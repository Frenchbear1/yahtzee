import { totals, validScore, type Game, type Room, type Scores, type Sheet, type State } from './game';

type BrowserRoom = Room & { created_at: number };
type BrowserStore = {
  version: 1;
  me: State['me'];
  currentRoom: string;
  rooms: BrowserRoom[];
  games: Game[];
};

const storageKey = 'yahtzee-pages-store-v1';

function id() {
  return crypto.randomUUID().replace(/-/g, '');
}

function code() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from(crypto.getRandomValues(new Uint8Array(4)), value => alphabet[value % alphabet.length]).join('');
}

function clean(value: unknown, fallback: string) {
  const result = String(value ?? '').trim().replace(/\s+/g, ' ').slice(0, 32);
  return result || fallback;
}

function fail(message: string, status = 400): never {
  const error = new Error(message) as Error & { status?: number };
  error.status = status;
  throw error;
}

function sheet(gameId: string, playerId: string, name: string): Sheet {
  return {
    game_id: gameId,
    player_id: playerId,
    name,
    photo_url: null,
    scores: {},
    bonus: 0,
    revision: 0,
    completed_at: null,
  };
}

function createStore(): BrowserStore {
  const playerId = id(), roomId = id(), gameId = id(), now = Date.now();
  return {
    version: 1,
    me: { id: playerId, name: 'You', photo_url: null },
    currentRoom: roomId,
    rooms: [{ id: roomId, name: 'My table', code: code(), host_id: playerId, created_at: now }],
    games: [{ id: gameId, room_id: roomId, started_at: now, ended_at: null, sheets: [sheet(gameId, playerId, 'You')] }],
  };
}

function loadStore() {
  try {
    const parsed = JSON.parse(localStorage.getItem(storageKey) || 'null') as BrowserStore | null;
    if (parsed?.version === 1 && parsed.me?.id && parsed.rooms?.length && parsed.games?.length) return parsed;
  } catch {}
  const store = createStore();
  saveStore(store);
  return store;
}

function saveStore(store: BrowserStore) {
  localStorage.setItem(storageKey, JSON.stringify(store));
}

function currentRoom(store: BrowserStore) {
  return store.rooms.find(room => room.id === store.currentRoom) || fail('That table was not found.', 404);
}

function roomGames(store: BrowserStore, roomId = store.currentRoom) {
  return store.games.filter(game => game.room_id === roomId).sort((a, b) => b.started_at - a.started_at);
}

function publicRoom(room: BrowserRoom): Room {
  return { id: room.id, name: room.name, code: room.code, host_id: room.host_id };
}

function snapshot(store: BrowserStore): State {
  const room = currentRoom(store);
  const history = roomGames(store);
  const state: State = {
    me: store.me,
    room,
    rooms: [...store.rooms].sort((a, b) => b.created_at - a.created_at).map(publicRoom),
    managedRooms: [...store.rooms].sort((a, b) => b.created_at - a.created_at).map(item => ({
      ...publicRoom(item),
      members: [store.me],
    })),
    players: [{ ...store.me, active: true }],
    game: history[0],
    history,
    mode: 'browser',
  };
  return JSON.parse(JSON.stringify(state)) as State;
}

function createRoom(store: BrowserStore, name: unknown) {
  const roomId = id(), gameId = id(), now = Date.now();
  store.rooms.push({ id: roomId, name: clean(name, 'My table'), code: code(), host_id: store.me.id, created_at: now });
  store.games.push({ id: gameId, room_id: roomId, started_at: now, ended_at: null, sheets: [sheet(gameId, store.me.id, store.me.name)] });
  store.currentRoom = roomId;
}

