import React, { useState } from "react";
import { api, ago, clock, cn, fail, nav, short, toast, useApi } from "../lib.jsx";
import { Avatar, Empty, Icon, Logo, Notice, Seg, Skel, Toggle } from "../ui.jsx";
import { Header } from "./home.jsx";

const AG = [["scanner", "Scanner", "scan", "var(--teal)", "Finds fresh tokens and drops the ones that fail your filters."], ["analyst", "Analyst", "brain", "var(--warn)", "Scores each survivor and writes the reason in plain words."], ["executor", "Executor", "bolt", "#a78bfa", "Opens and closes positions. Paper fills only unless you add a signer."], ["risk", "Risk", "shield", "var(--dn)", "Enforces size, budget, daily loss limit and the stops."]];
const money = (v) => (v === undefined || v === null ? "—" : "$" + Math.round(v).toLocaleString("en-US"));

function Traders() {
  const w = useApi("/watch", { poll: 60000 }); const [open, setOpen] = useState(null); const d = w.data;
  const [form, setForm] = useState(null);
  const save = async (patch) => { const s = { ...d.settings, ...patch }; try { const r = await api("/watch/settings", { method: "PUT", body: s }); toast(r.added ? `Now following ${r.added} trader(s)` : "Saved"); w.reload(); } catch (e) { fail(e); } };
  const follow = async (t) => { try { await api("/watch/follow", { method: "POST", body: { chain: "solana", address: t.wallet, handle: t.handle } }); toast(`Following ${t.handle}`); w.reload(); } catch (e) { fail(e); } };
  const unfollow = async (f) => { try { await api("/watch/follow", { method: "DELETE", body: { chain: f.chain, address: f.wallet_address } }); w.reload(); } catch (e) { fail(e); } };
  const addWallet = async () => { try { await api("/watch/follow", { method: "POST", body: { chain: form.chain, address: form.address.trim(), handle: form.handle || undefined } }); setForm(null); toast("Following. You'll be told about each trade."); w.reload(); } catch (e) { fail(e); } };
  if (w.loading) return <Skel n={4} h={80} />; if (w.error) return <Empty title="Not available">{w.error.message}</Empty>;
  const s = d.settings; const platforms = [...new Set(d.ranked.map((r) => r.platform))];
  return <>
    <div className="px"><div className="card">
      <div className="row"><div className="sp"><b>Let the AI follow top traders</b><div className="fs12 mut mt4">It re-ranks traders on their published results and follows the ones that meet your bar. You get a notification for every trade they make.</div></div><Toggle on={s.enabled} set={(v) => save({ enabled: v })} label="Auto-follow" /></div>
      {s.enabled && <><div className="pgrid mt12">{[["min_win_rate_pct", "Min win rate %"], ["min_trades", "Min trades"], ["min_pnl_usd", "Min profit $"], ["max_followed", "Follow up to"]].map(([k, l]) => <label key={k} className="col g4"><span className="lbl">{l}</span><input className="in" type="number" defaultValue={s[k]} onBlur={(e) => e.target.value !== String(s[k]) && save({ [k]: Number(e.target.value) })} /></label>)}</div>
        <div className="mt12"><div className="lbl mb8">When a followed trader trades</div><Seg value={s.on_trade} set={(v) => save({ on_trade: v })} opts={[["notify", "Notify me"], ["notify_and_mirror", "Notify + mirror (paper)"]]} /></div></>}
      <p className="fs11 dim mt8" style={{ lineHeight: 1.5 }}>Past results do not predict future ones, and figures come from each source, unverified. Mirroring opens paper positions only (or asks your approval); it never sends a real trade.</p></div></div>

    <div className="sec"><h2>Following</h2><button className="link" onClick={() => setForm({ chain: "solana", address: "", handle: "" })}>+ Add wallet</button></div>
    {d.following.length ? <div className="list">{d.following.map((f) => { const cur = d.cursors.find((c) => c.wallet_address === f.wallet_address); return <div key={f.wallet_address} className="item"><Logo sym={f.handle} /><div className="sp" style={{ minWidth: 0 }}><div className="t ell">{f.handle} <span className="tag">{f.source === "auto" ? "AI picked" : "manual"}</span></div><div className="u ell">{f.platform ? f.platform + " · " : ""}{short(f.wallet_address)} · {cur?.last_checked_at ? "checked " + ago(cur.last_checked_at) + " ago" : "not checked yet"}</div>{f.reason && <div className="u" style={{ lineHeight: 1.4 }}>{f.reason}</div>}{cur?.last_error && <div className="u dn">{cur.last_error}</div>}</div><button className="btn sec2 sm2" onClick={() => unfollow(f)}>Unfollow</button></div>; })}</div> : <Empty title="Not following anyone">Add a wallet address, or turn on auto-follow once traders are available.</Empty>}

    <div className="sec"><h2>Trades they made</h2><small>{d.trades.length}</small></div>
    {d.trades.length ? <div className="list">{d.trades.slice(0, 25).map((t) => { const f = d.following.find((x) => x.wallet_address === t.wallet_address); return <button key={t.id} className="item" onClick={() => nav(`/token?chain=${t.chain}&address=${encodeURIComponent(t.token_address)}`)}><Logo sym={t.token_address.slice(0, 2)} badge={t.side === "buy" ? "var(--cyan)" : "var(--up)"} /><div className="sp"><div className="t">{f?.handle || short(t.wallet_address)} {t.side === "buy" ? "bought" : "sold"}</div><div className="u mono">{short(t.token_address)} · {t.block_time ? clock(t.block_time) : ago(t.detected_at) + " ago"}</div></div><div className="r"><div className="t">{t.usd ? "$" + Number(t.usd).toFixed(0) : Number(t.quote_amount).toFixed(2) + " " + t.quote}</div></div></button>; })}</div> : <Empty title="No trades seen yet">New trades from wallets you follow appear here and as notifications. History before you followed is not back-filled.</Empty>}

    <div className="sec"><h2>Top traders</h2><small>{platforms.length ? platforms.join(" · ") : "from your feed"}</small></div>
    {d.ranked.length ? <div className="list">{d.ranked.map((r) => <div key={r.id}><button className="item" onClick={() => setOpen(open === r.id ? null : r.id)}><Logo sym={r.handle} /><div className="sp" style={{ minWidth: 0 }}><div className="t ell">{r.handle} <span className="tag">{r.platform}</span></div><div className="u">{r.stats.win_rate_pct ?? r.stats.winRatePct ?? "?"}% win · {r.stats.trades ?? "?"} trades · {money(r.stats.pnlUsd ?? r.stats.pnl_usd)}</div></div><span className={cn("chip", r.qualifies ? "up" : "")}>{r.qualifies ? "Qualifies" : "Not yet"} · {r.score}</span></button>
      {open === r.id && <div className="px" style={{ paddingBottom: 12 }}>{r.qualifies ? <p className="fs13 up">Meets all your thresholds.</p> : r.why.map((x) => <div key={x} className="fs12 mut">• {x}</div>)}{r.wallet && !d.following.some((f) => f.wallet_address === r.wallet) && <button className="btn sm2 mt8" onClick={() => follow(r)}>Follow {r.handle}</button>}</div>}</div>)}</div> :
      <Empty title="Requires configuration">No trader data yet. Apps like FOMO or pump.fun do not publish an open leaderboard API, so connect a data feed you have access to (TRADER_FEED_URL on your backend) or have an admin import traders. You can still follow any wallet by address.</Empty>}
    {d.notes.map((n) => <p key={n} className="fs11 dim px mt8" style={{ lineHeight: 1.5 }}>{n}</p>)}
    {form && <div className="scrim" onClick={() => setForm(null)}><div className="sheet" onClick={(e) => e.stopPropagation()}><div className="grab" /><b className="fs16">Follow a wallet</b><p className="fs12 mut">You'll get a notification for each swap it makes. Read-only: nothing is traded for you.</p>
      <div className="col g10 mt12"><select className="sel" value={form.chain} onChange={(e) => setForm({ ...form, chain: e.target.value })}><option value="solana">Solana (alerts supported)</option><option value="base">Base (saved, alerts need an indexer)</option><option value="ethereum">Ethereum (saved, alerts need an indexer)</option></select><input className="in mono" placeholder="Wallet address" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} /><input className="in" placeholder="Nickname (optional)" value={form.handle} onChange={(e) => setForm({ ...form, handle: e.target.value })} maxLength={60} /><button className="btn full" disabled={form.address.length < 26} onClick={addWallet}>Follow</button></div></div></div>}
  </>;
}

