import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { supabase } from "./supabase.js";
import { SITE_KEY, mountTurnstile } from "../../FreeCLMain/src/turnstile.js";
import { Queue } from "./queue.jsx";
import { Maps } from "./maps.jsx";
import { Records } from "./records.jsx";
import { Users } from "./users.jsx";
import "./styles.css";

function Login() {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  // Auth captcha is on, so sign-in needs a Turnstile token; each token is single-use.
  const slot = useRef(null);
  const [token, setToken] = useState("");
  const [round, setRound] = useState(0);
  useEffect(() => mountTurnstile(slot.current, setToken, setError), [round]);

  const signIn = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    const values = Object.fromEntries(new FormData(event.currentTarget));
    const { error: failure } = await supabase.auth.signInWithPassword({ email: values.email, password: values.password, options: { captchaToken: token || undefined } });
    setToken("");
    setRound((value) => value + 1);
    setBusy(false);
    if (failure) setError(failure.message);
  };

  return <main className="centred">
    <form className="card" onSubmit={signIn}>
      <h1>FreeCL 관리자</h1>
      <p className="muted">사이트 계정으로 로그인하세요.</p>
      <label>이메일<input autoComplete="email" name="email" required type="email" /></label>
      <label>비밀번호<input autoComplete="current-password" name="password" required type="password" /></label>
      <div className="captcha" key={round} ref={slot} />
      <button disabled={busy || (Boolean(SITE_KEY) && !token)} type="submit">{busy ? "확인 중…" : "로그인"}</button>
      {error && <p className="error" role="alert">{error}</p>}
    </form>
  </main>;
}

function Admins() {
  const [query, setQuery] = useState("");
  const [matches, setMatches] = useState([]);
  const [admins, setAdmins] = useState([]);
  const [adminQuery, setAdminQuery] = useState("");
  const [error, setError] = useState("");

  const load = async () => {
    const { data, error: failure } = await supabase.from("admins").select("user_id, role_id, profiles(username)").order("role_id").order("user_id");
    setError(failure?.message ?? "");
    setAdmins(data ?? []);
  };

  useEffect(() => { load(); }, []);
  useEffect(() => {
    const needle = query.replace(/[%_,()]/g, " ").trim();
    if (!needle) return setMatches([]);
    let active = true;
    const timer = window.setTimeout(async () => {
      const { data, error: failure } = await supabase.from("profiles").select("id, username").ilike("username", `%${needle}%`).order("username").limit(8);
      if (active) {
        setMatches(data ?? []);
        if (failure) setError(failure.message);
      }
    }, 250);
    return () => { active = false; window.clearTimeout(timer); };
  }, [query]);

  const assign = async (user) => {
    const { error: failure } = await supabase.rpc("grant_admin", { target_user_id: user.id });
    if (failure) return setError(failure.message);
    setQuery("");
    setMatches([]);
    load();
  };

  const remove = async (userId) => {
    const { error: failure } = await supabase.rpc("revoke_admin", { target_user_id: userId });
    if (failure) return setError(failure.message);
    load();
  };

  return <section className="queue">
    <h2>관리자 계정</h2>
    <label>유저 검색<input onChange={(event) => setQuery(event.target.value)} placeholder="닉네임 검색" type="search" value={query} /></label>
    {matches.map((user) => <div className="entry-actions" key={user.id}>
      <strong>{user.username}</strong><code>{user.id}</code>
      {admins.some((admin) => admin.user_id === user.id) ? <span className="muted">이미 관리자</span> : <button onClick={() => assign(user)} type="button">관리자 지정</button>}
    </div>)}
    <h3>현재 관리자</h3>
    <label>관리자 검색<input onChange={(event) => setAdminQuery(event.target.value)} placeholder="닉네임, 권한, 계정 ID 검색" type="search" value={adminQuery} /></label>
    <ul className="entries">{admins.filter((admin) => `${admin.profiles?.username ?? ""} ${admin.role_id === 0 ? "Root" : "Admin"} ${admin.user_id}`.toLowerCase().includes(adminQuery.trim().toLowerCase())).map((admin) => <li className="entry admin-row" key={admin.user_id}>
      <div><strong>{admin.profiles?.username ?? "계정 없음"}</strong> · {admin.role_id === 0 ? "Root" : "Admin"} · <code>{admin.user_id}</code></div>
      {admin.role_id !== 0 && <button className="ghost danger" onClick={() => remove(admin.user_id)} type="button">회수</button>}
    </li>)}</ul>
    {error && <p className="error" role="alert">{error}</p>}
  </section>;
}

function AdminGate({ user, children }) {
  const [state, setState] = useState("checking");
  useEffect(() => {
    supabase.rpc("is_admin").then(({ data, error }) => setState(error ? "error" : data ? "admin" : "denied"));
  }, []);
  if (state === "checking") return <p className="muted">권한 확인 중…</p>;
  if (state === "denied") return <p className="error">관리자 권한이 없습니다. 계정 ID: <code>{user.id}</code></p>;
  if (state === "error") return <p className="error">관리자 권한을 확인하지 못했습니다.</p>;
  return children;
}

function Dashboard({ user }) {
  const [section, setSection] = useState("queue");
  const [root, setRoot] = useState(false);

  useEffect(() => { supabase.rpc("is_root").then(({ data }) => setRoot(Boolean(data))); }, []);

  const sections = [["queue", "제출 검토"], ["maps", "맵 관리"], ["records", "기록 관리"], ["users", "유저 관리"], ...(root ? [["admins", "관리자"]] : [])];
  return <>
    <header className="topbar">
      <div className="shell topbar-row">
        <h1>FreeCL 관리자</h1>
        <div className="topbar-account">
          <span className="muted">{user.email} · <code>{user.id}</code></span>
          <button className="ghost" onClick={() => supabase.auth.signOut()} type="button">로그아웃</button>
        </div>
      </div>
      <nav className="shell sections" role="tablist">
        {sections.map(([value, label]) => <button aria-selected={section === value} key={value} onClick={() => setSection(value)} role="tab" type="button">{label}</button>)}
      </nav>
    </header>
    <main className="shell content">
      <AdminGate user={user}>
        {section === "queue" ? <Queue /> : section === "maps" ? <Maps /> : section === "records" ? <Records /> : section === "users" ? <Users actorId={user.id} root={root} /> : root && <Admins />}
      </AdminGate>
    </main>
  </>;
}

function App() {
  const [session, setSession] = useState(undefined);
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((_event, next) => setSession(next));
    return () => data.subscription.unsubscribe();
  }, []);
  if (session === undefined) return <main className="centred"><p className="muted">불러오는 중…</p></main>;
  return session ? <Dashboard user={session.user} /> : <Login />;
}

createRoot(document.getElementById("root")).render(<App />);
