import React, { useEffect, useState } from "react";
import { cn, useToast } from "./lib.jsx";

const P = {
  home: "M3 11l9-8 9 8M5 10v10h5v-6h4v6h5V10", agents: "M9 11a3 3 0 100-6 3 3 0 000 6zM3 20c0-3 2.7-5 6-5s6 2 6 5M16 5.5a3 3 0 010 5.5M18 15c2 .6 3 2.3 3 5", pulse: "M3 12h4l3-8 4 16 3-8h4", user: "M12 12a4 4 0 100-8 4 4 0 000 8zM4 21c0-4 3.6-6 8-6s8 2 8 6", search: "M11 18a7 7 0 100-14 7 7 0 000 14zM21 21l-5-5", bell: "M6 9a6 6 0 1112 0c0 6 2 7 2 7H4s2-1 2-7zM10 20a2 2 0 004 0",
  chev: "M9 6l6 6-6 6", back: "M15 6l-6 6 6 6", check: "M5 12l5 5 9-10", x: "M6 6l12 12M18 6L6 18", scan: "M4 8V5a1 1 0 011-1h3M16 4h3a1 1 0 011 1v3M20 16v3a1 1 0 01-1 1h-3M8 20H5a1 1 0 01-1-1v-3M4 12h16", brain: "M9 4a3 3 0 00-3 3 3 3 0 00-2 5 3 3 0 002 5 3 3 0 006 0V7a3 3 0 00-3-3zM15 4a3 3 0 013 3 3 3 0 012 5 3 3 0 01-2 5 3 3 0 01-3 3",
  bolt: "M13 2L4 14h7l-1 8 9-12h-7z", shield: "M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z", send: "M5 12h14M13 6l6 6-6 6", up: "M12 19V5M6 11l6-6 6 6", heart: "M12 20s-7-4.4-7-10a4 4 0 017-2.6A4 4 0 0119 10c0 5.6-7 10-7 10z", msg: "M4 5h16v11H9l-5 4z", plus: "M12 5v14M5 12h14", wallet: "M3 7h16a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2zM3 7l2-3h12M16 14h3", lock: "M6 11h12v9H6zM8 11V8a4 4 0 118 0v3",
  link: "M10 14a4 4 0 005.7 0l3-3a4 4 0 00-5.7-5.7l-1 1M14 10a4 4 0 00-5.7 0l-3 3a4 4 0 005.7 5.7l1-1", camera: "M4 8h3l2-3h6l2 3h3v11H4zM12 17a4 4 0 100-8 4 4 0 000 8z", play: "M8 5v14l11-7z", trash: "M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13", spark: "M12 3l2 6 6 2-6 2-2 6-2-6-6-2 6-2z", cog: "M12 15a3 3 0 100-6 3 3 0 000 6zM19 12l2-1-2-4-2 1-2-1V5h-4v2l-2 1-2-1-2 4 2 1v2l-2 1 2 4 2-1 2 1v2h4v-2l2-1 2 1 2-4-2-1z",
  globe: "M12 21a9 9 0 100-18 9 9 0 000 18zM3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18", flame: "M12 3c1 4 5 5 5 10a5 5 0 01-10 0c0-2 1-3 2-4 0 2 1 3 2 3 0-3-1-5 1-9z", book: "M5 4h10a3 3 0 013 3v13H8a3 3 0 01-3-3zM8 4v13", copy: "M9 9h10v11H9zM5 15V4h10", sliders: "M4 7h10M18 7h2M4 17h2M10 17h10M14 4v6M6 14v6", chart: "M4 20V4M4 20h16M8 16l4-5 3 3 5-7", eye: "M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zM12 15a3 3 0 100-6 3 3 0 000 6z", star: "M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z", warn: "M12 4l9 16H3zM12 10v4M12 17v.5", out: "M10 5H5v14h5M15 8l4 4-4 4M19 12H9",
};
export const Icon = ({ n, size = 20, sw = 1.9, ...r }) => <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...r}><path d={P[n] || P.spark} /></svg>;

export const Brand = ({ size = 30 }) => <span className="brand" style={{ width: size, height: size, borderRadius: size * .3 }}><svg width={size * .62} height={size * .62} viewBox="0 0 24 24" fill="none"><path d="M5 19V5l14 14V5" stroke="#12D6C5" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" /><circle cx="19" cy="5" r="1.7" fill="#55E6F0" /></svg></span>;

