import type { PlaylistItem, SpotifyPlaylistTrack } from "./types";

export interface MirrorPlaylistExportArtist {
  id: string;
  uri: string;
  name: string;
  spotifyUrl: string | null;
}

export interface MirrorPlaylistExportAlbum {
  id: string | null;
  uri: string;
  name: string;
  releaseDate: string | null;
  spotifyUrl: string | null;
}

export interface MirrorPlaylistExportTrack {
  playlistPosition: number;
  addedAt: string | null;
  id: string;
  uri: string;
  name: string;
  isrc: string | null;
  durationMs: number;
  explicit: boolean;
  spotifyUrl: string | null;
  artists: MirrorPlaylistExportArtist[];
  album: MirrorPlaylistExportAlbum;
}

export interface MirrorPlaylistExport {
  schemaVersion: 2;
  exportedAt: string;
  source: {
    playlistId: string;
    spotifyUrl: string;
  };
  tracks: MirrorPlaylistExportTrack[];
  skipped: {
    unavailableItems: number;
    nonTrackItems: number;
    localTracks: number;
  };
}

interface BuildMirrorPlaylistExportOptions {
  playlistId: string;
  playlistItems: PlaylistItem[];
  exportedAt: string;
}

/**
 * Converts Spotify's playlist response into the stable, read-only contract
 * consumed by the separate genre-playlist repository.
 *
 * @param {BuildMirrorPlaylistExportOptions} options - Playlist identity, raw items, and export timestamp.
 * @returns {MirrorPlaylistExport} Versioned metadata with attribution links and skip counts.
 */
export function buildMirrorPlaylistExport(
  options: BuildMirrorPlaylistExportOptions
): MirrorPlaylistExport {
  const tracks: MirrorPlaylistExportTrack[] = [];
  let unavailableItems = 0;
  let nonTrackItems = 0;
  let localTracks = 0;

  for (const [playlistPosition, entry] of options.playlistItems.entries()) {
    if (!entry.item) {
      unavailableItems += 1;
      continue;
    }

    if (entry.item.type !== "track") {
      nonTrackItems += 1;
      continue;
    }

    if (entry.item.is_local) {
      localTracks += 1;
      continue;
    }

    if (!entry.item.id || !entry.item.uri) {
      unavailableItems += 1;
      continue;
    }

    tracks.push(mapTrack(entry.item, playlistPosition, entry.added_at));
  }

  return {
    schemaVersion: 2,
    exportedAt: options.exportedAt,
    source: {
      playlistId: options.playlistId,
      spotifyUrl: `https://open.spotify.com/playlist/${options.playlistId}`
    },
    tracks,
    skipped: {
      unavailableItems,
      nonTrackItems,
      localTracks
    }
  };
}

/**
 * Maps a Spotify track into the stable export representation.
 *
 * @param {SpotifyPlaylistTrack} track - Spotify playlist track to map.
 * @param {number} playlistPosition - Zero-based position in the source playlist.
 * @param {string | null} addedAt - Timestamp at which the track entered the playlist.
 * @returns {MirrorPlaylistExportTrack} Attributed track metadata for local deterministic processing.
 */
function mapTrack(
  track: SpotifyPlaylistTrack,
  playlistPosition: number,
  addedAt: string | null
): MirrorPlaylistExportTrack {
  return {
    playlistPosition,
    addedAt,
    id: track.id!,
    uri: track.uri,
    name: track.name,
    isrc: track.external_ids?.isrc ?? null,
    durationMs: track.duration_ms,
    explicit: track.explicit,
    spotifyUrl: track.external_urls?.spotify ?? null,
    artists: track.artists.map((artist) => ({
      id: artist.id,
      uri: artist.uri,
      name: artist.name,
      spotifyUrl: artist.external_urls?.spotify ?? null
    })),
    album: {
      id: track.album.id,
      uri: track.album.uri,
      name: track.album.name,
      releaseDate: track.album.release_date ?? null,
      spotifyUrl: track.album.external_urls?.spotify ?? null
    }
  };
}
