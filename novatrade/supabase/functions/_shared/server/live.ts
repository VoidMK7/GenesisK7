import { b58decode, buildCloseAccounts, buildSolTransfer, exportSecretKeyBase58, fromB64, generateKeypair, keypairFromSeed, lamportsFromUsd, rawForFraction, signTransaction, solFromLamports, toB64, txEffect, uiFromRaw,
  LAMPORTS_PER_SOL, TOKEN_2022_PROGRAM, TOKEN_PROGRAM, WSOL_MINT, type Keypair, type RpcTx, type TxEffect } from "../core/solana/index.ts";
import { decryptSecret, encryptSecret } from "../core/crypto.ts";
import { HttpError } from "./http.ts";
import { notify, securityEvent, serviceDb } from "./auth.ts";
import { logEvent, nativeUsd, pairsForTokens, rpc } from "./memecoin.ts";

/** Real-money trading on Solana through Jupiter, from a per-user wallet whose key is encrypted on the server. Every limit here is enforced server-side. */

const env = (k: string) => process.env[k] ?? "";
const num = (k: string, d: number) => { const n = Number(env(k)); return Number.isFinite(n) && env(k) !== "" ? n : d; };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const JUP = "https://api.jup.ag";
/** Values that were pasted into a chat while testing. They must never protect real keys. */
const KNOWN_TEST_KEYS = ["hBY1IYQFuEWGVfJKfbegAddsCamoFDVNZixlqVMWXLc="];

export const liveLimits = () => ({ minUsd: num("LIVE_MIN_USD", 2), maxUsd: num("LIVE_MAX_TRADE_USD", 100), maxImpactPct: num("LIVE_MAX_IMPACT_PCT", 15), reserveSol: 0.004, withdrawDelayHours: 24 });

// ---------------------------------------------------------------- who may trade real money
export function liveSetupProblem(email: string | null): { code: string; message: string } | null {
  const list = env("LIVE_ALLOWED_EMAILS").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  if (!list.length) return { code: "live_not_enabled", message: "Live trading is switched off on this server. Set the secret LIVE_ALLOWED_EMAILS to the email(s) allowed to trade real money." };
  if (!email || !list.includes(email.toLowerCase())) return { code: "live_not_allowed", message: "This account is not on the live-trading list." };
  const key = env("CREDENTIAL_ENCRYPTION_KEY");
  if (!key) return { code: "no_encryption_key", message: "CREDENTIAL_ENCRYPTION_KEY is not set, so wallet keys cannot be protected." };
  if (KNOWN_TEST_KEYS.includes(key)) return { code: "test_encryption_key", message: "CREDENTIAL_ENCRYPTION_KEY is still a test value that was shared in a chat. Replace it with a new private key (openssl rand -base64 32) BEFORE creating a wallet." };
  return null;
}
export async function assertLive(userId: string) {
  const { data } = await serviceDb().auth.admin.getUserById(userId);
  const p = liveSetupProblem(data?.user?.email ?? null);
  if (p) throw new HttpError(403, p.message, { code: p.code });
}
async function assertNotStopped(userId: string) {
  const { data } = await serviceDb().from("nova_user_settings").select("emergency_stop").eq("user_id", userId).maybeSingle();
  if (data?.emergency_stop) throw new HttpError(423, "Emergency stop is on. Turn it off in Settings before trading.", { code: "emergency_stop" });
}

// ---------------------------------------------------------------- the wallet
export interface WalletRow { user_id: string; address: string; secret_enc: string; withdraw_to: string | null; withdraw_pending: string | null; withdraw_pending_at: string | null; last_sig: string | null; created_at: string }
export async function getWallet(userId: string): Promise<WalletRow | null> {
  const { data } = await serviceDb().from("nova_live_wallets").select("*").eq("user_id", userId).maybeSingle();
  return (data as WalletRow | null) ?? null;
}
export async function createWallet(userId: string): Promise<WalletRow> {
  await assertLive(userId);
  const have = await getWallet(userId); if (have) return have;
  const kp = await generateKeypair();
  const { data, error } = await serviceDb().from("nova_live_wallets").insert({ user_id: userId, address: kp.address, secret_enc: encryptSecret(toB64(kp.seed)) }).select("*").single();
  if (error || !data) throw new HttpError(500, "Could not create the wallet. Nothing was stored.");
  await securityEvent(userId, "live_wallet_created", { address: kp.address });
  return data as WalletRow;
}
async function loadKeypair(w: WalletRow): Promise<Keypair> {
  const kp = await keypairFromSeed(fromB64(decryptSecret(w.secret_enc)));
  if (kp.address !== w.address) throw new HttpError(500, "Wallet key does not match its address. Refusing to sign.");
  return kp;
}
async function needWallet(userId: string): Promise<{ w: WalletRow; kp: Keypair }> {
  await assertLive(userId);
  const w = await getWallet(userId); if (!w) throw new HttpError(409, "Create your trading wallet first.", { code: "no_wallet" });
  return { w, kp: await loadKeypair(w) };
}

