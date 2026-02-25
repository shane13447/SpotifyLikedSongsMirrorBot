export interface AppState {
  playlistId: string | null;
}

export interface SpotifyUser {
  id: string;
  display_name: string | null;
}

export interface SpotifyTrack {
  id: string;
  uri: string;
  is_local?: boolean;
  is_playable?: boolean | null;
}

export interface SavedTrackItem {
  added_at: string;
  track: SpotifyTrack | null;
}

export interface PagingResponse<T> {
  items: T[];
  limit: number;
  offset: number;
  total: number;
  next: string | null;
}

export interface SyncSummary {
  playlistId: string;
  createdPlaylist: boolean;
  likedCount: number;
  candidateCount: number;
  mirroredCount: number;
  skippedCount: number;
}