const HUES = [172, 200, 262, 330, 28, 142, 48];
const hue = (s = "") => HUES[[...s].reduce((a, c) => a + c.charCodeAt(0), 0) % HUES.length];
/** Real token image when the market data provides one (https only); otherwise a lettered badge. Never a made-up logo. */
export function Logo({ src, sym = "?", size, badge }) {
  const [bad, setBad] = useState(false);
  useEffect(() => setBad(false), [src]);
  return <span className={cn("logo", size)}>
    {src && !bad ? <img src={src} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setBad(true)} /> : <span className="fb" style={{ background: `hsl(${hue(sym)} 45% 22%)`, color: `hsl(${hue(sym)} 80% 72%)` }}>{sym.replace(/[^A-Za-z0-9]/g, "").slice(0, 2).toUpperCase() || "?"}</span>}
    {badge && <span className="badge" style={{ background: badge }} />}
  </span>;
}
export const Avatar = ({ p, size }) => <Logo src={p?.avatar_url} sym={p?.display_name || p?.handle || "?"} size={size} />;

export function Sheet({ onClose, children, title }) {
  useEffect(() => { const k = (e) => e.key === "Escape" && onClose(); window.addEventListener("keydown", k); const o = document.body.style.overflow; document.body.style.overflow = "hidden"; return () => { window.removeEventListener("keydown", k); document.body.style.overflow = o; }; }, []);
  return <div className="scrim" onClick={onClose}><div className="sheet" role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}><div className="grab" />{children}</div></div>;
}
export const Toggle = ({ on, set, label }) => <button type="button" role="switch" aria-checked={on} aria-label={label} className={cn("tgl", on && "on")} onClick={() => set(!on)}><i /></button>;
export const Seg = ({ value, set, opts }) => <div className="seg" role="tablist">{opts.map(([v, l]) => <button key={v} role="tab" aria-selected={value === v} className={value === v ? "on" : ""} onClick={() => set(v)}>{l}</button>)}</div>;
export const Notice = ({ children, info, icon = "warn" }) => <div className={cn("note", info && "info")}><Icon n={info ? "shield" : icon} size={18} style={{ flex: "none", marginTop: 1 }} /><div>{children}</div></div>;
export const Empty = ({ title, children, action }) => <div className="empty"><b>{title}</b>{children}{action && <div className="mt12">{action}</div>}</div>;
export const Skel = ({ h = 60, n = 1 }) => <div className="col g8 px">{Array.from({ length: n }, (_, i) => <div key={i} className="skel" style={{ height: h }} />)}</div>;
export const Sim = () => <span className="tag sim" title="Modelled on market prices. No real money moved.">SIMULATED</span>;

export function Toast() { const t = useToast(); return t ? <div className={cn("toast", t.err && "err")} role="status"><Icon n={t.err ? "warn" : "check"} size={18} /><span className="fs13">{t.msg}</span></div> : null; }

export function Ring({ value = 0, size = 56, color = "var(--warn)" }) {
  const r = size / 2 - 4, c = 2 * Math.PI * r, v = Math.max(0, Math.min(100, value));
  const col = v >= 75 ? "var(--up)" : v >= 55 ? "var(--warn)" : "var(--dn)";
  return <span className="ring" style={{ width: size, height: size }}><svg width={size} height={size}><circle cx={size / 2} cy={size / 2} r={r} stroke="var(--line)" strokeWidth="4" fill="none" /><circle cx={size / 2} cy={size / 2} r={r} stroke={col} strokeWidth="4" fill="none" strokeLinecap="round" strokeDasharray={`${c * v / 100} ${c}`} transform={`rotate(-90 ${size / 2} ${size / 2})`} /></svg><b>{Math.round(v)}</b></span>;
}

