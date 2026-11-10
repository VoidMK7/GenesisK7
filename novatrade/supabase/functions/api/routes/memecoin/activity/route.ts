import { route } from "../../../../_shared/server/http.ts";
import { requireUser } from "../../../../_shared/server/auth.ts";
import { intParam, q } from "../../../../_shared/server/util.ts";

export const GET = route(async (req: Request) => {
  const s = await requireUser(); const agent = q(req, "agent");
  let qry = s.db.from("nova_agent_events").select("*").order("id", { ascending: false }).limit(intParam(q(req, "limit"), 60, 1, 200));
  if (agent && ["scanner", "analyst", "executor", "risk", "system"].includes(agent)) qry = qry.eq("agent", agent);
  const { data } = await qry;
  return { events: data ?? [] };
});