// ---------------------------------------------------------------- chain reads
export interface Holding { mint: string; account: string; program: string; raw: bigint; decimals: number; amount: number; lamports: number }
async function tokenAccounts(owner: string, program: string): Promise<Holding[]> {
  const r = await rpc<{ value: { pubkey: string; account: { lamports: number; data: { parsed?: { info?: { mint: string; tokenAmount: { amount: string; decimals: number } } } } } }[] }>("solana", "getTokenAccountsByOwner", [owner, { programId: program }, { encoding: "jsonParsed", commitment: "confirmed" }], 9000);
  return r.value.flatMap((a) => { const i = a.account.data.parsed?.info; return i ? [{ mint: i.mint, account: a.pubkey, program, raw: BigInt(i.tokenAmount.amount), decimals: i.tokenAmount.decimals, amount: Number(i.tokenAmount.amount) / 10 ** i.tokenAmount.decimals, lamports: a.account.lamports }] : []; });
}
export async function readHoldings(owner: string): Promise<{ lamports: number; holdings: Holding[] }> {
  const [bal, a, b] = await Promise.all([rpc<{ value: number }>("solana", "getBalance", [owner, { commitment: "confirmed" }], 9000), tokenAccounts(owner, TOKEN_PROGRAM), tokenAccounts(owner, TOKEN_2022_PROGRAM).catch(() => [] as Holding[])]);
  return { lamports: bal.value, holdings: [...a, ...b] };
}

export interface WalletValue { sol: number; solUsd: number | null; lamports: number; totalUsd: number | null; tokens: { mint: string; symbol: string; amount: number; usd: number | null; image?: string }[]; unpriced: number; emptyAccounts: number; reclaimableSol: number }
export async function walletValue(address: string): Promise<WalletValue> {
  const [{ lamports, holdings }, solUsd] = await Promise.all([readHoldings(address), nativeUsd("solana")]);
  const live = holdings.filter((h) => h.raw > 0n && h.mint !== WSOL_MINT).sort((a, b) => b.amount - a.amount).slice(0, 60);
  const empty = holdings.filter((h) => h.raw === 0n);
  let priced = new Map<string, { priceUsd: number; symbol: string; imageUrl?: string }>();
  try { priced = new Map((await pairsForTokens("solana", live.map((h) => h.mint))).map((p) => [p.tokenAddress, p])); } catch { /* shown as unpriced */ }
  const tokens = live.map((h) => { const p = priced.get(h.mint); return { mint: h.mint, symbol: p?.symbol ?? h.mint.slice(0, 4) + "…", amount: h.amount, usd: p ? h.amount * p.priceUsd : null, image: p?.imageUrl }; });
  const wsol = holdings.filter((h) => h.mint === WSOL_MINT).reduce((a, h) => a + h.amount, 0);
  const sol = lamports / LAMPORTS_PER_SOL + wsol;
  const unpriced = tokens.filter((t) => t.usd === null).length;
  return { sol, solUsd, lamports, totalUsd: solUsd === null ? null : sol * solUsd + tokens.reduce((a, t) => a + (t.usd ?? 0), 0), tokens, unpriced, emptyAccounts: empty.length, reclaimableSol: empty.reduce((a, h) => a + h.lamports, 0) / LAMPORTS_PER_SOL };
}

// ---------------------------------------------------------------- Jupiter (Swap API v2: /order then /execute)
interface JupOrder { transaction?: string | null; requestId?: string; inAmount?: string; outAmount?: string; otherAmountThreshold?: string; priceImpact?: number; router?: string; slippageBps?: number; feeBps?: number; errorCode?: number; errorMessage?: string; error?: string; transactionVersion?: number }
const jupHeaders = (): Record<string, string> => ({ accept: "application/json", ...(env("JUPITER_API_KEY") ? { "x-api-key": env("JUPITER_API_KEY") } : {}) });

export async function jupOrder(p: { inputMint: string; outputMint: string; amount: bigint; taker?: string; slippageBps?: number }): Promise<JupOrder> {
  const u = new URL(JUP + "/swap/v2/order");
  u.searchParams.set("inputMint", p.inputMint); u.searchParams.set("outputMint", p.outputMint); u.searchParams.set("amount", p.amount.toString());
  if (p.taker) u.searchParams.set("taker", p.taker);
  if (p.slippageBps !== undefined) u.searchParams.set("slippageBps", String(Math.round(p.slippageBps)));
  let r: Response;
  try { r = await fetch(u, { headers: jupHeaders(), signal: AbortSignal.timeout(12000) }); } catch { throw new HttpError(502, "Could not reach Jupiter to price this swap. Nothing was sent."); }
  const j = (await r.json().catch(() => ({}))) as JupOrder;
  if (r.status === 429) throw new HttpError(429, "Jupiter is rate-limiting this server. Add a free JUPITER_API_KEY secret, or try again in a moment.", { code: "rate_limited" });
  if (!r.ok) throw new HttpError(502, `Jupiter could not price this swap (${j.error || j.errorMessage || r.status}). Nothing was sent.`);
  return j;
}
async function jupExecute(signedB64: string, requestId: string): Promise<{ status?: string; signature?: string; code?: number; error?: string }> {
  let r: Response;
  try { r = await fetch(JUP + "/swap/v2/execute", { method: "POST", headers: { ...jupHeaders(), "content-type": "application/json" }, body: JSON.stringify({ signedTransaction: signedB64, requestId }), signal: AbortSignal.timeout(30000) }); }
  catch { throw new HttpError(504, "Jupiter did not answer after the transaction was signed. Check your wallet before trying again.", { code: "unknown_outcome" }); }
  return (await r.json().catch(() => ({}))) as { status?: string; signature?: string; code?: number; error?: string };
}

