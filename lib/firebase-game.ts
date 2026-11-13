import { gameHasMoves, totals, validScore, type Game, type Room, type Scores, type Sheet, type State } from './game';
import {
  getFirebaseFirestore,
  serverTimestamp,
  type FirebaseFirestore,
  type FirebaseUser,
} from './firebase-profile';

type RoomRecord = Room & {
  created_at: number;
  updated_at: number;
  current_game_id: string;
  member_ids: string[];
};

type MemberRecord = State['me'] & { last_seen: number };
type StoredGame = Omit<Game, 'sheets'> & { sheets: Record<string, Sheet>; updated_at: number };

const roomCollection = 'yahtzeeRooms';
const codeCollection = 'yahtzeeRoomCodes';
const maxHistory = 50;
const maxPlayers = 12;
// A player counts as "ready" while their app has checked in recently. The app
// checks in every few seconds while it is open and visible.
const activeWindow = 30_000;
const heartbeatEvery = 10_000;
const currentRoomKey = (userId: string) => `yahtzee-online-room-${userId}`;

let heartbeat = { key: '', at: 0 };
// Difference between the Firestore server clock and this device's clock.
let serverOffset = 0;
// History only changes when the room document changes (new game, deletion,
// joins), so it is cached and only the live game is re-read on each refresh.
let historyCache: { owner: string; key: string; games: StoredGame[] } | null = null;
let roomsCache: { userId: string; rooms: RoomRecord[] } | null = null;
const preferredNames = new Map<string, string | null>();
let pendingNotice = '';

