# Yahtzee

A mobile-first Yahtzee scorekeeper with a home screen for game setup, invitations, connected players, history, and the leaderboard. During a game, the interface stays focused on the score sheet.

## GitHub Pages edition

The public GitHub Pages build saves immediately in browser storage. When a player signs in with Google, existing local games are merged into their private Firestore score history and become available on other signed-in devices. Blank games are never uploaded or shown in game history.

The Pages build remains a single-device scorekeeper. Use the downloadable local network edition for live multi-device play.

## Local network edition

Choose **Invite player → Get Wi-Fi multiplayer** in the app. Unzip on one computer with Node 22.13 or newer and run `node start.mjs`. Every phone opens the host's displayed LAN address and joins with the same invite code. The computer must remain awake. No internet or accounts are required during play.

The local edition uses the same React UI and API logic with a local SQLite adapter. Active players on the same hosted game appear automatically on Home. Its scores are separate from the GitHub Pages app. Keep the `yahtzee-scores.sqlite` file and the same browser identity on each phone. Detailed instructions are included in the download.

## Development

- `node scripts/build-local.mjs` builds the downloadable edition from the current UI and API source.
- `npm run build:pages` builds the static GitHub Pages edition into `.pages-dist`.
- `npx firebase-tools deploy --only firestore:rules` publishes the private per-account score-sync rules.
- `node tests/game-api.mjs` validates the compiled local API against an in-memory SQLite database. Build the local edition first.
- `node node_modules/typescript/bin/tsc --noEmit` checks application types.
