import { totals, validScore } from './game';
type DB = {prepare:(q:string)=>any;batch:(s:any[])=>Promise<any[]>};
class APIError extends Error {constructor(message:string,public status=400){super(message)}}
const fail=(message:string,status=400):never=>{throw new APIError(message,status)};
const id=()=>crypto.randomUUID();
const code=()=>Array.from(crypto.getRandomValues(new Uint8Array(8)),n=>'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[n%32]).join('');
const clean=(s:unknown,fallback:string)=>typeof s==='string'&&s.trim()?s.trim().slice(0,32):fallback;
export async function handleGame(request:Request,db:DB,mode='online'){
 const json=(d:any,status=200)=>Response.json(d,{status,headers:{'Cache-Control':'no-store'}});
 try{
  const token=request.headers.get('x-player-token')||'';
  if(!/^[a-zA-Z0-9-]{32,100}$/.test(token))fail('Your player profile needs to reconnect. Refresh and try again.',401);
  if(Number(request.headers.get('content-length'))>12000)fail('Request too large.',413);
  const raw=await request.text();if(raw.length>12000)fail('Request too large.',413);
  const b=JSON.parse(raw);if(!b||typeof b!=='object')fail('Invalid request.');
  const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(token))),b=>b.toString(16).padStart(2,'0')).join('');
  let me=await db.prepare('SELECT id,name,current_room FROM players WHERE token=?').bind(hash).first();
  if(!me){if(b.action!=='bootstrap')fail('Reconnect your player profile.',401);const pid=id(),rid=id(),gid=id(),now=Date.now();
   await db.batch([db.prepare('INSERT INTO players (id,token,name,current_room) VALUES (?,?,?,?)').bind(pid,hash,'You',rid),db.prepare('INSERT INTO rooms (id,name,code,host_id,created_at) VALUES (?,?,?,?,?)').bind(rid,'My table',code(),pid,now),db.prepare('INSERT INTO members (room_id,player_id) VALUES (?,?)').bind(rid,pid),db.prepare('INSERT INTO games (id,room_id,started_at) VALUES (?,?,?)').bind(gid,rid,now),db.prepare('INSERT INTO sheets (game_id,player_id) VALUES (?,?)').bind(gid,pid)]);me={id:pid,name:'You',current_room:rid};
  }
  const snapshot=async()=>{
   const room=await db.prepare('SELECT id,name,code,host_id FROM rooms WHERE id=?').bind(me.current_room).first();
   const roomRows=await db.prepare('SELECT r.id,r.name,r.code,r.host_id FROM rooms r JOIN members m ON r.id=m.room_id WHERE m.player_id=? ORDER BY r.created_at DESC').bind(me.id).all();
   const gs=await db.prepare('SELECT * FROM games WHERE room_id=? ORDER BY started_at DESC').bind(me.current_room).all();
   const ss=await db.prepare('SELECT s.*,p.name FROM sheets s JOIN players p ON p.id=s.player_id WHERE s.game_id IN (SELECT id FROM games WHERE room_id=? ORDER BY started_at DESC)').bind(me.current_room).all();
   const history=gs.results.map((g:any)=>({...g,sheets:ss.results.filter((s:any)=>s.game_id===g.id).map((s:any)=>({...s,scores:JSON.parse(s.scores)}))}));
   return{me:{id:me.id,name:me.name},room,rooms:roomRows.results,game:history[0],history,mode};
  };
  if(b.action==='rename'){
   const name=clean(b.name,'You');await db.prepare('UPDATE players SET name=? WHERE id=?').bind(name,me.id).run();me.name=name;
  }else if(b.action==='create-room'){
   const rid=id(),gid=id(),now=Date.now();await db.batch([db.prepare('INSERT INTO rooms (id,name,code,host_id,created_at) VALUES (?,?,?,?,?)').bind(rid,clean(b.name,'Family table'),code(),me.id,now),db.prepare('INSERT INTO members (room_id,player_id) VALUES (?,?)').bind(rid,me.id),db.prepare('INSERT INTO games (id,room_id,started_at) VALUES (?,?,?)').bind(gid,rid,now),db.prepare('INSERT INTO sheets (game_id,player_id) VALUES (?,?)').bind(gid,me.id),db.prepare('UPDATE players SET current_room=? WHERE id=?').bind(rid,me.id)]);me.current_room=rid;
  }else if(b.action==='join-room'||b.action==='switch-room'){
   const room= b.action==='join-room'?await db.prepare('SELECT * FROM rooms WHERE code=?').bind(String(b.code||'').replace(/[^a-z0-9]/gi,'').toUpperCase()).first():await db.prepare('SELECT r.* FROM rooms r JOIN members m ON r.id=m.room_id WHERE r.id=? AND m.player_id=?').bind(String(b.roomId||''),me.id).first();
   if(!room)fail('That table wasn’t found. Check the eight-letter code.');
   const g=await db.prepare('SELECT * FROM games WHERE room_id=? ORDER BY started_at DESC LIMIT 1').bind(room.id).first();
   const statements=[db.prepare('INSERT OR IGNORE INTO members (room_id,player_id) VALUES (?,?)').bind(room.id,me.id),db.prepare('UPDATE players SET current_room=? WHERE id=?').bind(room.id,me.id)];
   if(g&&!g.ended_at)statements.push(db.prepare('INSERT OR IGNORE INTO sheets (game_id,player_id) SELECT ?,? WHERE EXISTS (SELECT 1 FROM games WHERE id=? AND ended_at IS NULL)').bind(g.id,me.id,g.id));
   await db.batch(statements);me.current_room=room.id;
  }else if(b.action==='score'||b.action==='bonus'){
   const s=await db.prepare('SELECT s.*,g.room_id FROM sheets s JOIN games g ON g.id=s.game_id WHERE s.game_id=? AND s.player_id=? AND g.room_id=?').bind(String(b.gameId||''),me.id,me.current_room).first();
   if(!s)fail('This score sheet is not available.',404);
   const latest=await db.prepare('SELECT id FROM games WHERE room_id=? ORDER BY started_at DESC LIMIT 1').bind(me.current_room).first();
   if(latest.id!==s.game_id)fail('This game has been saved to history. Open the current game.',409);
   if(b.revision!==s.revision)fail('This score changed on another screen. Your sheet has been refreshed; try again.',409);
   const scores=JSON.parse(s.scores);let bonus=s.bonus;
   if(b.action==='score'){if(!validScore(b.category,b.value))fail('Choose a valid score for this category.');scores[b.category]=b.value;if(b.category==='yahtzee'){if(b.value!==50)bonus=0;else if(b.restoreBonus!==undefined){if(!Number.isInteger(b.restoreBonus)||b.restoreBonus<0||b.restoreBonus>12)fail('That Yahtzee bonus cannot be restored.');bonus=b.restoreBonus;}}}
   else{if(!Number.isInteger(b.bonus)||b.bonus<0||b.bonus>12)fail('Choose between 0 and 12 extra Yahtzees.');if(b.bonus>0&&scores.yahtzee!==50)fail('Score your first Yahtzee as 50 before adding a bonus.');bonus=b.bonus;}
   const complete=totals(scores,bonus).filled===13?Date.now():null;
   const updated=await db.prepare('UPDATE sheets SET scores=?,bonus=?,revision=revision+1,completed_at=? WHERE game_id=? AND player_id=? AND revision=?').bind(JSON.stringify(scores),bonus,complete,s.game_id,me.id,b.revision).run();
   if(!updated.meta?.changes)fail('Another screen changed this score. Please try again.',409);
   await db.prepare('UPDATE games SET ended_at=CASE WHEN NOT EXISTS (SELECT 1 FROM sheets WHERE game_id=? AND completed_at IS NULL) THEN COALESCE(ended_at,?) ELSE NULL END WHERE id=?').bind(s.game_id,Date.now(),s.game_id).run();
  }else if(b.action==='new-game'){
   const room=await db.prepare('SELECT * FROM rooms WHERE id=?').bind(me.current_room).first();if(room.host_id!==me.id)fail('The table host starts the next game.',403);
   const g=await db.prepare('SELECT * FROM games WHERE room_id=? ORDER BY started_at DESC LIMIT 1').bind(me.current_room).first();
   if(g.id!==b.gameId)fail('A new game has already started. Your table is refreshed.',409);
   if(!g.ended_at&&!b.confirm)fail('There are unfinished score sheets. Confirm to start a fresh game.');
   const gid=id();const created=await db.batch([db.prepare('INSERT INTO games (id,room_id,started_at) SELECT ?,?,? WHERE (SELECT id FROM games WHERE room_id=? ORDER BY started_at DESC LIMIT 1)=?').bind(gid,me.current_room,Date.now(),me.current_room,g.id),db.prepare('INSERT INTO sheets (game_id,player_id) SELECT ?,player_id FROM members WHERE room_id=? AND EXISTS (SELECT 1 FROM games WHERE id=?)').bind(gid,me.current_room,gid)]);if(!created[0].meta?.changes)fail('A new game has already started. Your table is refreshed.',409);
  }else if(b.action!=='bootstrap'&&b.action!=='refresh'){fail('Unknown action.');}
  return json(await snapshot());
 }catch(e){if(e instanceof APIError)return json({error:e.message},e.status);if(e instanceof SyntaxError)return json({error:'That request could not be read.'},400);console.error('Game request failed',e);return json({error:'Your table is temporarily unavailable. Your unsaved input is still here; please try again.'},503);}
}