async function confirmSignature(sig: string, ms = 35000): Promise<{ ok: boolean | null; err?: string }> {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try {
      const r = await rpc<{ value: ({ confirmationStatus?: string; err: unknown } | null)[] }>("solana", "getSignatureStatuses", [[sig], { searchTransactionHistory: true }], 8000);
      const s = r.value[0];
      if (s) { if (s.err) return { ok: false, err: JSON.stringify(s.err) }; if (s.confirmationStatus === "confirmed" || s.confirmationStatus === "finalized") return { ok: true }; }
    } catch { /* keep polling */ }
    await sleep(1500);
  }
  return { ok: null };
}
async function effectOf(sig: string, owner: string, mint: string): Promise<TxEffect> {
  for (let i = 0; i < 8; i++) {
    try {
      const tx = await rpc<RpcTx | null>("solana", "getTransaction", [sig, { encoding: "json", maxSupportedTransactionVersion: 0, commitment: "confirmed" }], 9000);
      if (tx?.meta) return txEffect(tx, owner, mint);
    } catch { /* retry */ }
    await sleep(1000);
  }
  throw new HttpError(502, "The swap was sent but its result could not be read yet. Check your wallet; the app will show it once the chain answers.", { code: "unknown_outcome", signature: sig });
}

/** One live action at a time per user, so a double tap or a tap during an agent cycle cannot spend the same funds twice. */
async function withLock<T>(userId: string, fn: () => Promise<T>): Promise<T> {
  const db = serviceDb();
  const { data, error } = await db.rpc("nova_live_acquire", { uid: userId, secs: 90 });
  if (error) throw new HttpError(503, "Could not start the trade safely. Nothing was sent.");
  if (!data) throw new HttpError(409, "Another live action is still running. Wait a few seconds and try again.", { code: "busy" });
  try { return await fn(); } finally { try { await db.rpc("nova_live_release", { uid: userId }); } catch { /* lock expires on its own */ } }
}

/** Defence in depth: simulate the transaction Jupiter built and refuse if it would take clearly more SOL than we meant to spend. A failed or inconclusive simulation never blocks (the chain still validates the real send). */
async function drainGuard(txB64: string, owner: string, maxOutLamports: bigint) {
  if (env("LIVE_SIM_GUARD") === "off") return;
  try {
    const pre = await rpc<{ value: number }>("solana", "getBalance", [owner, { commitment: "confirmed" }], 8000);
    const sim = await rpc<{ value?: { err?: unknown; accounts?: ({ lamports?: number } | null)[] } }>("solana", "simulateTransaction", [txB64, { encoding: "base64", sigVerify: false, replaceRecentBlockhash: true, commitment: "confirmed", accounts: { addresses: [owner], encoding: "base64" } }], 12000);
    const post = sim?.value?.accounts?.[0]?.lamports;
    if (sim?.value?.err || typeof post !== "number") return;
    if (BigInt(pre.value - post) > maxOutLamports + 10_000_000n) throw new HttpError(409, "The swap Jupiter built would take more SOL than you asked to spend, so it was blocked. Nothing was sent.", { code: "drain_blocked" });
  } catch (e) { if (e instanceof HttpError) throw e; }
}

async function swap(kp: Keypair, p: { inputMint: string; outputMint: string; amount: bigint; slippageBps?: number; minOutRaw?: bigint; trackMint: string; maxSolOut?: bigint }) {
  const lim = liveLimits();
  const order = await jupOrder({ inputMint: p.inputMint, outputMint: p.outputMint, amount: p.amount, taker: kp.address, slippageBps: p.slippageBps });
  if (!order.transaction || !order.requestId) throw new HttpError(409, `Jupiter could not build this swap${order.errorMessage ? ": " + order.errorMessage : ""}. Nothing was sent.`, { code: "no_route" });
  const impact = Math.abs(Number(order.priceImpact ?? 0));
  if (impact > lim.maxImpactPct) throw new HttpError(409, `Price impact would be ${impact.toFixed(1)}%, above the ${lim.maxImpactPct}% safety limit. Nothing was sent.`, { code: "impact_too_high" });
  if (p.minOutRaw !== undefined && BigInt(order.outAmount ?? "0") < p.minOutRaw) throw new HttpError(409, "The price moved against you since the quote. Nothing was sent. Try again.", { code: "price_moved" });
  await drainGuard(order.transaction, kp.address, p.maxSolOut ?? 0n);
  const signed = await signTransaction(fromB64(order.transaction), kp.seed, kp.publicKey);
  const ex = await jupExecute(toB64(signed), order.requestId);
  if (!ex.signature || (ex.status !== undefined && ex.status !== "Success")) throw new HttpError(502, `The swap did not go through (code ${ex.code ?? "?"}${ex.error ? ", " + ex.error : ""}). Nothing was spent unless your wallet shows otherwise.`, { code: "swap_failed" });
  const c = await confirmSignature(ex.signature);
  if (c.ok === false) throw new HttpError(502, `The chain rejected the swap (${c.err}). Only the network fee may have been charged.`, { code: "swap_failed", signature: ex.signature });
  if (c.ok === null) throw new HttpError(504, "The swap was sent but is not confirmed yet. Check your wallet before trying again.", { code: "unknown_outcome", signature: ex.signature });
  const fx = await effectOf(ex.signature, kp.address, p.trackMint);
  if (!fx.ok) throw new HttpError(502, "The chain reported the swap as failed. Only the network fee may have been charged.", { code: "swap_failed", signature: ex.signature });
  return { order, signature: ex.signature, fx };
}

