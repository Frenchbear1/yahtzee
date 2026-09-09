import { totals, validScore } from './game';

type DB = { prepare: (query: string) => any; batch: (statements: any[]) => Promise<any[]> };

class APIError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}

const fail = (message: string, status = 400): never => { throw new APIError(message, status); };
const id = () => crypto.randomUUID();
const code = () => Array.from(crypto.getRandomValues(new Uint8Array(4)), n => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[n % 32]).join('');
const clean = (value: unknown, fallback: string) => typeof value === 'string' && value.trim() ? value.trim().slice(0, 32) : fallback;
const cleanPhoto = (value: unknown) => {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string' || value.length > 600) return null;
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    return url.protocol === 'https:' && (host === 'googleusercontent.com' || host.endsWith('.googleusercontent.com')) ? url.toString() : null;
  } catch {
    return null;
  }
};

async function shortenCode(db: DB, room: any) {
  if (!room || room.code.length <= 4) return;
  for (let i = 0; i < 5; i++) {
    const next = code();
    try {
      const changed = await db.prepare('UPDATE rooms SET code=? WHERE id=? AND NOT EXISTS (SELECT 1 FROM rooms WHERE code=?)').bind(next, room.id, next).run();
      if (changed.meta?.changes) { room.code = next; return; }
    } catch {}
  }
}

