import type { MemeChain } from "./types.ts";

const B58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const EVM = /^0x[0-9a-fA-F]{40}$/;
export function validateAddress(chain: MemeChain, a: string): boolean { return chain === "solana" ? B58.test(a) : EVM.test(a); }
export function normalizeAddress(chain: MemeChain, a: string): string { return chain === "solana" ? a.trim() : a.trim().toLowerCase(); }
export const NATIVE: Record<MemeChain, string> = { solana: "SOL", ethereum: "ETH", base: "ETH", bsc: "BNB" };
