# SpotifyLikedSongsMirrorBot

A Node.js + TypeScript bot that mirrors your Spotify **Liked Songs** into a public playlist, keeping the playlist fully synced in the same order (newest liked song at the top).

## What it does

- Creates one public playlist on first run.
- Initial playlist name is `<Spotify Profile Name>'s Liked Songs`.
- Stores the created playlist ID in `state/state.json` and reuses it in future runs.
- Fully mirrors liked songs each run:
  - adds newly liked songs,
  - removes songs you unliked,
  - preserves newest-first ordering.
- Skips unavailable/unplayable/local tracks and continues.
- Runs hourly via GitHub Actions.

## Repository scope

All implementation is contained in this repository/folder (`SpotifyLikedSongsMirrorBot`).

## Requirements

- Node.js 20+
- A Spotify Developer app with redirect URI support
- GitHub repository secrets (for cloud runner execution)

## Setup

1. Install dependencies:

   ```bash
   npm install
   ```

2. Copy `.env.example` to `.env` and set at least:

   - `SPOTIFY_CLIENT_ID`
   - `SPOTIFY_CLIENT_SECRET`
   - `SPOTIFY_REDIRECT_URI` (default: `http://127.0.0.1:8888/callback`)
   - `SPOTIFY_AUTH_PORT` (default: `8888`)

3. Generate a refresh token (one-time, local):

   ```bash
   npm run auth
   ```

   The script prints your `SPOTIFY_REFRESH_TOKEN` after OAuth completes.

   Required OAuth scopes used by the helper:
   - `user-library-read`
   - `playlist-modify-public`
   - `playlist-modify-private`
   - `user-read-private`

4. Add GitHub repository secrets:

   - `SPOTIFY_CLIENT_ID`
   - `SPOTIFY_CLIENT_SECRET`
   - `SPOTIFY_REFRESH_TOKEN`

5. Commit and push to GitHub. The workflow at `.github/workflows/sync-liked-songs.yml` runs hourly.

## Local run

For a local sync run (uses `.env`):

```bash
npm run sync
```

## State file

- `state/state.json` stores only the mirror playlist ID.
- On first successful creation, GitHub Actions commits this file automatically.
- If the playlist is deleted, the bot creates a new playlist and updates `state/state.json`.

## Scripts

- `npm run sync` — run sync job
- `npm run auth` — run one-time OAuth helper to get refresh token
- `npm run typecheck` — TypeScript check
- `npm test` — test suite
- `npm run build` — compile TypeScript
