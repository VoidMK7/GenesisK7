"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

export default function AuthForm() {
  const router = useRouter();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const f = new FormData(e.currentTarget);
    const res = await fetch(`/api/auth/${mode}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(Object.fromEntries(f)),
    });
    const j = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setError(j.error || "Something went wrong");
    router.push("/chat");
    router.refresh();
  }

  return (
    <form onSubmit={submit} className="card w-full max-w-sm space-y-3">
      <h1 className="text-xl font-semibold">{mode === "login" ? "Log in" : "Create account"}</h1>
      {mode === "register" && <input name="name" placeholder="Name" required className="input" />}
      <input name="email" type="email" placeholder="Email" required className="input" />
      <input name="password" type="password" placeholder="Password (min 8 chars)" minLength={8} required className="input" />
      {error && <p className="text-sm text-red-400">{error}</p>}
      <button className="btn w-full" disabled={busy}>{busy ? "..." : mode === "login" ? "Log in" : "Sign up"}</button>
      <button type="button" className="text-xs text-slate-400 underline" onClick={() => setMode(mode === "login" ? "register" : "login")}>
        {mode === "login" ? "Need an account? Sign up" : "Have an account? Log in"}
      </button>
    </form>
  );
}
