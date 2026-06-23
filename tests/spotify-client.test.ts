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
