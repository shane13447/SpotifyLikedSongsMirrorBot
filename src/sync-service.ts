import type { AppConfig } from "./config";
import { logger } from "./logger";
import { SpotifyClient } from "./spotify-client";
import type { AppState, SavedTrackItem, SpotifyTrack, SyncSummary } from "./types";

const SPOTIFY_PLAYLIST_WRITE_BATCH_SIZE = 100;

/**
 * Derives the mirror playlist name from the user's display name, falling back
 * to a provided default when no display name is available.
 *
 * @param {string | null} displayName - The user's Spotify display name, if any.
 * @param {string} fallbackName - The name to use when no display name is present.
 * @returns {string} The playlist name to use for a newly created mirror playlist.
 */
export function buildInitialPlaylistName(displayName: string | null, fallbackName: string): string {
  const trimmed = displayName?.trim();
  if (!trimmed) {
    return fallbackName;
  }

  return `${trimmed}'s Liked Songs`;
}

/**
 * Determines whether a saved track should be excluded from the mirror, i.e.
 * when it is missing, lacks a URI, is a local file, or is not playable.
 *
 * @param {SpotifyTrack | null} track - The track to evaluate, or null.
 * @returns {boolean} True if the track should be skipped, false otherwise.
 */
function isSkippableTrack(track: SpotifyTrack | null): boolean {
  return !track || !track.uri || track.is_local === true || track.is_playable === false;
}

/**
 * Selects the deduplicated, ordered list of track URIs to mirror from the
 * user's liked tracks, skipping unplayable/local/missing tracks.
 *
 * @param {SavedTrackItem[]} likedTracks - The user's saved track items.
 * @returns {{ uris: string[]; likedCount: number; skippedCount: number }}
 *   The selected URIs, the total number of liked tracks, and the count of skipped tracks.
 */
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

/**
 * Splits an array into consecutive sub-arrays of at most the given size.
 *
 * @template T The element type of the array.
 * @param {T[]} items - The array to split.
 * @param {number} size - The maximum size of each chunk.
 * @returns {T[][]} An array of chunks preserving the original order.
 */
function chunk<T>(items: T[], size: number): T[][] {
  const result: T[][] = [];

  for (let i = 0; i < items.length; i += size) {
    result.push(items.slice(i, i + size));
  }

  return result;
}

/**
 * Runs the full mirror sync: refreshes the access token, resolves (or creates)
 * the mirror playlist, fetches the user's liked tracks, selects the tracks to
 * mirror, then clears and repopulates the playlist in batches.
 *
 * @param {SpotifyClient} spotifyClient - The client used to call the Spotify API.
 * @param {AppConfig} config - The application configuration.
 * @param {AppState} state - The persisted state, including any known playlist ID.
 * @returns {Promise<{ summary: SyncSummary; nextState: AppState }>}
 *   A summary of the sync and the next state to persist.
 * @throws {SpotifyApiError} If a non-recoverable Spotify API error occurs.
 */
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

  logger.info("Stage: clearing mirror playlist.");
  await spotifyClient.replacePlaylistItems(playlistId, [], accessToken);

  logger.info("Stage: appending tracks to mirror playlist.");
  const uriChunks = chunk(candidate.uris, SPOTIFY_PLAYLIST_WRITE_BATCH_SIZE);
  logger.info(`Stage: writing ${uriChunks.length} chunks.`);
  for (const [chunkIndex, uriChunk] of uriChunks.entries()) {
    logger.info(`Stage: writing chunk ${chunkIndex + 1}/${uriChunks.length} size=${uriChunk.length}.`);
    await spotifyClient.addPlaylistItems(playlistId, uriChunk, accessToken);
  }
  const writeResult = { mirroredCount: candidate.uris.length, writeSkippedCount: 0 };

  const skippedCount = candidate.skippedCount + writeResult.writeSkippedCount;

  return {
    summary: {
      playlistId,
      createdPlaylist,
      likedCount: candidate.likedCount,
      candidateCount: candidate.uris.length,
      mirroredCount: writeResult.mirroredCount,
      skippedCount
    },
    nextState: {
      playlistId
    }
  };
}
