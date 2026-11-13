# Yahtzee

A mobile-first Yahtzee scorekeeper with online rooms, invitations, connected players, history, and a leaderboard. During a game, the interface stays focused on the score sheet.

## Online multiplayer

The public GitHub Pages app saves solo games immediately in browser storage. Signing in with Google connects the app to shared Firestore rooms so players can join from any phone or tablet, on any network.

Tap **Invite player** to share a deep link or the six-character room code. Opening an invite link fills the code and joins automatically after Google sign-in. The same dialog also accepts a code typed by hand. Connected players and score changes refresh automatically.

- **Who's here:** a player shows as *Ready now* while their app is open, and *Away* about 30 seconds after they close it. Presence uses the Firestore server clock, so a phone with the wrong time still shows up correctly.
- **During a game:** a live strip above the score sheet shows everyone's total and progress.
- **Joining late:** joining a finished game doesn't reopen it; the newcomer gets a sheet when the host starts the next game.
- **Leaving:** guests can tap **Leave this game** (Home or the invite screen) to go back to their own game. Their unfinished sheet is removed so it never blocks the others. Hosts can remove players from the invite screen; removed players see a short notice.
- **Names:** a name changed under Profile is kept across sign-ins and devices instead of being reset to the Google name.
- **Signed-out games:** games played on a device before signing in are copied into the account's history once, the first time you sign in there.
- **Bad connections:** a score tapped while the connection drops stays on screen and is retried automatically. An *Offline* badge appears in the header while the device has no connection.

Firestore rules must be deployed for online rooms:

```sh
npx firebase-tools deploy --only firestore:rules
```

## Development

- `npm run build:pages` builds the static GitHub Pages edition into `.pages-dist`.
- `npx firebase-tools deploy --only firestore:rules` publishes the online-room and private score-history rules.
- `node node_modules/typescript/bin/tsc --noEmit` checks application types.
- `npm run test:online` runs the online-room logic (join, presence, leave, removal, history, imports) against an in-memory Firestore.

After changing `firestore.rules`, deploy them, or the change won't take effect. **Leave this game** depends on the `selfLeave` rule.
