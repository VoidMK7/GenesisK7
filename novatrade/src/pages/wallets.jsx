import React, { useState } from "react";
import { api, ago, cn, compact, fail, nav, short, toast, usd, useApi } from "../lib.jsx";
import { Empty, Icon, Logo, Notice, Seg, Sheet, Skel, Toggle } from "../ui.jsx";
import { Header } from "./home.jsx";

const CHAINS = [["solana", "Solana"], ["base", "Base"], ["ethereum", "Ethereum"], ["bsc", "BNB Chain"]];
const EVM = { "0x1": "ethereum", "0x2105": "base", "0x38": "bsc" };

/** Connects by READING an address from the browser wallet. No signature, transaction or approval is ever requested. */
export function ConnectSheet({ onClose, onDone, kind = "own" }) {
  const [chain, setChain] = useState("solana"); const [addr, setAddr] = useState(""); const [label, setLabel] = useState(""); const [busy, setBusy] = useState(false);
  const grab = async () => { try {
    if (chain === "solana") { const w = window.phantom?.solana || window.solflare || window.solana; if (!w?.connect) throw new Error("No Solana wallet found in this browser. Paste the address instead."); const r = await w.connect(); setAddr((r.publicKey || w.publicKey).toString()); }
    else { if (!window.ethereum?.request) throw new Error("No browser wallet found. Paste the address instead."); const [a] = await window.ethereum.request({ method: "eth_requestAccounts" }); const id = await window.ethereum.request({ method: "eth_chainId" }); setAddr(a); if (EVM[id] && EVM[id] !== chain) setChain(EVM[id]); }
  } catch (e) { fail(e); } };
  const save = async () => { setBusy(true); try { const r = await api("/wallets", { method: "POST", body: { chain, address: addr.trim(), label: label || undefined, kind } }); toast("Wallet added (read-only)"); onDone(r.wallet); } catch (e) { fail(e); } setBusy(false); };
  return <Sheet onClose={onClose} title="Connect wallet">
    <div className="row" style={{ justifyContent: "center", gap: 10 }}><span className="brand" style={{ width: 52, height: 52, borderRadius: 16 }}><Icon n="spark" size={26} style={{ color: "var(--teal)" }} /></span><span className="dim">• • •</span><span className="brand" style={{ width: 52, height: 52, borderRadius: 16, background: "var(--card2)" }}><Icon n="wallet" size={26} /></span></div>
    <div className="tc mt12"><b className="fs18">{kind === "tracked" ? "Track a wallet" : "Connect wallet"}</b><div className="fs13 mut mt4">{kind === "tracked" ? "Watch another wallet's activity." : "NovaTrade wants to read your wallet."}</div></div>
    <div className="card mt12" style={{ background: "var(--card2)" }}><div className="kv"><span>network</span><span className="mono">{CHAINS.find((c) => c[0] === chain)[1]}</span></div></div>
    <div className="col g8 mt12 fs14"><div className="row g10"><Icon n="check" size={16} style={{ color: "var(--up)" }} />view balance and activity</div><div className="row g10"><Icon n="check" size={16} style={{ color: "var(--up)" }} />you approve every real trade</div><div className="row g10"><Icon n="x" size={16} style={{ color: "var(--dn)" }} />can't move funds on its own</div></div>
    <div className="mt12"><Seg value={chain} set={setChain} opts={CHAINS} /></div>
    <div className="col g8 mt12">{kind === "own" && <button className="btn sec2 full" onClick={grab}><Icon n="link" size={16} />Read address from my browser wallet</button>}<input className="in mono" placeholder="…or paste a public address" value={addr} onChange={(e) => setAddr(e.target.value)} /><input className="in" placeholder="Label (optional)" value={label} onChange={(e) => setLabel(e.target.value)} maxLength={40} /></div>
    <button className="btn full mt12" style={{ background: "#F5821F", color: "#fff" }} disabled={busy || addr.trim().length < 26} onClick={save}>{busy ? "Adding…" : "Connect"}</button>
    <p className="fs11 dim tc mt8" style={{ lineHeight: 1.5 }}>Only the public address is stored. NovaTrade never asks for a seed phrase, private key, signature or spending approval.</p></Sheet>;
}

