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
});