// ---------------------------------------------------------------- quotes
export interface Quote { side: "buy" | "sell"; mint: string; inAmount: string; outAmount: string; outUi: number | null; priceImpactPct: number | null; router: string | null; solUsd: number | null; estUsd: number | null; decimals: number | null; minTradeUsd: number; maxTradeUsd: number; note?: string }
export async function liveQuote(userId: string, o: { side: "buy" | "sell"; mint: string; usd?: number; fraction?: number; slippageBps?: number }): Promise<Quote> {
  const lim = liveLimits(); const solUsd = await nativeUsd("solana");
  if (o.side === "buy") {
    if (!solUsd) throw new HttpError(502, "No SOL price available right now. Try again.");
    const usd = o.usd ?? 0; if (!(usd >= lim.minUsd)) throw new HttpError(400, `Minimum trade is $${lim.minUsd}.`); if (usd > lim.maxUsd) throw new HttpError(400, `Maximum trade is $${lim.maxUsd} (server limit).`);
    const order = await jupOrder({ inputMint: WSOL_MINT, outputMint: o.mint, amount: lamportsFromUsd(usd, solUsd), slippageBps: o.slippageBps });
    if (order.errorMessage && !order.outAmount) throw new HttpError(409, `No route: ${order.errorMessage}`);
    const dec = await mintDecimals(o.mint);
    return { side: "buy", mint: o.mint, inAmount: order.inAmount ?? "0", outAmount: order.outAmount ?? "0", outUi: dec === null ? null : uiFromRaw(BigInt(order.outAmount ?? "0"), dec), priceImpactPct: order.priceImpact === undefined ? null : Math.abs(order.priceImpact), router: order.router ?? null, solUsd, estUsd: usd, decimals: dec, minTradeUsd: lim.minUsd, maxTradeUsd: lim.maxUsd };
  }
  const { w } = await needWallet(userId); const { holdings } = await readHoldings(w.address);
  const h = holdings.find((x) => x.mint === o.mint && x.raw > 0n); if (!h) throw new HttpError(409, "You do not hold this coin in your trading wallet.");
  const amount = rawForFraction(h.raw, o.fraction ?? 1);
  const order = await jupOrder({ inputMint: o.mint, outputMint: WSOL_MINT, amount, slippageBps: o.slippageBps });
  if (order.errorMessage && !order.outAmount) throw new HttpError(409, `No route: ${order.errorMessage}`);
  const outSol = solFromLamports(BigInt(order.outAmount ?? "0"));
  return { side: "sell", mint: o.mint, inAmount: order.inAmount ?? amount.toString(), outAmount: order.outAmount ?? "0", outUi: outSol, priceImpactPct: order.priceImpact === undefined ? null : Math.abs(order.priceImpact), router: order.router ?? null, solUsd, estUsd: solUsd ? outSol * solUsd : null, decimals: h.decimals, minTradeUsd: lim.minUsd, maxTradeUsd: lim.maxUsd };
}
const decCache = new Map<string, number>();
async function mintDecimals(mint: string): Promise<number | null> {
  if (decCache.has(mint)) return decCache.get(mint)!;
  try { const r = await rpc<{ value: { decimals: number } }>("solana", "getTokenSupply", [mint], 6000); decCache.set(mint, r.value.decimals); return r.value.decimals; } catch { return null; }
}

// ---------------------------------------------------------------- buy / sell with full records
export interface TokenInfo { mint: string; symbol: string; name?: string; image?: string | null }
export interface Exit { stopLossPct: number; trailingStopPct: number; takeProfitPct: number; auto: boolean }
export interface BuyResult { positionId: string; tradeId: string; signature: string; qty: number; costUsd: number; entryPrice: number }

