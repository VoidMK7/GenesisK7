import React, { useEffect, useState } from "react";
import { api, ago, cn, fail, nav, sb, toast, useApi, useLocal } from "../lib.jsx";
import { Avatar, Empty, Icon, Notice, Seg, Skel, Toggle } from "../ui.jsx";
import { Header } from "./home.jsx";

export default function Account({ theme, setTheme }) {
  const p = useApi("/profile"); const me = useApi("/me"); const d = p.data;
  const rows = [["wallet", "Wallets", "Balances and how much the AI may use", "/wallets"], ["brain", "Teach your AI", "Strategy, rules and chat", "/teach"], ["spark", "My AI model", "Connect your own model", "/ai"], ["copy", "Copy terminal", "Follow wallets, mirror on paper", "/copy"], ["bell", "Notifications", "Trades, follows, approvals", "/notifications"], ["flame", "Market", "Live memecoin scan", "/market"]];
  return <><Header title="Account" />
    <div className="px"><button className="card row g12" style={{ width: "100%", textAlign: "left" }} onClick={() => nav("/profile")}>{d ? <Avatar p={d.profile} size="xl" /> : <div className="skel" style={{ width: 72, height: 72, borderRadius: 99 }} />}<div className="sp"><b className="fs16">{d?.profile.display_name || "…"}</b><div className="fs12 mut">@{d?.profile.handle}</div><div className="fs12 mt4"><b>{d?.counts.followers ?? 0}</b> <span className="mut">followers</span> · <b>{d?.counts.following ?? 0}</b> <span className="mut">following</span></div></div><Icon n="chev" /></button></div>
    {p.error && <div className="px mt12"><Notice>{p.error.message}</Notice></div>}
    <div className="list mt12">{rows.map(([ic, t, s, to]) => <button key={to} className="item" onClick={() => nav(to)}><span className="aic" style={{ width: 36, height: 36, background: "var(--card2)", borderRadius: 12 }}><Icon n={ic} size={18} /></span><div className="sp"><div className="t">{t}</div><div className="u">{s}</div></div><Icon n="chev" size={18} style={{ color: "var(--dim)" }} /></button>)}</div>
    <div className="sec"><h2>Appearance</h2></div><div className="px"><Seg value={theme} set={setTheme} opts={[["dark", "Dark · agents"], ["light", "Light · terminal"]]} /></div>
    <div className="sec"><h2>Safety</h2></div><div className="px col g8"><Notice info>Trading is <b>paper or analysis only</b> in this build. Live on-chain swaps are locked: they would need a wallet-signing adapter you add and audit. Wallets are read-only, and withdrawal permissions are never requested.</Notice>{me.data?.isAdmin && <button className="btn ghost" onClick={() => toast("Admin tools live in your backend's /admin routes.")}>Signed in as admin</button>}</div>
    <div className="px mt24"><button className="btn dn full" onClick={async () => { await sb?.auth.signOut(); nav("/"); }}>Sign out</button></div></>;
}

export function AiModel() {
  const a = useApi("/ai-provider"); const [f, setF] = useState({ provider: "openai", apiKey: "", model: "", baseUrl: "" }); const [busy, setBusy] = useState(false);
  const info = a.data?.providers.find((x) => x.id === f.provider); const c = a.data?.connection;
  const save = async () => { setBusy(true); try { const r = await api("/ai-provider", { method: "PUT", body: f }); toast(r.test?.ok ? "Connected and tested" : "Saved, but the test failed: " + (r.test?.message || "check key/model")); setF({ ...f, apiKey: "" }); a.reload(); } catch (e) { fail(e); } setBusy(false); };
  const test = async () => { try { const r = await api("/ai-provider", { method: "POST" }); toast(r.ok ? "Your model answered" : "Test failed: " + (r.message || "")); a.reload(); } catch (e) { fail(e); } };
  const del = async () => { try { await api("/ai-provider", { method: "DELETE" }); a.reload(); } catch (e) { fail(e); } };
  return <><Header back title="My AI model" /><div className="px col g12">
    <Notice info>Bring your own model. Your key is encrypted on the server and only used to write explanations and chat. It is separate from any wallet and can't move funds.</Notice>
    {a.loading ? <Skel n={2} h={120} /> : a.error ? <Empty title="Not available">{a.error.message}</Empty> : <>
      {c && <div className="card"><div className="row"><b className="sp">{c.provider}{c.model ? " · " + c.model : ""}</b><span className={cn("chip", c.last_test_ok ? "up" : "dn")}>{c.last_test_ok ? "working" : "failing"}</span></div><div className="fs12 mut mt4">Key {c.keyHint || "none"} · tested {c.last_tested_at ? ago(c.last_tested_at) + " ago" : "never"}</div><div className="row g8 mt12"><button className="btn sec2 sp sm2" onClick={test}>Test</button><button className="btn dn sp sm2" onClick={del}>Disconnect</button></div></div>}
      {!c && a.data.platformDefault && <Notice info>A platform default model ({a.data.platformDefault}) is available. Connect yours to use it instead.</Notice>}
      <div className="card"><b>{c ? "Replace" : "Connect"} a model</b><div className="col g10 mt12">
        <select className="sel" value={f.provider} onChange={(e) => setF({ ...f, provider: e.target.value })}>{a.data.providers.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
        {info?.needsKey && <input className="in mono" type="password" autoComplete="off" placeholder="API key" value={f.apiKey} onChange={(e) => setF({ ...f, apiKey: e.target.value })} />}
        <input className="in" placeholder={`Model${info?.defaultModel ? " (default " + info.defaultModel + ")" : ""}`} value={f.model} onChange={(e) => setF({ ...f, model: e.target.value })} />
        {info?.editableBaseUrl && <input className="in mono" placeholder={`Base URL${info.defaultBaseUrl ? " (" + info.defaultBaseUrl + ")" : ""}`} value={f.baseUrl} onChange={(e) => setF({ ...f, baseUrl: e.target.value })} />}
        <button className="btn full" disabled={busy || (info?.needsKey && !f.apiKey)} onClick={save}>{busy ? "Testing…" : "Save & test"}</button>{info && <p className="fs11 dim" style={{ lineHeight: 1.5 }}>{info.costNote}</p>}</div></div></>}</div></>;
}

export function Notifications() {
  const n = useApi("/notifications", { poll: 30000 }); const all = n.data?.notifications || [];
  const read = async () => { try { await api("/notifications", { method: "POST", body: { all: true } }); n.reload(); } catch (e) { fail(e); } };
  const icon = { trader_trade: "pulse", trade: "bolt", approval: "lock", follow: "agents", like: "heart", risk: "shield", order: "bolt" };
  return <><Header back title="Notifications" right={all.some((x) => !x.read) && <button className="btn sec2 sm2" onClick={read}>Mark all read</button>} />
    {n.loading ? <Skel n={5} h={56} /> : n.error ? <Empty title="Not available">{n.error.message}</Empty> : all.length ? <div className="list">{all.map((x) => <div key={x.id} className="item" style={{ opacity: x.read ? .6 : 1 }}><span className="aic" style={{ width: 34, height: 34, background: "var(--card2)", borderRadius: 11 }}><Icon n={icon[x.kind] || "bell"} size={16} /></span><div className="sp"><div className="t fs14">{x.title}</div>{x.body && <div className="u" style={{ lineHeight: 1.45 }}>{x.body}</div>}</div><span className="u">{ago(x.created_at)}</span></div>)}</div> : <Empty title="All quiet">You'll be told about every trade from wallets you follow, agent approvals and follows.</Empty>}</>;
}
