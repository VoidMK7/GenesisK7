import React, { useEffect, useRef, useState } from "react";
import { api, cn, fail, nav, toast, useApi } from "../lib.jsx";
import { Empty, Icon, Notice, Seg, Skel, Toggle } from "../ui.jsx";
import { Header } from "./home.jsx";
import { compileRules, parseStrategyPrompt } from "../core/index.ts";

const EXAMPLE = `Solana memecoins only.
Liquidity over 30k, 24h volume over 100k.
$25 per trade, max 4 positions.
Take profit 3x, stop loss 20%, trailing 15%.
Never buy tokens under 1 hour old.
Avoid anything that already pumped 10x.`;

export function Strategy() {
  const st = useApi("/memecoin/strategy"); const [prompt, setPrompt] = useState(null); const [mode, setMode] = useState("paper"); const [busy, setBusy] = useState(false);
  useEffect(() => { if (st.data) { setPrompt(st.data.strategy.prompt || ""); setMode(st.data.strategy.mode === "analysis" ? "analysis" : "paper"); } }, [st.data]);
  if (st.loading) return <Skel n={2} h={120} />; if (st.error) return <Empty title="Not available">{st.error.message}</Empty>;
  const s = st.data.strategy; const live = parseStrategyPrompt(prompt || "").understood;
  const save = async (enabled) => { setBusy(true); try { const r = await api("/memecoin/strategy", { method: "PUT", body: { prompt, mode, enabled: enabled ?? s.enabled } }); toast(enabled === true ? "Agents are on" : enabled === false ? "Agents paused" : "Saved"); st.reload(); if (r.note && !r.understood.length) toast(r.note); } catch (e) { fail(e); } setBusy(false); };
  return <div className="px"><div className="card">
    <div className="row"><b className="sp">Your strategy</b><span className={cn("chip", s.enabled ? "up" : "")}>{s.enabled ? "ON" : "OFF"}</span></div>
    <p className="fs12 mut mt4" style={{ lineHeight: 1.5 }}>Write it the way you'd tell a person. Numbers you state become hard limits the Risk agent enforces; you'll see exactly what was understood.</p>
    <textarea className="ta mono mt8" style={{ minHeight: 150, fontSize: 13 }} value={prompt ?? ""} onChange={(e) => setPrompt(e.target.value)} placeholder={EXAMPLE} maxLength={2000} />
    <div className="mt8">{live.length ? <div className="row g6 wrap">{live.map((u) => <span key={u} className="chip teal">{u}</span>)}</div> : <span className="fs12 dim">No numbers recognised yet. Try "stop loss 20%" or "liquidity over 30k".</span>}</div>
    <div className="mt12"><div className="lbl mb8">Mode</div><Seg value={mode} set={setMode} opts={[["paper", "Paper (simulated)"], ["analysis", "Analysis only"]]} /></div>
    <div className="pgrid mt12">{[["Per trade", "$" + s.positionUsd], ["Max open", s.maxOpenPositions], ["Take profit", "+" + s.takeProfitPct + "%"], ["Stop loss", "-" + s.stopLossPct + "%"], ["Trailing", s.trailingStopPct + "%"], ["Min liquidity", "$" + s.minLiquidityUsd.toLocaleString()]].map(([l, v]) => <div className="stat" key={l}><div className="lbl">{l}</div><div className="v">{v}</div></div>)}</div>
    <div className="row g8 mt12"><button className="btn sec2 sp" disabled={busy} onClick={() => save()}>Save</button><button className={cn("btn sp", s.enabled && "dn")} disabled={busy} onClick={() => save(!s.enabled)}>{s.enabled ? "Pause agents" : "Save & switch on"}</button></div>
    <p className="fs11 dim mt8" style={{ lineHeight: 1.5 }}>Live on-chain trading is off. Real swaps would need a signer you add and audit; until then the agents trade on paper and can send you approval requests.</p></div></div>;
}

