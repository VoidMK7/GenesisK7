import { requireUser } from "@/lib/auth";
import { read } from "@/lib/db";
import Nav from "@/components/Nav";
import TeachClient from "@/components/TeachClient";

export const dynamic = "force-dynamic";

export default async function TeachPage() {
  const user = await requireUser(["teacher", "admin"]);
  const cards = read().cards.map(({ text, ...c }) => c).reverse();
  return (
    <>
      <Nav user={user} />
      <main className="mx-auto max-w-5xl space-y-4 p-4">
        <h1 className="text-xl font-semibold">Teaching space</h1>
        <p className="text-sm text-slate-400">Only teacher and admin accounts can see this page. Everything saved here becomes memory the chat assistant can draw on.</p>
        <TeachClient cards={cards} />
      </main>
    </>
  );
}
