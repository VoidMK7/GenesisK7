import { route, uuid } from "../../../../_shared/server/http.ts";
import { HttpError } from "../../../../_shared/server/http.ts";
import { requireUser } from "../../../../_shared/server/auth.ts";

export const GET = route(async (_req: Request, ctx: { params: { id: string } }) => {
  const s = await requireUser();
  const id = uuid(ctx.params.id);
  const { data } = await s.db.from("nova_strategies").select("*").eq("id", id).maybeSingle(); // RLS: owner, or public+approved
  if (!data) throw new HttpError(404, "Strategy not found.");
  const { data: events } = await s.db.from("nova_strategy_events").select("id,kind,message,detail,created_at").eq("strategy_id", id).order("id");
  return { strategy: data, events: events ?? [] };
});