function Rules() {
  const r = useApi("/teach"); const [text, setText] = useState(""); const [kind, setKind] = useState("avoid"); const pv = text.length > 2 ? compileRules([{ id: "p", kind, text }]).understood.p : null;
  const add = async () => { try { const x = await api("/teach", { method: "POST", body: { kind, text } }); toast(x.enforced ? `Learned. Enforced: ${x.enforced}` : "Learned as guidance"); setText(""); r.reload(); } catch (e) { fail(e); } };
  const tog = async (x) => { try { await api("/teach", { method: "PUT", body: { id: x.id, active: !x.active } }); r.reload(); } catch (e) { fail(e); } };
  const del = async (x) => { try { await api("/teach", { method: "DELETE", body: { id: x.id } }); r.reload(); } catch (e) { fail(e); } };
  return <div className="px"><div className="card"><b>Teach the AI a rule</b><p className="fs12 mut mt4" style={{ lineHeight: 1.5 }}>Rules the app can read exactly (avoid a symbol, minimum age, minimum liquidity, maximum valuation, minimum safety score) are enforced. Anything else is passed to your AI as context.</p>
    <div className="mt8"><Seg value={kind} set={setKind} opts={[["avoid", "Avoid"], ["prefer", "Prefer"], ["limit", "Limit"], ["note", "Note"]]} /></div>
    <textarea className="ta mt8" style={{ minHeight: 70 }} value={text} onChange={(e) => setText(e.target.value)} placeholder='e.g. "Never buy tokens under 2 hours old" or "avoid $SCAM"' maxLength={400} />
    {text.length > 2 && <div className={cn("fs12 mt8", pv ? "up" : "mut")}>{pv ? "Will be enforced: " + pv : "Not a hard filter. Saved as guidance for your AI."}</div>}
    <button className="btn full mt8" disabled={text.trim().length < 3} onClick={add}>Teach</button></div>
    <div className="sec" style={{ padding: "18px 0 8px" }}><h2>Learned rules</h2><small>{r.data?.rules.length ?? 0}</small></div>
    {r.loading ? <Skel n={3} h={50} /> : r.data?.rules.length ? r.data.rules.map((x) => <div key={x.id} className="card row g10"><div className="sp" style={{ opacity: x.active ? 1 : .45 }}><div className="fs14">{x.text}</div><div className="fs11 mt4"><span className="tag">{x.kind}</span> {x.enforced ? <span className="up fs11"> enforced · {x.enforced}</span> : <span className="dim fs11"> guidance</span>}</div></div><Toggle on={x.active} set={() => tog(x)} label="Active" /><button className="ibtn" aria-label="Delete rule" onClick={() => del(x)}><Icon n="trash" size={17} /></button></div>) : <Empty title="No rules yet">Teach it from here, from any trade's detail sheet, or by chatting with your AI.</Empty>}</div>;
}

export function Assistant() {
  const m = useApi("/assistant"); const [text, setText] = useState(""); const [busy, setBusy] = useState(false); const end = useRef(null); const [local, setLocal] = useState([]);
  useEffect(() => { end.current?.scrollIntoView({ block: "end" }); }, [m.data, local]);
  const send = async () => { const t = text.trim(); if (!t) return; setText(""); setLocal((l) => [...l, { id: "u" + Date.now(), role: "user", body: t }]); setBusy(true); try { await api("/assistant", { method: "POST", body: { message: t } }); setLocal([]); await m.reload(); } catch (e) { fail(e); setLocal([]); } setBusy(false); };
  const teach = async (r) => { try { const x = await api("/teach", { method: "POST", body: { kind: r.kind, text: r.text, source: "chat" } }); toast(x.enforced ? "Taught and enforced" : "Taught"); } catch (e) { fail(e); } };
  if (m.loading) return <Skel n={3} h={60} />;
  if (m.data?.requiresConfiguration || m.error?.code === "requires_configuration") return <div className="px"><Notice icon="brain">The assistant uses <b>your</b> AI model. Connect one (OpenAI, Anthropic, Gemini, a local Ollama or any OpenAI-compatible endpoint) and it can explain trades and turn what you say into rules.</Notice><button className="btn full mt12" onClick={() => nav("/ai")}>Connect your AI model</button></div>;
  if (m.error) return <Empty title="Not available">{m.error.message}</Empty>;
  const all = [...(m.data?.messages || []), ...local];
  return <div className="col" style={{ minHeight: "56dvh" }}><div className="px col g10" style={{ paddingBottom: 12 }}>
    {!all.length && <Empty title={`Talking to your ${m.data.ai.provider} model`}>Try: "Only buy tokens with locked liquidity" or "Why did you skip the last one?"</Empty>}
    {all.map((x) => <div key={x.id} className="col g6"><div className={cn("bub", x.role === "user" ? "me" : "them")}>{x.body}</div>{(x.suggested_rules || []).map((r, i) => <div key={i} className="card row g8" style={{ marginTop: 0 }}><div className="sp fs13"><span className="tag">{r.kind}</span> {r.text}</div><button className="btn sm2" onClick={() => teach(r)}>Teach</button></div>)}</div>)}
    {busy && <div className="bub them dim">Thinking…</div>}<div ref={end} /></div>
    <div className="compose"><input className="in" value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === "Enter" && !busy && send()} placeholder="Tell the AI what you want" maxLength={2000} /><button className="btn" aria-label="Send" disabled={busy || !text.trim()} onClick={send}><Icon n="up" size={18} /></button></div></div>;
}

export default function Teach({ q = {} }) { const [tab, setTab] = useState(q.tab || "strategy"); return <><Header back title="Teach your AI" /><div className="px mb8"><Seg value={tab} set={setTab} opts={[["strategy", "Strategy"], ["rules", "Rules"], ["chat", "Chat"]]} /></div>{tab === "strategy" ? <Strategy /> : tab === "rules" ? <Rules /> : <Assistant />}</>; }
