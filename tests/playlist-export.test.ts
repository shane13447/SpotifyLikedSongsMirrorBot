import { describe, expect, it } from "vitest";
import { buildMirrorPlaylistExport } from "../src/playlist-export";
import type { PlaylistItem } from "../src/types";

describe("buildMirrorPlaylistExport", () => {
  it("creates a versioned, attributed export without non-track entries", () => {
    const playlistItems: PlaylistItem[] = [
      {
        added_at: "2026-07-24T10:00:00.000Z",
        item: {
          type: "track",
          id: "track-1",
          uri: "spotify:track:track-1",
          name: "Synthetic Track",
          duration_ms: 180000,
          explicit: false,
          is_local: false,
          external_urls: { spotify: "https://open.spotify.com/track/track-1" },
          artists: [
            {
              id: "artist-1",
              uri: "spotify:artist:artist-1",
              name: "Synthetic Artist",
              external_urls: { spotify: "https://open.spotify.com/artist/artist-1" }
            }
          ],
          album: {
            id: "album-1",
            uri: "spotify:album:album-1",
            name: "Synthetic Album",
            release_date: "2026",
            external_urls: { spotify: "https://open.spotify.com/album/album-1" }
          }
        }
      },
      {
        added_at: "2026-07-24T09:00:00.000Z",
        item: {
          type: "episode",
          id: "episode-1",
          uri: "spotify:episode:episode-1",
          name: "Synthetic Episode"
        }
      },
      {
        added_at: null,
        item: null
      }
    ];

    const result = buildMirrorPlaylistExport({
      playlistId: "playlist-1",
      playlistItems,
      exportedAt: "2026-07-24T12:00:00.000Z"
    });

    expect(result.schemaVersion).toBe(1);
    expect(result.source).toEqual({
      playlistId: "playlist-1",
      spotifyUrl: "https://open.spotify.com/playlist/playlist-1"
    });
    expect(result.tracks).toHaveLength(1);
    expect(result.tracks[0]).toMatchObject({
      playlistPosition: 0,
      id: "track-1",
      name: "Synthetic Track",
      spotifyUrl: "https://open.spotify.com/track/track-1",
      artists: [
        {
          id: "artist-1",
          name: "Synthetic Artist",
          spotifyUrl: "https://open.spotify.com/artist/artist-1"
        }
      ],
      album: {
        id: "album-1",
        name: "Synthetic Album",
        spotifyUrl: "https://open.spotify.com/album/album-1"
      }
    });
    expect(result.skipped).toEqual({
      unavailableItems: 1,
      nonTrackItems: 1,
      localTracks: 0
    });
  });

  it("skips local tracks because they cannot be resolved outside the source device", () => {
    const result = buildMirrorPlaylistExport({
      playlistId: "playlist-1",
      exportedAt: "2026-07-24T12:00:00.000Z",
      playlistItems: [
        {
          added_at: "2026-07-24T10:00:00.000Z",
          item: {
            type: "track",
            id: "local-track",
            uri: "spotify:local:artist:album:track:180",
            name: "Synthetic Local Track",
            duration_ms: 180000,
            explicit: false,
            is_local: true,
            external_urls: {},
            artists: [],
            album: {
              id: null,
              uri: "spotify:album:local",
              name: "Synthetic Local Album",
              release_date: null,
              external_urls: {}
            }
          }
        }
      ]
    });

    expect(result.tracks).toEqual([]);
    expect(result.skipped.localTracks).toBe(1);
  });
});