function fail(message: string, status = 400): never {
  const error = new Error(message) as Error & { status?: number };
  error.status = status;
  throw error;
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function clean(value: unknown, fallback: string) {
  const result = String(value ?? '').trim().replace(/\s+/g, ' ').slice(0, 32);
  return result || fallback;
}

function cleanPhoto(value: unknown) {
  try {
    const url = new URL(String(value ?? ''));
    return url.protocol === 'https:' && (url.hostname === 'googleusercontent.com' || url.hostname.endsWith('.googleusercontent.com')) ? url.toString() : null;
  } catch {
    return null;
  }
}

function millis(value: unknown) {
  if (typeof value === 'number') return value;
  const timestamp = value as { toMillis?: () => number } | null;
  return typeof timestamp?.toMillis === 'function' ? timestamp.toMillis() : 0;
}

function readLocal(key: string) {
  try { return localStorage.getItem(key); } catch { return null; }
}

function writeLocal(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {}
}

function inviteCode(value?: unknown) {
  if (value !== undefined) return String(value).replace(/[^a-z0-9]/gi, '').toUpperCase();
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from(crypto.getRandomValues(new Uint8Array(6)), number => alphabet[number % alphabet.length]).join('');
}

function profile(user: FirebaseUser, name?: unknown, photoUrl?: unknown): MemberRecord {
  const fallback = preferredNames.get(user.uid) || user.displayName || user.email?.split('@')[0] || 'Player';
  return {
    id: user.uid,
    name: clean(name ?? fallback, fallback),
    photo_url: cleanPhoto(photoUrl ?? user.photoURL),
    last_seen: Date.now(),
  };
}

function memberWrite(member: MemberRecord) {
  return { id: member.id, name: member.name, photo_url: member.photo_url, last_seen: serverTimestamp() };
}

function blankSheet(gameId: string, player: Pick<MemberRecord, 'id' | 'name' | 'photo_url'>): Sheet {
  return {
    game_id: gameId,
    player_id: player.id,
    name: player.name,
    photo_url: player.photo_url,
    scores: {},
    bonus: 0,
    revision: 0,
    completed_at: null,
  };
}

function roomRef(db: FirebaseFirestore, roomId: string) {
  return db.doc(`${roomCollection}/${roomId}`);
}

function memberRef(db: FirebaseFirestore, roomId: string, userId: string) {
  return db.doc(`${roomCollection}/${roomId}/members/${userId}`);
}

function gameRef(db: FirebaseFirestore, roomId: string, gameId: string) {
  return db.doc(`${roomCollection}/${roomId}/games/${gameId}`);
}

function profileRef(db: FirebaseFirestore, userId: string) {
  return db.doc(`users/${userId}/yahtzee/profile`);
}

function parseRoom(id: string, value: unknown): RoomRecord {
  const data = object(value);
  return {
    id,
    name: clean(data.name, 'My game'),
    code: inviteCode(data.code),
    host_id: String(data.host_id || ''),
    created_at: Number(data.created_at) || 0,
    updated_at: Number(data.updated_at) || 0,
    current_game_id: String(data.current_game_id || ''),
    member_ids: Array.isArray(data.member_ids) ? data.member_ids.filter(id => typeof id === 'string') : [],
  };
}

function parseMember(id: string, value: unknown): MemberRecord {
  const data = object(value);
  return {
    id,
    name: clean(data.name, 'Player'),
    photo_url: cleanPhoto(data.photo_url),
    last_seen: millis(data.last_seen),
  };
}

function parseSheet(gameId: string, playerId: string, value: unknown): Sheet {
  const data = object(value);
  const rawScores = object(data.scores);
  const scores: Scores = {};
  for (const [key, score] of Object.entries(rawScores)) {
    if (score === null || typeof score === 'number') scores[key] = score;
  }
  return {
    game_id: gameId,
    player_id: playerId,
    name: clean(data.name, 'Player'),
    photo_url: cleanPhoto(data.photo_url),
    scores,
    bonus: Number(data.bonus) || 0,
    revision: Number(data.revision) || 0,
    completed_at: typeof data.completed_at === 'number' ? data.completed_at : null,
  };
}

function parseStoredGame(id: string, value: unknown): StoredGame {
  const data = object(value);
  const storedSheets = object(data.sheets);
  const sheets: Record<string, Sheet> = {};
  for (const [playerId, rawSheet] of Object.entries(storedSheets)) sheets[playerId] = parseSheet(id, playerId, rawSheet);
  return {
    id,
    room_id: String(data.room_id || ''),
    started_at: Number(data.started_at) || 0,
    ended_at: typeof data.ended_at === 'number' ? data.ended_at : null,
    sheets,
    updated_at: Number(data.updated_at) || 0,
  };
}

function legacyGames(value: unknown, user: FirebaseUser, roomId: string) {
  const data = object(value);
  if (data.version !== 1 || !Array.isArray(data.games)) return [];
  const me = profile(user);
  const seen = new Set<string>();
  const games: StoredGame[] = [];
  for (const rawGame of data.games.slice(0, maxHistory - 1)) {
    const source = object(rawGame);
    const rawSheets = Array.isArray(source.sheets) ? source.sheets : [];
    const rawSheet = rawSheets[0];
    if (!rawSheet) continue;
    const proposedId = String(source.id || '');
    const gameId = /^[a-zA-Z0-9_-]{1,128}$/.test(proposedId) && !seen.has(proposedId) ? proposedId : crypto.randomUUID();
    seen.add(gameId);
    const migratedSheet = {
      ...parseSheet(gameId, user.uid, rawSheet),
      game_id: gameId,
      player_id: user.uid,
      name: me.name,
      photo_url: me.photo_url,
    };
    const game: StoredGame = {
      id: gameId,
      room_id: roomId,
      started_at: Number(source.started_at) || Date.now(),
      ended_at: typeof source.ended_at === 'number' ? source.ended_at : migratedSheet.completed_at,
      updated_at: Date.now(),
      sheets: { [user.uid]: migratedSheet },
    };
    if (gameHasMoves(displayGame(game, new Map()))) games.push(game);
  }
  return games;
}

function publicRoom(room: RoomRecord): Room {
  return { id: room.id, name: room.name, code: room.code, host_id: room.host_id };
}

function rememberRoom(userId: string, roomId: string) {
  writeLocal(currentRoomKey(userId), roomId);
}

async function membershipRooms(db: FirebaseFirestore, userId: string) {
  const snapshot = await db.collection(roomCollection).where('member_ids', 'array-contains', userId).get();
  const rooms = snapshot.docs.map(document => parseRoom(document.id, document.data())).sort((a, b) => b.created_at - a.created_at);
  roomsCache = { userId, rooms };
  return rooms;
}

async function findCurrentRoom(db: FirebaseFirestore, userId: string) {
  const remembered = readLocal(currentRoomKey(userId));
  if (remembered) {
    const document = await roomRef(db, remembered).get();
    if (document.exists) {
      const room = parseRoom(document.id, document.data());
      if (room.member_ids.includes(userId)) return room;
      pendingNotice = `You’re no longer in “${room.name}”. You’re back in your own game.`;
    } else {
      pendingNotice = 'That game was closed by its host. You’re back in your own game.';
    }
    writeLocal(currentRoomKey(userId), null);
  }
  const rooms = await membershipRooms(db, userId);
  // Prefer the player's own room so leaving or being removed lands them home.
  const room = rooms.find(item => item.host_id === userId) || rooms[0];
  if (!room) return null;
  rememberRoom(userId, room.id);
  return room;
}

async function createRoom(db: FirebaseFirestore, user: FirebaseUser, roomName: unknown = 'My game', legacyState?: unknown) {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const roomId = crypto.randomUUID();
    const gameId = crypto.randomUUID();
    const code = inviteCode();
    const now = Date.now();
    const me = profile(user);
    const migratedGames = legacyGames(legacyState, user, roomId);
    try {
      await db.runTransaction(async transaction => {
        const codeReference = db.doc(`${codeCollection}/${code}`);
        const codeDocument = await transaction.get(codeReference);
        if (codeDocument.exists) fail('Invite code collision.', 409);
        transaction.set(roomRef(db, roomId), {
          name: clean(roomName, 'My game'),
          code,
          host_id: user.uid,
          created_at: now,
          updated_at: now,
          current_game_id: gameId,
          member_ids: [user.uid],
        });
        transaction.set(codeReference, { room_id: roomId, host_id: user.uid, created_at: now });
        transaction.set(memberRef(db, roomId, user.uid), memberWrite(me));
        transaction.set(gameRef(db, roomId, gameId), {
          id: gameId,
          room_id: roomId,
          started_at: now,
          ended_at: null,
          updated_at: now,
          sheets: { [user.uid]: blankSheet(gameId, me) },
        });
        for (const migrated of migratedGames) transaction.set(gameRef(db, roomId, migrated.id), migrated);
      });
      rememberRoom(user.uid, roomId);
      roomsCache = null;
      return roomId;
    } catch (error) {
      if ((error as Error & { status?: number }).status !== 409) throw error;
    }
  }
  fail('Could not reserve an invite code. Please try again.', 503);
}

