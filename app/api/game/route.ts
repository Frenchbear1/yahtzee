import { env } from 'cloudflare:workers';
import { handleGame } from '@/lib/server';

const githubPagesOrigin = 'https://frenchbear1.github.io';

function withCors(request: Request, response: Response) {
  if (request.headers.get('origin') !== githubPagesOrigin) return response;
  response.headers.set('Access-Control-Allow-Origin', githubPagesOrigin);
  response.headers.set('Access-Control-Allow-Headers', 'Authorization, Content-Type, X-Player-Token');
  response.headers.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  response.headers.set('Access-Control-Max-Age', '86400');
  response.headers.append('Vary', 'Origin');
  return response;
}

export async function OPTIONS(request: Request) {
  if (request.headers.get('origin') !== githubPagesOrigin) return new Response(null, { status: 403 });
  return withCors(request, new Response(null, { status: 204 }));
}

export async function POST(request: Request) {
  const db = (env as unknown as { DB: D1Database }).DB;
  const response = db
    ? await handleGame(request, db)
    : Response.json({ error: 'Your table is starting up. Please try again shortly.' }, { status: 503 });
  return withCors(request, response);
}
