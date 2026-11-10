import type { MemePair, MemeStrategy } from "./types.ts";
import { DEFAULT_STRATEGY } from "./types.ts";
import { rugScore, type RugScore } from "./score.ts";
import type { OnchainFacts } from "./types.ts";

export interface TaughtRule { id: string; kind: "prefer" | "avoid" | "limit" | "note"; text: string }

export interface CompiledRules {
  blockSymbols: string[]; blockAddresses: string[]; minAgeMinutes?: number; minLiquidityUsd?: number; maxFdvUsd?: number; minRugScore?: number;
  /** rule id -> what we understood. Anything not listed here is advisory text only. */
  understood: Record<string, string>;
  advisory: TaughtRule[];
}

const n = (s: string) => Number(s.replace(/[, ]/g, ""));
const money = (s: string, suffix?: string) => n(s) * (suffix?.toLowerCase() === "k" ? 1e3 : suffix?.toLowerCase() === "m" ? 1e6 : 1);

/** Turns the plain-English rules a user taught into hard filters, when (and only when) the wording is unambiguous. */
export function compileRules(rules: TaughtRule[]): CompiledRules {
  const out: CompiledRules = { blockSymbols: [], blockAddresses: [], understood: {}, advisory: [] };
  for (const r of rules) {
    const t = r.text.trim(); let m: RegExpMatchArray | null; let got = false;
    if ((r.kind === "avoid" || /\b(never|avoid|don'?t|do not|block)\b/i.test(t)) && (m = t.match(/\b(?:avoid|never (?:buy|trade|touch)|don'?t (?:buy|trade|touch)|block)\s+\$?([A-Za-z0-9]{2,44})\b(?!\s*(?:tokens?|coins?)\s+(?:under|below|less))/i))) {
      const w = m[1];
      if (!/^(tokens?|coins?|anything|any|new|memecoins?|the|a|all)$/i.test(w) && !/^\d+$/.test(w)) {
        if (w.length >= 32) out.blockAddresses.push(w); else out.blockSymbols.push(w.toUpperCase());
        out.understood[r.id] = `Block ${w.length >= 32 ? "address " + w.slice(0, 6) + "…" : "$" + w.toUpperCase()}`; got = true;
      }
    }
    if ((m = t.match(/(?:under|below|less than|younger than)\s+(\d+(?:\.\d+)?)\s*(minutes?|mins?|hours?|hrs?|h|m)\b.*\bold\b|(?:at least|older than|min(?:imum)? age(?: of)?)\s+(\d+(?:\.\d+)?)\s*(minutes?|mins?|hours?|hrs?|h|m)\b/i))) {
      const val = m[1] ?? m[3]; const unit = (m[2] ?? m[4]).toLowerCase(); const mins = unit.startsWith("h") ? n(val) * 60 : n(val);
      out.minAgeMinutes = Math.max(out.minAgeMinutes ?? 0, mins); out.understood[r.id] = `Minimum age ${mins} min`; got = true;
    }
    if ((m = t.match(/liquidity\s*(?:of\s*)?(?:over|above|at least|min(?:imum)?|>=?|>)\s*\$?(\d[\d,]*(?:\.\d+)?)\s*([km])?/i))) {
      out.minLiquidityUsd = Math.max(out.minLiquidityUsd ?? 0, money(m[1], m[2])); out.understood[r.id] = `Minimum liquidity $${out.minLiquidityUsd}`; got = true;
    }
    if ((m = t.match(/(?:fdv|market ?cap|valuation)\s*(?:under|below|max(?:imum)?|<=?|<)\s*\$?(\d[\d,]*(?:\.\d+)?)\s*([km])?/i))) {
      out.maxFdvUsd = Math.min(out.maxFdvUsd ?? Infinity, money(m[1], m[2])); out.understood[r.id] = `Maximum valuation $${out.maxFdvUsd}`; got = true;
    }
    if ((m = t.match(/(?:rug|safety)\s*score\s*(?:over|above|at least|min(?:imum)?|>=?|>)\s*(\d{1,3})/i))) {
      out.minRugScore = Math.max(out.minRugScore ?? 0, Math.min(100, n(m[1]))); out.understood[r.id] = `Minimum safety score ${out.minRugScore}`; got = true;
    }
    if (!got) out.advisory.push(r);
  }
  return out;
}

