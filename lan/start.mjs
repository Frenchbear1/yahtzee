import {createServer} from 'node:http';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,existsSync,statSync,readdirSync} from 'node:fs';
import {join,extname,resolve,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {networkInterfaces} from 'node:os';
import {handleGame} from './server-core.mjs';
const base=fileURLToPath(new URL('./',import.meta.url));
const sqlite=new DatabaseSync(join(base,'yahtzee-scores.sqlite'));
sqlite.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS local_migrations (name TEXT PRIMARY KEY)');
for(const name of readdirSync(join(base,'migrations')).filter(n=>n.endsWith('.sql')).sort()){
 if(!sqlite.prepare('SELECT 1 FROM local_migrations WHERE name=?').get(name)){
  sqlite.exec('BEGIN');try{sqlite.exec(readFileSync(join(base,'migrations',name),'utf8'));sqlite.prepare('INSERT INTO local_migrations (name) VALUES (?)').run(name);sqlite.exec('COMMIT')}catch(e){sqlite.exec('ROLLBACK');throw e}
 }
}
const db={prepare(sql){const statement=sqlite.prepare(sql);let values=[];return{bind(...args){values=args;return this},async first(){return statement.get(...values)||null},async all(){return{results:statement.all(...values)}},async run(){const r=statement.run(...values);return{meta:{changes:Number(r.changes)}}}}},async batch(statements){sqlite.exec('BEGIN');try{const results=[];for(const statement of statements)results.push(await statement.run());sqlite.exec('COMMIT');return results}catch(e){sqlite.exec('ROLLBACK');throw e}}};
// Serialize requests so SQLite transaction batches cannot overlap.
let queue=Promise.resolve();
const publicPath=join(base,'public');
const mime={'.html':'text/html; charset=utf-8','.js':'application/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.webmanifest':'application/manifest+json','.woff2':'font/woff2'};
const server=createServer((req,res)=>{
 const url=new URL(req.url,'http://local.table');
 if(url.pathname==='/api/game'&&req.method==='POST'){
  let body='',size=0;req.on('data',chunk=>{size+=chunk.length;if(size>12000){res.writeHead(413);res.end('Request too large');req.destroy();return}body+=chunk});
  req.on('end',()=>{queue=queue.then(async()=>{const request=new Request('http://local.table/api/game',{method:'POST',headers:{'Content-Type':'application/json','x-player-token':String(req.headers['x-player-token']||'')},body});const result=await handleGame(request,db,'lan');res.writeHead(result.status,Object.fromEntries(result.headers));res.end(await result.text())}).catch(e=>{console.error(e);if(!res.headersSent)res.writeHead(500);res.end('Table unavailable. Please try again.')})});return;
 }
 if(req.method!=='GET'&&req.method!=='HEAD'){res.writeHead(405);res.end();return}
 let path;try{path=resolve(publicPath,'.'+decodeURIComponent(url.pathname))}catch{res.writeHead(400);res.end();return}
 if(path!==publicPath&&!path.startsWith(publicPath+sep)){res.writeHead(403);res.end();return}
 if(url.pathname==='/')path=join(publicPath,'index.html');
 if(!existsSync(path)||!statSync(path).isFile()){res.writeHead(404);res.end('Not found');return}
 res.writeHead(200,{'Content-Type':mime[extname(path)]||'application/octet-stream','Cache-Control':'no-cache','X-Content-Type-Options':'nosniff'});res.end(req.method==='HEAD'?undefined:readFileSync(path));
});
const port=Number(process.env.YAHTZEE_PORT||8787);
server.listen(port,'0.0.0.0',()=>{
 console.log('\nYahtzee Table is ready. Keep this window open.\n');
 console.log(`On this computer: http://localhost:${port}`);
 try{for(const entries of Object.values(networkInterfaces()))for(const item of entries||[])if(item.family==='IPv4'&&!item.internal)console.log(`On your family's phones: http://${item.address}:${port}`)}catch{console.log(`For phones: find this computer's Wi-Fi IPv4 address in network settings, then open http://THAT-ADDRESS:${port}.`)}
 console.log('\nConnect everyone to the same Wi-Fi. Open Family table and share the table code.\nScores stay in yahtzee-scores.sqlite in this folder. Keep the folder to keep your history.\nPress Ctrl+C to close the table.\n');
});
server.on('error',e=>{console.error('Could not open the table:',e.message);process.exitCode=1});
process.on('SIGINT',()=>{server.close();sqlite.close();process.exit(0)});
