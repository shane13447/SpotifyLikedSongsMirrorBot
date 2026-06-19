import "dotenv/config";
import path from "node:path";

export interface AppConfig {
  spotifyClientId: string;
  spotifyClientSecret: string;
  spotifyRefreshToken: string;
  fallbackPlaylistName: string;
  stateFilePath: string;
}

/**
 * Reads a required environment variable, trimming surrounding whitespace.
 *
 * @param {string} name - Name of the environment variable to read.
 * @returns {string} The trimmed, non-empty value of the environment variable.
 * @throws {Error} If the variable is unset or empty after trimming.
 */
function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

/**
 * Builds the application configuration from environment variables, applying
 * defaults for optional settings.
 *
 * @returns {AppConfig} The resolved application configuration.
 * @throws {Error} If any required Spotify credential variable is missing.
 */
export function loadConfig(): AppConfig {
  return {
    spotifyClientId: requireEnv("SPOTIFY_CLIENT_ID"),
    spotifyClientSecret: requireEnv("SPOTIFY_CLIENT_SECRET"),
    spotifyRefreshToken: requireEnv("SPOTIFY_REFRESH_TOKEN"),
    fallbackPlaylistName: process.env.FALLBACK_PLAYLIST_NAME?.trim() || "Liked Songs Mirror",
    stateFilePath: path.resolve(process.cwd(), "state", "state.json")
  };
}