/** Reads a plain-English strategy and extracts the numbers it clearly states. Returns what it understood so the UI can show it. */
export function parseStrategyPrompt(prompt: string): { patch: Partial<MemeStrategy>; understood: string[] } {
  const patch: Partial<MemeStrategy> = {}; const understood: string[] = []; let m: RegExpMatchArray | null;
  const t = prompt;
  if ((m = t.match(/liquidity\s*(?:of\s*)?(?:over|above|at least|min(?:imum)?|>=?|>)\s*\$?(\d[\d,]*(?:\.\d+)?)\s*([km])?/i))) { patch.minLiquidityUsd = money(m[1], m[2]); understood.push(`Minimum liquidity $${patch.minLiquidityUsd}`); }
  if ((m = t.match(/(?:24h\s*)?volume\s*(?:over|above|at least|min(?:imum)?|>=?|>)\s*\$?(\d[\d,]*(?:\.\d+)?)\s*([km])?/i))) { patch.minVolume24hUsd = money(m[1], m[2]); understood.push(`Minimum 24h volume $${patch.minVolume24hUsd}`); }
  if ((m = t.match(/(?:take[- ]?profit|tp)\s*(?:at|of|:)?\s*(\d+(?:\.\d+)?)\s*(%|x)/i))) { patch.takeProfitPct = m[2] === "x" ? (n(m[1]) - 1) * 100 : n(m[1]); understood.push(`Take profit +${patch.takeProfitPct}%`); }
  if ((m = t.match(/(?:stop[- ]?loss|sl)\s*(?:at|of|:)?\s*(\d+(?:\.\d+)?)\s*%/i))) { patch.stopLossPct = n(m[1]); understood.push(`Stop loss -${patch.stopLossPct}%`); }
  if ((m = t.match(/trailing(?:[- ]stop)?\s*(?:at|of|:)?\s*(\d+(?:\.\d+)?)\s*%/i))) { patch.trailingStopPct = n(m[1]); understood.push(`Trailing stop ${patch.trailingStopPct}% from peak`); }
  if ((m = t.match(/(?:max(?:imum)?|up to|no more than)\s*(\d{1,2})\s*(?:open\s*)?(?:positions?|trades?|tokens?|coins?)/i))) { patch.maxOpenPositions = Math.min(50, Math.max(1, n(m[1]))); understood.push(`At most ${patch.maxOpenPositions} open positions`); }
  if ((m = t.match(/\$\s*(\d[\d,]*(?:\.\d+)?)\s*(?:per|each|a)\s*(?:trade|buy|position|token|coin)/i))) { patch.positionUsd = n(m[1]); understood.push(`$${patch.positionUsd} per trade`); }
  if ((m = t.match(/(?:older than|at least)\s*(\d+)\s*(minutes?|mins?|hours?|hrs?|h)\s*old/i))) { patch.minAgeMinutes = /^h/i.test(m[2]) ? n(m[1]) * 60 : n(m[1]); understood.push(`Minimum age ${patch.minAgeMinutes} min`); }
  if ((m = t.match(/slippage\s*(?:of|at|:)?\s*(\d+(?:\.\d+)?)\s*%/i))) { patch.slippageBps = Math.round(n(m[1]) * 100); understood.push(`Slippage ${m[1]}%`); }
  const chains = (["solana", "base", "ethereum", "bsc"] as const).filter((c) => new RegExp(`\\b${c}\\b`, "i").test(t));
  if (/\bsol\b/i.test(t) && !chains.includes("solana")) chains.push("solana");
  if (chains.length) { patch.chains = [...chains]; understood.push(`Chains: ${chains.join(", ")}`); }
  return { patch, understood };
}

export interface Decision { action: "buy" | "skip"; reasons: string[]; failed: string[]; score: RugScore; rulesApplied: string[]; metrics: Record<string, number | string | undefined> }