export async function liveBuy(userId: string, o: { token: TokenInfo; usd: number; slippageBps?: number; agent: "executor" | "user" | "copy"; reason: string; evidence?: Record<string, unknown>; rules?: string[]; exit: Exit; expectOutRaw?: bigint; proposalId?: string }): Promise<BuyResult> {
  const lim = liveLimits();
  if (!(o.usd >= lim.minUsd)) throw new HttpError(400, `Minimum trade is $${lim.minUsd}.`);
  if (o.usd > lim.maxUsd) throw new HttpError(400, `Maximum trade is $${lim.maxUsd} (server limit).`);
  const { w, kp } = await needWallet(userId); await assertNotStopped(userId);
  return withLock(userId, async () => {
    const solUsd = await nativeUsd("solana"); if (!solUsd) throw new HttpError(502, "No SOL price available right now. Nothing was sent.");
    const lamports = lamportsFromUsd(o.usd, solUsd);
    const { lamports: have } = await readHoldings(w.address);
    if (BigInt(have) - lamports < BigInt(Math.round(lim.reserveSol * LAMPORTS_PER_SOL))) throw new HttpError(409, `Not enough SOL. You have ${solFromLamports(have).toFixed(4)} SOL and a buy of $${o.usd} needs ${solFromLamports(lamports).toFixed(4)} SOL plus about ${lim.reserveSol} SOL kept for network fees and account rent. Deposit more or buy less.`, { code: "insufficient_sol" });
    const minOut = o.expectOutRaw === undefined ? undefined : (o.expectOutRaw * 95n) / 100n;
    const { order, signature, fx } = await swap(kp, { inputMint: WSOL_MINT, outputMint: o.token.mint, amount: lamports, slippageBps: o.slippageBps, minOutRaw: minOut, trackMint: o.token.mint, maxSolOut: lamports });
    if (fx.tokenDeltaRaw <= 0n) throw new HttpError(502, "The swap confirmed but no tokens arrived. Check your wallet.", { code: "unknown_outcome", signature });
    const dec = fx.decimals ?? (await mintDecimals(o.token.mint)) ?? 0;
    const qty = uiFromRaw(fx.tokenDeltaRaw, dec);
    const spentLamports = Number(order.inAmount ?? lamports) + fx.feeLamports;
    const costUsd = solFromLamports(spentLamports) * solUsd; const entry = costUsd / qty;
    const db = serviceDb();
    try {
      const { data: open } = await db.from("nova_meme_positions").select("*").eq("user_id", userId).eq("mode", "live").eq("status", "open").eq("token_address", o.token.mint).maybeSingle();
      let positionId: string;
      if (open) {
        const q2 = Number(open.qty) + qty, c2 = Number(open.cost_usd) + costUsd;
        await db.from("nova_meme_positions").update({ qty: q2, cost_usd: c2, entry_price: c2 / q2, peak_price: Math.max(Number(open.peak_price), entry) }).eq("id", open.id);
        positionId = open.id as string;
      } else {
        const { data: pos, error } = await db.from("nova_meme_positions").insert({ user_id: userId, mode: "live", chain: "solana", token_address: o.token.mint, symbol: o.token.symbol, name: o.token.name ?? null, image_url: o.token.image ?? null,
          entry_price: entry, qty, cost_usd: costUsd, peak_price: entry, stop_loss_pct: o.exit.stopLossPct, trailing_stop_pct: o.exit.trailingStopPct, take_profit_pct: o.exit.takeProfitPct, auto_exit: o.exit.auto }).select("id").single();
        if (error || !pos) throw new Error("position insert failed");
        positionId = pos.id as string;
      }
      const evidence = { ...(o.evidence ?? {}), source: "jupiter", router: order.router ?? null, price_impact_pct: order.priceImpact ?? null, spent_lamports: spentLamports, fee_lamports: fx.feeLamports, sol_usd: solUsd, slippage_bps: o.slippageBps ?? "auto" };
      if (o.proposalId) {
        await db.from("nova_trade_log").update({ status: "confirmed", tx_signature: signature, simulated: false, price: entry, qty, usd: costUsd, evidence, position_id: positionId }).eq("id", o.proposalId).eq("user_id", userId);
        await logEvent(userId, "executor", "live_buy", `Live buy ${o.token.symbol} for $${costUsd.toFixed(2)} (confirmed on-chain).`, { token: o.token.mint, symbol: o.token.symbol, detail: { signature } });
        return { positionId, tradeId: o.proposalId, signature, qty, costUsd, entryPrice: entry };
      }
      const { data: t, error: te } = await db.from("nova_trade_log").insert({ user_id: userId, position_id: positionId, mode: "live", agent: o.agent, side: "buy", chain: "solana", token_address: o.token.mint, symbol: o.token.symbol, image_url: o.token.image ?? null,
        price: entry, qty, usd: costUsd, status: "confirmed", reason: o.reason, evidence, rules_applied: o.rules ?? [], tx_signature: signature, simulated: false }).select("id").single();
      if (te || !t) throw new Error("trade log insert failed");
      await logEvent(userId, "executor", "live_buy", `Live buy ${o.token.symbol} for $${costUsd.toFixed(2)} (confirmed on-chain).`, { token: o.token.mint, symbol: o.token.symbol, detail: { signature } });
      await notify(userId, "trade", `Bought ${o.token.symbol}`, `$${costUsd.toFixed(2)} · confirmed on-chain.`);
      return { positionId, tradeId: t.id as string, signature, qty, costUsd, entryPrice: entry };
    } catch (e) {
      await securityEvent(userId, "live_record_failed", { signature, mint: o.token.mint, side: "buy", message: e instanceof Error ? e.message : "unknown" });
      throw new HttpError(500, `The buy went through on-chain (${signature}) but could not be recorded. Your tokens are in your wallet. Reload the app.`, { code: "record_failed", signature });
    }
  });
}