export async function browserGameRequest(body: Record<string, unknown>): Promise<State> {
  const store = loadStore();
  const action = String(body.action || '');

  if (action === 'rename') {
    store.me.name = clean(body.name, 'You');
    for (const game of store.games) for (const playerSheet of game.sheets) playerSheet.name = store.me.name;
  } else if (action === 'create-room') {
    createRoom(store, body.name);
  } else if (action === 'rename-room') {
    const room = store.rooms.find(item => item.id === String(body.roomId || '')) || fail('That table was not found.', 404);
    room.name = clean(body.name, 'My table');
  } else if (action === 'delete-room') {
    const roomId = String(body.roomId || '');
    if (!store.rooms.some(room => room.id === roomId)) fail('That table was not found.', 404);
    store.rooms = store.rooms.filter(room => room.id !== roomId);
    store.games = store.games.filter(game => game.room_id !== roomId);
    if (!store.rooms.length) createRoom(store, 'My table');
    else if (store.currentRoom === roomId) store.currentRoom = [...store.rooms].sort((a, b) => b.created_at - a.created_at)[0].id;
  } else if (action === 'switch-room') {
    const roomId = String(body.roomId || '');
    if (!store.rooms.some(room => room.id === roomId)) fail('That table was not found.', 404);
    store.currentRoom = roomId;
  } else if (action === 'join-room') {
    const wanted = String(body.code || '').replace(/[^a-z0-9]/gi, '').toUpperCase();
    const room = store.rooms.find(item => item.code === wanted);
    if (!room) fail('Shared tables need a server. This Pages edition keeps scores only in this browser.');
    store.currentRoom = room.id;
  } else if (action === 'score' || action === 'bonus') {
    const game = roomGames(store).find(item => item.id === String(body.gameId || '')) || fail('This score sheet is not available.', 404);
    if (roomGames(store)[0]?.id !== game.id) fail('This game has been saved to history. Open the current game.', 409);
    const playerSheet = game.sheets.find(item => item.player_id === store.me.id) || fail('This score sheet is not available.', 404);
    if (body.revision !== playerSheet.revision) fail('This score changed in another tab. Your sheet has been refreshed; try again.', 409);
    const scores: Scores = { ...playerSheet.scores };
    let bonus = playerSheet.bonus;
    if (action === 'score') {
      if (!validScore(String(body.category || ''), body.value)) fail('Choose a valid score for this category.');
      scores[String(body.category)] = body.value as number | null;
      if (body.category === 'yahtzee') {
        if (body.value !== 50) bonus = 0;
        else if (body.restoreBonus !== undefined) bonus = Number(body.restoreBonus);
      }
    } else {
      const nextBonus = Number(body.bonus);
      if (!Number.isInteger(nextBonus) || nextBonus < 0 || nextBonus > 12) fail('Choose between 0 and 12 extra Yahtzees.');
      if (nextBonus > 0 && scores.yahtzee !== 50) fail('Score your first Yahtzee as 50 before adding a bonus.');
      bonus = nextBonus;
    }
    playerSheet.scores = scores;
    playerSheet.bonus = bonus;
    playerSheet.revision += 1;
    playerSheet.completed_at = totals(scores, bonus).filled === 13 ? Date.now() : null;
    game.ended_at = playerSheet.completed_at;
  } else if (action === 'delete-game') {
    const gameId = String(body.gameId || '');
    const game = store.games.find(item => item.id === gameId && item.room_id === store.currentRoom) || fail('That game was not found.', 404);
    const wasCurrent = roomGames(store)[0]?.id === game.id;
    store.games = store.games.filter(item => item.id !== gameId);
    if (wasCurrent) {
      const gameId = id(), now = Date.now();
      store.games.push({ id: gameId, room_id: store.currentRoom, started_at: now, ended_at: null, sheets: [sheet(gameId, store.me.id, store.me.name)] });
    }
  } else if (action === 'new-game') {
    const latest = roomGames(store)[0];
    if (!latest || latest.id !== String(body.gameId || '')) fail('A new game has already started. Your table is refreshed.', 409);
    const gameId = id(), now = Date.now();
    store.games.push({ id: gameId, room_id: store.currentRoom, started_at: now, ended_at: null, sheets: [sheet(gameId, store.me.id, store.me.name)] });
  } else if (!['bootstrap', 'refresh'].includes(action)) {
    fail('Unknown action.');
  }

  saveStore(store);
  return snapshot(store);
}
