import type {Candle,Quote} from './types';
const BASE='https://api.twelvedata.com';
function apiKey(){const k=process.env.TWELVEDATA_API_KEY;if(!k)throw new Error('Twelve Data is not configured. Add TWELVEDATA_API_KEY on the server.');return k;}
export async function twelveQuote(symbol:string,market:'forex'|'stocks'|'indices'|'commodities'|'crypto'='stocks'):Promise<Quote>{
 const u=new URL(`${BASE}/price`);u.searchParams.set('symbol',symbol);u.searchParams.set('apikey',apiKey());
 const r=await fetch(u,{cache:'no-store'});if(!r.ok)throw new Error(`Twelve Data returned ${r.status}`);const j=await r.json();if(j.status==='error'||!j.price)throw new Error(j.message||'Quote unavailable');
 return {symbol,market,price:Number(j.price),asOf:new Date().toISOString(),provider:'Twelve Data',delayed:true};
}
export async function twelveCandles(symbol:string,interval='1min',outputsize=100):Promise<Candle[]>{
 const u=new URL(`${BASE}/time_series`);for(const [k,v] of Object.entries({symbol,interval,outputsize:String(Math.min(Math.max(outputsize,1),500)),apikey:apiKey()}))u.searchParams.set(k,v);
 const r=await fetch(u,{cache:'no-store'});if(!r.ok)throw new Error(`Twelve Data returned ${r.status}`);const j=await r.json();if(j.status==='error'||!Array.isArray(j.values))throw new Error(j.message||'Candles unavailable');
 return j.values.map((x:any)=>({time:Date.parse(x.datetime),open:Number(x.open),high:Number(x.high),low:Number(x.low),close:Number(x.close),volume:x.volume?Number(x.volume):undefined})).reverse();
}
