"use client";
import { useState } from "react";
import Logo from "./Logo";

type Sim = { id: number; regime: string; outcome: "target" | "stop" | "timeout"; rMultiple: number; pnlPct: number; minutes: number; path: number[] };
type Summary = { results: Sim[]; targetHits: number; stopHits: number; timeouts: number; avgR: number; avgMinutesToExit: number; note: string };
type Setup = { symbol: string; side: "buy" | "sell"; entry: number; stop: number; target: number; horizonMinutes: number; interval: string };
type Msg = {
  role: "user" | "ai"; text: string; img?: string; cards?: string[]; sources?: { title: string; url: string }[];
  setup?: Setup | null; simulation?: Summary | null; warnings?: string[];
};

const COLOR = { target: "border-emerald-600 bg-emerald-950/40", stop: "border-red-700 bg-red-950/40", timeout: "border-slate-700 bg-slate-900" };
const fmtMin = (m: number) => (m >= 60 ? `${(m / 60).toFixed(1)}h` : `${Math.round(m)}m`);

function Spark({ path, outcome }: { path: number[]; outcome: string }) {
  const min = Math.min(...path), max = Math.max(...path), span = max - min || 1;
  const pts = path.map((v, i) => `${(i / Math.max(1, path.length - 1)) * 100},${30 - ((v - min) / span) * 28 - 1}`).join(" ");
  return <svg viewBox="0 0 100 30" className="h-8 w-full"><polyline fill="none" strokeWidth="1.5" stroke={outcome === "target" ? "#34d399" : outcome === "stop" ? "#f87171" : "#94a3b8"} points={pts} /></svg>;
}

function SimGrid({ s, setup }: { s: Summary; setup: Setup }) {
  const [risk, setRisk] = useState("0.5");
  const [note, setNote] = useState("");
  async function paper() {
    if (!confirm(`Open a PAPER ${setup.side.toUpperCase()} on ${setup.symbol} (stop ${setup.stop}, target ${setup.target}) risking ${risk}%?`)) return;
    const res = await fetch("/api/trades", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mode: "paper", symbol: setup.symbol, side: setup.side, stop: setup.stop, target: setup.target, riskPct: Number(risk), confirm: true }) });
    const j = await res.json().catch(() => ({}));
    setNote(res.ok ? "Paper trade opened. See the Trade page for the full step log." : `Not opened: ${j.error}`);
  }
  return (
    <div className="mt-3 space-y-2 rounded-xl border border-slate-800 bg-slate-900 p-3">
      <div className="text-xs text-slate-300">
        <b>{setup.side.toUpperCase()} {setup.symbol}</b> entry {setup.entry} · stop {setup.stop} · target {setup.target} · {fmtMin(setup.horizonMinutes)} window
      </div>
      <div className="text-xs text-slate-400">12 simulations: <span className="text-emerald-400">{s.targetHits} hit target</span> · <span className="text-red-400">{s.stopHits} hit stop</span> · {s.timeouts} unresolved · avg {s.avgR.toFixed(2)}R · avg {fmtMin(s.avgMinutesToExit)}</div>
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
        {s.results.map((r) => (
          <div key={r.id} className={`rounded border p-1.5 text-[11px] ${COLOR[r.outcome]}`}>
            <div className="flex justify-between"><span>#{r.id} {r.regime}</span><span>{r.rMultiple >= 0 ? "+" : ""}{r.rMultiple.toFixed(2)}R</span></div>
            <Spark path={r.path} outcome={r.outcome} />
            <div className="flex justify-between text-slate-400"><span>{r.outcome}</span><span>{fmtMin(r.minutes)}</span></div>
          </div>
        ))}
      </div>
      <p className="text-[11px] text-slate-500">{s.note}</p>
      <div className="flex flex-wrap items-center gap-2">
        <select value={risk} onChange={(e) => setRisk(e.target.value)} className="rounded border border-slate-700 bg-slate-950 px-2 py-1 text-xs">
          <option value="0.5">Low risk (0.5%)</option><option value="1">Medium (1%)</option><option value="2">High (2%)</option>
        </select>
        <button className="btn" onClick={paper}>Paper trade this</button>
        {note && <span className="text-xs text-slate-300">{note}</span>}
      </div>
    </div>
  );
}

const SUGGESTIONS = ["Analyse BTC on the 1-hour chart", "What is moving ETH today?", "How do breakout setups fail?"];

