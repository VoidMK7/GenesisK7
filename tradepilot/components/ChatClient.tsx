"use client";
import { useState } from "react";

type Msg = { role: "user" | "ai"; text: string; img?: string; cards?: string[] };

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
    r.onload = () => {
      const url = String(r.result);
      setImage({ mediaType: f.type, data: url.split(",")[1], url });
    };
    r.readAsDataURL(f);
  }

  async function send(e: React.FormEvent) {
    e.preventDefault();
    if (busy || (!input.trim() && !image)) return;
    const mine: Msg = { role: "user", text: input, img: image?.url };
    setMsgs((m) => [...m, mine]);
    setBusy(true);
    const body = { message: input, image: image ? { mediaType: image.mediaType, data: image.data } : undefined };
    setInput(""); setImage(null);
    const res = await fetch("/api/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const j = await res.json().catch(() => ({}));
    setBusy(false);
    setMsgs((m) => [...m, { role: "ai", text: res.ok ? j.reply : `Error: ${j.error || "request failed"}`, cards: j.usedCards }]);
  }

  return (
    <div className="flex h-[calc(100vh-8rem)] flex-col">
      <div className="flex-1 space-y-3 overflow-y-auto pb-4">
        {msgs.length === 0 && <p className="text-sm text-slate-500">Ask about a market, or attach a chart screenshot for analysis. Educational analysis only, not financial advice.</p>}
        {msgs.map((m, i) => (
          <div key={i} className={`card max-w-[85%] whitespace-pre-wrap text-sm ${m.role === "user" ? "ml-auto bg-slate-800" : ""}`}>
            {m.img && <img src={m.img} alt="chart" className="mb-2 max-h-60 rounded" />}
            {m.text}
            {m.cards && m.cards.length > 0 && <div className="mt-2 text-xs text-emerald-400">Used taught knowledge: {m.cards.join(", ")}</div>}
          </div>
        ))}
        {busy && <p className="text-sm text-slate-500">Thinking...</p>}
      </div>
      <form onSubmit={send} className="flex items-center gap-2">
        <label className="btn-ghost cursor-pointer">{image ? "Image ✓" : "Chart"}<input type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={pick} /></label>
        <input value={input} onChange={(e) => setInput(e.target.value)} placeholder="Ask about the market..." className="input" />
        <button className="btn" disabled={busy}>Send</button>
      </form>
    </div>
  );
}