/** The Scanner + Analyst + Risk decision for one token. Every sentence in `reasons` comes from a number that is also in `metrics`. */
export function evaluateToken(p: MemePair, s: MemeStrategy, rules: CompiledRules, ctx: { openAddresses: Set<string>; onchain?: OnchainFacts }): Decision {
  const score = rugScore(p, ctx.onchain);
  const failed: string[] = []; const ok: string[] = []; const applied: string[] = [];
  const minLiq = Math.max(s.minLiquidityUsd, rules.minLiquidityUsd ?? 0); if (rules.minLiquidityUsd !== undefined) applied.push(`Min liquidity $${rules.minLiquidityUsd}`);
  const minAge = Math.max(s.minAgeMinutes, rules.minAgeMinutes ?? 0); if (rules.minAgeMinutes !== undefined) applied.push(`Min age ${rules.minAgeMinutes} min`);
  const maxFdv = Math.min(s.maxFdvUsd ?? Infinity, rules.maxFdvUsd ?? Infinity);
  const minScore = Math.max(s.minRugScore, rules.minRugScore ?? 0);
  if (rules.maxFdvUsd !== undefined) applied.push(`Max valuation $${rules.maxFdvUsd}`);
  if (rules.minRugScore !== undefined) applied.push(`Min safety score ${rules.minRugScore}`);

  if (rules.blockSymbols.includes(p.symbol.toUpperCase()) || rules.blockAddresses.includes(p.tokenAddress)) { failed.push(`You taught me to avoid ${p.symbol}`); applied.push(`Avoid ${p.symbol}`); }
  if (ctx.openAddresses.has(p.tokenAddress)) failed.push("Already holding this token");
  (p.liquidityUsd >= minLiq ? ok : failed).push(`Liquidity $${Math.round(p.liquidityUsd).toLocaleString("en-US")} ${p.liquidityUsd >= minLiq ? "meets" : "is below"} the $${minLiq.toLocaleString("en-US")} minimum`);
  (p.volume24hUsd >= s.minVolume24hUsd ? ok : failed).push(`24h volume $${Math.round(p.volume24hUsd).toLocaleString("en-US")} ${p.volume24hUsd >= s.minVolume24hUsd ? "meets" : "is below"} the $${s.minVolume24hUsd.toLocaleString("en-US")} minimum`);
  if (p.ageMinutes === undefined) failed.push("Token age is unknown");
  else {
    if (p.ageMinutes < minAge) failed.push(`Only ${p.ageMinutes} min old (minimum ${minAge})`);
    else if (p.ageMinutes > s.maxAgeHours * 60) failed.push(`${Math.round(p.ageMinutes / 60)}h old, past the ${s.maxAgeHours}h window`);
    else ok.push(`Age ${p.ageMinutes < 120 ? p.ageMinutes + " min" : Math.round(p.ageMinutes / 60) + "h"} is inside the window`);
  }
  if (p.fdvUsd !== undefined && p.fdvUsd > maxFdv) failed.push(`Valuation $${Math.round(p.fdvUsd).toLocaleString("en-US")} is above the $${maxFdv.toLocaleString("en-US")} cap`);
  const ratio = p.sells24h > 0 ? p.buys24h / p.sells24h : p.buys24h > 0 ? Infinity : 0;
  (ratio >= s.minBuySellRatio ? ok : failed).push(`Buy/sell ratio ${Number.isFinite(ratio) ? ratio.toFixed(2) : "∞"} ${ratio >= s.minBuySellRatio ? "meets" : "is below"} ${s.minBuySellRatio}`);
  (score.score >= minScore ? ok : failed).push(`Safety score ${score.score}/100 (${score.grade} risk) ${score.score >= minScore ? "meets" : "is below"} the ${minScore} minimum`);
  for (const f of score.flags.slice(0, 3)) if (score.score < minScore) failed.push(f);
  return {
    action: failed.length ? "skip" : "buy", reasons: failed.length ? failed : ok, failed, score, rulesApplied: applied,
    metrics: { price: p.priceUsd, liquidityUsd: p.liquidityUsd, volume24hUsd: p.volume24hUsd, fdvUsd: p.fdvUsd, ageMinutes: p.ageMinutes, buys24h: p.buys24h, sells24h: p.sells24h, change1h: p.change.h1, change24h: p.change.h24, safetyScore: score.score, dex: p.dex },
  };
}

export { DEFAULT_STRATEGY };
