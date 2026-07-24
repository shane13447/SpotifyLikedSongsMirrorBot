import { describe, expect, it } from "vitest";
import { SpotifyClient } from "../src/spotify-client";

describe("SpotifyClient fetch pagination", () => {
  it("collects all liked track pages", async () => {
    const originalFetch = globalThis.fetch;

    try {
      const responses = [
        {
          items: [
            {
              added_at: "2026-01-02T00:00:00.000Z",
              track: { id: "1", uri: "spotify:track:1" }
            }
          ],
          limit: 1,
          offset: 0,
          total: 2,
          next: "next"
        },
        {
          items: [
            {
              added_at: "2026-01-01T00:00:00.000Z",
              track: { id: "2", uri: "spotify:track:2" }
            }
          ],
          limit: 1,
          offset: 1,
          total: 2,
          next: null
        }
      ];

      let callCount = 0;
      globalThis.fetch = (async () => {
        const payload = responses[callCount++];
        return {
          ok: true,
          status: 200,
          headers: new Headers(),
          text: async () => JSON.stringify(payload)
        } as Response;
      }) as typeof fetch;

      const client = new SpotifyClient("id", "secret", "refresh");
      const result = await client.fetchAllLikedTracks("token");

      expect(result).toHaveLength(2);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("follows the next cursor across multiple pages instead of a snapshot total", async () => {
    const originalFetch = globalThis.fetch;

    try {
      const requestedUrls: string[] = [];
      const responses = [
        {
          items: [{ added_at: "2026-01-03T00:00:00.000Z", track: { id: "1", uri: "spotify:track:1" } }],
          limit: 1,
          offset: 0,
          total: 3,
          next: "https://api.spotify.com/v1/me/tracks?limit=1&offset=1"
        },
        {
          items: [{ added_at: "2026-01-02T00:00:00.000Z", track: { id: "2", uri: "spotify:track:2" } }],
          limit: 1,
          offset: 1,
          total: 3,
          next: "https://api.spotify.com/v1/me/tracks?limit=1&offset=2"
        },
        {
          items: [{ added_at: "2026-01-01T00:00:00.000Z", track: { id: "3", uri: "spotify:track:3" } }],
          limit: 1,
          offset: 2,
          total: 3,
          next: null
        }
      ];

      let callCount = 0;
      globalThis.fetch = (async (url: string) => {
        requestedUrls.push(url);
        const payload = responses[callCount++];
        return {
          ok: true,
          status: 200,
          headers: new Headers(),
          text: async () => JSON.stringify(payload)
        } as Response;
      }) as typeof fetch;

      const client = new SpotifyClient("id", "secret", "refresh");
      const result = await client.fetchAllLikedTracks("token");

      expect(result).toHaveLength(3);
      expect(result.map((item) => item.track?.id)).toEqual(["1", "2", "3"]);
      // Subsequent requests must use the URLs from `next`, not self-computed offsets.
      expect(requestedUrls[1]).toBe("https://api.spotify.com/v1/me/tracks?limit=1&offset=1");
      expect(requestedUrls[2]).toBe("https://api.spotify.com/v1/me/tracks?limit=1&offset=2");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("requests /me/tracks with market=from_token so is_playable is populated", async () => {
    const originalFetch = globalThis.fetch;

    try {
      const requestedUrls: string[] = [];
      globalThis.fetch = (async (url: string) => {
        requestedUrls.push(url);
        return {
          ok: true,
          status: 200,
          headers: new Headers(),
          text: async () =>
            JSON.stringify({
              items: [{ added_at: "2026-01-01T00:00:00.000Z", track: { id: "1", uri: "spotify:track:1" } }],
              limit: 50,
              offset: 0,
              total: 1,
              next: null
            })
        } as Response;
      }) as typeof fetch;

      const client = new SpotifyClient("id", "secret", "refresh");
      await client.fetchAllLikedTracks("token");

      expect(requestedUrls).toHaveLength(1);
      const requested = new URL(requestedUrls[0]);
      expect(requested.pathname).toBe("/v1/me/tracks");
      expect(requested.searchParams.get("market")).toBe("from_token");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("stops on a null next cursor even when total shrinks mid-read (library shrinking)", async () => {
    const originalFetch = globalThis.fetch;

    try {
      // First page reports total=3 (next set); by the second page the library
      // has shrunk: total drops to 2 and next is null. Driving off a snapshot
      // total (3) would over-page and re-request a now-missing page; following
      // `next` correctly stops after the second page.
      const responses = [
        {
          items: [{ added_at: "2026-01-03T00:00:00.000Z", track: { id: "1", uri: "spotify:track:1" } }],
          limit: 1,
          offset: 0,
          total: 3,
          next: "https://api.spotify.com/v1/me/tracks?limit=1&offset=1"
        },
        {
          items: [{ added_at: "2026-01-02T00:00:00.000Z", track: { id: "2", uri: "spotify:track:2" } }],
          limit: 1,
          offset: 1,
          total: 2,
          next: null
        }
      ];

      let callCount = 0;
      globalThis.fetch = (async () => {
        const payload = responses[callCount++];
        if (!payload) {
          throw new Error(`Unexpected extra page request (call #${callCount})`);
        }
        return {
          ok: true,
          status: 200,
          headers: new Headers(),
          text: async () => JSON.stringify(payload)
        } as Response;
      }) as typeof fetch;

      const client = new SpotifyClient("id", "secret", "refresh");
      const result = await client.fetchAllLikedTracks("token");

      expect(callCount).toBe(2);
      expect(result.map((item) => item.track?.id)).toEqual(["1", "2"]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe("SpotifyClient 401 handling", () => {
  it("refreshes the access token and retries once on a 401", async () => {
    const originalFetch = globalThis.fetch;

    try {
      const calls: string[] = [];
      let apiCallCount = 0;
      let tokenCallCount = 0;

      globalThis.fetch = (async (input: RequestInfo | URL) => {
        const url = typeof input === "string" ? input : input.toString();
        calls.push(url);

        if (url.includes("accounts.spotify.com")) {
          tokenCallCount += 1;
          return {
            ok: true,
            status: 200,
            headers: new Headers(),
            text: async () => JSON.stringify({ access_token: "fresh-token" })
          } as Response;
        }

        apiCallCount += 1;
        if (apiCallCount === 1) {
          // First API call: simulate an expired token mid-sync.
          return {
            ok: false,
            status: 401,
            headers: new Headers(),
            text: async () => JSON.stringify({ error: { message: "The access token expired" } })
          } as Response;
        }

        return {
          ok: true,
          status: 200,
          headers: new Headers(),
          text: async () => JSON.stringify({ id: "user-1", display_name: "Shane" })
        } as Response;
      }) as typeof fetch;

      const client = new SpotifyClient("id", "secret", "refresh");
      const user = await client.getCurrentUser("stale-token");

      expect(user.id).toBe("user-1");
      // One token refresh triggered, and the API call retried after it.
      expect(tokenCallCount).toBe(1);
      expect(apiCallCount).toBe(2);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("does not loop forever when the refreshed token still yields 401", async () => {
    const originalFetch = globalThis.fetch;

    try {
      let tokenCallCount = 0;

      globalThis.fetch = (async (input: RequestInfo | URL) => {
        const url = typeof input === "string" ? input : input.toString();

        if (url.includes("accounts.spotify.com")) {
          tokenCallCount += 1;
          return {
            ok: true,
            status: 200,
            headers: new Headers(),
            text: async () => JSON.stringify({ access_token: "fresh-token" })
          } as Response;
        }

        return {
          ok: false,
          status: 401,
          headers: new Headers(),
          text: async () => JSON.stringify({ error: { message: "Invalid token" } })
        } as Response;
      }) as typeof fetch;

      const client = new SpotifyClient("id", "secret", "refresh");

      await expect(client.getCurrentUser("stale-token")).rejects.toMatchObject({ status: 401 });
      // Refresh attempted exactly once; the second 401 is treated as fatal.
      expect(tokenCallCount).toBe(1);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe("SpotifyClient response parsing", () => {
  it("throws a descriptive error when a 2xx body is not valid JSON", async () => {
    const originalFetch = globalThis.fetch;

    try {
      globalThis.fetch = (async () =>
        ({
          ok: true,
          status: 200,
          headers: new Headers(),
          text: async () => "<html>502 Bad Gateway</html>"
        }) as Response) as typeof fetch;

      const client = new SpotifyClient("id", "secret", "refresh");

      await expect(client.getCurrentUser("token")).rejects.toThrow(
        /Failed to parse Spotify API response as JSON/
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("honors Retry-After: 0 (immediate retry) on a 429", async () => {
    const originalFetch = globalThis.fetch;

    try {
      let callCount = 0;
      globalThis.fetch = (async () => {
        callCount += 1;
        if (callCount === 1) {
          return {
            ok: false,
            status: 429,
            headers: new Headers({ "retry-after": "0" }),
            text: async () => JSON.stringify({ error: { message: "rate limited" } })
          } as Response;
        }

        return {
          ok: true,
          status: 200,
          headers: new Headers(),
          text: async () => JSON.stringify({ id: "user-1", display_name: "Shane" })
        } as Response;
      }) as typeof fetch;

      const client = new SpotifyClient("id", "secret", "refresh");
      const start = Date.now();
      const user = await client.getCurrentUser("token");
      const elapsed = Date.now() - start;

      expect(user.id).toBe("user-1");
      expect(callCount).toBe(2);
      // Retry-After: 0 should not fall back to the ~500ms exponential backoff.
      expect(elapsed).toBeLessThan(300);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe("SpotifyClient playlist export pagination", () => {
  it("fetches the owner mirror through the 2026 playlist items endpoint", async () => {
    const originalFetch = globalThis.fetch;

    try {
      const requestedUrls: string[] = [];
      const responses = [
        {
          items: [
            {
              added_at: "2026-07-24T10:00:00.000Z",
              item: {
                type: "track",
                id: "track-1",
                uri: "spotify:track:track-1",
                name: "Synthetic Track One",
                duration_ms: 180000,
                explicit: false,
                is_local: false,
                external_urls: { spotify: "https://open.spotify.com/track/track-1" },
                artists: [],
                album: {
                  id: "album-1",
                  uri: "spotify:album:album-1",
                  name: "Synthetic Album",
                  release_date: "2026",
                  external_urls: { spotify: "https://open.spotify.com/album/album-1" }
                }
              }
            }
          ],
          limit: 1,
          offset: 0,
          total: 2,
          next: "https://api.spotify.com/v1/playlists/playlist-1/items?limit=1&offset=1"
        },
        {
          items: [
            {
              added_at: "2026-07-24T09:00:00.000Z",
              item: {
                type: "track",
                id: "track-2",
                uri: "spotify:track:track-2",
                name: "Synthetic Track Two",
                duration_ms: 200000,
                explicit: true,
                is_local: false,
                external_urls: { spotify: "https://open.spotify.com/track/track-2" },
                artists: [],
                album: {
                  id: "album-2",
                  uri: "spotify:album:album-2",
                  name: "Synthetic Album Two",
                  release_date: "2025",
                  external_urls: { spotify: "https://open.spotify.com/album/album-2" }
                }
              }
            }
          ],
          limit: 1,
          offset: 1,
          total: 2,
          next: null
        }
      ];

      let callCount = 0;
      globalThis.fetch = (async (url: string) => {
        requestedUrls.push(url);
        return {
          ok: true,
          status: 200,
          headers: new Headers(),
          text: async () => JSON.stringify(responses[callCount++])
        } as Response;
      }) as typeof fetch;

      const client = new SpotifyClient("id", "secret", "refresh");
      const result = await client.fetchAllPlaylistItems("playlist-1", "token");

      expect(result).toHaveLength(2);
      expect(result.map((entry) => entry.item?.id)).toEqual(["track-1", "track-2"]);
      expect(new URL(requestedUrls[0]).pathname).toBe("/v1/playlists/playlist-1/items");
      expect(requestedUrls[1]).toBe(
        "https://api.spotify.com/v1/playlists/playlist-1/items?limit=1&offset=1"
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
