import { describe, expect, it } from "vitest";
import { buildInitialPlaylistName, selectCandidateUris } from "../src/sync-service";

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
