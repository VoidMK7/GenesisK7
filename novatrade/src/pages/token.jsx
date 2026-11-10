import React, { useEffect, useState } from "react";
import { api, ago, compact, dexScan, fail, loadToken, nav, pct, price, sign, toast, usd, useApi, cn } from "../lib.jsx";
import { Empty, Icon, Logo, Notice, PriceChart, Ring, Seg, Sim, Skel } from "../ui.jsx";
import { Header } from "./home.jsx";

export function Market() {
  const [chain, setChain] = useState("solana"); const [s, set] = useState({ loading: true });
  useEffect(() => { let on = true; set({ loading: true }); dexScan([chain]).then((r) => on && set(r)).catch((e) => on && set({ error: e.message })); return () => { on = false; }; }, [chain]);
  return <>
    <Header title="Market" back right={<span className="chip teal">LIVE DATA</span>} />
    <div className="px"><Seg value={chain} set={setChain} opts={[["solana", "Solana"], ["base", "Base"], ["ethereum", "Ethereum"], ["bsc", "BNB"]]} /></div>
    <p className="fs12 mut px mt8" style={{ lineHeight: 1.5 }}>Newly listed and boosted tokens with their real trading data from DexScreener. The safety score is a market-data heuristic, not a contract audit.</p>
    {s.loading ? <div className="mt12"><Skel n={6} h={60} /></div> : s.error ? <div className="px mt12"><Notice>Could not load market data: {s.error}. Some networks or ad-blockers block the data provider.</Notice></div> : !s.tokens.length ? (s.errors?.length ? <div className="px mt12"><Notice>Could not reach the market data provider (DexScreener). Your network, an ad-blocker or a regional block may be stopping it. Try again in a moment.</Notice></div> : <Empty title="No tokens returned">Nothing new matched on this network right now.</Empty>) :
      <div className="list mt8">{s.tokens.slice(0, 40).map((p) => <button key={p.chain + p.tokenAddress} className="item" onClick={() => nav(`/token?chain=${p.chain}&address=${encodeURIComponent(p.tokenAddress)}`)}>
        <Logo src={p.imageUrl} sym={p.symbol} /><div className="sp" style={{ minWidth: 0 }}><div className="t ell">{p.symbol}</div><div className="u ell">{p.dex} · liq {compact(p.liquidityUsd)} · {p.ageMinutes !== undefined ? (p.ageMinutes < 120 ? p.ageMinutes + "m" : Math.round(p.ageMinutes / 60) + "h") + " old" : "age ?"}</div></div>
        <div className="r"><div className="t">{price(p.priceUsd)}</div><div className={cn("u", (p.change.h24 ?? 0) >= 0 ? "up" : "dn")}>{p.change.h24 !== undefined ? pct(p.change.h24, 0) : "—"}</div></div><Ring value={p.safety.score} size={34} /></button>)}</div>}
  </>;
}

