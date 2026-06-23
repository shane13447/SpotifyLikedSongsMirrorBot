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
