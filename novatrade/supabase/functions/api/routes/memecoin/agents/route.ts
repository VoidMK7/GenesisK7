import { body, HttpError, route } from "../../../../_shared/server/http.ts";
import { requireUser } from "../../../../_shared/server/auth.ts";
import { agentReport, saveAgentSettings } from "../../../../_shared/server/memecoin.ts";

/** GET /memecoin/agents -> settings, goal realism, survival status, per-agent results from recorded lessons.
 *  PUT /memecoin/agents { sniper?, rotate?, maxRotationsPerHour?, survival?: { startUsd, targetUsd, days } } */
export const GET = route(async () => { const s = await requireUser(); return await agentReport(s.userId); });

export const PUT = route(async (req: Request) => {
  const s = await requireUser(); const b = await body(req); const patch: Record<string, unknown> = {};
  if ("sniper" in b) { if (typeof b.sniper !== "boolean") throw new HttpError(400, "sniper must be true or false."); patch.sniper = b.sniper; }
  if ("rotate" in b) { if (typeof b.rotate !== "boolean") throw new HttpError(400, "rotate must be true or false."); patch.rotate = b.rotate; }
  if ("maxRotationsPerHour" in b) { const n = Number(b.maxRotationsPerHour); if (!Number.isInteger(n) || n < 1 || n > 10) throw new HttpError(400, "Rotations per hour must be a whole number from 1 to 10."); patch.maxRotationsPerHour = n; }
  if (b.survival && typeof b.survival === "object") {
    const g = b.survival as Record<string, unknown>; const out: Record<string, number | null> = {};
    for (const [k, max] of [["startUsd", 1e7], ["targetUsd", 1e9], ["days", 3650]] as const) {
      if (!(k in g)) continue; if (g[k] === null || g[k] === "") { out[k] = null; continue; }
      const n = Number(g[k]); if (!Number.isFinite(n) || n <= 0 || n > max) throw new HttpError(400, `${k} must be a positive number.`); out[k] = n;
    }
    patch.survival = out;
  }
  if (!Object.keys(patch).length) throw new HttpError(400, "Nothing to change.");
  await saveAgentSettings(s.userId, patch as never); return await agentReport(s.userId);
});
