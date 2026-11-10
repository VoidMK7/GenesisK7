import { body, HttpError, route, v } from "../../../../_shared/server/http.ts";
import { requireUser, serviceDb } from "../../../../_shared/server/auth.ts";
import { addressParam, chainParam } from "../../../../_shared/server/util.ts";

/** Follow any wallet by address. You will be notified of each trade it makes (Solana). */
export const POST = route(async (req: Request) => {
  const s = await requireUser(); const b = await body(req);
  const chain = chainParam(v.str(b, "chain", { optional: true }) || null); const addr = addressParam(chain, v.str(b, "address", { max: 64 }));
  const db = serviceDb();
  const { count } = await db.from("nova_followed_traders").select("*", { count: "exact", head: true }).eq("user_id", s.userId);
  if ((count ?? 0) >= 50) throw new HttpError(409, "You can follow up to 50 wallets.");
  await db.from("nova_followed_traders").upsert({ user_id: s.userId, chain, wallet_address: addr, handle: v.str(b, "handle", { optional: true, max: 60 }) || addr.slice(0, 4) + "…" + addr.slice(-4), platform: null, source: "manual", reason: null }, { onConflict: "user_id,chain,wallet_address" });
  return { ok: true, note: chain === "solana" ? undefined : "Saved, but trade alerts currently work for Solana wallets only." };
});
export const DELETE = route(async (req: Request) => {
  const s = await requireUser(); const b = await body(req);
  await serviceDb().from("nova_followed_traders").delete().eq("user_id", s.userId).eq("chain", v.str(b, "chain")).eq("wallet_address", v.str(b, "address", { max: 64 }));
  return { ok: true };
});
