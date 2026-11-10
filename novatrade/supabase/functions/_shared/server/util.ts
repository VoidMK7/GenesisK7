import { MEME_CHAINS, validateAddress, type MemeChain } from "../core/memecoin/index.ts";
import { serviceDb } from "./auth.ts";
import { HttpError } from "./http.ts";

export const q = (req: Request, k: string) => new URL(req.url).searchParams.get(k);
export function chainParam(s: string | null, dflt: MemeChain = "solana"): MemeChain {
  const c = (s ?? dflt) as MemeChain;
  if (!MEME_CHAINS.includes(c)) throw new HttpError(400, `chain must be one of: ${MEME_CHAINS.join(", ")}.`);
  return c;
}
export function addressParam(chain: MemeChain, s: string | null): string {
  if (!s || !validateAddress(chain, s.trim())) throw new HttpError(400, "That is not a valid address for this chain.");
  return chain === "solana" ? s.trim() : s.trim().toLowerCase();
}
export const intParam = (s: string | null, d: number, min: number, max: number) => { const n = Number(s); return Number.isFinite(n) && s !== null && s !== "" ? Math.min(max, Math.max(min, Math.floor(n))) : d; };

/** Creates the social profile on first use so every account has one. */
export async function ensureProfile(userId: string, email: string | null) {
  const db = serviceDb();
  const { data } = await db.from("nova_profiles").select("*").eq("user_id", userId).maybeSingle();
  if (data) return data;
  const base = (email?.split("@")[0] ?? "trader").toLowerCase().replace(/[^a-z0-9_]/g, "").slice(0, 14) || "trader";
  for (let i = 0; i < 6; i++) {
    const handle = `${base}${Math.floor(1000 + Math.random() * 9000)}`;
    const { data: row, error } = await db.from("nova_profiles").insert({ user_id: userId, handle, display_name: base.slice(0, 40) }).select("*").single();
    if (!error && row) return row;
  }
  throw new HttpError(500, "Could not create a profile. Try again.");
}
