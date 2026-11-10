import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { configured, nav, sb, toast, useLocal, useRoute, fail, useApi } from "./lib.jsx";
import { Brand, Icon, Notice, Toast } from "./ui.jsx";
import Home from "./pages/home.jsx";
import Agents from "./pages/agents.jsx";
import Activity, { TradeSheet } from "./pages/activity.jsx";
import Token, { Market } from "./pages/token.jsx";
import Social, { Room, Profile } from "./pages/social.jsx";
import Teach from "./pages/teach.jsx";
import Wallets from "./pages/wallets.jsx";
import Copy from "./pages/copy.jsx";
import Account, { AiModel, Notifications } from "./pages/account.jsx";
import "./styles.css";

const PUBLIC = ["/market", "/token"];
const TABS = [["/", "Home", "home"], ["/agents", "Agents", "agents"], ["/activity", "Activity", "pulse"], ["/social", "Social", "msg"], ["/account", "Account", "user"]];

function Welcome() {
  const [mode, setMode] = useState("in"); const [f, setF] = useState({ email: "", password: "" }); const [busy, setBusy] = useState(false); const [msg, setMsg] = useState(null);
  const go = async (e) => { e.preventDefault(); setBusy(true); setMsg(null); try { if (mode === "in") { const { error } = await sb.auth.signInWithPassword(f); if (error) throw error; } else { const { data, error } = await sb.auth.signUp(f); if (error) throw error; if (!data.session) setMsg("Check your email to confirm your account, then sign in."); } } catch (er) { setMsg(er.message); } setBusy(false); };
  return <div className="app" style={{ paddingBottom: 30 }}><div className="px" style={{ paddingTop: 56 }}>
    <div className="col" style={{ alignItems: "center", textAlign: "center" }}><Brand size={84} /><h1 style={{ margin: "18px 0 4px", fontSize: 32, letterSpacing: "-.03em" }}>NovaTrade</h1><span className="chip teal mono">memecoin copy trading</span><p className="mut fs14" style={{ lineHeight: 1.55, maxWidth: 330, margin: "14px 0 0" }}>Four agents scan, judge, trade and protect. Every trade is logged with the reason. Teach it in plain English.</p></div>
    {!configured && <div className="mt16"><Notice>Not connected to a backend yet. Put your Supabase project URL and anon key at the top of <b>index.html</b>. You can still explore live market data below.</Notice></div>}
    {configured && <form className="col g10 mt24" onSubmit={go}><input className="in" type="email" autoComplete="email" placeholder="Email" required value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /><input className="in" type="password" autoComplete={mode === "in" ? "current-password" : "new-password"} placeholder="Password" required minLength={8} value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} />
      {msg && <div className="fs13 warn">{msg}</div>}<button className="btn full" disabled={busy}>{busy ? "…" : mode === "in" ? "Sign in" : "Create account"}</button><button type="button" className="fs13 mut" onClick={() => { setMode(mode === "in" ? "up" : "in"); setMsg(null); }}>{mode === "in" ? "New here? Create an account" : "Have an account? Sign in"}</button></form>}
    <button className="btn ghost full mt16" onClick={() => nav("/market")}><Icon n="flame" size={16} />Explore live memecoins</button>
    <p className="fs11 dim tc mt24" style={{ lineHeight: 1.6 }}>Paper trading by default. Memecoins are extremely risky and can go to zero. Nothing here is financial advice or a promise of profit.</p></div><Toast /></div>;
}

function Shell({ session, theme, setTheme }) {
  const { path, q } = useRoute(); const [trade, setTrade] = useState(null); const notif = useApi(session ? "/notifications" : "", { poll: 45000 }); const unread = (notif.data?.notifications || []).filter((n) => !n.read).length;
  const open = (t) => setTrade(t); const on = (p) => (p === "/" ? path === "/" : path.startsWith(p));
  let page;
  if (path === "/") page = <Home openTrade={open} />; else if (path === "/agents") page = <Agents />; else if (path === "/activity") page = <Activity openTrade={open} />; else if (path === "/market") page = <Market />; else if (path === "/token") page = <Token q={q} />;
  else if (path === "/social") page = <Social q={q} />; else if (path === "/room") page = <Room q={q} />; else if (path === "/profile") page = <Profile q={q} />; else if (path === "/teach") page = <Teach q={q} />; else if (path === "/wallets") page = <Wallets />;
  else if (path === "/copy") page = <Copy />; else if (path === "/account") page = <Account theme={theme} setTheme={setTheme} />; else if (path === "/ai") page = <AiModel />; else if (path === "/notifications") page = <Notifications />;
  else page = <div className="empty"><b>Page not found</b><a className="teal b" href="#/">Go home</a></div>;
  return <div className="app" data-route={path} data-theme={path === "/copy" ? "light" : undefined}>{page}
    {session && <nav className="tabs" aria-label="Main">{TABS.map(([to, l, ic]) => <a key={to} href={"#" + to} className={on(to) ? "on" : ""} aria-current={on(to) ? "page" : undefined}><Icon n={ic} size={22} />{l}{to === "/account" && unread > 0 && <span className="nb">{unread > 9 ? "9+" : unread}</span>}</a>)}</nav>}
    {trade && <TradeSheet t={trade} onClose={() => setTrade(null)} />}<Toast /></div>;
}

function App() {
  const [theme, setTheme] = useLocal("nt-theme", "dark"); const { path } = useRoute();
  const [session, setSession] = useState(undefined);
  useEffect(() => { document.documentElement.dataset.theme = theme; document.querySelector('meta[name=theme-color]')?.setAttribute("content", theme === "dark" ? "#07111B" : "#EEF4F2"); }, [theme]);
  useEffect(() => { if (!sb) { setSession(null); return; } sb.auth.getSession().then(({ data }) => setSession(data.session)); const { data } = sb.auth.onAuthStateChange((_e, s) => setSession(s)); return () => data.subscription.unsubscribe(); }, []);
  if (session === undefined) return <div className="app"><div className="empty">Loading…</div></div>;
  if (!session && !PUBLIC.includes(path)) return <Welcome />;
  return <Shell session={session} theme={theme} setTheme={setTheme} />;
}
createRoot(document.getElementById("root")).render(<App />);
