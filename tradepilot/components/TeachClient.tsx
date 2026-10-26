"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

type CardLite = { id: string; title: string; kind: string; notes: string; tags: string[]; filename?: string; createdAt: string };

export default function TeachClient({ cards }: { cards: CardLite[] }) {
  const router = useRouter();
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  async function upload(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    setBusy(true); setMsg("");
    const res = await fetch("/api/teach/upload", { method: "POST", body: new FormData(form) });
    const j = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setMsg(j.error || "Upload failed");
    form.reset(); setMsg("Saved to AI memory."); router.refresh();
  }
  async function remove(id: string) {
    if (!confirm("Delete this learning card?")) return;
    await fetch(`/api/teach/cards?id=${id}`, { method: "DELETE" });
    router.refresh();
  }

  return (
    <div className="space-y-6">
      <form onSubmit={upload} className="card space-y-3">
        <h2 className="font-semibold">Add a learning card</h2>
        <input name="title" required placeholder="Title (e.g. 'London session breakout setup')" className="input" />
        <textarea name="notes" rows={4} placeholder="What should the AI learn from this? Rules, entry/exit logic, risk notes..." className="input" />
        <input name="tags" placeholder="Tags, comma separated (btc, breakout, scalping)" className="input" />
        <input name="file" type="file" accept="video/*,image/*,.csv,.txt,.md,.json" className="text-sm" />
        <p className="text-xs text-slate-500">Text/CSV files are read into memory. Videos and images are stored, but their content is NOT yet analysed: put the key lessons in the notes.</p>
        <div className="flex items-center gap-3">
          <button className="btn" disabled={busy}>{busy ? "Uploading..." : "Save card"}</button>
          {msg && <span className="text-sm text-slate-300">{msg}</span>}
        </div>
      </form>

      <div className="space-y-2">
        <h2 className="font-semibold">Memory ({cards.length} cards)</h2>
        {cards.length === 0 && <p className="text-sm text-slate-500">Nothing yet.</p>}
        {cards.map((c) => (
          <div key={c.id} className="card flex items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="font-medium">{c.title} <span className="ml-2 rounded bg-slate-800 px-2 py-0.5 text-xs text-slate-400">{c.kind}</span></div>
              {c.notes && <p className="mt-1 line-clamp-3 text-sm text-slate-400">{c.notes}</p>}
              {c.tags.length > 0 && <p className="mt-1 text-xs text-emerald-400">#{c.tags.join(" #")}</p>}
            </div>
            <button className="btn-ghost shrink-0" onClick={() => remove(c.id)}>Delete</button>
          </div>
        ))}
      </div>
    </div>
  );
}
