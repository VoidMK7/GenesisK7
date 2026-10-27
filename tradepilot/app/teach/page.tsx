import { requireUser } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";
import Nav from "@/components/Nav";
import TeachClient from "@/components/TeachClient";

export const dynamic = "force-dynamic";

export default async function TeachPage() {
  const user = await requireUser(["teacher", "admin"]);
  const { data } = await supabaseServer().from("cards")
    .select("id,title,kind,notes,tags,file_path,created_at").order("created_at", { ascending: false });
  const cards = (data || []).map((c) => ({ ...c, filename: c.file_path ?? undefined, createdAt: c.created_at }));
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
