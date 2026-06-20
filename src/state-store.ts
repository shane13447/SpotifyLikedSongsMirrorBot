import { promises as fs } from "node:fs";
import path from "node:path";
import type { AppState } from "./types";

const DEFAULT_STATE: AppState = {
  playlistId: null
};

/**
 * Reads the persisted application state from disk. If the file does not exist,
 * the default state is written to disk and returned.
 *
 * @param {string} stateFilePath - Absolute path to the state JSON file.
 * @returns {Promise<AppState>} The parsed (or freshly initialized) application state.
 * @throws {Error} If the file exists but cannot be read for a reason other than absence.
 */
export async function readState(stateFilePath: string): Promise<AppState> {
  try {
    const raw = await fs.readFile(stateFilePath, "utf8");
    const parsed = JSON.parse(raw) as Partial<AppState>;

    return {
      playlistId: typeof parsed.playlistId === "string" ? parsed.playlistId : null
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      await writeState(stateFilePath, DEFAULT_STATE);
      return { ...DEFAULT_STATE };
    }

    throw new Error(`Failed to read state file (${stateFilePath}): ${(error as Error).message}`);
  }
}

/**
 * Persists the application state to disk as pretty-printed JSON, creating any
 * missing parent directories.
 *
 * @param {string} stateFilePath - Absolute path to the state JSON file.
 * @param {AppState} state - The application state to persist.
 * @returns {Promise<void>} Resolves once the state has been written.
 */
export async function writeState(stateFilePath: string, state: AppState): Promise<void> {
  await fs.mkdir(path.dirname(stateFilePath), { recursive: true });
  await fs.writeFile(stateFilePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}
