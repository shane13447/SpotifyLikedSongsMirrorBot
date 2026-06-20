import { loadConfig } from "./config";
import { logger } from "./logger";
import { SpotifyClient } from "./spotify-client";
import { readState, writeState } from "./state-store";
import { syncLikedSongsMirror } from "./sync-service";

/**
 * Entry point for the sync run: loads configuration and persisted state,
 * constructs the Spotify client, performs the liked-songs mirror sync,
 * persists any new playlist ID, and logs a summary of the run.
 *
 * @returns {Promise<void>} Resolves once the sync has completed and results are logged.
 */
async function main(): Promise<void> {
  const config = loadConfig();
  const state = await readState(config.stateFilePath);

  const spotifyClient = new SpotifyClient(
    config.spotifyClientId,
    config.spotifyClientSecret,
    config.spotifyRefreshToken
  );

  const result = await syncLikedSongsMirror(spotifyClient, config, state);

  if (state.playlistId !== result.nextState.playlistId) {
    await writeState(config.stateFilePath, result.nextState);
    logger.info("Updated state/state.json with mirror playlist ID.");
  }

  logger.info(
    [
      "Sync complete.",
      `playlistId=${result.summary.playlistId}`,
      `createdPlaylist=${result.summary.createdPlaylist}`,
      `likedCount=${result.summary.likedCount}`,
      `candidateCount=${result.summary.candidateCount}`,
      `mirroredCount=${result.summary.mirroredCount}`,
      `skippedCount=${result.summary.skippedCount}`
    ].join(" ")
  );
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  logger.error(`Sync failed: ${message}`);
  process.exitCode = 1;
});
