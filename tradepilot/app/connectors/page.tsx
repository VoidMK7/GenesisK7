import { requireUser } from "@/lib/auth";
import Nav from "@/components/Nav";
import ConnectorsClient from "@/components/ConnectorsClient";

export default async function ConnectorsPage() {
  const user = await requireUser();
  return (<><Nav user={user} /><main className="mx-auto max-w-3xl space-y-4 p-4"><h1 className="text-xl font-semibold">Connectors</h1><ConnectorsClient /></main></>);
}