/** Area chart with trade markers. Points = [{t,v}], markers = [{t,side,symbol}]. Empty data draws a flat dashed baseline, never a made-up curve. */
export function AreaChart({ points, markers = [], height = 200, up = true }) {
  const W = 400, H = height, pad = 10;
  if (!points || points.length < 2) return <div className="chart" style={{ height }}><svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none"><line x1="0" x2={W} y1={H * .62} y2={H * .62} stroke="var(--line)" strokeWidth="2" strokeDasharray="5 6" /></svg></div>;
  const xs = points.map((p) => +new Date(p.t)), ys = points.map((p) => p.v);
  const x0 = Math.min(...xs), x1 = Math.max(...xs) || x0 + 1, lo = Math.min(...ys, 0), hi = Math.max(...ys, 0.0001);
  const X = (t) => pad + ((t - x0) / Math.max(1, x1 - x0)) * (W - 2 * pad), Y = (v) => H - 18 - ((v - lo) / Math.max(1e-9, hi - lo)) * (H - 50);
  const d = points.map((p, i) => `${i ? "L" : "M"}${X(+new Date(p.t)).toFixed(1)},${Y(p.v).toFixed(1)}`).join(" ");
  const col = up ? "var(--up)" : "var(--dn)"; const last = points[points.length - 1];
  return <div className="chart" style={{ height }}><svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label="Profit and loss over time">
    <defs><linearGradient id="ag" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor={col} stopOpacity=".35" /><stop offset="1" stopColor={col} stopOpacity="0" /></linearGradient></defs>
    <line x1="0" x2={W} y1={Y(0)} y2={Y(0)} stroke="var(--line)" strokeDasharray="4 5" />
    <path d={`${d} L${X(+new Date(last.t))},${H} L${X(x0)},${H} Z`} fill="url(#ag)" /><path d={d} fill="none" stroke={col} strokeWidth="2.4" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
    {markers.filter((m) => +new Date(m.t) >= x0 && +new Date(m.t) <= x1).slice(-12).map((m, i) => <circle key={i} cx={X(+new Date(m.t))} cy={Y(points.reduce((a, p) => (+new Date(p.t) <= +new Date(m.t) ? p.v : a), points[0].v))} r="3.2" fill={m.side === "buy" ? "var(--cyan)" : "var(--up)"} stroke="var(--bg)" strokeWidth="1.5" />)}
    <circle cx={X(+new Date(last.t))} cy={Y(last.v)} r="4.5" fill={col} stroke="var(--bg)" strokeWidth="2" /></svg></div>;
}

/** Token price path built ONLY from the % changes the provider reports (5m/1h/6h/24h). It is an outline, not a candle chart, and is labelled so. */
export function PriceChart({ pair, pos, height = 190 }) {
  const c = pair.change || {}; const now = pair.priceUsd;
  const back = (p) => (p === undefined || p === null ? null : now / (1 + p / 100));
  const pts = [[-1440, back(c.h24)], [-360, back(c.h6)], [-60, back(c.h1)], [-5, back(c.m5)], [0, now]].filter(([, v]) => v !== null && Number.isFinite(v));
  const W = 400, H = height; if (pts.length < 2) return <div className="empty">Not enough price history from the provider to draw a path.</div>;
  const vals = pts.map(([, v]) => v).concat(pos ? [pos.stopLine, pos.entry_price * 1] : []); const lo = Math.min(...vals) * .98, hi = Math.max(...vals) * 1.02;
  const X = (m) => 8 + ((m + 1440) / 1440) ** 0.5 * (W - 16), Y = (v) => H - 14 - ((v - lo) / (hi - lo)) * (H - 28);
  const d = pts.map(([m, v], i) => `${i ? "L" : "M"}${X(m).toFixed(1)},${Y(v).toFixed(1)}`).join(" "); const up = now >= pts[0][1];
  return <div className="chart" style={{ height }}><svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label="Approximate price path from provider percent changes">
    <path d={`${d} L${X(0)},${H} L${X(-1440)},${H} Z`} fill={up ? "rgba(25,199,133,.12)" : "rgba(240,82,104,.12)"} /><path d={d} fill="none" stroke={up ? "var(--up)" : "var(--dn)"} strokeWidth="2.4" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
    {pos && <><line x1="0" x2={W} y1={Y(pos.entry_price)} y2={Y(pos.entry_price)} stroke="var(--cyan)" strokeDasharray="3 5" /><line x1="0" x2={W} y1={Y(pos.stopLine)} y2={Y(pos.stopLine)} stroke="var(--dn)" strokeDasharray="6 4" strokeWidth="1.6" /></>}
    <circle cx={X(0)} cy={Y(now)} r="4.5" fill="var(--text)" stroke="var(--bg)" strokeWidth="2" /></svg></div>;
}