async function ensureRoom(db: FirebaseFirestore, user: FirebaseUser, legacyState?: unknown) {
  const current = await findCurrentRoom(db, user.uid);
  if (current) return current;
  const roomId = await createRoom(db, user, 'My game', legacyState);
  const document = await roomRef(db, roomId).get();
  return parseRoom(document.id, document.data());
}

async function currentMembers(db: FirebaseFirestore, roomId: string) {
  const snapshot = await db.collection(`${roomCollection}/${roomId}/members`).get();
  return snapshot.docs.map(document => parseMember(document.id, document.data()));
}

async function currentGames(db: FirebaseFirestore, roomId: string) {
  const snapshot = await db.collection(`${roomCollection}/${roomId}/games`).orderBy('started_at', 'desc').limit(maxHistory).get();
  return snapshot.docs.map(document => parseStoredGame(document.id, document.data()));
}

async function readGame(db: FirebaseFirestore, roomId: string, gameId: string) {
  if (!gameId) return null;
  const document = await gameRef(db, roomId, gameId).get();
  return document.exists ? parseStoredGame(document.id, document.data()) : null;
}

function displayGame(game: StoredGame, members: Map<string, MemberRecord>): Game {
  return {
    id: game.id,
    room_id: game.room_id,
    started_at: game.started_at,
    ended_at: game.ended_at,
    sheets: Object.values(game.sheets).map(sheet => {
      const member = members.get(sheet.player_id);
      return member ? { ...sheet, name: member.name, photo_url: member.photo_url } : sheet;
    }),
  };
}

function errorCode(error: unknown) {
  return String((error as { code?: unknown })?.code || '');
}

// Marks this player as present. A missing member document (for example after
// an interrupted join) is recreated instead of breaking the whole refresh.
async function touchMember(db: FirebaseFirestore, roomId: string, user: FirebaseUser) {
  const reference = memberRef(db, roomId, user.uid);
  try {
    await reference.update({ last_seen: serverTimestamp() });
  } catch (error) {
    if (!errorCode(error).includes('not-found')) return false;
    try { await reference.set(memberWrite(profile(user))); } catch { return false; }
  }
  return true;
}

