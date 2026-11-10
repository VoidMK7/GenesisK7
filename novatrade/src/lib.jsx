import React, { useCallback, useEffect, useRef, useState } from "react";
import { bestPairs, rugScore } from "./core/index.ts";

// ------------------------------------------------------------------ config (public values only)
export const CFG = window.NOVATRADE_CONFIG || {};
export const SB_URL = (CFG.supabaseUrl || "").replace(/\/+$/, "");
export const configured = Boolean(SB_URL && CFG.supabaseAnonKey);
export const sb = (() => { try { return configured && window.supabase ? window.supabase.createClient(SB_URL, CFG.supabaseAnonKey, { auth: { persistSession: true, autoRefreshToken: true } }) : null; } catch { return null; } })();

// ------------------------------------------------------------------ api
export class ApiError extends Error { constructor(m, status, code) { super(m); this.status = status; this.code = code; } }
export async function api(path, { method = "GET", body } = {}) {
  if (!configured || !sb) throw new ApiError("Backend not configured. Add your Supabase URL and anon key at the top of index.html.", 0, "requires_configuration");
  const { data } = await sb.auth.getSession();
  const token = data?.session?.access_token;
  if (!token) throw new ApiError("Sign in required.", 401);
  let r;
  try { r = await fetch(`${SB_URL}/functions/v1/api${path}`, { method, headers: { authorization: `Bearer ${token}`, "content-type": "application/json", apikey: CFG.supabaseAnonKey }, body: body ? JSON.stringify(body) : undefined }); }
  catch { throw new ApiError("Could not reach the backend. Check your connection and that the `api` function is deployed.", 0); }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new ApiError(j.error || `Request failed (${r.status})`, r.status, j.code);
  return j;
}

/** Fetches on mount / when `path` changes. `poll` ms re-fetches quietly. Never fakes data: on failure `error` is set and `data` stays null. */
export function useApi(path, { poll = 0, enabled = true } = {}) {
  const [s, set] = useState({ data: null, error: null, loading: Boolean(path && enabled) });
  const alive = useRef(true); const cur = useRef(path);
  const load = useCallback(async (quiet) => {
    if (!path || !enabled) return;
    if (!quiet) set((p) => ({ ...p, loading: true, error: null }));
    try { const d = await api(path); if (alive.current && cur.current === path) set({ data: d, error: null, loading: false }); }
    catch (e) { if (alive.current && cur.current === path) set((p) => ({ data: quiet ? p.data : null, error: e, loading: false })); }
  }, [path, enabled]);
  useEffect(() => { alive.current = true; cur.current = path; set({ data: null, error: null, loading: Boolean(path && enabled) }); load(false); return () => { alive.current = false; }; }, [path, enabled]);
  useEffect(() => { if (!poll || !path || !enabled) return; const t = setInterval(() => { if (!document.hidden) load(true); }, poll); return () => clearInterval(t); }, [poll, path, enabled, load]);
  return { ...s, reload: () => load(false) };
}

// ------------------------------------------------------------------ public market data (works with no backend)
const DEX = "https://api.dexscreener.com";
const jget = async (u) => { const r = await fetch(u, { headers: { accept: "application/json" } }); if (!r.ok) throw new Error(`DexScreener answered ${r.status}`); return r.json(); };
export async function dexTokens(chain, addrs) { const out = []; for (let i = 0; i < addrs.length; i += 30) out.push(...(await jget(`${DEX}/tokens/v1/${chain}/${addrs.slice(i, i + 30).join(",")}`))); return bestPairs(out); }
export async function dexScan(chains = ["solana"]) {
  const errors = []; const by = {};
  for (const u of [`${DEX}/token-profiles/latest/v1`, `${DEX}/token-boosts/latest/v1`]) { try { for (const t of await jget(u)) if (chains.includes(t.chainId) && t.tokenAddress) (by[t.chainId] ||= new Set()).add(t.tokenAddress); } catch (e) { errors.push(e.message); } }
  const pairs = []; for (const [c, set] of Object.entries(by)) { try { pairs.push(...(await dexTokens(c, [...set].slice(0, 40)))); } catch (e) { errors.push(e.message); } }
  return { tokens: pairs.map((p) => ({ ...p, safety: rugScore(p) })).sort((a, b) => b.volume24hUsd - a.volume24hUsd), errors };
}
export async function loadToken(chain, address) {
  if (configured && sb && (await sb.auth.getSession()).data.session) { try { return await api(`/memecoin/token?chain=${chain}&address=${encodeURIComponent(address)}`); } catch (e) { if (e.status === 404) throw e; } }
  const p = (await dexTokens(chain, [address]))[0]; if (!p) throw new ApiError("No trading pair found for this token.", 404);
  return { pair: p, safety: rugScore(p), contractFacts: null, position: null, history: [], log: [], direct: true };
}

