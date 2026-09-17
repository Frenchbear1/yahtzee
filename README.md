# Yahtzee Table

A mobile-first Yahtzee scorekeeper with a two-column score sheet, valid quick scores, editing and undo, bonus progress, a celebration button, and a sequential final tally.

Family tables share scores every four seconds. Each game has a stable ID and server timestamp, so its participants appear together in date-grouped history. Only fully finished multiplayer games count toward wins; tied high scores share a win. Solo games count toward personal bests and averages.

Online scores use the Sites D1 database. Each browser holds a random player credential; the database holds only its SHA-256 hash. Clearing browser storage creates a new identity. The hosted Site's access settings apply before table access. A room code grants access to that table and its history, so share it only with your group.

## GitHub Pages edition

The public GitHub Pages build is a static, single-browser scorekeeper. Scores, tables, and history are saved in browser local storage. Clearing site data clears that history. GitHub Pages cannot run the database-backed shared-family API; use the downloadable local network edition below for multi-device play.

## Local network edition

Choose **Family table → Download the local edition** in the app. Unzip on one computer with Node 22.13 or newer and run `node start.mjs`. Every phone opens the host's displayed LAN address and joins the same table code. The computer must remain awake. No internet or accounts are required during play.

The local edition uses the same React UI and API logic with a local SQLite adapter. Its scores are separate from the hosted app. Keep the `yahtzee-scores.sqlite` file and the same browser identity on each phone. Detailed instructions are included in the download.

## Development

- `node scripts/build-local.mjs` builds the downloadable edition from the current UI and API source.
- `npm run build:pages` builds the static GitHub Pages edition into `.pages-dist`.
- `npm run build` builds the hosted Worker and UI.
- `npm run db:generate` generates schema migrations after a schema edit.
- `node tests/game-api.mjs` validates the compiled local API against an in-memory SQLite database. Build the local edition first.
- `node node_modules/typescript/bin/tsc --noEmit` checks application types.

Regenerate the local download before the hosted build whenever UI or API source changes. Preserve applied database migrations.