export default function Token({ q }) {
  const [s, set] = useState({ loading: true }); const [busy, setBusy] = useState(false);
  const load = () => loadToken(q.chain || "solana", q.address).then((d) => set({ d })).catch((e) => set({ error: e }));
  useEffect(() => { set({ loading: true }); load(); }, [q.chain, q.address]);
  if (s.loading) return <><Header back title="Token" /><Skel n={4} h={90} /></>;
  if (s.error) return <><Header back title="Token" /><Empty title="Could not load this token">{s.error.message}</Empty></>;
  const { pair: p, safety, position: pos, log, contractFacts } = s.d; const up = (p.change.h24 ?? 0) >= 0;
  const close = async () => { setBusy(true); try { const r = await api(`/memecoin/positions/${pos.id}/close`, { method: "POST" }); toast(`Closed (simulated): ${sign(r.pnlUsd)}`); load(); } catch (e) { fail(e); } setBusy(false); };
  return <>
    <Header back title={p.symbol} right={p.url && <a className="ibtn" href={p.url} target="_blank" rel="noopener noreferrer" aria-label="Open on DexScreener"><Icon n="globe" /></a>} />
    <div className="px row g12"><Logo src={p.imageUrl} sym={p.symbol} size="xl" /><div className="sp" style={{ minWidth: 0 }}><div className="fs12 mut ell">{p.name} · {p.dex}</div><div className="bb" style={{ fontSize: 30, letterSpacing: "-.02em" }}>{price(p.priceUsd)}</div><span className={cn("chip", up ? "up" : "dn")}>{pct(p.change.h24 ?? 0)} 24h</span></div></div>
    <PriceChart pair={p} pos={pos} />
    <p className="fs11 dim px" style={{ marginTop: -2 }}>Outline drawn from the provider's 5m / 1h / 6h / 24h changes. {pos && "Dashed cyan = entry, red = current stop line."}</p>
    {pos && <div className="px mt12"><div className="card"><div className="row"><b className="sp">Your position</b><Sim /></div>
      <div className="pgrid mt8"><div className="stat"><div className="lbl">Entry</div><div className="v mono">{price(Number(pos.entry_price))}</div></div><div className="stat"><div className="lbl">Stop line now</div><div className="v mono dn">{price(pos.stopLine)}</div></div><div className="stat"><div className="lbl">Size</div><div className="v">{usd(Number(pos.cost_usd))}</div></div><div className="stat"><div className="lbl">Now</div><div className={cn("v", p.priceUsd >= Number(pos.entry_price) ? "up" : "dn")}>{pct((p.priceUsd / Number(pos.entry_price) - 1) * 100)}</div></div></div>
      <p className="fs12 mut mt8" style={{ lineHeight: 1.5 }}>Hard stop −{pos.stop_loss_pct}% · trailing {pos.trailing_stop_pct}% from peak · take profit +{pos.take_profit_pct}%</p>
      <button className="btn dn full mt12" disabled={busy} onClick={close}>Close position (simulated)</button></div></div>}
    <div className="sec"><h2>Market</h2></div>
    <div className="px"><div className="pgrid">{[["Liquidity", compact(p.liquidityUsd)], ["24h volume", compact(p.volume24hUsd)], ["Valuation", compact(p.fdvUsd)], ["Age", p.ageMinutes === undefined ? "—" : p.ageMinutes < 120 ? p.ageMinutes + " min" : Math.round(p.ageMinutes / 60) + " h"], ["Buys / sells 24h", `${p.buys24h} / ${p.sells24h}`], ["1h change", p.change.h1 === undefined ? "—" : pct(p.change.h1)]].map(([l, v]) => <div className="stat" key={l}><div className="lbl">{l}</div><div className="v">{v}</div></div>)}</div></div>
    <div className="sec"><h2>Safety</h2><small>heuristic</small></div>
    <div className="px"><div className="card"><div className="row g12"><Ring value={safety.score} size={64} /><div><div className="b">{safety.grade[0].toUpperCase() + safety.grade.slice(1)} risk</div><div className="fs12 mut">Higher is cleaner. Never a guarantee.</div></div></div>
      {safety.flags.length ? <div className="mt12 col g6">{safety.flags.map((f) => <div key={f} className="fs13 row g8"><Icon n="warn" size={15} style={{ color: "var(--warn)", flex: "none" }} />{f}</div>)}</div> : <p className="fs13 up mt12">Nothing alarming in the trading data.</p>}
      <div className="kv mt12"><span>Checked</span><span className="fs12" style={{ textAlign: "right" }}>{safety.checked.join(", ")}</span></div>
      {safety.notChecked.length > 0 && <div className="note mt8"><Icon n="eye" size={18} style={{ flex: "none" }} /><div>Not checked: {safety.notChecked.join(", ")}. Use a contract scanner before trusting any token.</div></div>}</div></div>
    {s.d.direct && <div className="px mt12"><Notice info>Sign in to see your position, history and trade log for this token.</Notice></div>}
    {log?.length > 0 && <><div className="sec"><h2>Your trades here</h2></div><div className="list">{log.map((t) => <div key={t.id} className="item"><div className="sp"><div className="t">{t.side === "buy" ? "Bought" : t.side === "sell" ? "Sold" : "Passed"} · {t.agent}</div><div className="u" style={{ lineHeight: 1.45 }}>{t.reason}</div></div><div className="r u">{ago(t.created_at)}</div></div>)}</div></>}
    <div className="px mt16"><div className="mono fs11 dim" style={{ wordBreak: "break-all" }}>{p.tokenAddress}</div></div>
  </>;
}
