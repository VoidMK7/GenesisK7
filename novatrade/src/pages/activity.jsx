import React, { useState } from "react";
import { api, clock, cn, compact, fail, nav, price, sign, toast, usd, useApi } from "../lib.jsx";
import { Empty, Icon, Logo, Seg, Sheet, Sim, Skel } from "../ui.jsx";
import { Header, TradeRow } from "./home.jsx";

const nice = { liquidityUsd: ["Liquidity", compact], volume24hUsd: ["24h volume", compact], fdvUsd: ["Valuation", compact], ageMinutes: ["Age", (v) => (v < 120 ? v + " min" : Math.round(v / 60) + " h")], buys24h: ["Buys 24h", String], sells24h: ["Sells 24h", String], change1h: ["1h", (v) => v + "%"], change24h: ["24h", (v) => v + "%"], safetyScore: ["Safety score", (v) => v + "/100"], price: ["Price", price], pnl_usd: ["Result", sign], entry_price: ["Entry", price], modelled_slippage_bps: ["Modelled slippage", (v) => v / 100 + "%"], modelled_fee_bps: ["Modelled fee", (v) => v / 100 + "%"] };

export function TradeSheet({ t, onClose }) {
  const [note, setNote] = useState(""); const [rating, setRating] = useState(t.feedback?.rating || 0); const [busy, setBusy] = useState(false);
  const rate = async (r) => { try { await api("/memecoin/feedback", { method: "POST", body: { tradeId: t.id, rating: r } }); setRating(r); toast(r > 0 ? "Marked as a good call" : "Marked as a bad call"); } catch (e) { fail(e); } };
  const teach = async (kind) => { if (note.trim().length < 3) return; setBusy(true); try { const r = await api("/teach", { method: "POST", body: { kind, text: note.trim(), source: "feedback" } }); toast(r.enforced ? `Learned. Enforced: ${r.enforced}` : "Learned. Saved as guidance for your AI."); setNote(""); } catch (e) { fail(e); } setBusy(false); };
  const reject = async () => { try { await api(`/memecoin/trades/${t.id}`, { method: "POST", body: { action: "reject" } }); toast("Proposal rejected"); onClose(true); } catch (e) { fail(e); } };
  const approve = async () => { try { await api(`/memecoin/trades/${t.id}`, { method: "POST", body: { action: "approve" } }); } catch (e) { fail(e); } };
  const ev = Object.entries(t.evidence || {}).filter(([k, v]) => nice[k] && v !== null && v !== undefined);
  return <Sheet onClose={() => onClose(false)} title="Trade details">
    <div className="row g12"><Logo src={t.image_url} sym={t.symbol} /><div className="sp"><div className="b fs16">{t.side === "skip" ? "Passed on" : t.side === "buy" ? "Buy" : "Sell"} {t.symbol}</div><div className="fs12 mut">{({ scanner: "Scanner", analyst: "Analyst", executor: "Executor", risk: "Risk", copy: "Copy agent", user: "You" })[t.agent]} · {new Date(t.created_at).toLocaleString()}</div></div>{t.simulated && <Sim />}</div>
    <div className="card mt12"><div className="lbl">Why</div><p className="fs14" style={{ margin: "6px 0 0", lineHeight: 1.55 }}>{t.reason}</p></div>
    {t.source_wallet && <div className="card"><div className="lbl">Copied from wallet</div><div className="mono fs12 mt4" style={{ wordBreak: "break-all" }}>{t.source_wallet}</div></div>}
    {ev.length > 0 && <div className="card"><div className="lbl mb8">Numbers used</div>{ev.map(([k, v]) => <div className="kv" key={k}><span>{nice[k][0]}</span><span className="mono">{nice[k][1](v)}</span></div>)}</div>}
    {(t.rules_applied || []).length > 0 && <div className="card"><div className="lbl mb8">Your rules that applied</div>{t.rules_applied.map((r) => <div key={r} className="fs13">• {r}</div>)}</div>}
    {t.status === "awaiting_approval" && <div className="row g8 mt12"><button className="btn sec2 sp" onClick={reject}>Reject</button><button className="btn sp" onClick={approve}>Approve</button></div>}
    {t.status !== "skipped" && <div className="row g8 mt12"><button className={cn("btn sp", rating === 1 ? "" : "sec2")} onClick={() => rate(1)}><Icon n="up" size={16} />Good call</button><button className={cn("btn sp", rating === -1 ? "dn" : "sec2")} onClick={() => rate(-1)}><Icon n="out" size={16} />Bad call</button></div>}
    <div className="card mt12"><div className="lbl">Teach the AI from this</div><textarea className="ta mt8" style={{ minHeight: 64 }} placeholder="e.g. Avoid tokens under 1 hour old" value={note} onChange={(e) => setNote(e.target.value)} maxLength={400} />
      <div className="row g8 mt8"><button className="btn sec2 sp sm2" disabled={busy} onClick={() => teach("prefer")}>Do more like this</button><button className="btn sec2 sp sm2" disabled={busy} onClick={() => teach("avoid")}>Avoid this</button></div></div>
    <button className="btn ghost full mt12" onClick={() => { onClose(false); nav(`/token?chain=${t.chain}&address=${encodeURIComponent(t.token_address)}`); }}>Open token page</button>
  </Sheet>;
}

export default function Activity({ openTrade }) {
  const [tab, setTab] = useState("trades"); const [side, setSide] = useState("");
  const tr = useApi(`/memecoin/trades?limit=80${side ? "&side=" + side : ""}`, { poll: 30000 }); const ev = useApi(tab === "log" ? "/memecoin/activity?limit=100" : "", { poll: 20000 });
  const col = { scanner: "var(--teal)", analyst: "var(--warn)", executor: "#a78bfa", risk: "var(--dn)", system: "var(--mut)" };
  return <>
    <Header title="Activity" right={<button className="btn sec2 sm2" onClick={() => { tr.reload(); }}>Refresh</button>} />
    <div className="px"><Seg value={tab} set={setTab} opts={[["trades", "Trades"], ["log", "Agent log"]]} /></div>
    {tab === "trades" && <><div className="row g8 px mt12">{[["", "All"], ["buy", "Buys"], ["sell", "Sells"], ["skip", "Passed"]].map(([v, l]) => <button key={v} className={cn("chip", side === v && "teal")} onClick={() => setSide(v)}>{l}</button>)}</div>
      <div className="mt8">{tr.loading ? <Skel n={6} h={56} /> : tr.error ? <div className="empty">{tr.error.message}</div> : tr.data.trades.length ? <div className="list">{tr.data.trades.map((t) => <TradeRow key={t.id} t={t} onOpen={openTrade} />)}</div> : <Empty title="Nothing here yet">Every decision the agents make appears here, with the reason.</Empty>}</div>
      {tr.data && <p className="fs11 dim px mt16" style={{ lineHeight: 1.5 }}>{tr.data.note}</p>}</>}
    {tab === "log" && <div className="mt8">{ev.loading ? <Skel n={6} h={44} /> : ev.error ? <div className="empty">{ev.error.message}</div> : (ev.data?.events || []).length ? ev.data.events.map((e) => <div className="ev" key={e.id}><span className="ag" style={{ color: col[e.agent] }}>{e.agent}</span><div className="sp"><div>{e.message}</div><div className="fs11 dim mt4">{clock(e.created_at)}</div></div></div>) : <Empty title="No agent activity yet">Switch your strategy on and run the agents.</Empty>}</div>}
  </>;
}
