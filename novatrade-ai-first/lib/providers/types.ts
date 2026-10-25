export type Market = 'crypto'|'forex'|'stocks'|'indices'|'commodities';
export type Quote = {symbol:string; market:Market; price:number; currency?:string; changePct?:number; asOf:string; provider:string; delayed?:boolean};
export type Candle = {time:number; open:number; high:number; low:number; close:number; volume?:number};
export type ProviderError = {error:string; setupRequired?:boolean};