async function snapshot(db: FirebaseFirestore, user: FirebaseUser, fullRooms = false): Promise<State> {
  const room = await ensureRoom(db, user);
  const beforeHeartbeat = Date.now();
  const heartbeatKey = `${user.uid}:${room.id}`;
  let wroteHeartbeat = false;
  if (heartbeat.key !== heartbeatKey || beforeHeartbeat - heartbeat.at > heartbeatEvery) {
    wroteHeartbeat = await touchMember(db, room.id, user);
    if (wroteHeartbeat) heartbeat = { key: heartbeatKey, at: beforeHeartbeat };
  }

  const owner = `${user.uid}:${room.id}`;
  const historyKey = `${room.current_game_id}:${room.updated_at}`;
  const cacheValid = historyCache?.owner === owner && historyCache.key === historyKey;
  const needRooms = fullRooms || roomsCache?.userId !== user.uid || !roomsCache.rooms.some(item => item.id === room.id);
  const [members, liveGame, fullHistory, rooms] = await Promise.all([
    currentMembers(db, room.id),
    cacheValid ? readGame(db, room.id, room.current_game_id) : Promise.resolve(null),
    cacheValid ? Promise.resolve(null) : currentGames(db, room.id),
    needRooms ? membershipRooms(db, user.uid) : Promise.resolve(roomsCache!.rooms),
  ]);

  let storedGames: StoredGame[];
  if (fullHistory) {
    storedGames = fullHistory;
    const live = storedGames.some(game => game.id === room.current_game_id) ? null : await readGame(db, room.id, room.current_game_id);
    if (live) storedGames = [live, ...storedGames];
  } else if (liveGame) {
    storedGames = [liveGame, ...historyCache!.games.filter(game => game.id !== liveGame.id)];
  } else {
    storedGames = await currentGames(db, room.id);
  }
  storedGames.sort((a, b) => b.started_at - a.started_at);
  historyCache = { owner, key: historyKey, games: storedGames };
  roomsCache = { userId: user.uid, rooms: rooms.map(item => item.id === room.id ? room : item) };

  const memberMap = new Map(members.map(member => [member.id, member]));
  const mine = memberMap.get(user.uid);
  if (wroteHeartbeat && mine?.last_seen) {
    const offset = mine.last_seen - beforeHeartbeat;
    if (Math.abs(offset) < 86_400_000) serverOffset = offset;
  }

  const games = storedGames.map(game => displayGame(game, memberMap));
  const activeGame = games.find(game => game.id === room.current_game_id) || games[0];
  if (!activeGame) fail('This game is still starting. Please reconnect.', 503);

  const now = Date.now() + serverOffset;
  const me = mine || profile(user);
  const players = members
    .filter(member => room.member_ids.includes(member.id))
    .map(member => ({
      id: member.id,
      name: member.name,
      photo_url: member.photo_url,
      active: member.id === user.uid || now - member.last_seen < activeWindow,
    }))
    .sort((a, b) => Number(b.id === user.uid) - Number(a.id === user.uid)
      || Number(b.id === room.host_id) - Number(a.id === room.host_id)
      || Number(b.active) - Number(a.active)
      || a.name.localeCompare(b.name));
  if (!players.some(player => player.id === user.uid)) players.unshift({ id: me.id, name: me.name, photo_url: me.photo_url, active: true });

  const notice = pendingNotice;
  pendingNotice = '';
  return {
    me: { id: me.id, name: me.name, photo_url: me.photo_url },
    room: publicRoom(room),
    rooms: roomsCache.rooms.map(publicRoom),
    managedRooms: room.host_id === user.uid
      ? [{ ...publicRoom(room), members: players.map(player => ({ id: player.id, name: player.name, photo_url: player.photo_url })) }]
      : [],
    players,
    game: activeGame,
    history: games,
    mode: 'online',
    ...(notice ? { notice } : {}),
  };
}

async function loadPreferredName(db: FirebaseFirestore, user: FirebaseUser) {
  if (preferredNames.has(user.uid)) return;
  try {
    const document = await profileRef(db, user.uid).get();
    const name = document.exists ? object(document.data()).name : null;
    preferredNames.set(user.uid, typeof name === 'string' && name.trim() ? clean(name, '') : null);
  } catch {
    // Try again on the next request instead of forgetting the custom name.
  }
}

