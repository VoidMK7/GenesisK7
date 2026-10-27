import Link from "next/link";
import type { User } from "@/lib/db";
import Logo from "./Logo";

export default function Nav({ user }: { user: User }) {
  const link = "whitespace-nowrap rounded-lg px-3 py-1.5 text-sm text-slate-300 transition-colors hover:bg-slate-800 hover:text-slate-100";
  return (
    <header className="sticky top-0 z-20 border-b border-slate-800 bg-slate-950/85 backdrop-blur">
      <div className="mx-auto flex max-w-5xl items-center gap-3 px-4 py-2.5">
        <Link href="/chat" className="flex shrink-0 items-center gap-2 pr-2" style={{ fontFamily: "var(--serif)" }}>
          <Logo size={26} /><span className="hidden text-lg sm:inline">TradePilot</span>
        </Link>
        <nav className="-mx-1 flex flex-1 items-center gap-0.5 overflow-x-auto px-1" aria-label="Main">
          <Link href="/chat" className={link}>Chat</Link>
          <Link href="/trade" className={link}>Trade</Link>
          <Link href="/signals" className={link}>Signals</Link>
          <Link href="/connectors" className={link}>Connectors</Link>
          {(user.role === "teacher" || user.role === "admin") && <Link href="/teach" className={link}>Teaching</Link>}
          {user.role === "admin" && <Link href="/admin" className={link}>Admin</Link>}
        </nav>
        <div className="flex shrink-0 items-center gap-3">
          <span className="hidden text-xs text-slate-400 md:inline">{user.email}</span>
          <form action="/api/auth/logout" method="post"><button className="btn-ghost">Log out</button></form>
        </div>
      </div>
    </header>
  );
}
