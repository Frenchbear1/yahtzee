import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import assert from 'node:assert/strict';
import {handleGame} from '../.local-build/server-core.mjs';
const sql=new DatabaseSync(':memory:');for(const name of readdirSync('drizzle').filter(n=>n.endsWith('.sql')).sort())sql.exec(readFileSync(`drizzle/${name}`,'utf8'));
const db={prepare(q){const s=sql.prepare(q);let args=[];return{bind(...a){args=a;return this},async first(){return s.get(...args)||null},async all(){return{results:s.all(...args)}},async run(){return{meta:{changes:Number(s.run(...args).changes)}}}}},async batch(ss){sql.exec('BEGIN');try{const results=[];for(const s of ss)results.push(await s.run());sql.exec('COMMIT');return results}catch(e){sql.exec('ROLLBACK');throw e}}};
let checks=0;
async function call(token,body,status=200){const response=await handleGame(new Request('http://test/api/game',{method:'POST',headers:{'x-player-token':token},body:JSON.stringify(body)}),db,'lan');const result=await response.json();assert.equal(response.status,status,JSON.stringify(result));checks++;return result}
const a='a'.repeat(64),b='b'.repeat(64),c='c'.repeat(64);
let alice=await call(a,{action:'bootstrap'}),bob=await call(b,{action:'bootstrap'});
alice=await call(a,{action:'rename',name:'Alice'});bob=await call(b,{action:'rename',name:'Bob'});
bob=await call(b,{action:'join-room',code:alice.room.code});alice=await call(a,{action:'refresh'});
assert.equal(alice.room.code.length,4);assert.equal(alice.game.id,bob.game.id);assert.equal(alice.game.sheets.length,2);assert.equal(alice.players.filter(p=>p.active).length,2);
await call(b,{action:'new-game',gameId:bob.game.id,confirm:true},403);
await call(c,{action:'refresh'},401);
const mine=s=>s.game.sheets.find(x=>x.player_id===s.me.id);
await call(a,{action:'score',gameId:alice.game.id,revision:0,category:'sixes',value:17},400);
await call(a,{action:'score',gameId:alice.game.id,revision:0,category:'house',value:24},400);
await call(a,{action:'bonus',gameId:alice.game.id,revision:0,bonus:1},400);
alice=await call(a,{action:'score',gameId:alice.game.id,revision:0,category:'sixes',value:18});
await call(a,{action:'score',gameId:alice.game.id,revision:0,category:'fives',value:15},409);
alice=await call(a,{action:'score',gameId:alice.game.id,revision:mine(alice).revision,category:'sixes',value:null});assert.equal(mine(alice).scores.sixes,null);
const scores={ones:3,twos:6,threes:9,fours:12,fives:15,sixes:18,kind3:24,kind4:26,house:25,small:30,large:40,yahtzee:50,chance:22};
for(const [category,value]of Object.entries(scores)){alice=await call(a,{action:'score',gameId:alice.game.id,revision:mine(alice).revision,category,value})}
assert(mine(alice).completed_at);assert.equal(alice.game.ended_at,null);
alice=await call(a,{action:'bonus',gameId:alice.game.id,revision:mine(alice).revision,bonus:1});assert.equal(mine(alice).bonus,1);
alice=await call(a,{action:'score',gameId:alice.game.id,revision:mine(alice).revision,category:'yahtzee',value:0});assert.equal(mine(alice).bonus,0);
for(const [category,value]of Object.entries(scores)){bob=await call(b,{action:'score',gameId:bob.game.id,revision:mine(bob).revision,category,value})}
assert(bob.game.ended_at);const finishedId=bob.game.id;assert.equal(bob.game.sheets.length,2);
alice=await call(a,{action:'refresh'});alice=await call(a,{action:'new-game',gameId:alice.game.id});assert.notEqual(alice.game.id,finishedId);assert.equal(alice.history.find(g=>g.id===finishedId).sheets.length,2);assert.equal(alice.game.sheets.length,2);assert.deepEqual(mine(alice).scores,{});
await call(a,{action:'new-game',gameId:finishedId,confirm:true},409);
const foreign=await call(c,{action:'bootstrap'});await call(c,{action:'score',gameId:alice.game.id,revision:0,category:'ones',value:3},404);
await call(c,{action:'switch-room',roomId:alice.room.id},400);
const before=alice.game.id;sql.prepare('UPDATE players SET last_seen=0 WHERE id=?').run(bob.me.id);alice=await call(a,{action:'new-game',gameId:before,confirm:true});assert.equal(alice.history.find(g=>g.id===before).ended_at,null);assert.equal(alice.game.sheets.length,1);
bob=await call(b,{action:'refresh'});assert(mine(bob));alice=await call(a,{action:'refresh'});assert.equal(alice.game.sheets.length,2);
const reloaded=await call(a,{action:'bootstrap'});assert.equal(reloaded.me.id,alice.me.id);assert.equal(reloaded.game.id,alice.game.id);assert.equal(reloaded.history.length,3);
console.log(`PASS: ${checks} API checks: shared rooms, remembered players, live reconnecting, short codes, scoring, history, and access control.`);
sql.close();