export type ExitReason = "take_profit" | "stop_loss" | "trailing_stop" | "manual" | "copy_exit" | "risk";
export interface SellResult { tradeId: string; signature: string; proceedsUsd: number; pnlUsd: number; closed: boolean }

export async function liveSell(userId: string, o: { mint: string; fraction: number; slippageBps?: number; agent: "executor" | "user" | "copy"; reason: string; exitReason: ExitReason; expectOutRaw?: bigint }): Promise<SellResult> {
  const { w, kp } = await needWallet(userId);
  if (o.exitReason === "manual" || o.exitReason === "risk" || o.exitReason === "copy_exit") { /* a user may always sell, even with the emergency stop on */ } else await assertNotStopped(userId);
  return withLock(userId, async () => {
    const db = serviceDb();
    const { data: pos } = await db.from("nova_meme_positions").select("*").eq("user_id", userId).eq("mode", "live").eq("status", "open").eq("token_address", o.mint).maybeSingle();
    const { holdings, lamports: have } = await readHoldings(w.address);
    const h = holdings.find((x) => x.mint === o.mint && x.raw > 0n);
    if (!h) throw new HttpError(409, "You do not hold this coin in your trading wallet.", { code: "no_balance" });
    if (have < 5000) throw new HttpError(409, "Not enough SOL left to pay the network fee for a sell. Deposit a little SOL first.", { code: "insufficient_sol" });
    const amount = rawForFraction(h.raw, o.fraction); const solUsd = (await nativeUsd("solana")) ?? 0;
    const minOut = o.expectOutRaw === undefined ? undefined : (o.expectOutRaw * 90n) / 100n;
    const { order, signature, fx } = await swap(kp, { inputMint: o.mint, outputMint: WSOL_MINT, amount, slippageBps: o.slippageBps, minOutRaw: minOut, trackMint: o.mint });
    const proceedsLamports = fx.lamportDelta + fx.wsolDelta;                       // already net of the network fee
    const proceedsUsd = solFromLamports(proceedsLamports) * solUsd;
    const soldQty = uiFromRaw(-fx.tokenDeltaRaw, h.decimals); const frac = pos ? Math.min(1, soldQty / Number(pos.qty)) : 1;
    const closed = o.fraction >= 0.999 || frac >= 0.999;
    const costPart = pos ? Number(pos.cost_usd) * (closed ? 1 : frac) : 0; const pnl = proceedsUsd - costPart;
    try {
      let positionId: string | null = null;
      if (pos) {
        positionId = pos.id as string;
        if (closed) await db.from("nova_meme_positions").update({ status: "closed", exit_price: soldQty > 0 ? proceedsUsd / soldQty : null, exit_reason: o.exitReason, pnl_usd: Number(pos.realised_usd ?? 0) + pnl, closed_at: new Date().toISOString() }).eq("id", pos.id).eq("status", "open");
        else await db.from("nova_meme_positions").update({ qty: Number(pos.qty) - soldQty, cost_usd: Number(pos.cost_usd) - costPart, realised_usd: Number(pos.realised_usd ?? 0) + pnl }).eq("id", pos.id);
      }
      const { data: t, error } = await db.from("nova_trade_log").insert({ user_id: userId, position_id: positionId, mode: "live", agent: o.agent, side: "sell", chain: "solana", token_address: o.mint, symbol: pos?.symbol ?? o.mint.slice(0, 4), image_url: pos?.image_url ?? null,
        price: soldQty > 0 ? proceedsUsd / soldQty : null, qty: soldQty, usd: proceedsUsd, status: "confirmed", reason: o.reason,
        evidence: { pnl_usd: pnl, entry_price: pos ? Number(pos.entry_price) : null, exit_reason: o.exitReason, source: "jupiter", router: order.router ?? null, price_impact_pct: order.priceImpact ?? null, fee_lamports: fx.feeLamports, sol_usd: solUsd, partial: !closed },
        rules_applied: [], tx_signature: signature, simulated: false }).select("id").single();
      if (error || !t) throw new Error("trade log insert failed");
      await logEvent(userId, "executor", "live_sell", `Live sell ${pos?.symbol ?? o.mint.slice(0, 4)}: ${o.exitReason.replace("_", " ")}, ${pnl >= 0 ? "+" : "-"}$${Math.abs(pnl).toFixed(2)} (confirmed on-chain).`, { token: o.mint, symbol: pos?.symbol, detail: { signature } });
      await notify(userId, "trade", `Sold ${pos?.symbol ?? "token"}`, `${o.reason} Result ${pnl >= 0 ? "+" : "-"}$${Math.abs(pnl).toFixed(2)}.`);
      return { tradeId: t.id as string, signature, proceedsUsd, pnlUsd: pnl, closed };
    } catch (e) {
      await securityEvent(userId, "live_record_failed", { signature, mint: o.mint, side: "sell", message: e instanceof Error ? e.message : "unknown" });
      throw new HttpError(500, `The sell went through on-chain (${signature}) but could not be recorded. Reload the app.`, { code: "record_failed", signature });
    }
  });
}