function WalletCard({ w, reload }) {
  const [busy, setBusy] = useState(false); const a = w.allocation || { enabled: false, mode: "percent", percent: 10, max_open_positions: 5 }; const [al, setAl] = useState(a); const snap = w.snapshot;
  const bal = snap?.total_usd === null || snap?.total_usd === undefined ? null : Number(snap.total_usd);
  const budget = !al.enabled || bal === null ? 0 : al.mode === "percent" ? bal * (Number(al.percent) || 0) / 100 : Math.min(bal, Number(al.amount_usd) || 0);
  const refresh = async () => { setBusy(true); try { const r = await api(`/wallets/${w.id}/refresh`, { method: "POST" }); if (r.note) toast(r.note); reload(); } catch (e) { fail(e); } setBusy(false); };
  const saveAl = async (next) => { setAl(next); try { await api(`/wallets/${w.id}/allocation`, { method: "PUT", body: { enabled: next.enabled, mode: next.mode, percent: Number(next.percent) || 0, amount_usd: Number(next.amount_usd) || 0, max_per_trade_usd: next.max_per_trade_usd ? Number(next.max_per_trade_usd) : undefined, max_open_positions: Number(next.max_open_positions) || 5, copy_buy_usd: next.copy_buy_usd ? Number(next.copy_buy_usd) : undefined, copy_sells: next.copy_sells ?? true } }); } catch (e) { fail(e); } };
  const del = async () => { if (!confirm("Remove this wallet from NovaTrade? Nothing happens to the wallet itself.")) return; try { await api("/wallets", { method: "DELETE", body: { id: w.id } }); reload(); } catch (e) { fail(e); } };
  return <div className="card"><div className="row g10"><span className="brand" style={{ width: 38, height: 38, borderRadius: 12, background: "var(--card2)" }}><Icon n="wallet" size={18} /></span><div className="sp" style={{ minWidth: 0 }}><b className="ell">{w.label || (w.kind === "tracked" ? "Tracked wallet" : "My wallet")}</b><div className="fs12 mut mono ell">{w.chain} · {short(w.address)} <span className="tag">{w.kind}</span></div></div><button className="ibtn" aria-label="Remove wallet" onClick={del}><Icon n="trash" size={17} /></button></div>
    <div className="row mt12"><div className="sp"><div className="lbl">Balance</div>{snap ? <><div className="bb" style={{ fontSize: 26 }}>{bal === null ? <span className="fs16 mut">price unavailable</span> : usd(bal)}</div><div className="fs12 mut">{Number(snap.native_balance).toFixed(4)} {snap.native_symbol} · read {ago(snap.taken_at)} ago</div></> : <div className="fs13 mut mt4">Not read yet</div>}</div><button className="btn sec2 sm2" disabled={busy} onClick={refresh}>{busy ? "Reading…" : snap ? "Refresh" : "Read balance"}</button></div>
    {snap?.tokens?.length > 0 && <div className="mt8">{snap.tokens.slice(0, 4).map((t) => <div key={t.mint} className="kv"><span className="mono">{t.symbol}</span><span>{t.usd === null ? <span className="dim">unpriced</span> : usd(t.usd)}</span></div>)}{snap.tokens.length > 4 && <div className="fs11 dim">+{snap.tokens.length - 4} more</div>}{snap.unpriced > 0 && <div className="fs11 warn mt4">{snap.unpriced} token(s) have no market price and are not in the total.</div>}</div>}
    <div className="mt12" style={{ borderTop: "1px solid var(--line)", paddingTop: 12 }}>
      <div className="row"><div className="sp"><b className="fs14">{w.kind === "tracked" ? "Copy this wallet" : "Let the AI use this wallet"}</b><div className="fs12 mut">{w.kind === "tracked" ? "Mirror its buys and sells on paper." : "How much of the balance the agents may deploy."}</div></div><Toggle on={al.enabled} set={(v) => saveAl({ ...al, enabled: v })} label="Allow" /></div>
      {al.enabled && (w.kind === "tracked" ? <div className="pgrid mt12"><label className="col g4"><span className="lbl">$ per mirrored buy</span><input className="in" type="number" defaultValue={al.copy_buy_usd ?? 25} onBlur={(e) => saveAl({ ...al, copy_buy_usd: e.target.value })} /></label><label className="col g4"><span className="lbl">Mirror sells</span><div style={{ paddingTop: 8 }}><Toggle on={al.copy_sells ?? true} set={(v) => saveAl({ ...al, copy_sells: v })} label="Mirror sells" /></div></label></div> : <>
        <div className="mt12"><Seg value={al.mode} set={(m) => saveAl({ ...al, mode: m })} opts={[["percent", "% of balance"], ["fixed", "Fixed $"]]} /></div>
        {al.mode === "percent" ? <div className="mt12"><div className="row fs13"><span className="mut sp">Use</span><b>{al.percent ?? 0}%</b></div><input type="range" min="0" max="100" step="1" value={al.percent ?? 0} style={{ width: "100%", accentColor: "var(--teal)" }} onChange={(e) => setAl({ ...al, percent: e.target.value })} onPointerUp={() => saveAl(al)} onKeyUp={() => saveAl(al)} /></div> : <label className="col g4 mt12"><span className="lbl">Amount in USD</span><input className="in" type="number" defaultValue={al.amount_usd ?? 100} onBlur={(e) => saveAl({ ...al, amount_usd: e.target.value })} /></label>}
        <div className="stat mt12"><div className="lbl">Available to the AI</div><div className="v">{bal === null ? "Read the balance first" : usd(budget)}</div></div>
        <div className="pgrid mt12"><label className="col g4"><span className="lbl">Max per trade $</span><input className="in" type="number" defaultValue={al.max_per_trade_usd ?? ""} placeholder="no cap" onBlur={(e) => saveAl({ ...al, max_per_trade_usd: e.target.value })} /></label><label className="col g4"><span className="lbl">Max open</span><input className="in" type="number" defaultValue={al.max_open_positions ?? 5} onBlur={(e) => saveAl({ ...al, max_open_positions: e.target.value })} /></label></div></>)}
      {w.kind === "own" && <button className="btn ghost full mt12" onClick={() => nav("/teach?tab=chat")}><Icon n="brain" size={16} />Tell the AI what you want</button>}</div></div>;
}

export default function Wallets() {
  const w = useApi("/wallets"); const [add, setAdd] = useState(null);
  return <><Header back title="Wallets" right={<button className="btn sm2" onClick={() => setAdd("own")}><Icon n="plus" size={15} />Connect</button>} />
    <div className="px"><Notice info>Wallets are <b>read-only</b>: balance and activity only. The allocation below limits what the agents may use on paper or ask you to approve; it never gives anyone spending rights.</Notice></div>
    <div className="px mt12">{w.loading ? <Skel n={2} h={160} /> : w.error ? <Empty title="Not available">{w.error.message}</Empty> : w.data.wallets.length ? w.data.wallets.map((x) => <WalletCard key={x.id} w={x} reload={w.reload} />) : <Empty title="No wallets yet" action={<button className="btn" onClick={() => setAdd("own")}>Connect a wallet</button>}>Add one to see its balance and decide how much the AI may use.</Empty>}</div>
    {w.data && w.data.wallets.length > 0 && <div className="px mt12"><button className="btn ghost full" onClick={() => setAdd("tracked")}>Track someone else's wallet</button></div>}
    {add && <ConnectSheet kind={add} onClose={() => setAdd(null)} onDone={() => { setAdd(null); w.reload(); }} />}</>;
}
