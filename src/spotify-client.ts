import type { PagingResponse, SavedTrackItem, SpotifyUser } from "./types";

const SPOTIFY_API_BASE = "https://api.spotify.com/v1";
const SPOTIFY_ACCOUNTS_BASE = "https://accounts.spotify.com/api";
const MAX_RETRIES = 4;

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
    const params = new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: this.refreshToken,
      client_id: this.clientId,
      client_secret: this.clientSecret
    });

    const response = await fetch(`${SPOTIFY_ACCOUNTS_BASE}/token`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: params
    });

    const bodyText = await response.text();
    if (!response.ok) {
      throw new SpotifyApiError(response.status, buildErrorMessage(response.status, bodyText));
    }

    const parsed = JSON.parse(bodyText) as { access_token?: string };
    if (!parsed.access_token) {
      throw new Error("Spotify token response did not include access_token");
    }

    return parsed.access_token;
  }

  async getCurrentUser(accessToken: string): Promise<SpotifyUser> {
    return this.request<SpotifyUser>(`${SPOTIFY_API_BASE}/me`, {
      method: "GET",
      accessToken
    });
  }

  async getPlaylist(playlistId: string, accessToken: string): Promise<{ id: string } | null> {
    try {
      const result = await this.request<{ id: string }>(`${SPOTIFY_API_BASE}/playlists/${playlistId}?fields=id`, {
        method: "GET",
        accessToken
      });

      return result;
    } catch (error) {
      if (error instanceof SpotifyApiError && error.status === 404) {
        return null;
      }

      throw error;
    }
  }

  async createPublicPlaylist(
    userId: string,
    name: string,
    accessToken: string
  ): Promise<{ id: string; externalUrl: string | null }> {
    const payload = {
      name,
      public: true,
      description: "Mirror of liked songs (auto-synced)"
    };

    const response = await this.request<{ id: string; external_urls?: { spotify?: string } }>(
      `${SPOTIFY_API_BASE}/users/${userId}/playlists`,
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

    while (true) {
      const page = await this.request<PagingResponse<SavedTrackItem>>(
        `${SPOTIFY_API_BASE}/me/tracks?limit=${limit}&offset=${offset}`,
        {
          method: "GET",
          accessToken
        }
      );

      results.push(...page.items);

      if (!page.next || page.items.length === 0) {
        break;
      }

      offset += page.limit;
    }

    return results;
  }

  async replacePlaylistItems(playlistId: string, uris: string[], accessToken: string): Promise<void> {
    await this.request<void>(`${SPOTIFY_API_BASE}/playlists/${playlistId}/tracks`, {
      method: "PUT",
      body: { uris },
      accessToken
    });
  }

  async addPlaylistItems(playlistId: string, uris: string[], accessToken: string): Promise<void> {
    await this.request<void>(`${SPOTIFY_API_BASE}/playlists/${playlistId}/tracks`, {
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

      const response = await fetch(url, {
        method: options.method || "GET",
        headers,
        body: options.body !== undefined ? JSON.stringify(options.body) : undefined
      });

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
