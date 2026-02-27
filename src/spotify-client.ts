import { logger } from "./logger";
import type { PagingResponse, SavedTrackItem, SpotifyUser } from "./types";

const SPOTIFY_API_BASE = "https://api.spotify.com/v1";
const SPOTIFY_ACCOUNTS_BASE = "https://accounts.spotify.com/api";
const MAX_RETRIES = 4;
const REQUEST_TIMEOUT_MS = 30000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseRetryAfterMs(headerValue: string | null): number | null {
  if (!headerValue) {
    return null;
  }

  const seconds = Number(headerValue);
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return null;
  }

  return seconds * 1000;
}

function buildErrorMessage(status: number, bodyText: string): string {
  if (!bodyText) {
    return `Spotify API request failed with status ${status}`;
  }

  try {
    const parsed = JSON.parse(bodyText) as { error?: { message?: string } | string; message?: string };

    if (typeof parsed.error === "string") {
      return `Spotify API request failed with status ${status}: ${parsed.error}`;
    }

    const errorMessage = parsed.error?.message || parsed.message;
    if (errorMessage) {
      return `Spotify API request failed with status ${status}: ${errorMessage}`;
    }
  } catch {
    // Ignore JSON parse failure and use plain text below.
  }

  return `Spotify API request failed with status ${status}: ${bodyText}`;
}

export class SpotifyApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "SpotifyApiError";
    this.status = status;
  }
}

interface RequestOptions {
  method?: "GET" | "POST" | "PUT";
  body?: unknown;
  accessToken?: string;
}

export class SpotifyClient {
  constructor(
    private readonly clientId: string,
    private readonly clientSecret: string,
    private readonly refreshToken: string
  ) {}

  async refreshAccessToken(): Promise<string> {
    let attempt = 0;

    while (true) {
      const params = new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: this.refreshToken,
        client_id: this.clientId,
        client_secret: this.clientSecret
      });

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

