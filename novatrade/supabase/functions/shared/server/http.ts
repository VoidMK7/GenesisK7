
export class HttpError extends Error {
  constructor(readonly status: number, message: string, readonly extra?: Record<string, unknown>) {
    super(message);
  }
}

export const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

export async function body(req: Request): Promise<Record<string, unknown>> {
  const len = Number(req.headers.get("content-length") ?? 0);
  if (len > 1_000_000) throw new HttpError(413, "Request too large.");
  try {
    const b = await req.json();
    if (!b || typeof b !== "object" || Array.isArray(b)) throw new Error();
    return b as Record<string, unknown>;
  } catch {
    throw new HttpError(400, "Send a JSON object.");
  }
}

export const v = {
  str(o: Record<string, unknown>, k: string, opts: { min?: number; max?: number; optional?: boolean } = {}): string {
    const x = o[k];
    if (x === undefined || x === null || x === "") {
      if (opts.optional) return "";
      throw new HttpError(400, `${k} is required.`);
    }
    if (typeof x !== "string") throw new HttpError(400, `${k} must be text.`);
    const s = x.trim();
    if (s.length < (opts.min ?? 1) && !(opts.optional && !s)) throw new HttpError(400, `${k} is too short.`);
    if (s.length > (opts.max ?? 500)) throw new HttpError(400, `${k} is too long.`);
    return s;
  },
  num(o: Record<string, unknown>, k: string, opts: { min?: number; max?: number; optional?: boolean } = {}): number | undefined {
    const x = o[k];
    if (x === undefined || x === null || x === "") {
      if (opts.optional) return undefined;
      throw new HttpError(400, `${k} is required.`);
    }
    const n = typeof x === "number" ? x : Number(x);
    if (!Number.isFinite(n)) throw new HttpError(400, `${k} must be a number.`);
    if (opts.min !== undefined && n < opts.min) throw new HttpError(400, `${k} must be at least ${opts.min}.`);
    if (opts.max !== undefined && n > opts.max) throw new HttpError(400, `${k} must be at most ${opts.max}.`);
    return n;
  },
  oneOf<T extends string>(o: Record<string, unknown>, k: string, allowed: readonly T[], optionalDefault?: T): T {
    const x = o[k];
    if ((x === undefined || x === "") && optionalDefault) return optionalDefault;
    if (typeof x !== "string" || !allowed.includes(x as T)) throw new HttpError(400, `${k} must be one of: ${allowed.join(", ")}.`);
    return x as T;
  },
  bool(o: Record<string, unknown>, k: string): boolean | undefined {
    const x = o[k];
    if (x === undefined) return undefined;
    if (typeof x !== "boolean") throw new HttpError(400, `${k} must be true or false.`);
    return x;
  },
};

export const SYMBOL_RE = /^[A-Za-z0-9._:\/-]{1,24}$/;
export function symbol(s: string): string {
  if (!SYMBOL_RE.test(s)) throw new HttpError(400, "Symbol contains invalid characters.");
  return s.toUpperCase();
}

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function uuid(s: string, name = "id"): string {
  if (!UUID_RE.test(s)) throw new HttpError(400, `${name} is not a valid id.`);
  return s;
}

// Very small in-memory limiter. On serverless this is per-instance, so treat it as a courtesy, not a guarantee.
const hits = new Map<string, number[]>();
export function rateLimit(key: string, max: number, windowMs: number) {
  const now = Date.now();
  const arr = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
  if (arr.length >= max) throw new HttpError(429, "Too many requests. Try again shortly.");
  arr.push(now);
  hits.set(key, arr);
}

/** Wraps a route handler so every failure becomes a clean JSON error and nothing internal leaks. */
export function route<A extends unknown[]>(fn: (...a: A) => Promise<unknown>) {
  return async (...a: A): Promise<Response> => {
    try {
      const out = await fn(...a);
      return out instanceof Response ? out : json(out);
    } catch (e) {
      if (e instanceof HttpError) return json({ error: e.message, ...(e.extra ?? {}) }, e.status);
      console.error("route error:", e instanceof Error ? e.message : e);
      return json({ error: "Something went wrong on the server." }, 500);
    }
  };
}
