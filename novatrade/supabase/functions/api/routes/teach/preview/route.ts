import { compileRules, parseStrategyPrompt } from "../../../../_shared/core/memecoin/index.ts";
import { body, route, v } from "../../../../_shared/server/http.ts";
import { requireUser } from "../../../../_shared/server/auth.ts";

/** Shows what a sentence would be understood as, before it is saved. */
export const POST = route(async (req: Request) => {
  await requireUser(); const b = await body(req); const text = v.str(b, "text", { max: 2000 });
  const rule = compileRules([{ id: "preview", kind: "note", text }]); const strat = parseStrategyPrompt(text);
  return { rule: rule.understood.preview ?? null, strategy: strat.understood, enforced: Boolean(rule.understood.preview) || strat.understood.length > 0 };
});
