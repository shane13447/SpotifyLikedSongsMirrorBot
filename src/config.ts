import "dotenv/config";
import path from "node:path";

export interface AppConfig {
  spotifyClientId: string;
  spotifyClientSecret: string;
  spotifyRefreshToken: string;
  fallbackPlaylistName: string;
  stateFilePath: string;
}

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

export function loadConfig(): AppConfig {
  return {
    spotifyClientId: requireEnv("SPOTIFY_CLIENT_ID"),
    spotifyClientSecret: requireEnv("SPOTIFY_CLIENT_SECRET"),
    spotifyRefreshToken: requireEnv("SPOTIFY_REFRESH_TOKEN"),
    fallbackPlaylistName: process.env.FALLBACK_PLAYLIST_NAME?.trim() || "Liked Songs Mirror",
    stateFilePath: path.resolve(process.cwd(), "state", "state.json")
  };
}
