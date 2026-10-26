import { redirect } from "next/navigation";
import { supabaseServer } from "./supabase/server";
import type { Role, User } from "./db";

// Verifies the session with Supabase, then loads the profile (role comes from the DB).
export async function getUser(): Promise<User | null> {
  const sb = supabaseServer();
  const { data: auth } = await sb.auth.getUser();
  if (!auth.user) return null;
  const { data } = await sb.from("profiles").select("id,email,name,role,created_at").eq("id", auth.user.id).single();
  return (data as User) ?? null;
}
export async function requireUser(roles?: Role[]): Promise<User> {
  const u = await getUser();
  if (!u) redirect("/login");
  if (roles && !roles.includes(u!.role)) redirect("/chat");
  return u as User;
}
export const canTeach = (r: Role) => r === "teacher" || r === "admin";
