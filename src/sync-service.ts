import type { AppConfig } from "./config";
import { logger } from "./logger";
import { SpotifyApiError, SpotifyClient } from "./spotify-client";
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

function shouldFallbackToSingleWrites(error: unknown): boolean {
  return error instanceof SpotifyApiError && error.status === 400;
}

function isPerTrackAvailabilityError(error: unknown): boolean {
  if (!(error instanceof SpotifyApiError) || error.status !== 400) {
    return false;
  }

  const message = error.message.toLowerCase();

  return (
    message.includes("not available") ||
    message.includes("unavailable") ||
    message.includes("not found") ||
    message.includes("invalid track uri") ||
    message.includes("invalid base62")
  );
}

async function appendWithFallback(
  spotifyClient: SpotifyClient,
  playlistId: string,
  accessToken: string,
  uris: string[]
): Promise<{ mirroredCount: number; writeSkippedCount: number }> {
  let mirroredCount = 0;
  let writeSkippedCount = 0;
  const chunks = chunk(uris, SPOTIFY_PLAYLIST_WRITE_BATCH_SIZE);

  logger.info(`Writing playlist in ${chunks.length} chunks of up to ${SPOTIFY_PLAYLIST_WRITE_BATCH_SIZE}.`);

  for (const [chunkIndex, uriChunk] of chunks.entries()) {
    logger.info(
      `Writing chunk ${chunkIndex + 1}/${chunks.length} size=${uriChunk.length} mirroredSoFar=${mirroredCount}`
    );

    try {
      await spotifyClient.addPlaylistItems(playlistId, uriChunk, accessToken);
      mirroredCount += uriChunk.length;
      continue;
    } catch (error) {
      if (!shouldFallbackToSingleWrites(error)) {
        throw error;
      }

      logger.warn(
        `Chunk add failed for ${uriChunk.length} tracks with status 400. Falling back to single-track writes.`
      );
    }

    for (const uri of uriChunk) {
      try {
        await spotifyClient.addPlaylistItems(playlistId, [uri], accessToken);
        mirroredCount += 1;
      } catch (error) {
        if (!isPerTrackAvailabilityError(error)) {
          throw error;
        }

        writeSkippedCount += 1;
        logger.warn(`Skipping unavailable track URI: ${uri}`);
      }
    }
  }

  return { mirroredCount, writeSkippedCount };
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
      logger.warn(`Stored playlist ID ${playlistId} was not found. Creating a new mirror playlist.`);
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
