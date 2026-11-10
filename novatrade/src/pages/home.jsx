import React, { useEffect, useMemo, useState } from "react";
import { api, ago, clock, cn, compact, fail, nav, pct, sign, toast, usd, useApi } from "../lib.jsx";
import { AreaChart, Brand, Empty, Icon, Logo, Notice, Ring, Sim, Skel } from "../ui.jsx";

export const Header = ({ title, back, right, brand }) => <div className="top">
  {back && <button className="ibtn" aria-label="Back" onClick={() => (history.length > 1 ? history.back() : nav("/"))}><Icon n="back" /></button>}
  {brand && <Brand />}<h1>{title}</h1><span className="sp" />{right}
</div>;

export function Bell() {
  const n = useApi("/notifications", { poll: 45000 }); const unread = (n.data?.notifications || []).filter((x) => !x.read).length;
  return <button className="ibtn" aria-label="Notifications" onClick={() => nav("/notifications")}><Icon n="bell" />{unread > 0 && <span className="dot" />}</button>;
}

const RANGES = [["1h", 3600e3], ["4h", 4 * 3600e3], ["1d", 864e5], ["1w", 7 * 864e5], ["all", Infinity]];
const verb = (t) => (t.side === "skip" ? "Passed on" : t.side === "buy" ? (t.status === "awaiting_approval" ? "Approve" : "Bought") : t.evidence?.exit_reason === "stop_loss" || t.evidence?.exit_reason === "trailing_stop" ? (Number(t.evidence?.pnl_usd) < 0 ? "Stopped" : "Sold") : "Sold");
const shortWhy = (r = "") => { const m = (re, f) => { const x = r.match(re); return x ? f(x) : null; };
  return m(/Liquidity \$([\d,]+)/, (x) => "liq $" + Math.round(Number(x[1].replace(/,/g, "")) / 1000) + "k") || m(/volume/i, () => "low volume") || m(/Only (\d+) min old/, (x) => x[1] + "m old") || m(/old, past/, () => "too old") || m(/Safety score (\d+)/, (x) => "safety " + x[1]) || m(/avoid/i, () => "your rule") || m(/Already holding/, () => "held") || r.split(/[.:]/)[0].slice(0, 18); };
const who = (t) => ({ scanner: "Scanner", analyst: "Analyst", executor: "Executor", risk: "Risk", copy: "Copy", user: "You" }[t.agent] || t.agent);

export function TradeRow({ t, onOpen }) {
  const pnl = t.evidence?.pnl_usd; const isSell = t.side === "sell";
  return <button className="item" onClick={() => onOpen(t)}>
    <Logo src={t.image_url} sym={t.symbol} badge={t.side === "buy" ? "var(--cyan)" : t.side === "sell" ? "var(--up)" : "var(--dim)"} />
    <div className="sp" style={{ minWidth: 0 }}><div className="t ell">{verb(t)} {t.symbol}</div><div className="u ell">{who(t)}{isSell && t.evidence?.exit_reason ? ` · ${String(t.evidence.exit_reason).replace("_", " ")}` : ""} · {clock(t.created_at)}</div></div>
    <div className="r">{isSell && pnl !== undefined ? <div className={cn("t", pnl >= 0 ? "up" : "dn")}>{sign(pnl)}</div> : <div className="t">{t.usd ? usd(t.usd) : t.side === "skip" ? <span className="dim">skipped</span> : "—"}</div>}
      <div className="u">{t.status === "awaiting_approval" ? "needs approval" : t.simulated ? "simulated" : "confirmed"}</div></div>
  </button>;
}