// ---------------------------------------------------------------- deposits, withdrawals, rent
export async function syncDeposits(userId: string): Promise<{ added: number }> {
  const w = await getWallet(userId); if (!w) return { added: 0 };
  const db = serviceDb(); const solUsd = await nativeUsd("solana");
  const sigs = await rpc<{ signature: string; err: unknown }[]>("solana", "getSignaturesForAddress", [w.address, { limit: 20, ...(w.last_sig ? { until: w.last_sig } : {}), commitment: "confirmed" }], 9000);
  if (!sigs.length) return { added: 0 };
  let added = 0;
  for (const s of [...sigs].reverse()) {
    if (s.err) continue;
    const tx = await rpc<(RpcTx & { transaction: { message: { header: { numRequiredSignatures: number } } } }) | null>("solana", "getTransaction", [s.signature, { encoding: "json", maxSupportedTransactionVersion: 0, commitment: "confirmed" }], 9000);
    if (!tx?.meta) continue;
    const keys = tx.transaction.message.accountKeys.map((k) => (typeof k === "string" ? k : k.pubkey)); const i = keys.indexOf(w.address);
    const delta = i < 0 ? 0 : tx.meta.postBalances[i] - tx.meta.preBalances[i];
    if (i >= tx.transaction.message.header.numRequiredSignatures && delta > 0) {
      const sol = solFromLamports(delta);
      const { error } = await db.from("nova_wallet_ledger").insert({ user_id: userId, kind: "deposit", sol, usd: solUsd ? sol * solUsd : null, signature: s.signature });
      if (!error) { added++; await notify(userId, "trade", "Deposit received", `${sol.toFixed(4)} SOL arrived in your trading wallet.`); }
    }
  }
  await db.from("nova_live_wallets").update({ last_sig: sigs[0].signature }).eq("user_id", userId);
  return { added };
}

const validAddress = (a: string) => { try { return b58decode(a).length === 32; } catch { return false; } };

/** A first address is accepted at once. Changing it later waits 24h, so a stolen session cannot redirect your money immediately. */
export async function setWithdrawAddress(userId: string, address: string): Promise<{ active: string | null; pending: string | null; activatesAt: string | null }> {
  await assertLive(userId);
  const w = await getWallet(userId); if (!w) throw new HttpError(409, "Create your trading wallet first.");
  if (!validAddress(address)) throw new HttpError(400, "That is not a valid Solana address.");
  if (address === w.address) throw new HttpError(400, "Pick a different wallet from the trading wallet itself.");
  const db = serviceDb();
  if (!w.withdraw_to) { await db.from("nova_live_wallets").update({ withdraw_to: address, withdraw_pending: null, withdraw_pending_at: null }).eq("user_id", userId); await securityEvent(userId, "withdraw_address_set", { address }); return { active: address, pending: null, activatesAt: null }; }
  if (address === w.withdraw_to) { await db.from("nova_live_wallets").update({ withdraw_pending: null, withdraw_pending_at: null }).eq("user_id", userId); return { active: address, pending: null, activatesAt: null }; }
  const at = new Date().toISOString();
  await db.from("nova_live_wallets").update({ withdraw_pending: address, withdraw_pending_at: at }).eq("user_id", userId);
  await securityEvent(userId, "withdraw_address_change_requested", { from: w.withdraw_to, to: address });
  await notify(userId, "risk", "Withdrawal address change requested", `The new address becomes usable in ${liveLimits().withdrawDelayHours} hours. If this was not you, switch off your session and change your password.`);
  return { active: w.withdraw_to, pending: address, activatesAt: new Date(Date.parse(at) + liveLimits().withdrawDelayHours * 3600e3).toISOString() };
}
export function resolveWithdrawAddress(w: WalletRow): { active: string | null; pending: string | null; activatesAt: string | null; promote: boolean } {
  if (w.withdraw_pending && w.withdraw_pending_at) {
    const at = Date.parse(w.withdraw_pending_at) + liveLimits().withdrawDelayHours * 3600e3;
    if (Date.now() >= at) return { active: w.withdraw_pending, pending: null, activatesAt: null, promote: true };
    return { active: w.withdraw_to, pending: w.withdraw_pending, activatesAt: new Date(at).toISOString(), promote: false };
  }
  return { active: w.withdraw_to, pending: null, activatesAt: null, promote: false };
}

