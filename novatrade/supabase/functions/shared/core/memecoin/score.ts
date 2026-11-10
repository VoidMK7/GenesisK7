import type { MemePair, OnchainFacts } from "./types.ts";

export interface RugScore { score: number; grade: "low" | "medium" | "high" | "extreme"; flags: string[]; checked: string[]; notChecked: string[] }

/**
 * A transparent heuristic, 100 = cleanest. It uses MARKET DATA ONLY unless contract facts are supplied.
 * It cannot see contract code, so a high score is "nothing alarming in the trading data", never "safe".
 */
export function rugScore(p: MemePair, onchain?: OnchainFacts): RugScore {
  let s = 100; const flags: string[] = []; const checked = ["liquidity depth", "liquidity vs valuation", "token age", "buy/sell balance", "volume vs liquidity", "recent crash", "public socials"];
  const hit = (pts: number, why: string) => { s -= pts; flags.push(why); };
  if (p.liquidityUsd < 5_000) hit(40, `Liquidity only $${Math.round(p.liquidityUsd)}`);
  else if (p.liquidityUsd < 15_000) hit(25, `Thin liquidity ($${Math.round(p.liquidityUsd)})`);
  else if (p.liquidityUsd < 30_000) hit(10, `Modest liquidity ($${Math.round(p.liquidityUsd)})`);
  if (p.fdvUsd && p.liquidityUsd / p.fdvUsd < 0.02) hit(15, `Liquidity is under 2% of valuation, so a small sell moves the price a lot`);
  if (p.ageMinutes !== undefined && p.ageMinutes < 30) hit(15, `Only ${p.ageMinutes} minutes old`);
  if (p.sells24h === 0 && p.buys24h >= 20) hit(35, `${p.buys24h} buys and zero sells: could be a honeypot (cannot sell)`);
  else if (p.sells24h > 0 && p.buys24h / p.sells24h > 6) hit(10, `Buys outnumber sells ${(p.buys24h / p.sells24h).toFixed(1)} to 1, which can mean sells are failing`);
  if (p.liquidityUsd > 0 && p.volume24hUsd / p.liquidityUsd > 60) hit(10, `Volume is ${(p.volume24hUsd / p.liquidityUsd).toFixed(0)}x liquidity, which can mean wash trading`);
  if (p.change.h1 !== undefined && p.change.h1 < -50) hit(15, `Down ${Math.abs(p.change.h1).toFixed(0)}% in the last hour`);
  if (!p.socials.twitter && !p.socials.website && !p.socials.telegram) hit(8, `No website or social links listed`);
  const notChecked = ["contract code", "holder concentration", "mint / freeze authority", "locked liquidity"];
  if (onchain) {
    notChecked.length = 0;
    if (onchain.mintAuthorityRenounced === false) { hit(20, "Mint authority is still active: more supply can be created"); } 
    if (onchain.freezeAuthorityRenounced === false) { hit(15, "Freeze authority is still active: wallets can be frozen"); }
    if (onchain.top10HoldersPct !== undefined && onchain.top10HoldersPct > 50) hit(20, `Top 10 holders own ${onchain.top10HoldersPct.toFixed(0)}%`);
    else if (onchain.top10HoldersPct !== undefined && onchain.top10HoldersPct > 30) hit(8, `Top 10 holders own ${onchain.top10HoldersPct.toFixed(0)}%`);
    if (onchain.lpLockedPct !== undefined && onchain.lpLockedPct < 50) hit(10, `Only ${onchain.lpLockedPct.toFixed(0)}% of liquidity is locked`);
    checked.push(`contract facts via ${onchain.source}`);
  }
  s = Math.max(0, Math.min(100, s));
  return { score: s, grade: s >= 75 ? "low" : s >= 55 ? "medium" : s >= 35 ? "high" : "extreme", flags, checked, notChecked };
}