async function updateProfile(db: FirebaseFirestore, user: FirebaseUser, name: unknown, photoUrl: unknown) {
  const rooms = await membershipRooms(db, user.uid);
  const next = profile(user, name, photoUrl);
  if (!rooms.length) return;
  const batch = db.batch();
  for (const room of rooms) batch.set(memberRef(db, room.id, user.uid), memberWrite(next), { merge: true });
  await batch.commit();
}

async function joinRoom(db: FirebaseFirestore, user: FirebaseUser, rawCode: unknown) {
  const code = inviteCode(rawCode);
  if (!/^[A-HJ-NP-Z2-9]{4,8}$/.test(code)) fail('That invite code doesn’t look right. Codes use letters and numbers, like K7M2QX.');
  let joinedRoomId = '';
  await db.runTransaction(async transaction => {
    const codeReference = db.doc(`${codeCollection}/${code}`);
    const codeDocument = await transaction.get(codeReference);
    if (!codeDocument.exists) fail('No game uses that code. Check the code and try again.', 404);
    const roomId = String(codeDocument.data()?.room_id || '');
    const roomReference = roomRef(db, roomId);
    const roomDocument = await transaction.get(roomReference);
    if (!roomDocument.exists) fail('That game has been closed by its host.', 404);
    const room = parseRoom(roomDocument.id, roomDocument.data());
    const alreadyMember = room.member_ids.includes(user.uid);
    if (!alreadyMember && room.member_ids.length >= maxPlayers) fail(`That game is full (${maxPlayers} players).`);
    const currentGameReference = gameRef(db, room.id, room.current_game_id);
    const currentGameDocument = room.current_game_id ? await transaction.get(currentGameReference) : null;
    const currentGame = currentGameDocument?.exists ? parseStoredGame(currentGameDocument.id, currentGameDocument.data()) : null;
    const me = profile(user);
    const now = Date.now();
    if (!alreadyMember) transaction.update(roomReference, { member_ids: [...room.member_ids, user.uid], updated_at: now });
    transaction.set(memberRef(db, room.id, user.uid), memberWrite(me), { merge: true });
    // Join the game in progress. A finished game is left untouched so it
    // stays finished; the newcomer gets a sheet when the next game starts.
    if (currentGame && !currentGame.ended_at && !currentGame.sheets[user.uid]) {
      transaction.update(currentGameReference, {
        [`sheets.${user.uid}`]: blankSheet(room.current_game_id, me),
        updated_at: now,
      });
    }
    joinedRoomId = room.id;
  });
  rememberRoom(user.uid, joinedRoomId);
  roomsCache = null;
}

async function leaveRoom(db: FirebaseFirestore, user: FirebaseUser, room: RoomRecord) {
  if (room.host_id === user.uid) fail('You host this game, so you can’t leave it.');
  await db.runTransaction(async transaction => {
    const reference = roomRef(db, room.id);
    const document = await transaction.get(reference);
    if (!document.exists) return;
    const latest = parseRoom(document.id, document.data());
    if (!latest.member_ids.includes(user.uid)) return;
    const currentGameReference = gameRef(db, room.id, latest.current_game_id);
    const currentGameDocument = latest.current_game_id ? await transaction.get(currentGameReference) : null;
    const currentGame = currentGameDocument?.exists ? parseStoredGame(currentGameDocument.id, currentGameDocument.data()) : null;
    const now = Date.now();
    transaction.update(reference, { member_ids: latest.member_ids.filter(id => id !== user.uid), updated_at: now });
    transaction.delete(memberRef(db, room.id, user.uid));
    // An unfinished sheet would keep everyone else's game open forever.
    if (currentGame?.sheets[user.uid] && !currentGame.ended_at && !currentGame.sheets[user.uid].completed_at) {
      const sheets = { ...currentGame.sheets };
      delete sheets[user.uid];
      const remaining = Object.values(sheets);
      const endedAt = remaining.length > 0 && remaining.every(sheet => sheet.completed_at) ? now : null;
      transaction.update(currentGameReference, { sheets, ended_at: endedAt, updated_at: now });
    }
  });
  writeLocal(currentRoomKey(user.uid), null);
  roomsCache = null;
}

