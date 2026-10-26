"use client";
import { useCallback, useEffect, useState } from "react";

type Trade = { id: string; mode: string; symbol: string; side: string; qty: number; entry: number; stop: number; target: number; risk_pct: number; status: string; exit_price: number | null; pnl: number | null; close_reason: string | null; steps: { at: string; msg: string }[]; opened_at: string; strategy_id: string | null };
type Settings = { max_risk_pct: number; max_open_trades: number; daily_loss_limit_pct: number; paper_balance: number; live_enabled: boolean };
type Conn = { id: string; label: string; testnet: boolean };
type Strat = { id: string; name: string; description: string };
const post = (u: string, b: unknown, method = "POST") => fetch(u, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(b) });

export default function TradeClient() {
  const [trades, setTrades] = useState<Trade[]>([]);
  const [stats, setStats] = useState<{ open: number; closed: number; winRate: number | null; totalPnl: number } | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [conns, setConns] = useState<Conn[]>([]);
  const [strats, setStrats] = useState<Strat[]>([]);
  const [msg, setMsg] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [t, r, c, s] = await Promise.all(["/api/trades", "/api/risk", "/api/connections", "/api/strategies"].map((u) => fetch(u).then((x) => x.json())));
    setTrades(t.trades || []); setStats(t.stats || null); setSettings(r.settings || null); setConns(c.connections || []); setStrats(s.strategies || []);
    if (t.errors?.length) setMsg(`Sync issues: ${t.errors.join("; ")}`);
  }, []);
  useEffect(() => { load(); }, [load]);

  async function saveRisk(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.currentTarget));
    const res = await post("/api/risk", { ...f, live_enabled: (e.currentTarget.elements.namedItem("live_enabled") as HTMLInputElement).checked }, "PUT");
    setMsg(res.ok ? "Risk settings saved" : (await res.json()).error); load();
  }
  async function open(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>;
    const live = f.mode === "live";
    if (!confirm(`${live ? "LIVE order on your exchange account. " : "Paper trade. "}${f.side.toUpperCase()} ${f.symbol} stop ${f.stop} target ${f.target}, risk ${f.riskPct}%. Confirm?`)) return;
    const res = await post("/api/trades", { ...f, symbol: f.symbol.toUpperCase(), stop: +f.stop, target: +f.target, riskPct: +f.riskPct, connectionId: f.connectionId || null, strategyId: f.strategyId || null, confirm: true });
    const j = await res.json(); setMsg(res.ok ? "Trade opened" : `Not opened: ${j.error}`); load();
  }
  async function close(id: string) {
    if (!confirm("Close this trade at market?")) return;
    const res = await post("/api/trades/close", { id }); const j = await res.json();
    setMsg(res.ok ? "Trade closed" : `Error: ${j.error}`); load();
  }
  async function addStrat(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault(); const form = e.currentTarget;
    await post("/api/strategies", Object.fromEntries(new FormData(form))); form.reset(); load();
  }

  const byStrat = strats.map((s) => {
    const c = trades.filter((t) => t.strategy_id === s.id && t.status === "closed");
    return { ...s, n: c.length, wins: c.filter((t) => Number(t.pnl) > 0).length, pnl: c.reduce((a, t) => a + Number(t.pnl || 0), 0) };
  });

  return (
    <div className="space-y-6">
      {msg && <div className="card text-sm">{msg}</div>}
      {stats && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {[["Open", stats.open], ["Closed", stats.closed], ["Win rate", stats.winRate === null ? "-" : `${Math.round(stats.winRate * 100)}%`], ["Total P/L", stats.totalPnl.toFixed(2)]].map(([l, v]) => (
            <div key={String(l)} className="card"><div className="text-xs text-slate-400">{l}</div><div className="text-xl font-semibold">{v}</div></div>
          ))}
        </div>
      )}

      <form onSubmit={open} className="card grid gap-2 md:grid-cols-4">
        <h2 className="font-semibold md:col-span-4">Open a trade</h2>
        <input name="symbol" placeholder="BTCUSDT" required className="input" />
        <select name="side" className="input"><option value="buy">Buy</option><option value="sell">Sell (paper only)</option></select>
        <input name="stop" type="number" step="any" placeholder="Stop price" required className="input" />
        <input name="target" type="number" step="any" placeholder="Target price" required className="input" />
        <select name="riskPct" className="input" defaultValue="0.5"><option value="0.5">Low risk 0.5%</option><option value="1">Medium 1%</option><option value="2">High 2%</option></select>
        <select name="mode" className="input"><option value="paper">Paper (simulated)</option><option value="live">Exchange connection</option></select>
        <select name="connectionId" className="input"><option value="">Connection (for exchange mode)</option>{conns.map((c) => <option key={c.id} value={c.id}>{c.label || "Binance"} {c.testnet ? "(testnet)" : "(LIVE)"}</option>)}</select>
        <select name="strategyId" className="input"><option value="">No strategy</option>{strats.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
        <button className="btn md:col-span-4">Review &amp; open</button>
      </form>

      <div className="space-y-2">
        <h2 className="font-semibold">Trades</h2>
        {trades.length === 0 && <p className="text-sm text-slate-500">No trades yet.</p>}
        {trades.map((t) => (
          <div key={t.id} className="card text-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div><b>{t.side.toUpperCase()} {t.symbol}</b> <span className="ml-1 rounded bg-slate-800 px-1.5 py-0.5 text-xs">{t.mode}</span> <span className="ml-1 text-xs text-slate-400">{t.status}</span></div>
              <div className="text-xs text-slate-400">entry {t.entry} · stop {t.stop} · target {t.target} · qty {Number(t.qty).toPrecision(5)}{t.pnl !== null && <> · <span className={Number(t.pnl) >= 0 ? "text-emerald-400" : "text-red-400"}>P/L {Number(t.pnl).toFixed(2)} ({t.close_reason})</span></>}</div>
              <div className="flex gap-2">
                <button className="btn-ghost" onClick={() => setOpenId(openId === t.id ? null : t.id)}>{openId === t.id ? "Hide steps" : "Steps"}</button>
                {t.status === "open" && <button className="btn-ghost" onClick={() => close(t.id)}>Close</button>}
              </div>
            </div>
            {openId === t.id && <ol className="mt-3 list-decimal space-y-0.5 pl-5 text-xs text-slate-300">{t.steps.map((s, i) => <li key={i}><span className="text-slate-500">{s.at.slice(11, 19)}</span> {s.msg}</li>)}</ol>}
          </div>
        ))}
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {settings && (
          <form onSubmit={saveRisk} className="card space-y-2 text-sm">
            <h2 className="font-semibold">Risk limits (enforced on every trade)</h2>
            <label className="block">Max risk per trade % <input name="max_risk_pct" type="number" step="0.1" defaultValue={settings.max_risk_pct} className="input mt-1" /></label>
            <label className="block">Max open trades <input name="max_open_trades" type="number" defaultValue={settings.max_open_trades} className="input mt-1" /></label>
            <label className="block">Daily loss limit % <input name="daily_loss_limit_pct" type="number" step="0.5" defaultValue={settings.daily_loss_limit_pct} className="input mt-1" /></label>
            <label className="block">Paper starting balance <input name="paper_balance" type="number" defaultValue={settings.paper_balance} className="input mt-1" /></label>
            <label className="flex items-center gap-2"><input name="live_enabled" type="checkbox" defaultChecked={settings.live_enabled} /> Allow real-money (non-testnet) trading</label>
            <button className="btn">Save</button>
          </form>
        )}
        <div className="card space-y-3 text-sm">
          <h2 className="font-semibold">Strategies</h2>
          <form onSubmit={addStrat} className="space-y-2">
            <input name="name" placeholder="Name" required className="input" />
            <textarea name="description" rows={2} placeholder="Rules / notes" className="input" />
            <button className="btn">Add strategy</button>
          </form>
          {byStrat.map((s) => (
            <div key={s.id} className="flex items-start justify-between gap-2 border-t border-slate-800 pt-2">
              <div><b>{s.name}</b><div className="text-xs text-slate-400">{s.n} closed · {s.n ? Math.round((s.wins / s.n) * 100) : 0}% win · P/L {s.pnl.toFixed(2)}</div></div>
              <button className="btn-ghost" onClick={async () => { await fetch(`/api/strategies?id=${s.id}`, { method: "DELETE" }); load(); }}>Delete</button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
