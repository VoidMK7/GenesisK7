import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SignJWT, jwtVerify } from "jose";
import { findUserById, type Role, type User } from "./db";

export const COOKIE = "tp_session";
const secret = () => {
  const s = process.env.AUTH_SECRET;
  if (!s || s === "change-me") throw new Error("Set AUTH_SECRET in .env.local");
  return new TextEncoder().encode(s);
};

export async function createSession(userId: string) {
  const token = await new SignJWT({ uid: userId })
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime("7d")
    .sign(secret());
  cookies().set(COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 7,
  });
}
export function destroySession() {
  cookies().set(COOKIE, "", { path: "/", maxAge: 0 });
}

// Role is always re-read from the database, so promotions/demotions apply immediately.
export async function getUser(): Promise<User | null> {
  const token = cookies().get(COOKIE)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret());
    return findUserById(String(payload.uid)) ?? null;
  } catch {
    return null;
  }
}
export async function requireUser(roles?: Role[]): Promise<User> {
  const u = await getUser();
  if (!u) redirect("/login");
  if (roles && !roles.includes(u.role)) redirect("/chat");
  return u;
}
export const canTeach = (r: Role) => r === "teacher" || r === "admin";
