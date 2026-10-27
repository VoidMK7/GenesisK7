import { NextResponse } from "next/server";
import { getUser } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";
import { encrypt } from "@/lib/crypto";
import { getAccount } from "@/lib/binance";

// Never returns key material.
export async function GET() {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { data } = await supabaseServer().from("connections").select("id,exchange,label,testnet,created_at").order("created_at", { ascending: false });
  return NextResponse.json({ connections: data || [] });
}

export async function POST(req: Request) {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { label, apiKey, apiSecret, testnet } = await req.json().catch(() => ({}));
  if (typeof apiKey !== "string" || typeof apiSecret !== "string" || apiKey.length < 10 || apiSecret.length < 10)
    return NextResponse.json({ error: "API key and secret required" }, { status: 400 });
  const isTestnet = testnet !== false;
  try {
    const acct = await getAccount({ apiKey, apiSecret, testnet: isTestnet });
    if (acct.permissions && Array.isArray(acct.permissions) && !acct.permissions.includes("SPOT"))
      return NextResponse.json({ error: "Key has no SPOT permission" }, { status: 400 });
    if (acct.canWithdraw) // warn loudly: keys should never be able to withdraw
      return NextResponse.json({ error: "This key can WITHDRAW funds. Create a new key with trading only and withdrawals disabled." }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ error: `Could not verify key: ${(e as Error).message}` }, { status: 400 });
  }
  const { error } = await supabaseServer().from("connections").insert({
    user_id: user.id, exchange: "binance", label: String(label || "").slice(0, 60),
    api_key_enc: encrypt(apiKey), api_secret_enc: encrypt(apiSecret), testnet: isTestnet,
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: Request) {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });
  await supabaseServer().from("connections").delete().eq("id", id).eq("user_id", user.id);
  return NextResponse.json({ ok: true });
}
