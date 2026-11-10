import { route } from "../../../_shared/server/http.ts";
import { requireUser, serviceDb } from "../../../_shared/server/auth.ts";

/** Who is signed in, and whether they are an administrator (decided here, never by the browser). */
export const GET = route(async () => {
  const s = await requireUser();
  const { data } = await serviceDb().from("user_roles").select("role").eq("user_id", s.userId).eq("role", "admin").maybeSingle();
  return { userId: s.userId, email: s.email, isAdmin: Boolean(data) };
});
