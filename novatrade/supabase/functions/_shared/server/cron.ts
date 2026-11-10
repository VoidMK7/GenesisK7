import { timingSafeEqual } from "node:crypto";
import { Buffer } from "node:buffer";
import { HttpError } from "./http.ts";

export function cronAuthorized(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) throw new HttpError(503, "CRON_SECRET is not configured.");
  const got = (req.headers.get("authorization") ?? "").replace(/^Bearer /, "");
  const a = Buffer.from(got), b = Buffer.from(secret);
  if (a.length !== b.length || !timingSafeEqual(a, b)) throw new HttpError(401, "Unauthorized.");
}
