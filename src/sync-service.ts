import type { AppConfig } from "./config";
import { logger } from "./logger";
import { SpotifyClient } from "./spotify-client";
import type { AppState, SavedTrackItem, SpotifyTrack, SyncSummary } from "./types";

const SPOTIFY_PLAYLIST_WRITE_BATCH_SIZE = 100;

export function buildInitialPlaylistName(displayName: string | null, fallbackName: string): string {
  const trimmed = displayName?.trim();
  if (!trimmed) {
    return fallbackName;
  }

  return `${trimmed}'s Liked Songs`;
}

function isSkippableTrack(track: SpotifyTrack | null): boolean {
  return !track || !track.uri || track.is_local === true || track.is_playable === false;
}

export function selectCandidateUris(likedTracks: SavedTrackItem[]): {
  uris: string[];
  likedCount: number;
  skippedCount: number;
} {
  const seenUris = new Set<string>();
  const uris: string[] = [];
  let skippedCount = 0;

  for (const item of likedTracks) {
    if (isSkippableTrack(item.track)) {
      skippedCount += 1;
      continue;
    }

    const uri = item.track!.uri;

    if (seenUris.has(uri)) {
      continue;
    }

    seenUris.add(uri);
    uris.push(uri);
  }

  return {
    uris,
    likedCount: likedTracks.length,
    skippedCount
  };
}

function chunk<T>(items: T[], size: number): T[][] {
  const result: T[][] = [];

  for (let i = 0; i < items.length; i += size) {
    result.push(items.slice(i, i + size));
  }

  return result;
}

export async function syncLikedSongsMirror(
  spotifyClient: SpotifyClient,
  config: AppConfig,
  state: AppState
): Promise<{ summary: SyncSummary; nextState: AppState }> {
  logger.info("Stage: refreshing access token.");
  const accessToken = await spotifyClient.refreshAccessToken();
  logger.info("Stage: access token acquired.");

  logger.info("Stage: fetching current user.");
  const currentUser = await spotifyClient.getCurrentUser(accessToken);
  logger.info(`Stage: current user fetched (userId=${currentUser.id}).`);

  logger.info("Stage: resolving mirror playlist.");
  let playlistId = state.playlistId;
  let createdPlaylist = false;

  if (playlistId) {
    logger.info(`Stage: checking existing playlist (playlistId=${playlistId}).`);
    const existing = await spotifyClient.getPlaylist(playlistId, accessToken);
    if (!existing) {
      logger.warn(`Stored playlist ID ${playlistId} was not found or inaccessible. Creating a new mirror playlist.`);
      playlistId = null;
    } else {
      logger.info(`Stage: existing playlist confirmed (playlistId=${playlistId}).`);
    }
  }

  if (!playlistId) {
    const playlistName = buildInitialPlaylistName(currentUser.display_name, config.fallbackPlaylistName);
    logger.info(`Stage: creating mirror playlist (${playlistName}).`);
    const created = await spotifyClient.createPublicPlaylist(playlistName, accessToken);
    playlistId = created.id;
    createdPlaylist = true;

    logger.info(`Created mirror playlist: ${playlistName} (${playlistId})`);
    if (created.externalUrl) {
      logger.info(`Playlist URL: ${created.externalUrl}`);
    }
  }

  logger.info("Stage: fetching liked tracks.");
  const likedTracks = await spotifyClient.fetchAllLikedTracks(accessToken);

  logger.info("Stage: selecting candidate URIs.");
  const candidate = selectCandidateUris(likedTracks);
  logger.info(
    `Stage: selected candidates likedCount=${candidate.likedCount} candidateCount=${candidate.uris.length} skippedCount=${candidate.skippedCount}`
  );

  // Replace the playlist contents atomically: a single PUT swaps the whole
  // playlist to the first batch in one operation (so the playlist is never
  // observed empty while there are tracks to mirror), then any remaining
  // batches are appended. Clearing first would leave the public playlist
  // empty or partially populated if a later write failed.
  const uriChunks = chunk(candidate.uris, SPOTIFY_PLAYLIST_WRITE_BATCH_SIZE);

  logger.info("Stage: replacing mirror playlist contents.");
  // PUT with the first batch atomically replaces all existing items. For an
  // empty library, uriChunks is empty and we PUT [] to clear the playlist.
  const [firstChunk, ...restChunks] = uriChunks;
  await spotifyClient.replacePlaylistItems(playlistId, firstChunk ?? [], accessToken);

  logger.info(`Stage: appending ${restChunks.length} additional chunk(s).`);
  for (const [chunkIndex, uriChunk] of restChunks.entries()) {
    logger.info(`Stage: writing chunk ${chunkIndex + 2}/${uriChunks.length} size=${uriChunk.length}.`);
    await spotifyClient.addPlaylistItems(playlistId, uriChunk, accessToken);
  }

  const skippedCount = candidate.skippedCount;

  return {
    summary: {
      playlistId,
      createdPlaylist,
      likedCount: candidate.likedCount,
      candidateCount: candidate.uris.length,
      mirroredCount: candidate.uris.length,
      skippedCount
    },
    nextState: {
      playlistId
    }
  };
}
