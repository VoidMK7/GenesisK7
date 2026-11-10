import React, { useEffect, useRef, useState } from "react";
import { api, ago, cn, fail, nav, sb, toast, useApi } from "../lib.jsx";
import { Avatar, Empty, Icon, Notice, Seg, Sheet, Skel } from "../ui.jsx";
import { Header } from "./home.jsx";
import { Assistant } from "./teach.jsx";

export async function uploadMedia(file) {
  if (!sb) throw new Error("Backend not configured.");
  const { data: u } = await sb.auth.getUser(); const uid = u?.user?.id; if (!uid) throw new Error("Sign in first.");
  if (file.size > 25 * 1024 * 1024) throw new Error("Files can be up to 25 MB.");
  if (!/^(image\/(png|jpe?g|webp|gif)|video\/(mp4|webm))$/.test(file.type)) throw new Error("Use PNG, JPG, WebP, GIF, MP4 or WebM.");
  const ext = file.type.split("/")[1].replace("jpeg", "jpg"); const path = `${uid}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const { error } = await sb.storage.from("nova-media").upload(path, file, { contentType: file.type, upsert: false });
  if (error) throw new Error(error.message.includes("not found") ? "The media bucket is missing. Apply migration 0004 on your backend." : error.message);
  return sb.storage.from("nova-media").getPublicUrl(path).data.publicUrl;
}
const videoSeconds = (file) => new Promise((res, rej) => { const v = document.createElement("video"); v.preload = "metadata"; v.onloadedmetadata = () => { URL.revokeObjectURL(v.src); res(v.duration); }; v.onerror = () => rej(new Error("Could not read that video.")); v.src = URL.createObjectURL(file); });

function Post({ p, onChange }) {
  const [c, setC] = useState(null); const [text, setText] = useState("");
  const like = async () => { try { await api(`/posts/${p.id}/like`, { method: "POST" }); onChange(); } catch (e) { fail(e); } };
  const openC = async () => { if (c) return setC(null); try { setC((await api(`/posts/${p.id}/comments`)).comments); } catch (e) { fail(e); } };
  const send = async () => { try { await api(`/posts/${p.id}/comments`, { method: "POST", body: { body: text } }); setText(""); setC((await api(`/posts/${p.id}/comments`)).comments); onChange(); } catch (e) { fail(e); } };
  const del = async () => { try { await api(`/posts/${p.id}`, { method: "DELETE" }); onChange(); } catch (e) { fail(e); } };
  const a = p.author; const isVid = /\.(mp4|webm)$/i.test(p.media_url || "");
  return <div className="post"><div className="row g10"><button onClick={() => nav(`/profile?handle=${a.handle}`)}><Avatar p={a} size="sm" /></button><div className="sp" style={{ minWidth: 0 }}><b className="fs14">{a.display_name}</b> <span className="fs12 mut">@{a.handle} · {ago(p.created_at)}</span></div>{p.mine && <button className="ibtn" aria-label="Delete post" onClick={del}><Icon n="trash" size={16} /></button>}</div>
    <p>{p.body}</p>{p.token_symbol && <button className="chip teal mt8" onClick={() => nav(`/token?chain=solana&address=${encodeURIComponent(p.token_address)}`)}>${p.token_symbol}</button>}
    {p.media_url && (isVid ? <video src={p.media_url} controls playsInline muted loop /> : <img src={p.media_url} alt="" loading="lazy" />)}
    <div className="act"><button className={p.liked ? "on" : ""} onClick={like} aria-pressed={p.liked}><Icon n="heart" size={18} style={{ fill: p.liked ? "currentColor" : "none" }} />{p.likes}</button><button onClick={openC}><Icon n="msg" size={18} />{p.comments}</button></div>
    {c && <div className="mt8 col g8">{c.map((x) => <div key={x.id} className="fs13"><b>{x.author?.display_name || "User"}</b> <span className="mut">{x.body}</span></div>)}<div className="row g8"><input className="in" placeholder="Reply" value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === "Enter" && text.trim() && send()} maxLength={500} /><button className="btn sm2" disabled={!text.trim()} onClick={send}>Send</button></div></div>}</div>;
}

function Feed() {
  const [tab, setTab] = useState("all"); const f = useApi(`/feed?tab=${tab}`, { poll: 40000 }); const [text, setText] = useState(""); const [file, setFile] = useState(null); const [busy, setBusy] = useState(false); const fi = useRef(null);
  const post = async () => { setBusy(true); try { const media = file ? await uploadMedia(file) : undefined; await api("/feed", { method: "POST", body: { body: text, media_url: media } }); setText(""); setFile(null); f.reload(); toast("Posted"); } catch (e) { fail(e); } setBusy(false); };
  return <>
    <div className="px"><div className="card"><textarea className="ta" style={{ minHeight: 70 }} placeholder="Share a call, a lesson, a win or a loss. Free to post." value={text} onChange={(e) => setText(e.target.value)} maxLength={1000} />
      <div className="row g8 mt8"><input ref={fi} type="file" accept="image/*,video/mp4,video/webm" className="hide" onChange={(e) => setFile(e.target.files[0] || null)} /><button className="btn sec2 sm2" onClick={() => fi.current.click()}><Icon n="camera" size={16} />{file ? file.name.slice(0, 14) : "Photo / video"}</button><span className="sp fs11 dim tc">{text.length}/1000</span><button className="btn sm2" disabled={busy || !text.trim()} onClick={post}>{busy ? "Posting…" : "Post"}</button></div></div></div>
    <div className="px mt8"><Seg value={tab} set={setTab} opts={[["all", "For you"], ["following", "Following"]]} /></div>
    <div className="mt8">{f.loading ? <Skel n={3} h={110} /> : f.error ? <Empty title="Not available">{f.error.message}</Empty> : f.data.posts.length ? f.data.posts.map((p) => <Post key={p.id} p={{ ...p, mine: false }} onChange={f.reload} />) : <Empty title="No posts yet">{f.data.empty || "Be the first to post."}</Empty>}</div>
  </>;
}

function People() {
  const [qs, setQs] = useState(""); const [dq, setDq] = useState(""); useEffect(() => { const t = setTimeout(() => setDq(qs), 300); return () => clearTimeout(t); }, [qs]);
  const p = useApi(`/social/people?q=${encodeURIComponent(dq)}`); const follow = async (u) => { try { await api("/social/follow", { method: "POST", body: { userId: u.user_id, follow: !u.following } }); p.reload(); } catch (e) { fail(e); } };
  return <><div className="px"><input className="in" placeholder="Search people" value={qs} onChange={(e) => setQs(e.target.value)} /></div><div className="list mt8">{p.loading ? <Skel n={4} h={56} /> : p.data?.people.length ? p.data.people.map((u) => <div key={u.user_id} className="item"><button onClick={() => nav(`/profile?handle=${u.handle}`)}><Avatar p={u} /></button><div className="sp" style={{ minWidth: 0 }}><div className="t ell">{u.display_name}</div><div className="u ell">@{u.handle} · {u.followers} followers</div></div><button className={cn("btn sm2", u.following && "sec2")} onClick={() => follow(u)}>{u.following ? "Following" : "Follow"}</button></div>) : <Empty title="No one found">{p.error?.message || "Invite friends so there is someone to follow."}</Empty>}</div></>;
}

function Communities() {
  const r = useApi("/rooms?kind=community", { poll: 60000 }); const [mk, setMk] = useState(null);
  const join = async (x) => { try { await api(`/rooms/${x.id}/join`, { method: "POST" }); nav(`/room?id=${x.id}&name=${encodeURIComponent(x.name)}`); } catch (e) { fail(e); } };
  const create = async () => { try { const x = await api("/rooms", { method: "POST", body: mk }); setMk(null); nav(`/room?id=${x.room.id}&name=${encodeURIComponent(mk.name)}`); } catch (e) { fail(e); } };
  return <><div className="px"><button className="btn full" onClick={() => setMk({ name: "", description: "", is_public: true })}><Icon n="plus" size={18} />Start a community</button></div>
    <div className="list mt8">{r.loading ? <Skel n={4} h={60} /> : r.data?.rooms.length ? r.data.rooms.map((x) => <button key={x.id} className="item" onClick={() => (x.joined ? nav(`/room?id=${x.id}&name=${encodeURIComponent(x.name)}`) : join(x))}><span className="logo"><span className="fb" style={{ background: "var(--card2)" }}>#</span></span><div className="sp" style={{ minWidth: 0 }}><div className="t ell">{x.name}</div><div className="u ell">{x.description || "No description"} · {x.members} members</div></div><span className={cn("chip", x.joined && "teal")}>{x.joined ? "Open" : "Join"}</span></button>) : <Empty title="No communities yet">Start the first one: a memecoin group, a strategy club, anything.</Empty>}</div>
    {mk && <Sheet onClose={() => setMk(null)}><b className="fs16">New community</b><div className="col g10 mt12"><input className="in" placeholder="Name" value={mk.name} onChange={(e) => setMk({ ...mk, name: e.target.value })} maxLength={48} /><textarea className="ta" style={{ minHeight: 70 }} placeholder="What is it about?" value={mk.description} onChange={(e) => setMk({ ...mk, description: e.target.value })} maxLength={300} /><button className="btn full" disabled={mk.name.trim().length < 3} onClick={create}>Create</button></div></Sheet>}</>;
}

function Messages() {
  const r = useApi("/rooms?kind=dm", { poll: 30000 });
  return <div className="list">{r.loading ? <Skel n={3} h={56} /> : r.data?.rooms.length ? r.data.rooms.map((x) => <button key={x.id} className="item" onClick={() => nav(`/room?id=${x.id}&name=${encodeURIComponent(x.with?.display_name || "Chat")}`)}><Avatar p={x.with} /><div className="sp"><div className="t">{x.with?.display_name || "Conversation"}</div><div className="u">@{x.with?.handle}</div></div><Icon n="chev" size={18} /></button>) : <Empty title="No conversations">Open someone's profile and tap Message.</Empty>}</div>;
}

export default function Social({ q }) {
  const [tab, setTab] = useState(q.tab || "feed"); const [sub, setSub] = useState("ai");
  return <><Header title="Social" right={<button className="ibtn" aria-label="My profile" onClick={() => nav("/profile")}><Icon n="user" /></button>} /><div className="px mb8"><Seg value={tab} set={setTab} opts={[["feed", "Feed"], ["community", "Community"], ["chat", "Chat"], ["people", "People"]]} /></div>
    {tab === "feed" && <Feed />}{tab === "community" && <Communities />}{tab === "people" && <People />}
    {tab === "chat" && <><div className="px mb8"><Seg value={sub} set={setSub} opts={[["ai", "My AI"], ["dm", "Messages"]]} /></div>{sub === "ai" ? <Assistant /> : <Messages />}</>}</>;
}

export function Room({ q }) {
  const [msgs, setMsgs] = useState([]); const [text, setText] = useState(""); const [err, setErr] = useState(null); const last = useRef(0); const end = useRef(null); const [ready, setReady] = useState(false);
  useEffect(() => { let on = true; last.current = 0; setMsgs([]); setReady(false); const tick = async () => { if (document.hidden) return; try { const d = await api(`/rooms/${q.id}/messages${last.current ? "?after=" + last.current : ""}`); if (!on) return; setReady(true); setErr(null); if (d.messages.length) { last.current = Math.max(last.current, ...d.messages.map((m) => m.id)); setMsgs((m) => (last.current && m.length ? [...m, ...d.messages] : d.messages)); } } catch (e) { on && setErr(e); } }; tick(); const t = setInterval(tick, 3000); return () => { on = false; clearInterval(t); }; }, [q.id]);
  useEffect(() => { end.current?.scrollIntoView({ block: "end" }); }, [msgs.length]);
  const send = async () => { const t = text.trim(); if (!t) return; setText(""); try { await api(`/rooms/${q.id}/messages`, { method: "POST", body: { body: t } }); const d = await api(`/rooms/${q.id}/messages?after=${last.current || 0}`); if (d.messages.length) { last.current = Math.max(...d.messages.map((m) => m.id)); setMsgs((m) => [...m, ...d.messages]); } } catch (e) { fail(e); setText(t); } };
  return <><Header back title={q.name || "Chat"} /><div className="px col g8" style={{ minHeight: "60dvh", paddingBottom: 12 }}>
    {err && <Notice>{err.message}</Notice>}{ready && !msgs.length && <Empty title="No messages yet">Say hi.</Empty>}
    {msgs.map((m) => <div key={m.id} className="col" style={{ alignItems: m.mine ? "flex-end" : "flex-start" }}>{!m.mine && <span className="fs11 mut" style={{ margin: "0 6px 2px" }}>{m.sender.display_name}</span>}<div className={cn("bub", m.mine ? "me" : "them")}>{m.body}</div></div>)}<div ref={end} /></div>
    <div className="compose"><input className="in" value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === "Enter" && send()} placeholder="Message" maxLength={2000} /><button className="btn" aria-label="Send" disabled={!text.trim()} onClick={send}><Icon n="up" size={18} /></button></div></>;
}

export function Profile({ q }) {
  const p = useApi(`/profile${q.handle ? "?handle=" + encodeURIComponent(q.handle) : ""}`); const [edit, setEdit] = useState(null); const [busy, setBusy] = useState(false); const d = p.data;
  const follow = async () => { try { await api("/social/follow", { method: "POST", body: { userId: d.profile.user_id, follow: !d.following } }); p.reload(); } catch (e) { fail(e); } };
  const dm = async () => { try { const r = await api("/dm", { method: "POST", body: { userId: d.profile.user_id } }); nav(`/room?id=${r.roomId}&name=${encodeURIComponent(d.profile.display_name)}`); } catch (e) { fail(e); } };
  const pick = async (kind, file) => { if (!file) return; try {
    if (kind === "banner" && file.type.startsWith("video/")) { const s = await videoSeconds(file); if (s > 10.05) throw new Error(`That clip is ${s.toFixed(1)}s. Banner videos can be up to 10 seconds.`); if (s < 1) throw new Error("That clip is too short (minimum 1 second)."); setEdit((e) => ({ ...e, banner_seconds: Math.round(s * 10) / 10, banner_kind: "video", bannerFile: file, bannerPreview: URL.createObjectURL(file) })); }
    else if (kind === "banner") setEdit((e) => ({ ...e, banner_kind: "image", banner_seconds: null, bannerFile: file, bannerPreview: URL.createObjectURL(file) }));
    else setEdit((e) => ({ ...e, avatarFile: file, avatarPreview: URL.createObjectURL(file) })); } catch (e) { fail(e); } };
  const save = async () => { setBusy(true); try { const b = { display_name: edit.display_name, bio: edit.bio || "", handle: edit.handle };
    if (edit.avatarFile) b.avatar_url = await uploadMedia(edit.avatarFile);
    if (edit.bannerFile) { b.banner_url = await uploadMedia(edit.bannerFile); b.banner_kind = edit.banner_kind; b.banner_seconds = edit.banner_seconds; } else if (edit.clearBanner) b.banner_url = null;
    await api("/profile", { method: "PUT", body: b }); setEdit(null); p.reload(); toast("Profile saved"); } catch (e) { fail(e); } setBusy(false); };
  if (p.loading) return <><Header back title="Profile" /><Skel n={3} h={100} /></>; if (p.error) return <><Header back title="Profile" /><Empty title="Not available">{p.error.message}</Empty></>;
  const pr = d.profile;
  return <><Header back title={d.isMe ? "My profile" : "@" + pr.handle} />
    <div className="banner">{pr.banner_url && (pr.banner_kind === "video" ? <video src={pr.banner_url} autoPlay muted loop playsInline /> : <img src={pr.banner_url} alt="" />)}</div>
    <div className="row" style={{ alignItems: "flex-end" }}><div className="avatar-lg"><Avatar p={pr} size="xl" /></div><span className="sp" />{d.isMe ? <button className="btn sec2 sm2" style={{ marginRight: 18 }} onClick={() => setEdit({ display_name: pr.display_name, bio: pr.bio || "", handle: pr.handle })}>Edit profile</button> : <div className="row g8" style={{ marginRight: 18 }}><button className="btn sec2 sm2" onClick={dm}>Message</button><button className={cn("btn sm2", d.following && "sec2")} onClick={follow}>{d.following ? "Following" : "Follow"}</button></div>}</div>
    <div className="px mt8"><div className="bb fs18">{pr.display_name}</div><div className="fs13 mut">@{pr.handle}</div>{pr.bio && <p className="fs14" style={{ lineHeight: 1.5, margin: "8px 0 0" }}>{pr.bio}</p>}<div className="row g16 mt12 fs13"><span><b>{d.counts.posts}</b> <span className="mut">posts</span></span><span><b>{d.counts.followers}</b> <span className="mut">followers</span></span><span><b>{d.counts.following}</b> <span className="mut">following</span></span></div></div>
    <div className="sec"><h2>Posts</h2></div>{d.posts.length ? d.posts.map((x) => <div key={x.id} className="post"><div className="fs11 dim">{ago(x.created_at)}</div><p>{x.body}</p>{x.media_url && (/\.(mp4|webm)$/i.test(x.media_url) ? <video src={x.media_url} controls playsInline muted /> : <img src={x.media_url} alt="" />)}</div>) : <Empty title="No posts yet" />}
    {edit && <Sheet onClose={() => setEdit(null)} title="Edit profile"><b className="fs16">Edit profile</b><div className="col g10 mt12">
      <div className="banner" style={{ borderRadius: 14, height: 110 }}>{(edit.bannerPreview || (!edit.clearBanner && pr.banner_url)) && (((edit.banner_kind || pr.banner_kind) === "video") ? <video src={edit.bannerPreview || pr.banner_url} autoPlay muted loop playsInline /> : <img src={edit.bannerPreview || pr.banner_url} alt="" />)}</div>
      <div className="row g8"><label className="btn sec2 sm2 sp"><Icon n="play" size={15} />Banner (up to 10s)<input type="file" className="hide" accept="video/mp4,video/webm,image/png,image/jpeg,image/webp,image/gif" onChange={(e) => pick("banner", e.target.files[0])} /></label>{(pr.banner_url || edit.bannerPreview) && <button className="btn sec2 sm2" onClick={() => setEdit({ ...edit, bannerFile: null, bannerPreview: null, clearBanner: true })}>Remove</button>}</div>
      {edit.banner_seconds && <span className="fs11 mut">Video banner: {edit.banner_seconds}s, loops silently.</span>}
      <div className="row g12"><Avatar p={{ ...pr, avatar_url: edit.avatarPreview || pr.avatar_url }} size="xl" /><label className="btn sec2 sm2"><Icon n="camera" size={15} />Change picture<input type="file" className="hide" accept="image/png,image/jpeg,image/webp,image/gif" onChange={(e) => pick("avatar", e.target.files[0])} /></label></div>
      <label className="col g4"><span className="lbl">Name</span><input className="in" value={edit.display_name} onChange={(e) => setEdit({ ...edit, display_name: e.target.value })} maxLength={40} /></label>
      <label className="col g4"><span className="lbl">Handle</span><input className="in" value={edit.handle} onChange={(e) => setEdit({ ...edit, handle: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "") })} maxLength={20} /></label>
      <label className="col g4"><span className="lbl">Bio</span><textarea className="ta" style={{ minHeight: 64 }} value={edit.bio} onChange={(e) => setEdit({ ...edit, bio: e.target.value })} maxLength={280} /></label>
      <button className="btn full" disabled={busy || !edit.display_name.trim() || edit.handle.length < 3} onClick={save}>{busy ? "Saving…" : "Save"}</button></div></Sheet>}
  </>;
}
