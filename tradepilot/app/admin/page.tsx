import { requireUser } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";
import type { User } from "@/lib/db";
import Nav from "@/components/Nav";
import RoleSelect from "@/components/RoleSelect";

export const dynamic = "force-dynamic";

type Stats = {
  total_users: number; active_7d: number; chats: number; logins: number; cards: number; teachers: number;
  daily: { day: string; signups: number; active: number }[]; per_user: Record<string, number>;
};

export default async function AdminPage() {
  const me = await requireUser(["admin"]);
  const sb = supabaseServer();
  const [{ data: st }, { data: profiles }] = await Promise.all([
    sb.rpc("admin_stats"),
    sb.from("profiles").select("id,email,name,role,created_at").order("created_at", { ascending: false }),
  ]);
  const s = st as Stats;
  const users = (profiles || []) as User[];
  const days = s.daily.map((d) => d.day);
  const signups = s.daily.map((d) => d.signups);
  const activeUsers = s.daily.map((d) => d.active);
  const maxBar = Math.max(1, ...signups, ...activeUsers);

  const stats: [string, number][] = [
    ["Total users", s.total_users],
    ["Active (7 days)", s.active_7d],
    ["Chat messages", s.chats],
    ["Logins", s.logins],
    ["Learning cards", s.cards],
    ["Teachers", s.teachers],
  ];

  return (
    <>
      <Nav user={me} />
      <main className="mx-auto max-w-5xl space-y-6 p-4">
        <h1 className="text-xl font-semibold">Admin panel</h1>

        <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
          {stats.map(([label, value]) => (
            <div key={label} className="card">
              <div className="text-xs text-slate-400">{label}</div>
              <div className="text-2xl font-semibold">{value}</div>
            </div>
          ))}
        </div>

        <div className="card">
          <h2 className="mb-1 font-semibold">Last 14 days</h2>
          <p className="mb-3 text-xs text-slate-400"><span className="text-emerald-400">■</span> new sign-ups &nbsp; <span className="text-sky-400">■</span> active users</p>
          <div className="flex h-32 items-end gap-1">
            {days.map((d, i) => (
              <div key={d} className="flex flex-1 items-end gap-0.5" title={`${d}: ${signups[i]} sign-ups, ${activeUsers[i]} active`}>
                <div className="w-1/2 rounded-t bg-emerald-500" style={{ height: `${(signups[i] / maxBar) * 100}%`, minHeight: signups[i] ? 2 : 0 }} />
                <div className="w-1/2 rounded-t bg-sky-500" style={{ height: `${(activeUsers[i] / maxBar) * 100}%`, minHeight: activeUsers[i] ? 2 : 0 }} />
              </div>
            ))}
          </div>
          <div className="mt-1 flex justify-between text-[10px] text-slate-500"><span>{days[0]}</span><span>{days[13]}</span></div>
        </div>

        <div className="card overflow-x-auto">
          <h2 className="mb-3 font-semibold">Users</h2>
          <table className="w-full text-left text-sm">
            <thead className="text-xs text-slate-400">
              <tr><th className="py-1">Name</th><th>Email</th><th>Joined</th><th>Events</th><th>Role</th></tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id} className="border-t border-slate-800">
                  <td className="py-2">{u.name}</td>
                  <td>{u.email}</td>
                  <td>{u.created_at.slice(0, 10)}</td>
                  <td>{s.per_user[u.id] ?? 0}</td>
                  <td><RoleSelect userId={u.id} role={u.role} disabled={u.id === me.id} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </main>
    </>
  );
}
