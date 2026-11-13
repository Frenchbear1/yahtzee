// Runs the real online-room logic (lib/firebase-game.ts) against a small
// in-memory Firestore so multiplayer flows can be checked without a network.
// Run with: npx tsx tests/online-rooms.test.ts
import assert from 'node:assert/strict';

import { createFakeFirestore } from './fake-firestore.ts';
type Data = Record<string, unknown>;
const fake = createFakeFirestore();
const { docs, firestore } = fake;
const storage = new Map<string, string>();
Object.assign(globalThis, {
  window: { firebase: { apps: [1], firestore } },
  localStorage: { getItem: (k: string) => storage.get(k) ?? null, setItem: (k: string, v: string) => storage.set(k, v), removeItem: (k: string) => storage.delete(k) },
});
Object.defineProperty(globalThis.navigator, 'onLine', { value: true, configurable: true });

// Each "device" gets its own copy of the module, like separate phones.
const deviceA = await import('../lib/firebase-game.ts?device=a');
const deviceB = await import('../lib/firebase-game.ts?device=b');
const user = (uid: string, displayName: string) => ({ uid, displayName, email: `${uid}@example.com`, photoURL: null, getIdToken: async () => 'token' });
const alice = user('alice', 'Alice Smith'), bob = user('bob', 'Bob Jones');
const a = (body: Data) => deviceA.firebaseGameRequest(body, alice);
const b = (body: Data) => deviceB.firebaseGameRequest(body, bob);
const mine = (state: any) => state.game.sheets.find((s: any) => s.player_id === state.me.id);
const fails = async (promise: Promise<unknown>, pattern: RegExp) => { await assert.rejects(promise, (e: Error) => pattern.test(e.message)); };
let checks = 0;
const check = (label: string) => { checks += 1; console.log(`  ✓ ${label}`); };

// Bob's phone clock is 2 minutes fast; presence must still work.
fake.setSkew(0);
let A = await a({ action: 'bootstrap' });
let B = await b({ action: 'bootstrap' });
assert.equal(A.mode, 'online'); assert.equal(A.players.length, 1);
check('each player gets their own room on first sign-in');

A = await a({ action: 'rename', name: 'Ally' });
assert.equal(A.me.name, 'Ally');
A = await a({ action: 'sync-profile', name: 'Alice Smith', photoUrl: null });
assert.equal(A.me.name, 'Ally');
check('custom name survives the Google profile sync');

await fails(b({ action: 'join-room', code: 'ZZZZZZ' }), /No game uses that code/);
B = await b({ action: 'join-room', code: A.room.code.toLowerCase() });
assert.equal(B.room.id, A.room.id);
A = await a({ action: 'refresh' });
assert.equal(A.players.length, 2); assert.equal(A.game.sheets.length, 2);
assert(A.players.every((p: any) => p.active));
assert.equal(A.players[0].id, 'alice');
check('joining by code (any case) shows both players as ready');

// Presence uses the server clock: shift the server 2 minutes ahead of the
// devices and Bob must still read as active right after checking in.
fake.setSkew(120_000);
await new Promise(r => setTimeout(r, 5));
const realNow = Date.now;
Date.now = () => realNow() + 11_000; // force fresh heartbeats
B = await b({ action: 'refresh' });
A = await a({ action: 'refresh' });
assert(A.players.find((p: any) => p.id === 'bob').active, 'bob should be active despite clock skew');
Date.now = () => realNow() + 80_000; // Bob's app is closed for over a minute
A = await a({ action: 'refresh' });
assert.equal(A.players.find((p: any) => p.id === 'bob').active, false);
Date.now = realNow; fake.setSkew(0);
check('presence is measured on the server clock (skew-proof) and goes Away when closed');

// Scores sync between devices, history is cached but the live game is fresh.
A = await a({ action: 'score', gameId: A.game.id, revision: 0, category: 'sixes', value: 18 });
B = await b({ action: 'refresh' });
assert.equal(B.game.sheets.find((s: any) => s.player_id === 'alice').scores.sixes, 18);
check('scores from one phone appear on the other');

const scores: Record<string, number> = { ones: 3, twos: 6, threes: 9, fours: 12, fives: 15, sixes: 18, kind3: 24, kind4: 26, house: 25, small: 30, large: 40, yahtzee: 50, chance: 22 };
for (const [category, value] of Object.entries(scores)) A = await a({ action: 'score', gameId: A.game.id, revision: mine(A).revision, category, value });
assert(mine(A).completed_at); assert.equal(A.game.ended_at, null);
check('game stays open while another player is still scoring');

// Bob leaves mid-game: his unfinished sheet must not block Alice's game.
B = await b({ action: 'leave-room' });
assert.notEqual(B.room.id, A.room.id); assert.equal(B.room.host_id, 'bob'); assert.equal(B.notice, undefined);
A = await a({ action: 'refresh' });
assert.equal(A.players.length, 1); assert(A.game.ended_at, 'game should end once the leaver is gone');
await fails(a({ action: 'leave-room' }), /host/);
check('a guest can leave; their unfinished sheet no longer blocks the game');

// Joining a finished game does not reopen it; the newcomer waits.
B = await b({ action: 'join-room', code: A.room.code });
assert(B.game.ended_at); assert.equal(mine(B), undefined);
await fails(b({ action: 'score', gameId: B.game.id, revision: 0, category: 'ones', value: 3 }), /next game/);
A = await a({ action: 'new-game', gameId: A.game.id });
assert.equal(A.game.sheets.length, 2);
B = await b({ action: 'refresh' });
assert(mine(B)); assert.equal(B.history.length, 2);
check('late joiners wait for the next game, then get a sheet');

// Host deletes an old game: guests' cached history must refresh.
const oldId = A.history.find((g: any) => g.id !== A.game.id).id;
A = await a({ action: 'delete-game', gameId: oldId });
B = await b({ action: 'refresh' });
assert(!B.history.some((g: any) => g.id === oldId));
check('history deletions reach other players');

// Host removes Bob: Bob is told and lands back in his own room.
A = await a({ action: 'remove-member', roomId: A.room.id, playerId: 'bob' });
B = await b({ action: 'refresh' });
assert.equal(B.room.host_id, 'bob'); assert.match(B.notice || '', /no longer in/);
B = await b({ action: 'refresh' });
assert.equal(B.notice, undefined);
check('a removed player gets a one-time notice and goes home');

// A missing member document is repaired instead of breaking refresh.
docs.delete(`yahtzeeRooms/${B.room.id}/members/bob`);
Date.now = () => realNow() + 30_000;
B = await b({ action: 'refresh' });
Date.now = realNow;
assert(docs.has(`yahtzeeRooms/${B.room.id}/members/bob`));
check('a missing member record is recreated on the next check-in');

// Games played signed-out on this device are imported once.
const localGame = { id: 'abc123local', started_at: 1000, ended_at: 2000, sheets: [{ game_id: 'abc123local', player_id: 'local', name: 'You', photo_url: null, scores, bonus: 0, revision: 13, completed_at: 2000 }] };
B = await b({ action: 'import-local', data: { version: 1, games: [localGame] } });
assert(B.history.some((g: any) => g.id === 'abc123local')); assert.match(B.notice || '', /Added 1 game/);
B = await b({ action: 'import-local', data: { version: 1, games: [localGame] } });
assert.equal(B.notice, undefined);
check('signed-out games are imported into the account once');

console.log(`PASS: ${checks} online room checks`);
