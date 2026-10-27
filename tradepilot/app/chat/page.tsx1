import { requireUser } from "@/lib/auth";
import Nav from "@/components/Nav";
import ChatClient from "@/components/ChatClient";

export default async function ChatPage() {
  const user = await requireUser();
  return (
    <>
      <Nav user={user} />
      <main className="mx-auto max-w-3xl p-4"><ChatClient /></main>
    </>
  );
}