async function mutateScore(db: FirebaseFirestore, user: FirebaseUser, room: RoomRecord, body: Record<string, unknown>) {
  const requestedGameId = String(body.gameId || '');
  await db.runTransaction(async transaction => {
    const roomDocument = await transaction.get(roomRef(db, room.id));
    if (!roomDocument.exists) fail('That game was not found.', 404);
    const latestRoom = parseRoom(roomDocument.id, roomDocument.data());
    if (latestRoom.current_game_id !== requestedGameId) fail('A new game has already started. Your game is refreshed.', 409);
    const reference = gameRef(db, room.id, requestedGameId);
    const document = await transaction.get(reference);
    if (!document.exists) fail('This score sheet is not available.', 404);
    const game = parseStoredGame(document.id, document.data());
    const playerSheet = game.sheets[user.uid];
    if (!playerSheet) fail('You’ll get a score sheet when the next game starts.', 403);
    if (body.revision !== playerSheet.revision) fail('Another screen changed this score. Please try again.', 409);

    const scores = { ...playerSheet.scores };
    let bonus = playerSheet.bonus;
    if (body.action === 'score') {
      if (!validScore(String(body.category || ''), body.value)) fail('Choose a valid score for this category.');
      scores[String(body.category)] = body.value as number | null;
      if (body.category === 'yahtzee') {
        if (body.value !== 50) bonus = 0;
        else if (body.restoreBonus !== undefined) {
          const restoreBonus = Number(body.restoreBonus);
          if (!Number.isInteger(restoreBonus) || restoreBonus < 0 || restoreBonus > 12) fail('That Yahtzee bonus cannot be restored.');
          bonus = restoreBonus;
        }
      }
    } else {
      const nextBonus = Number(body.bonus);
      if (!Number.isInteger(nextBonus) || nextBonus < 0 || nextBonus > 12) fail('Choose between 0 and 12 extra Yahtzees.');
      if (nextBonus > 0 && scores.yahtzee !== 50) fail('Score your first Yahtzee as 50 before adding a bonus.');
      bonus = nextBonus;
    }

    const completedAt = totals(scores, bonus).filled === 13 ? playerSheet.completed_at || Date.now() : null;
    const sheets = {
      ...game.sheets,
      [user.uid]: { ...playerSheet, scores, bonus, revision: playerSheet.revision + 1, completed_at: completedAt },
    };
    const endedAt = Object.values(sheets).every(sheet => sheet.completed_at) ? game.ended_at || Date.now() : null;
    transaction.update(reference, { sheets, ended_at: endedAt, updated_at: Date.now() });
  });
}

function sheetsFor(memberIds: string[], members: Map<string, MemberRecord>, gameId: string) {
  const sheets: Record<string, Sheet> = {};
  for (const playerId of memberIds) {
    const member = members.get(playerId) || { id: playerId, name: 'Player', photo_url: null, last_seen: 0 };
    sheets[playerId] = blankSheet(gameId, member);
  }
  return sheets;
}

async function newGame(db: FirebaseFirestore, user: FirebaseUser, room: RoomRecord, body: Record<string, unknown>) {
  if (room.host_id !== user.uid) fail('The game host starts the next game.', 403);
  const gameId = crypto.randomUUID();
  const members = new Map((await currentMembers(db, room.id)).map(member => [member.id, member]));
  const now = Date.now();
  await db.runTransaction(async transaction => {
    const roomReference = roomRef(db, room.id);
    const roomDocument = await transaction.get(roomReference);
    if (!roomDocument.exists) fail('That game was not found.', 404);
    const latestRoom = parseRoom(roomDocument.id, roomDocument.data());
    if (latestRoom.current_game_id !== String(body.gameId || '')) fail('A new game has already started. Your game is refreshed.', 409);
    const oldReference = gameRef(db, room.id, latestRoom.current_game_id);
    const oldDocument = await transaction.get(oldReference);
    const oldGame = oldDocument.exists ? parseStoredGame(oldDocument.id, oldDocument.data()) : null;
    if (oldGame && !oldGame.ended_at && !body.confirm) fail('There are unfinished score sheets. Confirm to start a fresh game.');
    transaction.set(gameRef(db, room.id, gameId), {
      id: gameId,
      room_id: room.id,
      started_at: now,
      ended_at: null,
      updated_at: now,
      sheets: sheetsFor(latestRoom.member_ids, members, gameId),
    });
    transaction.update(roomReference, { current_game_id: gameId, updated_at: now });
  });
}