export async function handleGame(request: Request, db: DB, mode = 'online') {
  const json = (data: any, status = 200) => Response.json(data, { status, headers: { 'Cache-Control': 'no-store' } });
  try {
    const token = request.headers.get('x-player-token') || '';
    if (!/^[a-zA-Z0-9-]{32,100}$/.test(token)) fail('Your player profile needs to reconnect. Refresh and try again.', 401);
    if (Number(request.headers.get('content-length')) > 12000) fail('Request too large.', 413);
    const raw = await request.text();
    if (raw.length > 12000) fail('Request too large.', 413);
    const body = JSON.parse(raw);
    if (!body || typeof body !== 'object') fail('Invalid request.');

    const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))), byte => byte.toString(16).padStart(2, '0')).join('');
    const seenAt = Date.now();
    let me = await db.prepare('SELECT id,name,photo_url,current_room FROM players WHERE token=?').bind(hash).first();

    if (!me) {
      if (body.action !== 'bootstrap') fail('Reconnect your player profile.', 401);
      const playerId = id(), roomId = id(), gameId = id(), now = Date.now();
      await db.batch([
        db.prepare('INSERT INTO players (id,token,name,photo_url,current_room,last_seen) VALUES (?,?,?,?,?,?)').bind(playerId, hash, 'You', null, roomId, now),
        db.prepare('INSERT INTO rooms (id,name,code,host_id,created_at) VALUES (?,?,?,?,?)').bind(roomId, 'My table', code(), playerId, now),
        db.prepare('INSERT INTO members (room_id,player_id) VALUES (?,?)').bind(roomId, playerId),
        db.prepare('INSERT INTO games (id,room_id,started_at) VALUES (?,?,?)').bind(gameId, roomId, now),
        db.prepare('INSERT INTO sheets (game_id,player_id) VALUES (?,?)').bind(gameId, playerId),
      ]);
      me = { id: playerId, name: 'You', photo_url: null, current_room: roomId };
    }

    await db.prepare('UPDATE players SET last_seen=? WHERE id=?').bind(seenAt, me.id).run();

    const snapshot = async () => {
      const room = await db.prepare('SELECT id,name,code,host_id FROM rooms WHERE id=?').bind(me.current_room).first();
      if (room?.host_id === me.id) await shortenCode(db, room);
      const roomRows = await db.prepare('SELECT r.id,r.name,r.code,r.host_id FROM rooms r JOIN members m ON r.id=m.room_id WHERE m.player_id=? ORDER BY r.created_at DESC').bind(me.id).all();
      const playerRows = await db.prepare('SELECT p.id,p.name,p.photo_url,p.current_room,p.last_seen FROM players p JOIN members m ON m.player_id=p.id WHERE m.room_id=? ORDER BY p.name').bind(me.current_room).all();
      const games = await db.prepare('SELECT * FROM games WHERE room_id=? ORDER BY started_at DESC').bind(me.current_room).all();
      const sheets = await db.prepare('SELECT s.*,p.name,p.photo_url FROM sheets s JOIN players p ON p.id=s.player_id WHERE s.game_id IN (SELECT id FROM games WHERE room_id=? ORDER BY started_at DESC)').bind(me.current_room).all();
      const history = games.results.map((game: any) => ({
        ...game,
        sheets: sheets.results.filter((sheet: any) => sheet.game_id === game.id).map((sheet: any) => ({ ...sheet, scores: JSON.parse(sheet.scores) })),
      }));
      const ownedRows = await db.prepare(`
        SELECT r.id AS room_id,r.name AS room_name,r.code,r.host_id,r.created_at,
               p.id AS player_id,p.name AS player_name,p.photo_url
        FROM rooms r
        JOIN members m ON m.room_id=r.id
        JOIN players p ON p.id=m.player_id
        WHERE r.host_id=?
        ORDER BY r.created_at DESC,p.name
      `).bind(me.id).all();
      const managedRooms: any[] = [];
      for (const row of ownedRows.results) {
        let managed = managedRooms.find(item => item.id === row.room_id);
        if (!managed) {
          managed = { id: row.room_id, name: row.room_name, code: row.code, host_id: row.host_id, members: [] };
          managedRooms.push(managed);
        }
        managed.members.push({ id: row.player_id, name: row.player_name, photo_url: row.photo_url || null });
      }
      return {
        me: { id: me.id, name: me.name, photo_url: me.photo_url || null },
        room,
        rooms: roomRows.results,
        managedRooms,
        players: playerRows.results.map((player: any) => ({
          id: player.id,
          name: player.name,
          photo_url: player.photo_url || null,
          active: player.current_room === me.current_room && seenAt - player.last_seen < 15000,
        })),
        game: history[0],
        history,
        mode,
      };
    };

    if (body.action === 'rename') {
      const name = clean(body.name, 'You');
      await db.prepare('UPDATE players SET name=? WHERE id=?').bind(name, me.id).run();
      me.name = name;
    } else if (body.action === 'sync-profile') {
      const photoUrl = cleanPhoto(body.photoUrl);
      const googleName = clean(body.name, 'You');
      const name = googleName;
      await db.prepare('UPDATE players SET name=?,photo_url=? WHERE id=?').bind(name, photoUrl, me.id).run();
      me.name = name;
      me.photo_url = photoUrl;
    } else if (body.action === 'create-room') {
      const roomId = id(), gameId = id(), now = Date.now();
      await db.batch([
        db.prepare('INSERT INTO rooms (id,name,code,host_id,created_at) VALUES (?,?,?,?,?)').bind(roomId, clean(body.name, 'Family table'), code(), me.id, now),
        db.prepare('INSERT INTO members (room_id,player_id) VALUES (?,?)').bind(roomId, me.id),
        db.prepare('INSERT INTO games (id,room_id,started_at) VALUES (?,?,?)').bind(gameId, roomId, now),
        db.prepare('INSERT INTO sheets (game_id,player_id) VALUES (?,?)').bind(gameId, me.id),
        db.prepare('UPDATE players SET current_room=? WHERE id=?').bind(roomId, me.id),
      ]);
      me.current_room = roomId;
    } else if (body.action === 'rename-room') {
      const roomId = String(body.roomId || '');
      const room = await db.prepare('SELECT id,host_id FROM rooms WHERE id=?').bind(roomId).first();
      if (!room) fail('That table was not found.', 404);
      if (room.host_id !== me.id) fail('Only the table owner can rename it.', 403);
      await db.prepare('UPDATE rooms SET name=? WHERE id=?').bind(clean(body.name, 'My table'), roomId).run();
    } else if (body.action === 'remove-member') {
      const roomId = String(body.roomId || ''), playerId = String(body.playerId || '');
      const room = await db.prepare('SELECT id,host_id FROM rooms WHERE id=?').bind(roomId).first();
      if (!room) fail('That table was not found.', 404);
      if (room.host_id !== me.id) fail('Only the table owner can manage its players.', 403);
      if (!playerId || playerId === room.host_id) fail('The table owner cannot be removed.');
      const member = await db.prepare('SELECT p.id,p.current_room FROM players p JOIN members m ON m.player_id=p.id WHERE p.id=? AND m.room_id=?').bind(playerId, roomId).first();
      if (!member) fail('That player is no longer at this table.', 404);
      const statements = [db.prepare('DELETE FROM members WHERE room_id=? AND player_id=?').bind(roomId, playerId)];
      if (member.current_room === roomId) {
        const alternate = await db.prepare('SELECT room_id FROM members WHERE player_id=? AND room_id<>? LIMIT 1').bind(playerId, roomId).first();
        if (alternate) {
          statements.push(db.prepare('UPDATE players SET current_room=? WHERE id=?').bind(alternate.room_id, playerId));
        } else {
          const fallbackRoom = id(), fallbackGame = id(), now = Date.now();
          statements.push(
            db.prepare('INSERT INTO rooms (id,name,code,host_id,created_at) VALUES (?,?,?,?,?)').bind(fallbackRoom, 'My table', code(), playerId, now),
            db.prepare('INSERT INTO members (room_id,player_id) VALUES (?,?)').bind(fallbackRoom, playerId),
            db.prepare('INSERT INTO games (id,room_id,started_at) VALUES (?,?,?)').bind(fallbackGame, fallbackRoom, now),
            db.prepare('INSERT INTO sheets (game_id,player_id) VALUES (?,?)').bind(fallbackGame, playerId),
            db.prepare('UPDATE players SET current_room=? WHERE id=?').bind(fallbackRoom, playerId),
          );
        }
      }
      await db.batch(statements);
    } else if (body.action === 'delete-room') {
      const roomId = String(body.roomId || '');
      const room = await db.prepare('SELECT id,host_id FROM rooms WHERE id=?').bind(roomId).first();
      if (!room) fail('That table was not found.', 404);
      if (room.host_id !== me.id) fail('Only the table owner can delete it.', 403);
      const currentMembers = await db.prepare('SELECT p.id,p.current_room FROM players p JOIN members m ON m.player_id=p.id WHERE m.room_id=?').bind(roomId).all();
      const statements: any[] = [];
      let nextRoomForMe = me.current_room;
      for (const member of currentMembers.results) {
        if (member.current_room !== roomId) continue;
        const alternate = await db.prepare('SELECT room_id FROM members WHERE player_id=? AND room_id<>? LIMIT 1').bind(member.id, roomId).first();
        if (alternate) {
          statements.push(db.prepare('UPDATE players SET current_room=? WHERE id=?').bind(alternate.room_id, member.id));
          if (member.id === me.id) nextRoomForMe = alternate.room_id;
        } else {
          const fallbackRoom = id(), fallbackGame = id(), now = Date.now();
          statements.push(
            db.prepare('INSERT INTO rooms (id,name,code,host_id,created_at) VALUES (?,?,?,?,?)').bind(fallbackRoom, 'My table', code(), member.id, now),
            db.prepare('INSERT INTO members (room_id,player_id) VALUES (?,?)').bind(fallbackRoom, member.id),
            db.prepare('INSERT INTO games (id,room_id,started_at) VALUES (?,?,?)').bind(fallbackGame, fallbackRoom, now),
            db.prepare('INSERT INTO sheets (game_id,player_id) VALUES (?,?)').bind(fallbackGame, member.id),
            db.prepare('UPDATE players SET current_room=? WHERE id=?').bind(fallbackRoom, member.id),
          );
          if (member.id === me.id) nextRoomForMe = fallbackRoom;
        }
      }
      statements.push(
        db.prepare('DELETE FROM sheets WHERE game_id IN (SELECT id FROM games WHERE room_id=?)').bind(roomId),
        db.prepare('DELETE FROM games WHERE room_id=?').bind(roomId),
        db.prepare('DELETE FROM members WHERE room_id=?').bind(roomId),
        db.prepare('DELETE FROM rooms WHERE id=?').bind(roomId),
      );
      await db.batch(statements);
      me.current_room = nextRoomForMe;
    } else if (body.action === 'join-room' || body.action === 'switch-room') {
      const room = body.action === 'join-room'
        ? await db.prepare('SELECT * FROM rooms WHERE code=?').bind(String(body.code || '').replace(/[^a-z0-9]/gi, '').toUpperCase()).first()
        : await db.prepare('SELECT r.* FROM rooms r JOIN members m ON r.id=m.room_id WHERE r.id=? AND m.player_id=?').bind(String(body.roomId || ''), me.id).first();
      if (!room) fail('That table was not found. Check the four-letter code.');
      const game = await db.prepare('SELECT * FROM games WHERE room_id=? ORDER BY started_at DESC LIMIT 1').bind(room.id).first();
      const statements = [
        db.prepare('INSERT OR IGNORE INTO members (room_id,player_id) VALUES (?,?)').bind(room.id, me.id),
        db.prepare('UPDATE players SET current_room=? WHERE id=?').bind(room.id, me.id),
      ];
      if (game && !game.ended_at) statements.push(db.prepare('INSERT OR IGNORE INTO sheets (game_id,player_id) SELECT ?,? WHERE EXISTS (SELECT 1 FROM games WHERE id=? AND ended_at IS NULL)').bind(game.id, me.id, game.id));
      await db.batch(statements);
      me.current_room = room.id;
    } else if (body.action === 'score' || body.action === 'bonus') {
      const sheet = await db.prepare('SELECT s.*,g.room_id FROM sheets s JOIN games g ON g.id=s.game_id WHERE s.game_id=? AND s.player_id=? AND g.room_id=?').bind(String(body.gameId || ''), me.id, me.current_room).first();
      if (!sheet) fail('This score sheet is not available.', 404);
      const latest = await db.prepare('SELECT id FROM games WHERE room_id=? ORDER BY started_at DESC LIMIT 1').bind(me.current_room).first();
      if (latest.id !== sheet.game_id) fail('This game has been saved to history. Open the current game.', 409);
      if (body.revision !== sheet.revision) fail('This score changed on another screen. Your sheet has been refreshed; try again.', 409);
      const scores = JSON.parse(sheet.scores);
      let bonus = sheet.bonus;
      if (body.action === 'score') {
        if (!validScore(body.category, body.value)) fail('Choose a valid score for this category.');
        scores[body.category] = body.value;
        if (body.category === 'yahtzee') {
          if (body.value !== 50) bonus = 0;
          else if (body.restoreBonus !== undefined) {
            if (!Number.isInteger(body.restoreBonus) || body.restoreBonus < 0 || body.restoreBonus > 12) fail('That Yahtzee bonus cannot be restored.');
            bonus = body.restoreBonus;
          }
        }
      } else {
        if (!Number.isInteger(body.bonus) || body.bonus < 0 || body.bonus > 12) fail('Choose between 0 and 12 extra Yahtzees.');
        if (body.bonus > 0 && scores.yahtzee !== 50) fail('Score your first Yahtzee as 50 before adding a bonus.');
        bonus = body.bonus;
      }
      const complete = totals(scores, bonus).filled === 13 ? Date.now() : null;
      const updated = await db.prepare('UPDATE sheets SET scores=?,bonus=?,revision=revision+1,completed_at=? WHERE game_id=? AND player_id=? AND revision=?').bind(JSON.stringify(scores), bonus, complete, sheet.game_id, me.id, body.revision).run();
      if (!updated.meta?.changes) fail('Another screen changed this score. Please try again.', 409);
      await db.prepare('UPDATE games SET ended_at=CASE WHEN NOT EXISTS (SELECT 1 FROM sheets WHERE game_id=? AND completed_at IS NULL) THEN COALESCE(ended_at,?) ELSE NULL END WHERE id=?').bind(sheet.game_id, Date.now(), sheet.game_id).run();
    } else if (body.action === 'delete-game') {
      const gameId = String(body.gameId || '');
      const oldGame = await db.prepare('SELECT g.id,g.room_id,r.host_id FROM games g JOIN rooms r ON r.id=g.room_id WHERE g.id=?').bind(gameId).first();
      if (!oldGame) fail('That game was not found.', 404);
      if (oldGame.host_id !== me.id) fail('Only the table owner can delete game history.', 403);
      const latest = await db.prepare('SELECT id FROM games WHERE room_id=? ORDER BY started_at DESC LIMIT 1').bind(oldGame.room_id).first();
      const statements = [
        db.prepare('DELETE FROM sheets WHERE game_id=?').bind(gameId),
        db.prepare('DELETE FROM games WHERE id=?').bind(gameId),
      ];
      if (latest?.id === gameId) {
        const replacementId = id(), started = Date.now();
        statements.push(
          db.prepare('INSERT INTO games (id,room_id,started_at) VALUES (?,?,?)').bind(replacementId, oldGame.room_id, started),
          db.prepare('INSERT INTO sheets (game_id,player_id) SELECT ?,m.player_id FROM members m JOIN players p ON p.id=m.player_id WHERE m.room_id=? AND (m.player_id=? OR (p.current_room=? AND p.last_seen>=?))').bind(replacementId, oldGame.room_id, me.id, oldGame.room_id, started - 15000),
        );
      }
      await db.batch(statements);
    } else if (body.action === 'new-game') {
      const room = await db.prepare('SELECT * FROM rooms WHERE id=?').bind(me.current_room).first();
      if (room.host_id !== me.id) fail('The table host starts the next game.', 403);
      const game = await db.prepare('SELECT * FROM games WHERE room_id=? ORDER BY started_at DESC LIMIT 1').bind(me.current_room).first();
      if (game.id !== body.gameId) fail('A new game has already started. Your table is refreshed.', 409);
      if (!game.ended_at && !body.confirm) fail('There are unfinished score sheets. Confirm to start a fresh game.');
      const gameId = id(), started = Date.now();
      const created = await db.batch([
        db.prepare('INSERT INTO games (id,room_id,started_at) SELECT ?,?,? WHERE (SELECT id FROM games WHERE room_id=? ORDER BY started_at DESC LIMIT 1)=?').bind(gameId, me.current_room, started, me.current_room, game.id),
        db.prepare('INSERT INTO sheets (game_id,player_id) SELECT ?,m.player_id FROM members m JOIN players p ON p.id=m.player_id WHERE m.room_id=? AND (m.player_id=? OR (p.current_room=? AND p.last_seen>=?)) AND EXISTS (SELECT 1 FROM games WHERE id=?)').bind(gameId, me.current_room, me.id, me.current_room, started - 15000, gameId),
      ]);
      if (!created[0].meta?.changes) fail('A new game has already started. Your table is refreshed.', 409);
    } else if (body.action !== 'bootstrap' && body.action !== 'refresh') {
      fail('Unknown action.');
    }

    const current = await db.prepare('SELECT id FROM games WHERE room_id=? AND ended_at IS NULL ORDER BY started_at DESC LIMIT 1').bind(me.current_room).first();
    if (current) await db.prepare('INSERT OR IGNORE INTO sheets (game_id,player_id) SELECT ?,? WHERE EXISTS (SELECT 1 FROM members WHERE room_id=? AND player_id=?)').bind(current.id, me.id, me.current_room, me.id).run();
    return json(await snapshot());
  } catch (error) {
    if (error instanceof APIError) return json({ error: error.message }, error.status);
    if (error instanceof SyntaxError) return json({ error: 'That request could not be read.' }, 400);
    console.error('Game request failed', error);
    return json({ error: 'Your table is temporarily unavailable. Your unsaved input is still here; please try again.' }, 503);
  }
}
