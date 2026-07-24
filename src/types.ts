/**
 * Application state persisted to disk between sync runs (see `state-store.ts`).
 */
export interface AppState {
  /** ID of the mirror playlist created on a previous run, or `null` if one has not been created yet. */
  playlistId: string | null;
}

/**
 * The authenticated Spotify user, as returned by `GET /v1/me`.
 */
export interface SpotifyUser {
  /** Spotify user ID. */
  id: string;
  /** User's display name, or `null` if not set. */
  display_name: string | null;
}

/**
 * A Spotify track as embedded in a saved-tracks (liked songs) item.
 */
export interface SpotifyTrack {
  /** Spotify track ID. */
  id: string;
  /** Spotify URI for the track (e.g. `spotify:track:...`), used when writing playlist items. */
  uri: string;
  /** `true` if this is a local file rather than a catalog track. */
  is_local?: boolean;
  /**
   * Whether the track is playable in the requesting market. Only populated when the
   * request includes a `market` query parameter; otherwise `undefined`/`null`.
   */
  is_playable?: boolean | null;
}

/**
 * A single item from the `/v1/me/tracks` (liked songs) endpoint.
 */
export interface SavedTrackItem {
  /** ISO-8601 timestamp of when the track was liked/saved. */
  added_at: string;
  /** The saved track, or `null` if Spotify could not resolve it (e.g. removed from catalog). */
  track: SpotifyTrack | null;
}

/**
 * Public Spotify link attached to exported catalogue entities.
 */
export interface SpotifyExternalUrls {
  spotify?: string;
}

/**
 * Artist reference embedded in a Spotify playlist track.
 */
export interface SpotifyArtistReference {
  id: string;
  uri: string;
  name: string;
  external_urls?: SpotifyExternalUrls;
}

/**
 * Album reference embedded in a Spotify playlist track.
 */
export interface SpotifyAlbumReference {
  id: string | null;
  uri: string;
  name: string;
  release_date?: string | null;
  external_urls?: SpotifyExternalUrls;
}

/**
 * Track object returned by Spotify's 2026 playlist-items response.
 */
export interface SpotifyPlaylistTrack {
  type: "track";
  id: string | null;
  uri: string;
  name: string;
  duration_ms: number;
  explicit: boolean;
  is_local?: boolean;
  external_urls?: SpotifyExternalUrls;
  artists: SpotifyArtistReference[];
  album: SpotifyAlbumReference;
}

/**
 * Minimal episode shape used to identify and exclude non-track playlist items.
 */
export interface SpotifyPlaylistEpisode {
  type: "episode";
  id: string | null;
  uri: string;
  name: string;
}

/**
 * A playlist entry from Spotify's 2026 `/playlists/{id}/items` endpoint.
 */
export interface PlaylistItem {
  added_at: string | null;
  item: SpotifyPlaylistTrack | SpotifyPlaylistEpisode | null;
}

/**
 * Generic shape of a Spotify paginated list response.
 *
 * @typeParam T - The type of each item in the page.
 */
export interface PagingResponse<T> {
  /** Items on this page. */
  items: T[];
  /** Page size requested. */
  limit: number;
  /** Offset of the first item in this page. */
  offset: number;
  /** Total number of items across all pages, as reported at the time of this page's request. */
  total: number;
  /** Absolute URL of the next page, or `null` if this is the last page. */
  next: string | null;
}

/**
 * Summary of a completed sync run, used for logging and the process exit summary.
 */
export interface SyncSummary {
  /** ID of the mirror playlist that was synced. */
  playlistId: string;
  /** `true` if the mirror playlist did not already exist and was created during this run. */
  createdPlaylist: boolean;
  /** Total number of liked (saved) tracks fetched. */
  likedCount: number;
  /** Number of liked tracks that passed the skip filter and were candidates for mirroring. */
  candidateCount: number;
  /** Number of tracks actually written to the mirror playlist. */
  mirroredCount: number;
  /** Number of liked tracks skipped (unavailable, unplayable, or local). */
  skippedCount: number;
}
