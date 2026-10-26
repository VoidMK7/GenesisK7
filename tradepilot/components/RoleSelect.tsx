"use client";
import { useRouter } from "next/navigation";

export default function RoleSelect({ userId, role, disabled }: { userId: string; role: string; disabled?: boolean }) {
  const router = useRouter();
  async function change(e: React.ChangeEvent<HTMLSelectElement>) {
    const res = await fetch("/api/admin/users", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId, role: e.target.value }),
    });
    if (!res.ok) alert((await res.json().catch(() => ({}))).error || "Failed");
    router.refresh();
  }
  return (
    <select defaultValue={role} onChange={change} disabled={disabled} className="rounded border border-slate-700 bg-slate-950 px-2 py-1 text-sm">
      <option value="user">user</option>
      <option value="teacher">teacher (teaching access)</option>
      <option value="admin">admin</option>
    </select>
  );
}
