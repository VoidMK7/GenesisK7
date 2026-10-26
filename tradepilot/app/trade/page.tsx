import { requireUser } from "@/lib/auth";
import Nav from "@/components/Nav";
import TradeClient from "@/components/TradeClient";

export default async function TradePage() {
  const user = await requireUser();
  return (<><Nav user={user} /><main className="mx-auto max-w-5xl space-y-4 p-4"><h1 className="text-xl font-semibold">Trading</h1><TradeClient /></main></>);
}
