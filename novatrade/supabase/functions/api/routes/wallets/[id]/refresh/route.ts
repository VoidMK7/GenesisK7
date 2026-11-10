import { HttpError, rateLimit, route, uuid } from "../../../../../_shared/server/http.ts";
import { requireUser, serviceDb } from "../../../../../_shared/server/auth.ts";
import { readWallet } from "../../../../../_shared/server/memecoin.ts";
import type { MemeChain } from "../../../../../_shared/core/memecoin/index.ts";

export const POST = route(async (_req: Request, ctx: { params: Record<string, string> }) => {
  const s = await requireUser(); rateLimit(`wallet-read:${s.userId}`, 12, 60_000); const id = uuid(ctx.params.id); const db = serviceDb();
  const { data: w } = await db.from("nova_wallets").select("*").eq("id", id).eq("user_id", s.userId).maybeSingle();
  if (!w) throw new HttpError(404, "Wallet not found.");
  let r; try { r = await readWallet(w.chain as MemeChain, w.address as string); } catch (e) { throw new HttpError(502, `Could not read the wallet: ${e instanceof Error ? e.message : "RPC error"}. Public RPCs are rate-limited; set RPC_URL_${String(w.chain).toUpperCase()} to your own endpoint.`); }
  const { data } = await db.from("nova_wallet_snapshots").insert({ wallet_id: id, user_id: s.userId, native_symbol: r.nativeSymbol, native_balance: r.nativeBalance, total_usd: r.totalUsd, tokens: r.tokens, unpriced: r.unpriced, source: r.source }).select("*").single();
  return { snapshot: data, note: r.note };
});
