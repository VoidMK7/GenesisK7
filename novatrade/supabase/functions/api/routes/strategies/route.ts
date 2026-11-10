import { route } from "../../../_shared/server/http.ts";
import { requireUser } from "../../../_shared/server/auth.ts";

export const GET = route(async (req: Request) => {
  const s = await requireUser();
  const q = new URL(req.url).searchParams;
  const scope = q.get("scope") === "public" ? "public" : "mine";
  let query = s.db.from("nova_strategies").select("id,user_id,engine,symbol,market,name,direction,payload,status,visibility,moderation,created_at").order("created_at", { ascending: false }).limit(60);
  query = scope === "public" ? query.eq("visibility", "public").eq("moderation", "approved") : query.eq("user_id", s.userId);
  const { data } = await query;
  const rows = (data ?? []).map((r) => (scope === "public" ? { ...r, user_id: undefined } : r)); // do not expose authors on the public board
  return { strategies: rows };
});