async function deleteGame(db: FirebaseFirestore, user: FirebaseUser, room: RoomRecord, body: Record<string, unknown>) {
  if (room.host_id !== user.uid) fail('Only the game owner can delete game history.', 403);
  const requestedGameId = String(body.gameId || '');
  const replacementId = crypto.randomUUID();
  const members = new Map((await currentMembers(db, room.id)).map(member => [member.id, member]));
  const now = Date.now();
  await db.runTransaction(async transaction => {
    const roomReference = roomRef(db, room.id);
    const roomDocument = await transaction.get(roomReference);
    if (!roomDocument.exists) fail('That game was not found.', 404);
    const latestRoom = parseRoom(roomDocument.id, roomDocument.data());
    const requestedReference = gameRef(db, room.id, requestedGameId);
    const requestedDocument = await transaction.get(requestedReference);
    if (!requestedDocument.exists) fail('That game was already deleted.', 404);
    transaction.delete(requestedReference);
    if (latestRoom.current_game_id === requestedGameId) {
      transaction.set(gameRef(db, room.id, replacementId), {
        id: replacementId,
        room_id: room.id,
        started_at: now,
        ended_at: null,
        updated_at: now,
        sheets: sheetsFor(latestRoom.member_ids, members, replacementId),
      });
      transaction.update(roomReference, { current_game_id: replacementId, updated_at: now });
    } else {
      // Bumping updated_at tells every player's app to reload the history.
      transaction.update(roomReference, { updated_at: Math.max(now, latestRoom.updated_at + 1) });
    }
  });
}

async function deleteRoom(db: FirebaseFirestore, user: FirebaseUser, roomId: string) {
  const reference = roomRef(db, roomId);
  const roomDocument = await reference.get();
  if (!roomDocument.exists) fail('That game was not found.', 404);
  const room = parseRoom(roomDocument.id, roomDocument.data());
  if (room.host_id !== user.uid) fail('Only the game owner can delete it.', 403);
  const [games, members] = await Promise.all([
    db.collection(`${roomCollection}/${roomId}/games`).get(),
    db.collection(`${roomCollection}/${roomId}/members`).get(),
  ]);
  const batch = db.batch();
  for (const game of games.docs) batch.delete(gameRef(db, roomId, game.id));
  for (const member of members.docs) batch.delete(memberRef(db, roomId, member.id));
  batch.delete(db.doc(`${codeCollection}/${room.code}`));
  batch.delete(reference);
  await batch.commit();
  writeLocal(currentRoomKey(user.uid), null);
  roomsCache = null;
}

// Copies games played on this device while signed out into the player's own
// online room, so nothing disappears after signing in. Existing games are kept.
async function importLocalGames(db: FirebaseFirestore, user: FirebaseUser, room: RoomRecord, data: unknown) {
  if (room.host_id !== user.uid) return 0;
  const games = legacyGames(data, user, room.id);
  if (!games.length) return 0;
  const existing = await Promise.all(games.map(game => gameRef(db, room.id, game.id).get()));
  const missing = games.filter((_, index) => !existing[index].exists);
  if (!missing.length) return 0;
  const batch = db.batch();
  for (const game of missing) batch.set(gameRef(db, room.id, game.id), game);
  batch.update(roomRef(db, room.id), { updated_at: Math.max(Date.now(), room.updated_at + 1) });
  await batch.commit();
  return missing.length;
}

function friendlyFirebaseError(error: unknown): never {
  const known = error as Error & { status?: number; code?: string };
  if (known.status) throw known;
  const code = errorCode(error);
  if (code.includes('permission-denied')) fail('That action isn’t allowed for your account. Refresh and try again.', 403);
  if (code.includes('unauthenticated')) fail('Google sign-in expired. Sign in again to keep playing online.', 401);
  if (code.includes('resource-exhausted')) fail('Online play is busy right now. Try again in a few minutes.', 503);
  if (code.includes('unavailable') || code.includes('deadline-exceeded') || (typeof navigator !== 'undefined' && !navigator.onLine)) {
    fail('You’re offline. Check your connection and try again.', 503);
  }
  if (code.includes('aborted')) fail('Someone else saved at the same moment. Please try again.', 409);
  throw known;
}

