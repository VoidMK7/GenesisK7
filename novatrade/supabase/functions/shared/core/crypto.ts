import { Buffer } from "node:buffer";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

// AES-256-GCM envelope for broker and AI-provider credentials. Server-side only.
// Format: v1:<iv b64>:<tag b64>:<ciphertext b64>

function keyFrom(b64: string | undefined): Buffer {
  if (!b64) throw new Error("CREDENTIAL_ENCRYPTION_KEY is not set.");
  const k = Buffer.from(b64, "base64");
  if (k.length !== 32) throw new Error("CREDENTIAL_ENCRYPTION_KEY must be 32 bytes, base64 encoded (openssl rand -base64 32).");
  return k;
}

export function encryptSecret(plain: string, keyB64: string | undefined = process.env.CREDENTIAL_ENCRYPTION_KEY): string {
  const key = keyFrom(keyB64);
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return ["v1", iv.toString("base64"), c.getAuthTag().toString("base64"), ct.toString("base64")].join(":");
}

export function decryptSecret(blob: string, keyB64: string | undefined = process.env.CREDENTIAL_ENCRYPTION_KEY): string {
  const key = keyFrom(keyB64);
  const [v, iv, tag, ct] = blob.split(":");
  if (v !== "v1" || !iv || !tag || !ct) throw new Error("Unrecognised secret format.");
  const d = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64"));
  d.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([d.update(Buffer.from(ct, "base64")), d.final()]).toString("utf8");
}

/** Shows only the last 4 characters. Never log or return the full key. */
export const maskSecret = (s: string) => (s.length <= 8 ? "••••" : `••••${s.slice(-4)}`);