export default function ChatClient() {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [image, setImage] = useState<{ mediaType: string; data: string; url: string } | null>(null);
  const [busy, setBusy] = useState(false);

  function pick(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    if (f.size > 4 * 1024 * 1024) return alert("Image must be under 4MB");
    const r = new FileReader();
    r.onload = () => { const url = String(r.result); setImage({ mediaType: f.type, data: url.split(",")[1], url }); };
    r.readAsDataURL(f);
  }

  async function send(e?: React.FormEvent) {
    e?.preventDefault();
    if (busy || (!input.trim() && !image)) return;
    setMsgs((m) => [...m, { role: "user", text: input, img: image?.url }]);
    setBusy(true);
    const body = { message: input, image: image ? { mediaType: image.mediaType, data: image.data } : undefined };
    setInput(""); setImage(null);
    const res = await fetch("/api/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const j = await res.json().catch(() => ({}));
    setBusy(false);
    setMsgs((m) => [...m, res.ok
      ? { role: "ai", text: j.reply, cards: j.usedCards, sources: j.sources, setup: j.setup, simulation: j.simulation, warnings: j.warnings }
      : { role: "ai", text: `Something went wrong: ${j.error || "the request failed"}. Check your connection and try again.` }]);
  }

  return (
    <div className="flex h-[calc(100dvh-5.5rem)] flex-col">
      <div className="flex-1 space-y-6 overflow-y-auto pb-6 pt-4">
        {msgs.length === 0 && (
          <div className="flex h-full flex-col items-center justify-center gap-6 text-center">
            <h1 className="max-w-lg text-3xl md:text-4xl">What are we looking at today?</h1>
            <p className="max-w-md text-sm text-slate-400">Ask about a market or attach a chart. If a trade idea holds up, you will see twelve simulated outcomes before choosing to paper trade. Educational analysis, not financial advice.</p>
            <div className="flex flex-wrap justify-center gap-2">
              {SUGGESTIONS.map((s) => <button key={s} className="btn-ghost" onClick={() => setInput(s)}>{s}</button>)}
            </div>
          </div>
        )}
        {msgs.map((m, i) => m.role === "user" ? (
          <div key={i} className="ml-auto max-w-[85%] rounded-2xl bg-slate-800 px-4 py-2.5 text-[15px] whitespace-pre-wrap">
            {m.img && <img src={m.img} alt="Attached chart" className="mb-2 max-h-56 rounded-lg" />}
            {m.text}
          </div>
        ) : (
          <div key={i} className="flex gap-3">
            <div className="mt-1 shrink-0"><Logo size={24} /></div>
            <div className="prose-chat min-w-0 flex-1 whitespace-pre-wrap">
              {m.text}
              {m.setup && m.simulation && <SimGrid s={m.simulation} setup={m.setup} />}
              {m.sources && m.sources.length > 0 && (
                <div className="mt-3 text-xs">
                  <div className="mb-1 text-slate-400">Sources</div>
                  <ul className="space-y-0.5">{m.sources.map((s) => <li key={s.url}><a href={s.url} target="_blank" rel="noopener noreferrer" className="text-sky-400 underline underline-offset-2">{s.title}</a></li>)}</ul>
                </div>
              )}
              {m.cards && m.cards.length > 0 && <div className="mt-2 text-xs text-emerald-400">Used taught knowledge: {m.cards.join(", ")}</div>}
              {m.warnings && m.warnings.length > 0 && <div className="mt-2 text-xs text-amber-400">{m.warnings.join(" ")}</div>}
            </div>
          </div>
        ))}
        {busy && (
          <div className="flex items-center gap-3"><Logo size={24} /><div className="dots text-sm text-slate-400" role="status" aria-label="Analysing"><span /><span /><span /></div></div>
        )}
      </div>

      <form onSubmit={send} className="rounded-2xl border border-slate-700 bg-slate-900 p-2 shadow-sm focus-within:border-accent">
        {image && (
          <div className="relative mb-2 inline-block">
            <img src={image.url} alt="Chart to analyse" className="h-16 rounded-lg" />
            <button type="button" onClick={() => setImage(null)} aria-label="Remove image" className="absolute -right-2 -top-2 h-5 w-5 rounded-full bg-slate-100 text-xs leading-5 text-slate-950">×</button>
          </div>
        )}
        <div className="flex items-end gap-2">
          <label className="btn-ghost cursor-pointer" title="Attach a chart image">Attach<input type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={pick} /></label>
          <textarea
            value={input} rows={1} onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
            placeholder="Ask about a market or chart" aria-label="Message"
            className="max-h-40 min-h-[2.25rem] flex-1 resize-none bg-transparent px-2 py-1.5 text-[15px] outline-none placeholder:text-slate-500"
          />
          <button className="btn h-9 w-9 shrink-0 !p-0" disabled={busy} aria-label="Send">
            <svg viewBox="0 0 20 20" className="mx-auto h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10 16V4M5 9l5-5 5 5" /></svg>
          </button>
        </div>
      </form>
    </div>
  );
}
