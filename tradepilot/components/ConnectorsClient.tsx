"use client";
import { useEffect, useState } from "react";

type Conn = { id: string; label: string; testnet: boolean; exchange: string; created_at: string };

export default function ConnectorsClient() {
  const [conns, setConns] = useState<Conn[]>([]);
  const [msg, setMsg] = useState("");
  const load = () => fetch("/api/connections").then((r) => r.json()).then((j) => setConns(j.connections || []));
  useEffect(() => { load(); }, []);

  async function add(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    const res = await fetch("/api/connections", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ label: f.get("label"), apiKey: f.get("apiKey"), apiSecret: f.get("apiSecret"), testnet: f.get("testnet") === "on" }) });
    const j = await res.json();
    setMsg(res.ok ? "Connected. Key verified and stored encrypted." : j.error);
    if (res.ok) form.reset();
    load();
  }
  async function remove(id: string) {
    if (!confirm("Remove this connection?")) return;
    await fetch(`/api/connections?id=${id}`, { method: "DELETE" }); load();
  }

  return (
    <div className="space-y-6">
      <form onSubmit={add} className="card space-y-2">
        <h2 className="font-semibold">Connect Binance (spot)</h2>
        <p className="text-xs text-slate-400">Create an API key with <b>Enable Spot &amp; Margin Trading</b> only. Never enable withdrawals (keys that can withdraw are rejected). Start with a testnet key from testnet.binance.vision.</p>
        <input name="label" placeholder="Label (e.g. Testnet)" className="input" />
        <input name="apiKey" placeholder="API key" required autoComplete="off" className="input" />
        <input name="apiSecret" type="password" placeholder="API secret" required autoComplete="off" className="input" />
        <label className="flex items-center gap-2 text-sm"><input name="testnet" type="checkbox" defaultChecked /> Testnet (no real money)</label>
        <button className="btn">Verify &amp; connect</button>
        {msg && <p className="text-sm text-slate-300">{msg}</p>}
      </form>
      <div className="space-y-2">
        <h2 className="font-semibold">Connections</h2>
        {conns.length === 0 && <p className="text-sm text-slate-500">None yet. Paper trading works without one.</p>}
        {conns.map((c) => (
          <div key={c.id} className="card flex items-center justify-between text-sm">
            <div>{c.label || "Binance"} <span className={`ml-2 rounded px-1.5 py-0.5 text-xs ${c.testnet ? "bg-slate-800" : "bg-red-900"}`}>{c.testnet ? "testnet" : "LIVE"}</span></div>
            <button className="btn-ghost" onClick={() => remove(c.id)}>Remove</button>
          </div>
        ))}
      </div>
    </div>
  );
}
