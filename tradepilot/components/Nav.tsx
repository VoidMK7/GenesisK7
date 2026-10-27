import Link from "next/link";
import type { User } from "@/lib/db";

export default function Nav({ user }: { user: User }) {
  return (
    <header className="border-b border-slate-800 bg-slate-900/60">
      <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
        <div className="flex items-center gap-5 text-sm">
          <span className="font-semibold text-emerald-400">TradePilot AI</span>
          <Link href="/chat" className="hover:text-emerald-300">Chat</Link>
          <Link href="/trade" className="hover:text-emerald-300">Trade</Link>
          <Link href="/signals" className="hover:text-emerald-300">Signals</Link>
          <Link href="/connectors" className="hover:text-emerald-300">Connectors</Link>
          {(user.role === "teacher" || user.role === "admin") && (
            <Link href="/teach" className="hover:text-emerald-300">Teaching</Link>
          )}
          {user.role === "admin" && (
            <Link href="/admin" className="hover:text-emerald-300">Admin</Link>
          )}
        </div>
        <div className="flex items-center gap-3 text-xs text-slate-400">
          <span>{user.email} · {user.role}</span>
          <form action="/api/auth/logout" method="post">
            <button className="btn-ghost">Log out</button>
          </form>
        </div>
      </div>
    </header>
  );
}
