import { redirect } from "next/navigation";
import { getUser } from "@/lib/auth";
import AuthForm from "@/components/AuthForm";

export default async function LoginPage() {
  if (await getUser()) redirect("/chat");
  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <AuthForm />
    </main>
  );
}