function AgentCards({ events, trades, positions }) {
  const scan = events.find((e) => e.agent === "scanner" && e.kind === "scan"); const pools = scan ? Number((scan.message.match(/Scanned (\d+)/) || [])[1] || 0) : null;
  const skips = trades.filter((t) => t.side === "skip").slice(0, 3); const lastDecision = trades.find((t) => t.side === "skip" || t.side === "buy");
  const open = positions.filter((p) => p.status === "open"); const today = trades.filter((t) => t.side !== "skip" && Date.now() - new Date(t.created_at) < 864e5);
  const score = lastDecision?.evidence?.safetyScore; const p0 = open[0];
  const cards = [
    <button key="s" className="acard" onClick={() => nav("/agents")}><div className="h"><span className="aic" style={{ background: "rgba(18,214,197,.15)", color: "var(--teal)" }}><Icon n="scan" size={13} /></span>Scanner</div><div className="s"><b>● {pools ?? "—"}</b> pools</div>
      <div className="col g6">{skips.length ? skips.map((t) => <div key={t.id} className="strike"><s>{t.symbol}</s><em>{shortWhy(t.reason)}</em></div>) : <div className="s">Waiting for the first scan</div>}</div></button>,
    <button key="a" className="acard" onClick={() => nav("/agents")}><div className="h"><span className="aic" style={{ background: "rgba(245,185,74,.15)", color: "var(--warn)" }}><Icon n="brain" size={13} /></span>Analyst</div><div className="s">● Scoring</div>
      <div className="row g10">{score !== undefined ? <Ring value={score} /> : <span className="ring"><b className="dim">–</b></span>}<div className="col g4"><b className="fs13">{lastDecision?.symbol || "—"}</b><span className="s">{lastDecision ? (lastDecision.side === "buy" ? "passed" : "skipped") : "no tokens yet"}</span></div></div></button>,
    <button key="e" className="acard" onClick={() => nav("/activity")}><div className="h"><span className="aic" style={{ background: "rgba(139,92,246,.18)", color: "#a78bfa" }}><Icon n="bolt" size={13} /></span>Executor</div><div className="s"><b>● {today.length}</b> trades today</div>
      {p0 ? <><div className="row g8"><Logo src={p0.image_url} sym={p0.symbol} size="sm" /><div><b className="fs12">{p0.symbol}</b><div className="s">{usd(p0.cost_usd, 0)} position</div></div></div><span className="pill">Simulated fills</span></> : <div className="s">No open positions</div>}</button>,
    <button key="r" className="acard" onClick={() => nav("/agents")}><div className="h"><span className="aic" style={{ background: "rgba(240,82,104,.15)", color: "var(--dn)" }}><Icon n="shield" size={13} /></span>Risk</div><div className="s">● {open.length} guarded</div>
      {p0 ? <><div className="row g8"><Logo src={p0.image_url} sym={p0.symbol} size="sm" /><div><b className="fs12">{p0.symbol}</b><div className="s">stop −{p0.stop_loss_pct}%</div></div></div><div className="row g6"><span className="chip dn mono">stop −{p0.stop_loss_pct}%</span><span className="chip up mono">trail {p0.trailing_stop_pct}%</span></div></> : <div className="s">Stops attach to every position</div>}</button>,
  ];
  const [i, setI] = useState(0);
  return <><div className="car" onScroll={(e) => setI(Math.round(e.currentTarget.scrollLeft / (e.currentTarget.clientWidth * .5)))}>{cards}</div><div className="dots">{[0, 1, 2, 3].map((k) => <i key={k} className={k === Math.min(3, i) ? "on" : ""} />)}</div></>;
}

