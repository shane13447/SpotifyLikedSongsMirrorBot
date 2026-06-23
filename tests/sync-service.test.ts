import { describe, expect, it } from "vitest";
import type { AppConfig } from "../src/config";
import type { SpotifyClient } from "../src/spotify-client";
import { buildInitialPlaylistName, selectCandidateUris, syncLikedSongsMirror } from "../src/sync-service";
import type { AppState, SavedTrackItem } from "../src/types";

type RecordedCall =
  | { op: "replace"; uris: string[] }
  | { op: "add"; uris: string[] };

function makeFakeClient(options: {
  likedTracks: SavedTrackItem[];
  existingPlaylistId?: string | null;
  calls: RecordedCall[];
}): SpotifyClient {
  return {
    refreshAccessToken: async () => "token",
    getCurrentUser: async () => ({ id: "user-1", display_name: "Shane" }),
    getPlaylist: async () =>
      options.existingPlaylistId ? { id: options.existingPlaylistId } : null,
    createPublicPlaylist: async () => ({ id: "new-playlist", externalUrl: null }),
    fetchAllLikedTracks: async () => options.likedTracks,
    replacePlaylistItems: async (_playlistId: string, uris: string[]) => {
      options.calls.push({ op: "replace", uris });
    },
    addPlaylistItems: async (_playlistId: string, uris: string[]) => {
      options.calls.push({ op: "add", uris });
    }
  } as unknown as SpotifyClient;
}

const baseConfig: AppConfig = {
  spotifyClientId: "id",
  spotifyClientSecret: "secret",
  spotifyRefreshToken: "refresh",
  fallbackPlaylistName: "Liked Songs Mirror",
  stateFilePath: "state/state.json"
};

function track(uri: string): SavedTrackItem {
  return { added_at: "2026-01-01T00:00:00.000Z", track: { id: uri, uri } };
}

describe("syncLikedSongsMirror playlist write", () => {
  it("replaces contents with the first batch (never clears first) then appends the rest", async () => {
    const likedTracks = Array.from({ length: 150 }, (_, i) => track(`spotify:track:${i}`));
    const calls: RecordedCall[] = [];
    const client = makeFakeClient({ likedTracks, existingPlaylistId: "p1", calls });
    const state: AppState = { playlistId: "p1" };

    const { summary } = await syncLikedSongsMirror(client, baseConfig, state);

    // First write is a PUT (replace) with the first 100 URIs, not an empty clear.
    expect(calls[0].op).toBe("replace");
    expect(calls[0].uris).toHaveLength(100);
    // Remaining 50 are appended via POST.
    expect(calls[1].op).toBe("add");
    expect(calls[1].uris).toHaveLength(50);
    // Playlist is never cleared with an empty replace while tracks exist.
    expect(calls.some((c) => c.op === "replace" && c.uris.length === 0)).toBe(false);
    expect(summary.mirroredCount).toBe(150);
  });

  it("clears the playlist with an empty replace when the library is empty", async () => {
    const calls: RecordedCall[] = [];
    const client = makeFakeClient({ likedTracks: [], existingPlaylistId: "p1", calls });
    const state: AppState = { playlistId: "p1" };

    const { summary } = await syncLikedSongsMirror(client, baseConfig, state);

    expect(calls).toEqual([{ op: "replace", uris: [] }]);
    expect(summary.mirroredCount).toBe(0);
  });
});

describe("buildInitialPlaylistName", () => {
  it("uses profile display name when available", () => {
    expect(buildInitialPlaylistName("Shane", "Liked Songs Mirror")).toBe("Shane's Liked Songs");
  });

  it("uses fallback when display name is missing", () => {
    expect(buildInitialPlaylistName(null, "Liked Songs Mirror")).toBe("Liked Songs Mirror");
  });
});

describe("selectCandidateUris", () => {
  it("keeps order and skips local/unplayable/null tracks", () => {
    const result = selectCandidateUris([
      {
        added_at: "2026-01-03T00:00:00.000Z",
        track: {
          id: "1",
          uri: "spotify:track:1"
        }
      },
      {
        added_at: "2026-01-02T00:00:00.000Z",
        track: {
          id: "2",
          uri: "spotify:track:2",
          is_local: true
        }
      },
      {
        added_at: "2026-01-01T00:00:00.000Z",
        track: {
          id: "3",
          uri: "spotify:track:3",
          is_playable: false
        }
      },
      {
        added_at: "2025-12-31T00:00:00.000Z",
        track: null
      },
      {
        added_at: "2025-12-30T00:00:00.000Z",
        track: {
          id: "1",
          uri: "spotify:track:1"
        }
      }
    ]);

    expect(result.uris).toEqual(["spotify:track:1"]);
    expect(result.likedCount).toBe(5);
    expect(result.skippedCount).toBe(3);
  });
});
