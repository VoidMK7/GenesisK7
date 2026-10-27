import { requireUser } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";
import Nav from "@/components/Nav";

export const dynamic = "force-dynamic";
type Sig = { id: string; symbol: string; timeframe: string; direction: string; strength: number; price: number; stop: number | null; target: number | null; context: string; sources: { title: string; url: string }[]; created_at: string };

export default async function SignalsPage() {
  const user = await requireUser();
  const { data } = await supabaseServer().from("signals").select("*").order("created_at", { ascending: false }).limit(60);
  const sigs = (data || []) as Sig[];
  return (
    <>
      <Nav user={user} />
      <main className="mx-auto max-w-3xl space-y-3 p-4">
        <h1 className="text-xl font-semibold">Signals</h1>
        <p className="text-xs text-slate-400">Rule-based (EMA trend, RSI, ATR levels), refreshed by a scheduled job. Not financial advice and not guaranteed to be profitable.</p>
        {sigs.length === 0 && <p className="text-sm text-slate-500">No signals yet. Set up the scheduled job (see README).</p>}
        {sigs.map((s) => (
          <div key={s.id} className="card text-sm">
            <div className="flex items-center justify-between">
              <div><b>{s.symbol}</b> <span className="text-xs text-slate-400">{s.timeframe}</span> <span className={`ml-2 font-semibold ${s.direction === "buy" ? "text-emerald-400" : s.direction === "sell" ? "text-red-400" : "text-slate-400"}`}>{s.direction.toUpperCase()}</span> <span className="text-xs text-slate-500">strength {s.strength}/3</span></div>
              <div className="text-xs text-slate-500">{new Date(s.created_at).toISOString().replace("T", " ").slice(0, 16)} UTC</div>
            </div>
            <div className="mt-1 text-xs text-slate-400">price {s.price}{s.stop && <> · stop {Number(s.stop).toFixed(4)} · target {Number(s.target).toFixed(4)}</>}</div>
            {s.context && <p className="mt-2 text-slate-300">{s.context}</p>}
            {s.sources?.length > 0 && <ul className="mt-1 text-xs">{s.sources.map((x) => <li key={x.url}><a className="text-sky-400 underline" href={x.url} target="_blank" rel="noopener noreferrer">{x.title}</a></li>)}</ul>}
          </div>
        ))}
      </main>
    </>
  );
}
