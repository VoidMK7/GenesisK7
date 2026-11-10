// Supabase Edge Functions expose secrets through Deno.env. The shared code reads process.env, so mirror it once at start-up.
declare const Deno: { env: { toObject(): Record<string, string> } };
const g = globalThis as unknown as { process?: { env: Record<string, string | undefined> } };
g.process = g.process ?? { env: {} };
for (const [k, v] of Object.entries(Deno.env.toObject())) if (g.process.env[k] === undefined) g.process.env[k] = v;
export {};
