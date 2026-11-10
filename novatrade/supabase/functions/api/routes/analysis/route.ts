import { analyze } from "../../../_shared/core/orchestrator.ts";
import type { Direction, Signal } from "../../../_shared/core/types.ts";
import { body, HttpError, rateLimit, route, symbol, v } from "../../../_shared/server/http.ts";
import { requireUser, serviceDb } from "../../../_shared/server/auth.ts";
import { parseAssetClass, parseInterval, withProvider } from "../../../_shared/server/market.ts";
import { loadTraders } from "../../../_shared/server/traders.ts";
import { runResearch } from "../../../_shared/server/research.ts";


/** Runs all four engines plus consensus on fresh candles and records every proposal and its reasoning. Never places an order. */
export const POST = route(async (req: Request) => {
  const s = await requireUser();
  rateLimit(`analysis:${s.userId}`, 20, 60_000);
  const b = await body(req);
  const cls = parseAssetClass(v.str(b, "class"));
  const sym = symbol(v.str(b, "symbol"));
  const interval = parseInterval(v.str(b, "interval", { optional: true }) || "1h");
  const useNews = v.bool(b, "useNews") ?? true;
  const humanDir = v.str(b, "humanView", { optional: true });
  if (humanDir && !["long", "short", "neutral"].includes(humanDir)) throw new HttpError(400, "humanView must be long, short or neutral.");

  const { candles, meta } = await withProvider(cls, (p) => p.getCandles(sym, interval, 500));
  const traders = await loadTraders();

  let sentiment;
  let research: Awaited<ReturnType<typeof runResearch>> | null = null;
  if (useNews) {
    research = await runResearch(sym).catch(() => null);
    if (research?.sentiment) {
      const m = research.sentiment;
      sentiment = { score: m.score, source: "News/RSS" + (research.configured.social ? " + X" : ""), asOf: m.asOf, method: m.method };
    }
  }

  const result = analyze({
    symbol: sym, market: cls, interval, candles, traders, sentiment,
    human: humanDir ? { direction: humanDir as Direction, by: s.email ?? "you" } : undefined,
  });

  // Persist each proposal with its reasoning so the activity feed has a full history.
  const db = serviceDb();
  const saved: Record<string, string> = {};
  for (const sig of result.signals) {
    const proposals = [sig.strategy, ...(sig.alternatives ?? [])].filter(Boolean) as NonNullable<Signal["strategy"]>[];
    for (const [i, p] of proposals.entries()) {
      const { data } = await db.from("nova_strategies").insert({
        user_id: s.userId, engine: sig.engine, symbol: sym, market: cls, name: p.name, direction: p.direction,
        payload: { proposal: p, signal: { confidence: sig.confidence, uncertainty: sig.uncertainty, rationale: sig.rationale, missing: sig.missing }, interval, dataMeta: meta },
      }).select("id").single();
      if (data?.id) {
        if (i === 0) saved[sig.engine] = data.id as string;
        await db.from("nova_strategy_events").insert([
          { strategy_id: data.id, user_id: s.userId, kind: "generated", message: `${sig.engine} engine proposed "${p.name}" (${p.direction}).`, detail: { rationale: sig.rationale, confidenceBasis: sig.confidenceBasis } },
          ...(p.simulation ? [{ strategy_id: data.id, user_id: s.userId, kind: "simulated", message: `${p.simulation.scenarioCount} scenarios simulated (not a forecast).`, detail: { positiveShare: p.simulation.positiveScenarioShare, best: p.simulation.best, worst: p.simulation.worst } }] : []),
        ]);
      }
    }
  }
  return { ...result, strategyIds: saved, data: meta, research: research ? { configured: research.configured, sentiment: research.sentiment } : null };
});
