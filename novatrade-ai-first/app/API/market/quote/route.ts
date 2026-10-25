import {NextRequest,NextResponse} from 'next/server';
import {cryptoQuote} from '@/lib/providers/coingecko';
import {twelveQuote} from '@/lib/providers/twelvedata';
import type {Market} from '@/lib/providers/types';
export const runtime='nodejs';
export async function GET(req:NextRequest){
 const symbol=(req.nextUrl.searchParams.get('symbol')||'bitcoin').trim();const market=(req.nextUrl.searchParams.get('market')||'crypto') as Market;
 if(symbol.length>50||!/^[a-zA-Z0-9._:/ -]+$/.test(symbol))return NextResponse.json({error:'Invalid symbol'},{status:400});
 try{const quote=market==='crypto'&&/^[a-z0-9-]+$/.test(symbol)?await cryptoQuote(symbol):await twelveQuote(symbol,market);return NextResponse.json({ok:true,quote,liveExecutionEnabled:false},{headers:{'Cache-Control':'no-store'}})}catch(e){return NextResponse.json({ok:false,error:e instanceof Error?e.message:'Quote provider error',setupRequired:true,liveExecutionEnabled:false},{status:503})}
}
