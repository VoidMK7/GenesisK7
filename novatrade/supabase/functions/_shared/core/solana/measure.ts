import { LAMPORTS_PER_SOL, WSOL_MINT } from "./tx.ts";

/** What the chain says a confirmed transaction did to one wallet. Built only from the transaction's own balance records. */
export interface TxEffect {
  ok: boolean;
  feeLamports: number;
  /** Native SOL change of the wallet, INCLUDING the network fee it paid. */
  lamportDelta: number;
  /** Change in wrapped SOL held in token accounts owned by the wallet (raw lamports). */
  wsolDelta: number;
  /** Change in the raw amount of `mint` held by the wallet, and the mint's decimals when the transaction shows them. */
  tokenDeltaRaw: bigint;
  decimals: number | null;
}

interface TokBal { accountIndex: number; mint: string; owner?: string; uiTokenAmount: { amount: string; decimals: number } }
export interface RpcTx {
  meta: null | { err: unknown; fee: number; preBalances: number[]; postBalances: number[]; preTokenBalances?: TokBal[]; postTokenBalances?: TokBal[] };
  transaction: { message: { accountKeys: (string | { pubkey: string })[]; header?: { numRequiredSignatures: number } } };
}

const keyOf = (k: string | { pubkey: string }) => (typeof k === "string" ? k : k.pubkey);
const sumRaw = (list: TokBal[] | undefined, owner: string, mint: string) => (list ?? []).filter((b) => b.owner === owner && b.mint === mint).reduce((a, b) => a + BigInt(b.uiTokenAmount.amount), 0n);

export function txEffect(tx: RpcTx, owner: string, mint: string): TxEffect {
  const m = tx.meta; if (!m) throw new Error("Transaction has no metadata yet.");
  const keys = tx.transaction.message.accountKeys.map(keyOf); const i = keys.indexOf(owner);
  if (i < 0) throw new Error("Wallet is not part of this transaction.");
  const dec = [...(m.postTokenBalances ?? []), ...(m.preTokenBalances ?? [])].find((b) => b.owner === owner && b.mint === mint)?.uiTokenAmount.decimals ?? null;
  return { ok: m.err === null || m.err === undefined, feeLamports: m.fee, lamportDelta: m.postBalances[i] - m.preBalances[i],
    wsolDelta: Number(sumRaw(m.postTokenBalances, owner, WSOL_MINT) - sumRaw(m.preTokenBalances, owner, WSOL_MINT)),
    tokenDeltaRaw: sumRaw(m.postTokenBalances, owner, mint) - sumRaw(m.preTokenBalances, owner, mint), decimals: dec };
}

export const lamportsFromUsd = (usd: number, solUsd: number): bigint => BigInt(Math.floor((usd / solUsd) * LAMPORTS_PER_SOL));
export const solFromLamports = (l: number | bigint) => Number(l) / LAMPORTS_PER_SOL;
export const uiFromRaw = (raw: bigint, decimals: number) => Number(raw) / 10 ** decimals;
/** Raw token amount for a fraction of a balance. A fraction of 1 (or within rounding of it) sells everything, so no dust is left behind. */
export function rawForFraction(balanceRaw: bigint, fraction: number): bigint {
  if (!(fraction > 0) || fraction > 1) throw new Error("fraction must be above 0 and at most 1");
  if (fraction >= 0.999) return balanceRaw;
  return (balanceRaw * BigInt(Math.floor(fraction * 1_000_000))) / 1_000_000n;
}
