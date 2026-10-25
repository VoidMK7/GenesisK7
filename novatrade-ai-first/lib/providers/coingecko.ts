import type {Quote} from './types';
const BASE='https://api.coingecko.com/api/v3';
export async function cryptoQuote(id:string):Promise<Quote>{
 const key=process.env.COINGECKO_DEMO_API_KEY;
 const url=new URL(`${BASE}/simple/price`); url.searchParams.set('ids',id); url.searchParams.set('vs_currencies','usd'); url.searchParams.set('include_24hr_change','true'); url.searchParams.set('include_last_updated_at','true');
 const res=await fetch(url,{headers:key?{'x-cg-demo-api-key':key}:{},next:{revalidate:30}});
 if(!res.ok) throw new Error(`CoinGecko returned ${res.status}`);
 const j=await res.json(); const row=j[id]; if(!row?.usd) throw new Error('No quote returned for this CoinGecko asset ID');
 return {symbol:id.toUpperCase(),market:'crypto',price:row.usd,changePct:row.usd_24h_change,asOf:new Date((row.last_updated_at||Date.now()/1000)*1000).toISOString(),provider:'CoinGecko',delayed:true};
}
