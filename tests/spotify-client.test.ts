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