async function blockhash(): Promise<Uint8Array> {
  const r = await rpc<{ value: { blockhash: string } }>("solana", "getLatestBlockhash", [{ commitment: "confirmed" }], 8000);
  return b58decode(r.value.blockhash);
}
async function sendSigned(raw: Uint8Array): Promise<string> {
  const sig = await rpc<string>("solana", "sendTransaction", [toB64(raw), { encoding: "base64", skipPreflight: false, preflightCommitment: "confirmed", maxRetries: 3 }], 12000);
  const c = await confirmSignature(sig);
  if (c.ok === false) throw new HttpError(502, `The chain rejected the transaction (${c.err}).`);
  if (c.ok === null) throw new HttpError(504, "Sent but not confirmed yet. Check your wallet before trying again.", { code: "unknown_outcome", signature: sig });
  return sig;
}

export async function withdrawSol(userId: string, amountSol: number | "max"): Promise<{ signature: string; sol: number; to: string }> {
  const { w, kp } = await needWallet(userId); await assertNotStopped(userId);
  const r = resolveWithdrawAddress(w);
  if (r.promote) await serviceDb().from("nova_live_wallets").update({ withdraw_to: r.active, withdraw_pending: null, withdraw_pending_at: null }).eq("user_id", userId);
  if (!r.active) throw new HttpError(409, "Save a withdrawal address first.", { code: "no_withdraw_address" });
  return withLock(userId, async () => {
    const { lamports } = await readHoldings(w.address); const fee = 5000n;
    const want = amountSol === "max" ? BigInt(lamports) - fee : BigInt(Math.floor(amountSol * LAMPORTS_PER_SOL));
    if (want <= 0n || want + fee > BigInt(lamports)) throw new HttpError(409, `You have ${solFromLamports(lamports).toFixed(6)} SOL. That amount plus the network fee is more than your balance.`, { code: "insufficient_sol" });
    const left = BigInt(lamports) - want - fee;
    if (left > 0n && left < 890_880n) throw new HttpError(409, "A wallet must keep at least 0.00089 SOL or be emptied completely. Withdraw everything, or leave a little more.", { code: "rent_minimum" });
    const raw = buildSolTransfer(kp.publicKey, b58decode(r.active!), want, await blockhash());
    const sig = await sendSigned(await signTransaction(raw, kp.seed, kp.publicKey));
    const solUsd = await nativeUsd("solana"); const sol = solFromLamports(want);
    await serviceDb().from("nova_wallet_ledger").insert({ user_id: userId, kind: "withdraw", sol, usd: solUsd ? sol * solUsd : null, signature: sig });
    await securityEvent(userId, "withdrawal", { to: r.active, sol, signature: sig });
    await notify(userId, "trade", "Withdrawal sent", `${sol.toFixed(4)} SOL sent to ${r.active!.slice(0, 4)}…${r.active!.slice(-4)}.`);
    return { signature: sig, sol, to: r.active! };
  });
}

/** Closes empty token accounts and returns their rent (about 0.002 SOL each) to the wallet. */
export async function reclaimRent(userId: string): Promise<{ closed: number; sol: number; signature: string | null }> {
  const { w, kp } = await needWallet(userId);
  return withLock(userId, async () => {
    const { holdings } = await readHoldings(w.address); const empty = holdings.filter((h) => h.raw === 0n).slice(0, 8);
    if (!empty.length) return { closed: 0, sol: 0, signature: null };
    const raw = buildCloseAccounts(kp.publicKey, empty.map((h) => ({ address: b58decode(h.account), programId: b58decode(h.program) })), await blockhash());
    const sig = await sendSigned(await signTransaction(raw, kp.seed, kp.publicKey));
    const sol = empty.reduce((a, h) => a + h.lamports, 0) / LAMPORTS_PER_SOL; const solUsd = await nativeUsd("solana");
    await serviceDb().from("nova_wallet_ledger").insert({ user_id: userId, kind: "reclaim", sol, usd: solUsd ? sol * solUsd : null, signature: sig });
    return { closed: empty.length, sol, signature: sig };
  });
}

/** Shows the private key once so the owner can import the wallet elsewhere. Logged. The caller must have asked for it by typing a confirmation word. */
export async function exportKey(userId: string): Promise<string> {
  const { kp } = await needWallet(userId);
  await securityEvent(userId, "live_key_exported", {});
  await notify(userId, "risk", "Wallet key was exported", "If this was not you, withdraw your funds and change your password now.");
  return exportSecretKeyBase58(kp);
}

// ---------------------------------------------------------------- growth history
export async function recordSnapshot(userId: string, mode: "paper" | "live", pnlUsd: number, valueUsd: number | null, minGapMs = 5 * 60_000) {
  try {
    const db = serviceDb();
    const { data: last } = await db.from("nova_equity_snapshots").select("at").eq("user_id", userId).eq("mode", mode).order("at", { ascending: false }).limit(1).maybeSingle();
    if (last && Date.now() - new Date(last.at as string).getTime() < minGapMs) return;
    await db.from("nova_equity_snapshots").insert({ user_id: userId, mode, pnl_usd: pnlUsd, value_usd: valueUsd });
  } catch { /* history is best effort */ }
}