export default function Home({ openTrade }) {
  const home = useApi("/home", { poll: 30000 }); const act = useApi("/memecoin/activity?limit=40", { poll: 30000 }); const tr = useApi("/memecoin/trades?limit=14", { poll: 30000 }); const pos = useApi("/memecoin/positions", { poll: 45000 });
  const [range, setRange] = useState("all"); const h = home.data;
  // While the app is open and the strategy is on, run one agent cycle every 2 minutes (the server rate-limits this and cron does the same when scheduled).
  useEffect(() => { if (!h?.enabled) return; let stop = false; const run = async () => { if (document.hidden || stop) return; try { await api("/memecoin/run", { method: "POST" }); home.reload(); act.reload(); tr.reload(); } catch { /* shown in Activity */ } }; const t = setInterval(run, 120000); return () => { stop = true; clearInterval(t); }; }, [h?.enabled]);
  const series = useMemo(() => { const lim = RANGES.find((r) => r[0] === range)[1]; return (h?.series || []).filter((p) => Date.now() - new Date(p.t) <= lim); }, [h, range]);
  const total = (h?.realisedUsd || 0) + (h?.unrealisedUsd || 0); const up = total >= 0;
  const noKey = home.error?.code === "requires_configuration";
  return <>
    <Header brand title="NovaTrade" right={<><button className="ibtn" aria-label="Market" onClick={() => nav("/market")}><Icon n="search" /></button><Bell /></>} />
    {noKey && <div className="px mb8"><Notice>This app is not connected to a backend yet. Add your Supabase URL and anon key at the top of <b>index.html</b>. You can still browse the live <a className="teal b" href="#/market">market</a>.</Notice></div>}
    {home.error && !noKey && <div className="px mb8"><Notice>{home.error.message}</Notice></div>}
    <div className="hero">
      <div className="row g8 fs12 mut mb8"><span className="chip warn">{h?.mode === "live_approval" ? "LIVE · APPROVAL" : h?.mode === "analysis" ? "ANALYSIS ONLY" : "PAPER"}</span><span>Simulated profit &amp; loss</span></div>
      <div className={cn("big", h && total !== 0 && (up ? "up" : "dn"))}>{home.loading ? "$—" : usd(total)}</div>
      <div className="row g8 wrap mt8"><span className="chip">Realised {sign(h?.realisedUsd || 0)}</span><span className="chip">Open {sign(h?.unrealisedUsd || 0)}</span>{h?.winRatePct !== null && h?.winRatePct !== undefined && <span className="chip up">{h.winRatePct.toFixed(0)}% wins · {h.closedCount} closed</span>}</div>
    </div>
    <AreaChart points={series} markers={h?.markers || []} up={up} />
    {h && !h.series?.length && !home.loading && <div className="px"><p className="fs12 mut tc" style={{ marginTop: -6 }}>{h.note || "No closed trades yet."}</p></div>}
    <div className="ranges"><span className="rg on" style={{ display: "inline-flex", gap: 6, alignItems: "center" }}><i style={{ width: 6, height: 6, borderRadius: 9, background: "var(--up)" }} />LIVE</span>{RANGES.map(([k]) => <button key={k} className={cn("rg", range === k && "on")} onClick={() => setRange(k)}>{k.toUpperCase()}</button>)}</div>

    {h && !h.enabled && <div className="px mt16"><div className="card"><div className="b">Your agents are off</div><p className="fs13 mut" style={{ margin: "6px 0 12px", lineHeight: 1.5 }}>Tell the AI how to trade in plain English, pick your limits, and switch it on. It starts in paper mode, so nothing real is traded.</p><button className="btn full" onClick={() => nav("/teach")}><Icon n="brain" size={18} />Set up your strategy</button></div></div>}

    <div className="sec"><h2>Agents</h2><small>{h?.enabled ? "4 running" : "paused"}</small></div>
    <AgentCards events={act.data?.events || []} trades={tr.data?.trades || []} positions={pos.data?.positions || []} />

    <div className="sec"><h2>Activity</h2><a href="#/activity">See all</a></div>
    {tr.loading ? <Skel n={4} h={56} /> : (tr.data?.trades || []).length ? <div className="list">{tr.data.trades.slice(0, 8).map((t) => <TradeRow key={t.id} t={t} onOpen={openTrade} />)}</div> : <Empty title="No decisions yet">When the agents run, every buy, sell and pass shows here with its reason.</Empty>}
    <div className="px mt16"><p className="fs11 dim" style={{ lineHeight: 1.5 }}>Paper results are modelled on market prices with assumed slippage and fees. They are not real trades and do not predict real results. Memecoins can lose all their value.</p></div>
  </>;
}
