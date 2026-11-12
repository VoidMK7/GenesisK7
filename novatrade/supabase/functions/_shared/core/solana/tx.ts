import { b58decode } from "./base58.ts";
import { sign } from "./keys.ts";

export const SYSTEM_PROGRAM = "11111111111111111111111111111111";
export const TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
export const TOKEN_2022_PROGRAM = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
export const WSOL_MINT = "So11111111111111111111111111111111111111112";
export const LAMPORTS_PER_SOL = 1_000_000_000;

export function compactU16Encode(n: number): number[] {
  if (!Number.isInteger(n) || n < 0 || n > 0xffff) throw new Error("compact-u16 out of range");
  const out: number[] = []; let v = n;
  for (;;) { const low = v & 0x7f; v >>= 7; if (v === 0) { out.push(low); return out; } out.push(low | 0x80); }
}
export function compactU16Decode(b: Uint8Array, off: number): [number, number] {
  let value = 0, shift = 0;
  for (let i = 0; i < 3; i++) {
    const byte = b[off + i]; if (byte === undefined) throw new Error("Truncated transaction.");
    value |= (byte & 0x7f) << shift;
    if ((byte & 0x80) === 0) return [value, off + i + 1];
    shift += 7;
  }
  throw new Error("Bad compact-u16 in transaction.");
}

export interface ParsedTx { version: "legacy" | number; numRequiredSignatures: number; sigStart: number; msgStart: number; message: Uint8Array; accountKeys: Uint8Array[] }

/** Reads just enough of a serialized transaction (legacy or v0) to find the message and the signer slots. */
export function parseTx(bytes: Uint8Array): ParsedTx {
  const [sigCount, afterCount] = compactU16Decode(bytes, 0);
  const sigStart = afterCount, msgStart = sigStart + sigCount * 64;
  if (msgStart >= bytes.length) throw new Error("Transaction is too short.");
  let o = msgStart, version: "legacy" | number = "legacy";
  if (bytes[o] & 0x80) { version = bytes[o] & 0x7f; o++; if (version !== 0) throw new Error(`Unsupported transaction version ${version}.`); }
  const numRequiredSignatures = bytes[o]; o += 3;
  const [nKeys, afterKeys] = compactU16Decode(bytes, o); o = afterKeys;
  if (o + nKeys * 32 > bytes.length) throw new Error("Transaction is truncated.");
  const accountKeys: Uint8Array[] = []; for (let i = 0; i < nKeys; i++) accountKeys.push(bytes.slice(o + i * 32, o + (i + 1) * 32));
  if (numRequiredSignatures !== sigCount) throw new Error("Signature slots do not match the message header.");
  return { version, numRequiredSignatures, sigStart, msgStart, message: bytes.slice(msgStart), accountKeys };
}

/** Adds our signature in our own slot and leaves every other slot untouched (a market maker may add theirs later). */
export async function signTransaction(bytes: Uint8Array, seed: Uint8Array, publicKey: Uint8Array): Promise<Uint8Array> {
  const p = parseTx(bytes);
  const idx = p.accountKeys.slice(0, p.numRequiredSignatures).findIndex((k) => k.length === 32 && k.every((x, i) => x === publicKey[i]));
  if (idx < 0) throw new Error("This transaction does not ask for our wallet's signature.");
  const out = bytes.slice(); out.set(await sign(seed, p.message), p.sigStart + idx * 64);
  return out;
}

const u64le = (n: bigint): number[] => { const o: number[] = []; let v = n; for (let i = 0; i < 8; i++) { o.push(Number(v & 0xffn)); v >>= 8n; } return o; };
const concat = (...parts: (Uint8Array | number[])[]): Uint8Array => { const n = parts.reduce((a, p) => a + p.length, 0); const o = new Uint8Array(n); let k = 0; for (const p of parts) { o.set(p, k); k += p.length; } return o; };

/** Unsigned legacy transaction: one System Program transfer, fee payer = sender. Returns the full wire bytes with an empty signature slot. */
export function buildSolTransfer(from: Uint8Array, to: Uint8Array, lamports: bigint, recentBlockhash: Uint8Array): Uint8Array {
  if (lamports <= 0n) throw new Error("Amount must be above zero.");
  if (from.length !== 32 || to.length !== 32 || recentBlockhash.length !== 32) throw new Error("Bad key or blockhash length.");
  const system = b58decode(SYSTEM_PROGRAM);
  const data = concat([2, 0, 0, 0], u64le(lamports));                           // SystemInstruction::Transfer
  const message = concat([1, 0, 1], compactU16Encode(3), from, to, system, recentBlockhash,
    compactU16Encode(1), [2], compactU16Encode(2), [0, 1], compactU16Encode(data.length), data);
  return concat(compactU16Encode(1), new Uint8Array(64), message);
}

/** Unsigned legacy transaction that closes empty token accounts (returning their rent to `owner`). */
export function buildCloseAccounts(owner: Uint8Array, accounts: { address: Uint8Array; programId: Uint8Array }[], recentBlockhash: Uint8Array): Uint8Array {
  if (!accounts.length || accounts.length > 8) throw new Error("Close between 1 and 8 accounts at a time.");
  const programs: Uint8Array[] = []; for (const a of accounts) if (!programs.some((p) => p.every((x, i) => x === a.programId[i]))) programs.push(a.programId);
  // account order: signer+writable owner, writable token accounts, then read-only program ids
  const keys = [owner, ...accounts.map((a) => a.address), ...programs];
  const idx = (k: Uint8Array) => keys.findIndex((x) => x.every((b, i) => b === k[i]));
  const ixs = accounts.map((a) => concat([idx(a.programId)], compactU16Encode(3), [idx(a.address), 0, 0], compactU16Encode(1), [9]));   // CloseAccount(account -> owner, authority owner)
  const message = concat([1, 0, programs.length], compactU16Encode(keys.length), ...keys, recentBlockhash, compactU16Encode(ixs.length), ...ixs);
  return concat(compactU16Encode(1), new Uint8Array(64), message);
}
