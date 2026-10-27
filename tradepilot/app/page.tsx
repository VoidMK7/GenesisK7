import { redirect } from "next/navigation";
import { getUser } from "@/lib/auth";
import AuthForm from "@/components/AuthForm";
import Scene3D from "@/components/Scene3D";
import Logo from "@/components/Logo";

export default async function LoginPage() {
  if (await getUser()) redirect("/chat");
  return (
    <main className="mx-auto grid min-h-screen max-w-6xl items-center gap-6 px-5 py-8 md:grid-cols-2 md:gap-10">
      <section>
        <div className="mb-5 flex items-center gap-2.5"><Logo size={32} /><span className="text-xl" style={{ fontFamily: "var(--serif)" }}>TradePilot</span></div>
        <h1 className="max-w-md text-4xl leading-[1.1] md:text-5xl">Read the chart. Test the trade. Then decide.</h1>
        <p className="mt-4 max-w-md text-slate-300">Upload a chart, get an analysis with sources, and watch twelve simulated outcomes before you risk a cent.</p>
        <Scene3D />
      </section>
      <section className="flex justify-center md:justify-end"><AuthForm /></section>
    </main>
  );
}
