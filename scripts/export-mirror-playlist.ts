import { promises as fs } from "node:fs";
import path from "node:path";
import { loadConfig } from "../src/config";
import { logger } from "../src/logger";
import { buildMirrorPlaylistExport } from "../src/playlist-export";
import { SpotifyClient } from "../src/spotify-client";
import { readState } from "../src/state-store";

/**
 * Resolves the required `--output` argument without allowing playlist metadata
 * to fall back to standard output or an accidental tracked path.
 *
 * @param {string[]} args - Command-line arguments following the script name.
 * @returns {string} Absolute output path for the metadata export.
 * @throws {Error} If `--output` is absent or has no value.
 */
function readOutputPath(args: string[]): string {
  const outputIndex = args.indexOf("--output");
  const outputValue = outputIndex >= 0 ? args[outputIndex + 1]?.trim() : "";

  if (!outputValue) {
    throw new Error("Usage: npm run export:mirror -- --output <ignored-json-path>");
  }

  return path.resolve(process.cwd(), outputValue);
}

/**
 * Fetches the configured mirror playlist with owner credentials and writes a
 * versioned metadata-only JSON file. No playlist write endpoint is called.
 *
 * @returns {Promise<void>} Resolves after the export file is written.
 */
async function main(): Promise<void> {
  const outputPath = readOutputPath(process.argv.slice(2));
  const config = loadConfig();
  const state = await readState(config.stateFilePath);

  if (!state.playlistId) {
    throw new Error("The mirror playlist ID is not configured in state/state.json");
  }

  const spotifyClient = new SpotifyClient(
    config.spotifyClientId,
    config.spotifyClientSecret,
    config.spotifyRefreshToken
  );
  const accessToken = await spotifyClient.refreshAccessToken();
  const playlistItems = await spotifyClient.fetchAllPlaylistItems(state.playlistId, accessToken);
  const exported = buildMirrorPlaylistExport({
    playlistId: state.playlistId,
    playlistItems,
    exportedAt: new Date().toISOString()
  });

  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, `${JSON.stringify(exported, null, 2)}\n`, "utf8");
  logger.info(
    `Mirror metadata export complete. tracks=${exported.tracks.length} ` +
      `skipped=${Object.values(exported.skipped).reduce((sum, value) => sum + value, 0)}`
  );
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  logger.error(`Mirror metadata export failed: ${message}`);
  process.exitCode = 1;
});
