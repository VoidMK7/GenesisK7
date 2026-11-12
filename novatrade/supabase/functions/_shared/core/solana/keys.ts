import { b58encode, fromB64 } from "./base58.ts";

// Ed25519 through the platform's WebCrypto (Node 20+, Deno / Supabase Edge). No third-party code touches a private key.
const PKCS8_PREFIX = Uint8Array.from([0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x04, 0x22, 0x04, 0x20]);
const subtle = (): SubtleCrypto => globalThis.crypto.subtle;
const asBuf = (u: Uint8Array): ArrayBuffer => u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength) as ArrayBuffer;

async function privateKey(seed: Uint8Array): Promise<CryptoKey> {
  if (seed.length !== 32) throw new Error("A wallet seed must be 32 bytes.");
  const pkcs8 = new Uint8Array(PKCS8_PREFIX.length + 32); pkcs8.set(PKCS8_PREFIX); pkcs8.set(seed, PKCS8_PREFIX.length);
  return subtle().importKey("pkcs8", asBuf(pkcs8), { name: "Ed25519" }, true, ["sign"]);
}

export async function publicKeyFromSeed(seed: Uint8Array): Promise<Uint8Array> {
  const jwk = await subtle().exportKey("jwk", await privateKey(seed));
  if (!jwk.x) throw new Error("Could not derive the public key.");
  return fromB64(jwk.x.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(jwk.x.length / 4) * 4, "="));
}

export interface Keypair { seed: Uint8Array; publicKey: Uint8Array; address: string }

export async function keypairFromSeed(seed: Uint8Array): Promise<Keypair> {
  const publicKey = await publicKeyFromSeed(seed);
  return { seed, publicKey, address: b58encode(publicKey) };
}
export async function generateKeypair(): Promise<Keypair> {
  return keypairFromSeed(globalThis.crypto.getRandomValues(new Uint8Array(32)));
}
export async function sign(seed: Uint8Array, message: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await subtle().sign({ name: "Ed25519" }, await privateKey(seed), asBuf(message)));
}
export async function verify(publicKey: Uint8Array, message: Uint8Array, signature: Uint8Array): Promise<boolean> {
  const k = await subtle().importKey("raw", asBuf(publicKey), { name: "Ed25519" }, false, ["verify"]);
  return subtle().verify({ name: "Ed25519" }, k, asBuf(signature), asBuf(message));
}
/** The 64-byte secret key (seed + public key) in base58: the format Phantom and Solflare import as a "private key". */
export function exportSecretKeyBase58(k: Keypair): string { const o = new Uint8Array(64); o.set(k.seed); o.set(k.publicKey, 32); return b58encode(o); }
