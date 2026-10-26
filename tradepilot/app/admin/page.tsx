import { requireUser } from "@/lib/auth";
import { read } from "@/lib/db";
import Nav from "@/components/Nav";
import RoleSelect from "@/components/RoleSelect";

export const dynamic = "force-dynamic";

const dayKey = (iso: string) => iso.slice(0, 10);

export default async function AdminPage() {
  const me = await requireUser(["admin"]);
  const { users, cards, events } = read();

  const days: string[] = [];
  for (let i = 13; i >= 0; i--) days.push(dayKey(new Date(Date.now() - i * 86400000).toISOString()));
  const signups = days.map((d) => users.filter((u) => dayKey(u.createdAt) === d).length);
  const activeUsers = days.map((d) => new Set(events.filter((e) => dayKey(e.at) === d).map((e) => e.userId)).size);
  const maxBar = Math.max(1, ...signups, ...activeUsers);
  const count = (t: string) => events.filter((e) => e.type === t).length;
  const last7 = Date.now() - 7 * 86400000;
  const wau = new Set(events.filter((e) => new Date(e.at).getTime() > last7).map((e) => e.userId)).size;

  const stats = [
    ["Total users", users.length],
    ["Active (7 days)", wau],
    ["Chat messages", count("chat")],
    ["Logins", count("login")],
    ["Learning cards", cards.length],
    ["Teachers", users.filter((u) => u.role === "teacher").length],
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
                  <td>{dayKey(u.createdAt)}</td>
                  <td>{events.filter((e) => e.userId === u.id).length}</td>
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