// ------------------------------------------------------------------ format
export const usd = (n, d = 2) => (n === null || n === undefined || Number.isNaN(n) ? "—" : (n < 0 ? "-" : "") + "$" + Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d }));
export const sign = (n, d = 2) => (n === null || n === undefined ? "—" : (n >= 0 ? "+" : "-") + "$" + Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d }));
export const pct = (n, d = 1) => (n === null || n === undefined ? "—" : (n >= 0 ? "+" : "") + n.toFixed(d) + "%");
export const compact = (n) => (n === null || n === undefined ? "—" : n >= 1e9 ? "$" + (n / 1e9).toFixed(2) + "B" : n >= 1e6 ? "$" + (n / 1e6).toFixed(2) + "M" : n >= 1e3 ? "$" + (n / 1e3).toFixed(1) + "K" : "$" + n.toFixed(0));
export const price = (n) => { if (!n) return "—"; if (n >= 1) return "$" + n.toFixed(n >= 100 ? 2 : 4); const z = Math.floor(-Math.log10(n)); return "$" + n.toFixed(Math.min(10, z + 4)); };
export const ago = (iso) => { const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000); return s < 60 ? "now" : s < 3600 ? Math.floor(s / 60) + "m" : s < 86400 ? Math.floor(s / 3600) + "h" : Math.floor(s / 86400) + "d"; };
export const clock = (iso) => new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
export const short = (a) => (a && a.length > 12 ? a.slice(0, 4) + "…" + a.slice(-4) : a || "");
export const cn = (...a) => a.filter(Boolean).join(" ");

// ------------------------------------------------------------------ tiny global store (toasts, theme, router)
const subs = new Set(); let toastState = null;
export function toast(msg, err = false) { toastState = { msg, err, id: Date.now() }; subs.forEach((f) => f()); setTimeout(() => { if (toastState && Date.now() - toastState.id >= 3400) { toastState = null; subs.forEach((f) => f()); } }, 3500); }
export function useToast() { const [, f] = useState(0); useEffect(() => { const u = () => f((x) => x + 1); subs.add(u); return () => subs.delete(u); }, []); return toastState; }
export const fail = (e) => toast(e?.message || "Something went wrong", true);

export const nav = (p) => { location.hash = "#" + p; };
const parse = () => { const h = (location.hash || "#/").slice(1); const [path, qs] = h.split("?"); return { path: "/" + path.replace(/^\/+|\/+$/g, ""), q: Object.fromEntries(new URLSearchParams(qs || "")) }; };
export function useRoute() { const [r, set] = useState(parse()); useEffect(() => { const f = () => { set(parse()); window.scrollTo(0, 0); }; window.addEventListener("hashchange", f); return () => window.removeEventListener("hashchange", f); }, []); return r; }

export function useLocal(key, init) {
  const [v, set] = useState(() => { try { const s = localStorage.getItem(key); return s === null ? init : JSON.parse(s); } catch { return init; } });
  return [v, (x) => { set(x); try { localStorage.setItem(key, JSON.stringify(x)); } catch { /* private mode */ } }];
}
