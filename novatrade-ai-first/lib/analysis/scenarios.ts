import type {Candle} from '../providers/types';
export type Scenario={name:string; horizonBars:number; direction:'bullish'|'bearish'|'neutral'; assumedMovePct:number; estimatedPnlPct:number; invalidation:string; evidence:string};
// Transparent deterministic stress scenarios, not probability forecasts or model predictions.
export function buildScenarios(candles:Candle[],riskPct=1):Scenario[]{
 if(candles.length<10)throw new Error('At least 10 historical candles are required to build scenarios.');
 const closes=candles.map(c=>c.close), last=closes.at(-1)!;const returns=closes.slice(1).map((v,i)=>Math.log(v/closes[i]));
 const mean=returns.reduce((a,b)=>a+b,0)/returns.length;const variance=returns.reduce((a,b)=>a+(b-mean)**2,0)/Math.max(1,returns.length-1);const vol=Math.sqrt(variance);
 const horizons=[1,2,3,5,8,13,1,2,3,5,8,13];
 const names=['Momentum continuation','Momentum fade','Volatility expansion','Low-volatility drift','Bullish breakout stress','Bearish breakdown stress','Mean reversion up','Mean reversion down','Trend persistence','Trend reversal','Range-bound flat','High-volatility adverse'];
 return horizons.map((h,i)=>{const move=(i===0?mean*h:i===1?-mean*h:i===2?vol*Math.sqrt(h):i===3?mean*h*.25:i===4?vol*1.5*Math.sqrt(h):i===5?-vol*1.5*Math.sqrt(h):i===6?Math.abs(mean)*h:i===7?-Math.abs(mean)*h:i===8?mean*h*1.25:i===9?-mean*h*.75:i===10?0:-vol*2*Math.sqrt(h));const bounded=Math.max(-.25,Math.min(.25,move));const dir=bounded>.001?'bullish':bounded<-.001?'bearish':'neutral';return {name:names[i],horizonBars:h,direction:dir,assumedMovePct:Number((bounded*100).toFixed(3)),estimatedPnlPct:Number((bounded*100-riskPct*.01).toFixed(3)),invalidation:'Scenario invalid if price action departs from the assumed return/volatility path.',evidence:`Computed from ${returns.length} observed candle-to-candle log returns; historical mean ${(mean*100).toFixed(4)}% per bar, sample volatility ${(vol*100).toFixed(4)}% per bar. Not a probability estimate.`};});
}