      let response: Response;
      try {
        response = await fetch(`${SPOTIFY_ACCOUNTS_BASE}/token`, {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded"
          },
          body: params,
          signal: controller.signal
        });
      } catch (error) {
        const isAbortError = error instanceof Error && error.name === "AbortError";
        if (isAbortError && attempt < MAX_RETRIES) {
          attempt += 1;
          const backoffMs = 500 * 2 ** (attempt - 1);
          logger.warn(`Spotify token request timed out after ${REQUEST_TIMEOUT_MS}ms. Retrying attempt ${attempt}.`);
          await sleep(backoffMs);
          continue;
        }

        throw error;
      } finally {
        clearTimeout(timeoutId);
      }

      const bodyText = await response.text();

      if (response.ok) {
        const parsed = JSON.parse(bodyText) as { access_token?: string };
        if (!parsed.access_token) {
          throw new Error("Spotify token response did not include access_token");
        }

        return parsed.access_token;
      }

      const shouldRetry = response.status === 429 || response.status >= 500;
      if (shouldRetry && attempt < MAX_RETRIES) {
        attempt += 1;
        const retryAfterMs = parseRetryAfterMs(response.headers.get("retry-after"));
        const backoffMs = retryAfterMs ?? 500 * 2 ** (attempt - 1);
        await sleep(backoffMs);
        continue;
      }

      throw new SpotifyApiError(response.status, buildErrorMessage(response.status, bodyText));
    }
  }

  async getCurrentUser(accessToken: string): Promise<SpotifyUser> {
    return this.request<SpotifyUser>(`${SPOTIFY_API_BASE}/me`, {
      method: "GET",
      accessToken
    });
  }

  async getPlaylist(playlistId: string, accessToken: string): Promise<{ id: string } | null> {
    logger.info(`Checking playlist existence for playlistId=${playlistId}.`);

    try {
      return await this.request<{ id: string }>(`${SPOTIFY_API_BASE}/playlists/${playlistId}?fields=id`, {
        method: "GET",
        accessToken
      });
    } catch (error) {
      if (error instanceof SpotifyApiError && error.status === 404) {
        return null;
      }

      throw error;
    }
  }

  async createPublicPlaylist(
    name: string,
    accessToken: string
  ): Promise<{ id: string; externalUrl: string | null }> {
    const payload = {
      name,
      public: true,
      description: "Mirror of liked songs (auto-synced)"
    };

    const response = await this.request<{ id: string; external_urls?: { spotify?: string } }>(
      `${SPOTIFY_API_BASE}/me/playlists`,
      {
        method: "POST",
        body: payload,
        accessToken
      }
    );

    return {
      id: response.id,
      externalUrl: response.external_urls?.spotify || null
    };
  }

  async fetchAllLikedTracks(accessToken: string): Promise<SavedTrackItem[]> {
    const results: SavedTrackItem[] = [];
    let offset = 0;
    const limit = 50;
    let total = Number.POSITIVE_INFINITY;

    while (results.length < total) {
      const page = await this.request<PagingResponse<SavedTrackItem>>(
        `${SPOTIFY_API_BASE}/me/tracks?limit=${limit}&offset=${offset}`,
        {
          method: "GET",
          accessToken
        }
      );

      total = page.total;
      logger.info(
        `Fetched liked tracks page offset=${page.offset} items=${page.items.length} collected=${results.length}/${total}`
      );

      if (page.items.length === 0) {
        break;
      }

      results.push(...page.items);
      offset += page.items.length;
    }

    logger.info(`Completed liked tracks fetch. collected=${results.length} total=${total}`);

    return results;
  }

  async replacePlaylistItems(playlistId: string, uris: string[], accessToken: string): Promise<void> {
    try {
      await this.request<void>(`${SPOTIFY_API_BASE}/playlists/${playlistId}/items`, {
        method: "PUT",
        body: { uris },
        accessToken
      });
    } catch (error) {
      // Spotify may return 403 when clearing an already-empty playlist. Ignore it.
      if (uris.length === 0 && error instanceof SpotifyApiError && error.status === 403) {
        return;
      }

      throw error;
    }
  }

  async addPlaylistItems(playlistId: string, uris: string[], accessToken: string): Promise<void> {
    await this.request<void>(`${SPOTIFY_API_BASE}/playlists/${playlistId}/items`, {
      method: "POST",
      body: { uris },
      accessToken
    });
  }

  private async request<T>(url: string, options: RequestOptions): Promise<T> {
    let attempt = 0;

    while (true) {
      const headers: Record<string, string> = {
        Accept: "application/json"
      };

      if (options.accessToken) {
        headers.Authorization = `Bearer ${options.accessToken}`;
      }

      if (options.body !== undefined) {
        headers["Content-Type"] = "application/json";
      }

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

      logger.info(`Spotify request attempt ${attempt + 1}: ${options.method || "GET"} ${url}`);

      let response: Response;
      try {
        response = await fetch(url, {
          method: options.method || "GET",
          headers,
          body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
          signal: controller.signal
        });
      } catch (error) {
        const isAbortError = error instanceof Error && error.name === "AbortError";
        if (isAbortError && attempt < MAX_RETRIES) {
          attempt += 1;
          const backoffMs = 500 * 2 ** (attempt - 1);
          logger.warn(`Spotify API request timed out after ${REQUEST_TIMEOUT_MS}ms. Retrying attempt ${attempt}.`);
          await sleep(backoffMs);
          continue;
        }

        throw error;
      } finally {
        clearTimeout(timeoutId);
      }

      const bodyText = await response.text();

      if (response.ok) {
        if (!bodyText) {
          return undefined as T;
        }

        return JSON.parse(bodyText) as T;
      }

      const shouldRetry = response.status === 429 || response.status >= 500;
      if (shouldRetry && attempt < MAX_RETRIES) {
        attempt += 1;
        const retryAfterMs = parseRetryAfterMs(response.headers.get("retry-after"));
        const backoffMs = retryAfterMs ?? 500 * 2 ** (attempt - 1);
        await sleep(backoffMs);
        continue;
      }

      throw new SpotifyApiError(response.status, buildErrorMessage(response.status, bodyText));
    }
  }
}
