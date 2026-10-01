# Yahtzee

A mobile-first Yahtzee scorekeeper with online rooms, invitations, connected players, history, and a leaderboard. During a game, the interface stays focused on the score sheet.

## Online multiplayer

The public GitHub Pages app saves solo games immediately in browser storage. Signing in with Google connects the app to shared Firestore rooms so players can join from any phone or tablet, on any network.

Tap **Invite player** to share a deep link or the six-character room code. Opening an invite link fills the code and joins automatically after Google sign-in. The same dialog also accepts a code typed by hand. Connected players and score changes refresh automatically.

Firestore rules must be deployed for online rooms:

```sh
npx firebase-tools deploy --only firestore:rules
```

## Development

- `npm run build:pages` builds the static GitHub Pages edition into `.pages-dist`.
- `npx firebase-tools deploy --only firestore:rules` publishes the online-room and private score-history rules.
- `node node_modules/typescript/bin/tsc --noEmit` checks application types.
