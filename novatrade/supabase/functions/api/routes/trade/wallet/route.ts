import { HttpError, rateLimit, route } from "../../../../_shared/server/http.ts";
import { requireUser, serviceDb } from "../../../../_shared/server/auth.ts";
import { createWallet, getWallet, liveLimits, liveSetupProblem, resolveWithdrawAddress, syncDeposits, walletValue } from "../../../../_shared/server/live.ts";

const lastSync = new Map<string, number>();

/** Your trading wallet: address, balances, deposit history and limits. Never returns the key. */
export const GET = route(async () => {
  const s = await requireUser(); const setup = liveSetupProblem(s.email); const limits = liveLimits();
  const w = await getWallet(s.userId);
  if (!w) return { setup, wallet: null, limits };
  if (Date.now() - (lastSync.get(s.userId) ?? 0) > 30_000) { lastSync.set(s.userId, Date.now()); try { await syncDeposits(s.userId); } catch { /* deposits are picked up on the next refresh */ } }
  const r = resolveWithdrawAddress(w);
  if (r.promote) await serviceDb().from("nova_live_wallets").update({ withdraw_to: r.active, withdraw_pending: null, withdraw_pending_at: null }).eq("user_id", s.userId);
  let value = null as Awaited<ReturnType<typeof walletValue>> | null; let readError: string | null = null;
  try { value = await walletValue(w.address); } catch (e) { readError = e instanceof Error ? e.message : "Could not read the wallet."; }
  const { data: ledger } = await serviceDb().from("nova_wallet_ledger").select("id,kind,sol,usd,signature,created_at").eq("user_id", s.userId).order("id", { ascending: false }).limit(30);
  const net = (ledger ?? []).reduce((a, l) => a + (l.kind === "deposit" ? Number(l.usd ?? 0) : l.kind === "withdraw" ? -Number(l.usd ?? 0) : 0), 0);
  return { setup, limits, wallet: { address: w.address, createdAt: w.created_at, withdrawTo: r.active, withdrawPending: r.pending, withdrawActivatesAt: r.activatesAt }, value, readError, ledger: ledger ?? [], netDepositedUsd: net };
});

/** Creates the wallet once. The private key is generated here and stored encrypted; it is shown to nobody unless you export it. */
export const POST = route(async () => {
  const s = await requireUser(); rateLimit(`live-create:${s.userId}`, 3, 3600_000);
  const p = liveSetupProblem(s.email); if (p) throw new HttpError(403, p.message, { code: p.code });
  const w = await createWallet(s.userId);
  return { address: w.address, note: "Send SOL to this address to fund it. Only SOL on the Solana network. Anything else sent here may be lost." };
});
