import { logger } from "./logger";
import type { PagingResponse, SavedTrackItem, SpotifyUser } from "./types";

const SPOTIFY_API_BASE = "https://api.spotify.com/v1";
const SPOTIFY_ACCOUNTS_BASE = "https://accounts.spotify.com/api";
const MAX_RETRIES = 4;
const REQUEST_TIMEOUT_MS = 30000;

/**
 * Returns a promise that resolves after the given delay.
 *
 * @param {number} ms - Number of milliseconds to wait.
 * @returns {Promise<void>} Resolves once the delay has elapsed.
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Parses a `Retry-After` header value (in seconds) into milliseconds.
 *
 * @param {string | null} headerValue - The raw header value, or null if absent.
 * @returns {number | null} The delay in milliseconds, or null if the value is missing or invalid.
 */
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

/**
 * Builds a human-readable error message for a failed Spotify API response,
 * extracting the API's error message from the JSON body when available.
 *
 * @param {number} status - The HTTP status code of the failed response.
 * @param {string} bodyText - The raw response body text.
 * @returns {string} A descriptive error message including the status and any parsed detail.
 */
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

/**
 * Error thrown when the Spotify API responds with a non-OK HTTP status,
 * carrying the status code for callers to inspect.
 */
export class SpotifyApiError extends Error {
  readonly status: number;

  /**
   * @param {number} status - The HTTP status code returned by the Spotify API.
   * @param {string} message - A descriptive error message.
   */
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

/**
 * Thin client for the Spotify Web API covering the operations needed to mirror
 * liked songs: token refresh, user lookup, and playlist read/write. Requests
 * are retried with exponential backoff on rate-limit and server errors.
 */
export class SpotifyClient {
  /**
   * @param {string} clientId - The Spotify application client ID.
   * @param {string} clientSecret - The Spotify application client secret.
   * @param {string} refreshToken - The OAuth refresh token used to obtain access tokens.
   */
  constructor(
    private readonly clientId: string,
    private readonly clientSecret: string,
    private readonly refreshToken: string
  ) {}

  /**
   * Exchanges the configured refresh token for a short-lived access token,
   * retrying with backoff on timeouts, rate limits, and server errors.
   *
   * @returns {Promise<string>} A valid Spotify access token.
   * @throws {SpotifyApiError} If the token endpoint returns a non-retryable error or exhausts retries.
   * @throws {Error} If the response omits an access token or a non-abort network error occurs.
   */
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

  /**
   * Fetches the profile of the user that owns the access token.
   *
   * @param {string} accessToken - A valid Spotify access token.
   * @returns {Promise<SpotifyUser>} The current user's profile.
   * @throws {SpotifyApiError} If the request fails.
   */
  async getCurrentUser(accessToken: string): Promise<SpotifyUser> {
    return this.request<SpotifyUser>(`${SPOTIFY_API_BASE}/me`, {
      method: "GET",
      accessToken
    });
  }

  /**
   * Checks whether a playlist exists and is accessible to the current user.
   *
   * @param {string} playlistId - The Spotify playlist ID to look up.
   * @param {string} accessToken - A valid Spotify access token.
   * @returns {Promise<{ id: string } | null>} The playlist's id, or null if it is missing or inaccessible (403/404).
   * @throws {SpotifyApiError} If the request fails with a status other than 403 or 404.
   */
  async getPlaylist(playlistId: string, accessToken: string): Promise<{ id: string } | null> {
    logger.info(`Checking playlist existence for playlistId=${playlistId}.`);

    try {
      return await this.request<{ id: string }>(`${SPOTIFY_API_BASE}/playlists/${playlistId}?fields=id`, {
        method: "GET",
        accessToken
      });
    } catch (error) {
      if (error instanceof SpotifyApiError && (error.status === 403 || error.status === 404)) {
        return null;
      }

      throw error;
    }
  }

  /**
   * Creates a new public playlist for the current user.
   *
   * @param {string} name - The display name for the new playlist.
   * @param {string} accessToken - A valid Spotify access token.
   * @returns {Promise<{ id: string; externalUrl: string | null }>} The new playlist's id and public URL (null if absent).
   * @throws {SpotifyApiError} If the request fails.
   */
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

  /**
   * Fetches every page of the current user's liked (saved) tracks.
   *
   * @param {string} accessToken - A valid Spotify access token.
   * @returns {Promise<SavedTrackItem[]>} All saved track items in their original order.
   * @throws {SpotifyApiError} If any page request fails.
   */
  async fetchAllLikedTracks(accessToken: string): Promise<SavedTrackItem[]> {
    const results: SavedTrackItem[] = [];
    let offset = 0;
    const limit = 50;
    let total = Number.POSITIVE_INFINITY;

    while (results.length < total) {
      // Pass market=from_token so Spotify resolves track relinking and
      // populates `is_playable` for the authenticated user's market. Without a
      // market the field is omitted, leaving the downstream is_playable===false
      // skip filter (sync-service) inert and unavailable tracks silently
      // mirrored.
      const page = await this.request<PagingResponse<SavedTrackItem>>(
        `${SPOTIFY_API_BASE}/me/tracks?limit=${limit}&offset=${offset}&market=from_token`,
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

  /**
   * Replaces all items in a playlist with the given URIs (passing an empty
   * array clears the playlist). A 403 returned while clearing an already-empty
   * playlist is treated as success.
   *
   * @param {string} playlistId - The target playlist ID.
   * @param {string[]} uris - The track URIs to set as the playlist's contents.
   * @param {string} accessToken - A valid Spotify access token.
   * @returns {Promise<void>} Resolves once the playlist items have been replaced.
   * @throws {SpotifyApiError} If the request fails (other than the ignored empty-clear 403 case).
   */
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

  /**
   * Appends the given track URIs to the end of a playlist.
   *
   * @param {string} playlistId - The target playlist ID.
   * @param {string[]} uris - The track URIs to append.
   * @param {string} accessToken - A valid Spotify access token.
   * @returns {Promise<void>} Resolves once the items have been added.
   * @throws {SpotifyApiError} If the request fails.
   */
  async addPlaylistItems(playlistId: string, uris: string[], accessToken: string): Promise<void> {
    await this.request<void>(`${SPOTIFY_API_BASE}/playlists/${playlistId}/items`, {
      method: "POST",
      body: { uris },
      accessToken
    });
  }

  /**
   * Performs an authenticated JSON request against the Spotify API, retrying
   * with exponential backoff on timeouts, rate limits (429), and server errors
   * (5xx). Parses the JSON response body, or returns undefined for empty bodies.
   *
   * @template T The expected shape of the parsed response body.
   * @param {string} url - The fully-qualified request URL.
   * @param {RequestOptions} options - Request method, optional JSON body, and optional access token.
   * @returns {Promise<T>} The parsed response body (undefined when the body is empty).
   * @throws {SpotifyApiError} If the response is a non-retryable error or retries are exhausted.
   * @throws {Error} If a non-abort network error occurs.
   */
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
