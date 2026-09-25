import { env } from 'cloudflare:workers';
import { handleGame } from '@/lib/server';
export async function POST(request:Request){const db=(env as unknown as {DB:D1Database}).DB;if(!db)return Response.json({error:'Your table is starting up. Please try again shortly.'},{status:503});return handleGame(request,db);}