function Mine() {
  const st = useApi("/memecoin/strategy"); const ev = useApi("/memecoin/activity?limit=60", { poll: 20000 }); const [busy, setBusy] = useState(false); const [sel, setSel] = useState("");
  const run = async () => { setBusy(true); try { const r = await api("/memecoin/run", { method: "POST" }); toast(`Scanned ${r.scanned}: ${r.bought} bought, ${r.proposed} proposed, ${r.skipped} passed`); ev.reload(); } catch (e) { fail(e); } setBusy(false); };
  const events = (ev.data?.events || []).filter((e) => !sel || e.agent === sel); const s = st.data?.strategy;
  return <>
    <div className="px col g10">{AG.map(([k, n, ic, c, d]) => <button key={k} className="card row g12" style={{ textAlign: "left", outline: sel === k ? "2px solid " + c : "none" }} onClick={() => setSel(sel === k ? "" : k)}><span className="aic" style={{ width: 36, height: 36, background: "var(--card2)", color: c, borderRadius: 12 }}><Icon n={ic} /></span><div className="sp"><b>{n}</b><div className="fs12 mut" style={{ lineHeight: 1.4 }}>{d}</div></div><span className={cn("chip", s?.enabled ? "up" : "")}>{s?.enabled ? "running" : "paused"}</span></button>)}</div>
    <div className="px mt12 row g8"><button className="btn sp" disabled={busy || !s?.enabled} onClick={run}><Icon n="bolt" size={16} />{busy ? "Running…" : "Run agents now"}</button><button className="btn sec2" onClick={() => nav("/teach")}>Teach</button></div>
    {s && !s.enabled && <p className="fs12 mut px mt8">Switch the strategy on in Teach to run the agents.</p>}
    <div className="sec"><h2>{sel ? AG.find((a) => a[0] === sel)[1] + " log" : "Agent log"}</h2></div>
    {ev.loading ? <Skel n={5} h={44} /> : events.length ? events.map((e) => <div className="ev" key={e.id}><span className="ag" style={{ color: AG.find((a) => a[0] === e.agent)?.[3] }}>{e.agent}</span><div className="sp"><div>{e.message}</div><div className="fs11 dim mt4">{clock(e.created_at)}</div></div></div>) : <Empty title="Quiet so far">Run the agents to see what each one does.</Empty>}
  </>;
}

export default function Agents() { const [tab, setTab] = useState("mine"); return <><Header title="Agents" right={<button className="btn sec2 sm2" onClick={() => nav("/market")}>Market</button>} /><div className="px mb8"><Seg value={tab} set={setTab} opts={[["mine", "My agents"], ["traders", "Top traders"]]} /></div>{tab === "mine" ? <Mine /> : <Traders />}</>; }
