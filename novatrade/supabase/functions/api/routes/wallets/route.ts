import { NATIVE, validateAddress, type MemeChain } from "../../../_shared/core/memecoin/index.ts";
import { body, HttpError, rateLimit, route, uuid, v } from "../../../_shared/server/http.ts";
import { requireUser, serviceDb } from "../../../_shared/server/auth.ts";
import { addressParam, chainParam } from "../../../_shared/server/util.ts";

/** Wallets are READ-ONLY records: an address and balance snapshots. No keys, no signatures, no spending approval. */
export const GET = route(async () => {
  const s = await requireUser(); const db = serviceDb();
  const { data: ws } = await db.from("nova_wallets").select("*").eq("user_id", s.userId).order("created_at");
  const out: Record<string, unknown>[] = [];
  for (const w of ws ?? []) {
    const [{ data: snap }, { data: alloc }] = await Promise.all([
      db.from("nova_wallet_snapshots").select("*").eq("wallet_id", w.id).order("id", { ascending: false }).limit(1).maybeSingle(),
      db.from("nova_allocations").select("*").eq("wallet_id", w.id).maybeSingle(),
    ]);
    out.push({ ...w, nativeSymbol: NATIVE[w.chain as MemeChain], snapshot: snap ?? null, allocation: alloc ?? null });
  }
  return { wallets: out };
});

export const POST = route(async (req: Request) => {
  const s = await requireUser(); rateLimit(`wallet:${s.userId}`, 20, 60_000); const b = await body(req);
  const chain = chainParam(v.str(b, "chain")); const address = addressParam(chain, v.str(b, "address", { max: 64 }));
  const kind = v.oneOf(b, "kind", ["own", "tracked"] as const, "own");
  const db = serviceDb();
  const { count } = await db.from("nova_wallets").select("*", { count: "exact", head: true }).eq("user_id", s.userId);
  if ((count ?? 0) >= 20) throw new HttpError(409, "You can save up to 20 wallets.");
  if (!validateAddress(chain, address)) throw new HttpError(400, "Invalid address.");
  const { data, error } = await db.from("nova_wallets").insert({ user_id: s.userId, chain, address, label: v.str(b, "label", { optional: true, max: 40 }) || null, kind }).select("*").single();
  if (error) throw new HttpError(409, "That wallet is already saved.");
  return { wallet: data, note: "Read-only. NovaTrade never asks for a private key, seed phrase or spending approval." };
});

export const DELETE = route(async (req: Request) => {
  const s = await requireUser(); const b = await body(req);
  await serviceDb().from("nova_wallets").delete().eq("id", uuid(v.str(b, "id"))).eq("user_id", s.userId);
  return { ok: true };
});
