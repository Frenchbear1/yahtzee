# Yahtzee Table

A mobile-first Yahtzee scorekeeper with a two-column score sheet, valid quick scores, editing and undo, bonus progress, a celebration button, and a sequential final tally.

## GitHub Pages edition

The public GitHub Pages build is a static, single-browser scorekeeper. Google sign-in supplies the player's name and profile photo, while scores, tables, and history are saved in browser local storage. Signing in does not sync game history between devices, and clearing site data clears that history. Use the downloadable local network edition below for multi-device play.

## Local network edition

Choose **Family table → Download the local edition** in the app. Unzip on one computer with Node 22.13 or newer and run `node start.mjs`. Every phone opens the host's displayed LAN address and joins the same table code. The computer must remain awake. No internet or accounts are required during play.

The local edition uses the same React UI and API logic with a local SQLite adapter. Its scores are separate from the GitHub Pages app. Keep the `yahtzee-scores.sqlite` file and the same browser identity on each phone. Detailed instructions are included in the download.

## Development

- `node scripts/build-local.mjs` builds the downloadable edition from the current UI and API source.
- `npm run build:pages` builds the static GitHub Pages edition into `.pages-dist`.
- `node tests/game-api.mjs` validates the compiled local API against an in-memory SQLite database. Build the local edition first.
- `node node_modules/typescript/bin/tsc --noEmit` checks application types.
