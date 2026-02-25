import { promises as fs } from "node:fs";
import path from "node:path";
import type { AppState } from "./types";

const DEFAULT_STATE: AppState = {
  playlistId: null
};

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

export async function writeState(stateFilePath: string, state: AppState): Promise<void> {
  await fs.mkdir(path.dirname(stateFilePath), { recursive: true });
  await fs.writeFile(stateFilePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}
