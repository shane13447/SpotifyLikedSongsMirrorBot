# SpotifyLikedSongsMirrorBot

Behold... my **Spotify-Liked-Songs-Mirror-Inator**!

A Node.js + TypeScript bot that mirrors your Spotify **Liked Songs** into a public playlist, keeping it perfectly synced in the same order (newest liked song at the top), just as any respectable -inator should.

## What this -inator does

- Creates one public playlist on first run.
- Initial playlist name is `<Spotify Profile Name>'s Liked Songs`.
- Stores the created playlist ID in `state/state.json` and reuses it in future runs.
- Fully mirrors liked songs each run:
  - adds newly liked songs,
  - removes songs you unliked,
  - preserves newest-first ordering.
- Skips unavailable, unplayable, or local tracks and continues.
- Runs hourly via GitHub Actions.

## Prerequisites (yes, even villains need prerequisites)

- A **Spotify Premium** account (required for apps in development mode)
- [Node.js](https://nodejs.org/) 20 or later
- A [GitHub](https://github.com/) account (for automated hourly sync)

## Setup (step by step, no tragic backstory required)

### 1. Create a Spotify Developer app

1. Go to the [Spotify Developer Dashboard](https://developer.spotify.com/dashboard).
2. Log in with the Spotify account whose liked songs you want to mirror.
3. Click **Create app**.
4. Fill in the form:
   - **App name**: anything you like (e.g. `LikedSongsMirror`)
   - **App description**: anything you like
   - **Redirect URI**: `http://127.0.0.1:8888/callback`
   - **Which API/SDKs are you planning to use?**: select **Web API**
5. Save the app.
6. Open the app's **Settings** and note your **Client ID** and **Client Secret**.

### 2. Add your Spotify account to the app allowlist

While the app is in development mode (the default), only allowlisted users can use it.

1. In the Developer Dashboard, open your app.
2. Go to **Settings** > **User Management**.
3. Add the **email address** of the Spotify account you want to mirror.
4. The account must accept the invite (check email) before proceeding.

### 3. Clone and install

```bash
git clone https://github.com/<your-username>/SpotifyLikedSongsMirrorBot.git
cd SpotifyLikedSongsMirrorBot
npm install
```

### 4. Create your `.env` file

Copy the example and fill in your credentials:

```bash
cp .env.example .env
```

Edit `.env` and set:

```
SPOTIFY_CLIENT_ID=<your client id from step 1>
SPOTIFY_CLIENT_SECRET=<your client secret from step 1>
```

Leave `SPOTIFY_REFRESH_TOKEN` empty for now. The other values have sensible defaults:

- `SPOTIFY_REDIRECT_URI` — default: `http://127.0.0.1:8888/callback` (must match what you entered in the dashboard)
- `SPOTIFY_AUTH_PORT` — default: `8888`
- `FALLBACK_PLAYLIST_NAME` — default: `Liked Songs Mirror` (used only if your profile has no display name)

### 5. Generate a refresh token (one-time)

```bash
npm run auth
```

This opens your browser to Spotify's authorization page. Log in with the account you want to mirror and click **Agree**. The script captures the callback and prints your refresh token.

Copy the printed `SPOTIFY_REFRESH_TOKEN` value and paste it into your `.env` file.

The helper requests these OAuth scopes:
- `user-library-read` — read your liked songs
- `playlist-modify-public` — create and write to public playlists
- `playlist-modify-private` — write to playlists (required by Spotify even for public playlists)
- `user-read-private` — read your profile display name for the playlist title

### 6. Test locally

```bash
npm run sync
```

You should see output like:

```
Created mirror playlist: YourName's Liked Songs (playlistId)
Playlist URL: https://open.spotify.com/playlist/...
Sync complete. likedCount=... mirroredCount=...
```

Open the playlist URL to verify your liked songs are there. If everything looks good, the -inator is operational.

### 7. Push to GitHub and add secrets

1. Create a new GitHub repository (or fork this one).
2. Push your code:

   ```bash
   git remote set-url origin https://github.com/<your-username>/SpotifyLikedSongsMirrorBot.git
   git push -u origin main
   ```

3. In your GitHub repository, go to **Settings** > **Secrets and variables** > **Actions**.
4. Add three **Repository secrets**:

   | Secret name              | Value                              |
   |--------------------------|------------------------------------|
   | `SPOTIFY_CLIENT_ID`      | Your client ID from step 1         |
   | `SPOTIFY_CLIENT_SECRET`  | Your client secret from step 1     |
   | `SPOTIFY_REFRESH_TOKEN`  | The refresh token from step 5      |

5. The workflow at `.github/workflows/sync-liked-songs.yml` runs automatically every hour. On the first cloud run, it commits the playlist ID to `state/state.json` so future runs reuse the same playlist.

That's it. Every hour, this glorious -inator checks your liked songs and updates the public playlist to match.

## How auto-updating works

The GitHub Actions workflow (`.github/workflows/sync-liked-songs.yml`) runs on a cron schedule (`0 * * * *` = top of every hour). Each run:

1. Checks out the repo (which contains `state/state.json` with the playlist ID).
2. Fetches all your liked songs from Spotify.
3. Replaces the playlist contents with the current liked songs (newest first).
4. If a new playlist was created, commits the updated `state/state.json` back to the repo.

No manual intervention is needed after initial setup. Like a new song, and it appears in the playlist within the hour.

## State file

- `state/state.json` stores only the mirror playlist ID.
- On first successful creation, GitHub Actions commits this file automatically.
- If the playlist is deleted externally, the bot creates a new one on the next run.
- To reset and create a fresh playlist, set `playlistId` to `null` in `state/state.json` and commit.

## Scripts

| Command              | Description                                     |
|----------------------|-------------------------------------------------|
| `npm run sync`       | Run the sync job locally                        |
| `npm run auth`       | One-time OAuth helper to generate refresh token |
| `npm run typecheck`  | TypeScript type checking                        |
| `npm test`           | Run test suite                                  |
| `npm run build`      | Compile TypeScript                              |

## Troubleshooting (every -inator needs maintenance)

- **403 Forbidden on sync**: Ensure your Spotify account is added to the app's allowlist in the Developer Dashboard, and that the account has Spotify Premium.
- **Missing redirect_uri error on `npm run auth`**: Verify that the redirect URI in the Developer Dashboard exactly matches `http://127.0.0.1:8888/callback`.
- **Workflow not running**: GitHub Actions schedules can be delayed. Check the Actions tab in your repository. The workflow only runs on the default branch.
- **Refresh token expired**: Spotify refresh tokens are long-lived but can be revoked. Re-run `npm run auth` and update the GitHub secret if sync starts failing with 401 errors.
