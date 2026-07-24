# Liked-songs mirror instructions

This repository has one responsibility: mirror Shane's Spotify liked songs into
the configured playlist. Keep it independently buildable and releasable. Genre
classification belongs in the separate `SpotifyGenrePlaylistBot` repository.

## Working rules

1. Preserve the existing hourly mirror behaviour and idempotent playlist updates.
2. Treat the mirror playlist or an explicitly documented export as the public
   contract consumed by the genre repository.
3. Do not add genre taxonomies, genre playlists or cross-repository imports here.
4. Never copy Spotify credentials, refresh tokens or `.env` values between repos.
5. Run the existing tests and typecheck before committing behavioural changes.

Work produced by OpenCode, Reasonix or another external model remains
`awaiting-frontier-review` until frontier Codex checks its diff and evidence.