export async function firebaseGameRequest(body: Record<string, unknown>, user: FirebaseUser): Promise<State> {
  try {
    const db = await getFirebaseFirestore();
    await loadPreferredName(db, user);
    const action = String(body.action || '');

    if (action === 'refresh') return await snapshot(db, user);
    if (action === 'bootstrap') {
      await ensureRoom(db, user, body.legacyState);
      return await snapshot(db, user, true);
    }
    if (action === 'join-room') {
      await joinRoom(db, user, body.code);
      return await snapshot(db, user, true);
    }

    const room = await ensureRoom(db, user, body.legacyState);
    if (action === 'rename') {
      const name = clean(body.name, '');
      if (!name) fail('Enter a name.');
      await profileRef(db, user.uid).set({ name, updatedAt: Date.now() });
      preferredNames.set(user.uid, name);
      await updateProfile(db, user, name, user.photoURL);
    } else if (action === 'sync-profile') {
      await updateProfile(db, user, preferredNames.get(user.uid) || body.name, body.photoUrl);
    } else if (action === 'create-room') {
      await createRoom(db, user, body.name);
    } else if (action === 'rename-room') {
      if (room.host_id !== user.uid || room.id !== String(body.roomId || '')) fail('Only the game owner can rename it.', 403);
      await roomRef(db, room.id).update({ name: clean(body.name, 'My game'), updated_at: Date.now() });
    } else if (action === 'delete-room') {
      await deleteRoom(db, user, String(body.roomId || ''));
    } else if (action === 'switch-room') {
      const next = await roomRef(db, String(body.roomId || '')).get();
      if (!next.exists || !parseRoom(next.id, next.data()).member_ids.includes(user.uid)) fail('That game was not found.', 404);
      rememberRoom(user.uid, next.id);
    } else if (action === 'leave-room') {
      await leaveRoom(db, user, room);
    } else if (action === 'import-local') {
      const count = await importLocalGames(db, user, room, body.data);
      if (count) pendingNotice = `Added ${count} ${count === 1 ? 'game' : 'games'} from this device to your history.`;
    } else if (action === 'remove-member') {
      const playerId = String(body.playerId || '');
      if (room.host_id !== user.uid || room.id !== String(body.roomId || '')) fail('Only the game owner can manage its players.', 403);
      if (!playerId || playerId === user.uid) fail('The game owner cannot be removed.');
      await db.runTransaction(async transaction => {
        const reference = roomRef(db, room.id);
        const document = await transaction.get(reference);
        if (!document.exists) fail('That game was not found.', 404);
        const latest = parseRoom(document.id, document.data());
        if (!latest.member_ids.includes(playerId)) fail('That player is no longer in this game.', 404);
        const currentGameReference = gameRef(db, room.id, latest.current_game_id);
        const currentGameDocument = await transaction.get(currentGameReference);
        const currentGame = currentGameDocument.exists ? parseStoredGame(currentGameDocument.id, currentGameDocument.data()) : null;
        const updatedAt = Date.now();
        transaction.update(reference, { member_ids: latest.member_ids.filter(id => id !== playerId), updated_at: updatedAt });
        transaction.delete(memberRef(db, room.id, playerId));
        if (currentGame?.sheets[playerId] && !currentGame.ended_at) {
          const sheets = { ...currentGame.sheets };
          delete sheets[playerId];
          const remainingSheets = Object.values(sheets);
          const endedAt = remainingSheets.length > 0 && remainingSheets.every(sheet => sheet.completed_at)
            ? currentGame.ended_at || updatedAt
            : null;
          transaction.update(currentGameReference, { sheets, ended_at: endedAt, updated_at: updatedAt });
        }
      });
    } else if (action === 'score' || action === 'bonus') {
      await mutateScore(db, user, room, body);
      return await snapshot(db, user);
    } else if (action === 'new-game') {
      await newGame(db, user, room, body);
    } else if (action === 'delete-game') {
      await deleteGame(db, user, room, body);
    } else {
      fail('Unknown action.');
    }

    return await snapshot(db, user, true);
  } catch (error) {
    friendlyFirebaseError(error);
  }
}

export function onlineInviteCode(value: string) {
  return inviteCode(value);
}
