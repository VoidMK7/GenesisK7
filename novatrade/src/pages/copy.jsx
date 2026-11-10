import React, { useState } from "react";
import { api, clock, cn, fail, nav, short, toast, useApi } from "../lib.jsx";
import { Brand, Empty, Icon, Skel } from "../ui.jsx";
import { parseStrategyPrompt } from "../core/index.ts";
import { ConnectSheet } from "./wallets.jsx";

const PH = `Connect to my wallet and copy the top Solana meme traders.

COPY a buy only if ALL pass:
- liquidity over 30k
- take profit 3x, stop loss 20%
- $25 per trade, max 4 positions

Never buy tokens under 1 hour old.
Log every copy: wallet, token, size, why.`;
const COLORS = ["#F59E0B", "#6366F1", "#10B981", "#8B5CF6", "#F97316", "#EC4899", "#06B6D4", "#64748B"];

/** The light "terminal · copy mode" screen: your instruction, the wallets being copied, and a streaming log of everything. */
export default function Copy() {
  const w = useApi("/watch", { poll: 30000 }); const tr = useApi("/memecoin/trades?limit=60", { poll: 30000 }); const st = useApi("/memecoin/strategy");
  const [text, setText] = useState(null); const [add, setAdd] = useState(false); const [busy, setBusy] = useState(false);
  const s = st.data?.strategy; const val = text ?? s?.prompt ?? ""; const understood = parseStrategyPrompt(val).understood;
  const send = async () => { setBusy(true); try { const r = await api("/memecoin/strategy", { method: "PUT", body: { prompt: val, mode: "paper", enabled: true } }); toast(r.understood.length ? `Set: ${r.understood.length} rule(s) understood. Agents on (paper).` : "Saved as guidance. No numbers recognised."); st.reload(); } catch (e) { fail(e); } setBusy(false); };
  const following = w.data?.following || []; const copies = (tr.data?.trades || []).filter((t) => t.agent === "copy");
  const lines = [...(w.data?.trades || []).map((t) => ({ at: t.detected_at, k: "obs", t })), ...copies.map((t) => ({ at: t.created_at, k: "cp", t }))].sort((a, b) => +new Date(b.at) - +new Date(a.at)).slice(0, 50);
  const nameOf = (a) => following.find((f) => f.wallet_address === a)?.handle || short(a);
  return <div className="term" style={{ margin: "0 -0px", padding: "14px 16px 40px" }}>
    <div className="row g10"><Brand size={34} /><div><b style={{ fontFamily: "var(--sans)", fontSize: 18 }}>NovaTrade</b><span className="chip teal mono" style={{ marginLeft: 8, fontSize: 10 }}>copy mode</span></div><span className="sp" /><span className="row g6 fs12"><i style={{ width: 7, height: 7, borderRadius: 9, background: "var(--up)" }} />{following.length ? "Live" : "Idle"}</span></div>
    <div className="promptbox mt16"><div className="fs11 dim mb8">message NovaTrade</div><textarea value={val} onChange={(e) => setText(e.target.value)} placeholder={PH} maxLength={2000} />
      <div className="row mt8"><div className="sp row g6 wrap">{understood.slice(0, 3).map((u) => <span key={u} className="chip teal" style={{ fontSize: 10 }}>{u}</span>)}</div><button className="btn" aria-label="Send" disabled={busy || !val.trim()} onClick={send} style={{ borderRadius: 999, width: 40, height: 40, padding: 0, background: "#111", color: "#fff" }}><Icon n="up" size={18} /></button></div></div>
    <div className="row mt16 g12"><div className="sp"><div className="fs11 dim">following</div><div style={{ fontSize: 40, fontWeight: 800, fontFamily: "var(--sans)" }}>{following.length}<span className="fs16 mut"> wallet{following.length === 1 ? "" : "s"}</span></div><div className="fs12 mut">{copies.length} mirrored paper trade{copies.length === 1 ? "" : "s"} · {w.data?.trades.length || 0} observed</div></div><button className="btn or" onClick={() => setAdd(true)}>Connect wallet</button></div>
    <div className="card mt16" style={{ padding: "8px 12px" }}><div className="row" style={{ padding: "6px 0" }}><b className="sp" style={{ fontFamily: "var(--sans)" }}>wallets</b><span className="fs11 dim">copies · last</span></div>
      {w.loading ? <Skel n={3} h={34} /> : following.length ? <table className="wtab"><tbody>{following.map((f, i) => { const n = copies.filter((c) => c.source_wallet === f.wallet_address).length; const last = (w.data.trades || []).find((t) => t.wallet_address === f.wallet_address); return <tr key={f.wallet_address}><td><span className="wdot" style={{ background: COLORS[i % COLORS.length] }}>{f.handle[0]?.toUpperCase()}</span>{f.handle.length > 14 ? short(f.handle) : f.handle}</td><td className="mut">{f.platform || (f.source === "auto" ? "AI pick" : "manual")}</td><td style={{ textAlign: "right" }}>{n}</td><td style={{ textAlign: "right" }} className="dim">{last ? clock(last.detected_at) : "–"}</td></tr>; })}</tbody></table> : <div className="empty" style={{ padding: 18 }}>No wallets yet. Follow wallets from <a className="teal b" href="#/agents">Agents › Top traders</a>.</div>}</div>
    <div className="card mt12" style={{ minHeight: 160 }}><div className="row"><b className="sp" style={{ fontFamily: "var(--sans)" }}>copy log</b><span className="fs11 up stream">streaming</span></div>
      <div className="mt8">{lines.length ? lines.map((l, i) => l.k === "obs" ? <div key={i} className="logline"><span className="dim">{clock(l.at)}</span> <b>{nameOf(l.t.wallet_address)}</b> {l.t.side === "buy" ? "bought" : "sold"} {short(l.t.token_address)} {l.t.usd ? "$" + Number(l.t.usd).toFixed(0) : ""} <span className="dim">· on-chain</span></div> : <div key={i} className="logline"><span className="dim">{clock(l.at)}</span> <b>{l.t.side === "buy" ? "✓ copied" : "✓ exited"}</b> {l.t.symbol} {l.t.usd ? "$" + Number(l.t.usd).toFixed(2) : ""} <span className="dim">· paper · {l.t.reason.slice(0, 70)}</span></div>) : <div className="logline">Waiting for the first trade from a followed wallet. Nothing is shown until it really happens.</div>}</div></div>
    <p className="fs11 dim mt12" style={{ lineHeight: 1.6 }}>Copying is simulated (paper) or approval-based. NovaTrade can't move funds on its own, and results here are not guaranteed or predictive.</p>
    {add && <ConnectSheet kind="own" onClose={() => setAdd(false)} onDone={() => { setAdd(false); nav("/wallets"); }} />}
  </div>;
}
