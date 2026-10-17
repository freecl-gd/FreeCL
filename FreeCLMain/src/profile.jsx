import { useEffect, useState } from "react";
import { useSession } from "./account.jsx";
import { callFunction, supabase } from "./supabase.js";

const USERNAME = /^[a-z0-9_]{2,20}$/;
const USERNAME_RULE = "조건: 영문 소문자/숫자/_, 2~20자";
const MAX_AVATAR = 2 * 1024 * 1024;

// Every section here is one save button over one table, so they share the plumbing and
// differ only in what save() does.
function Section({ children, className = "", onSave, title, submitLabel = "저장" }) {
  const [state, setState] = useState({});

  const submit = async (event) => {
    event.preventDefault();
    setState({ busy: true });
    try {
      setState({ done: await onSave(new FormData(event.currentTarget)) });
    } catch (failure) {
      setState({ error: failure.message });
    }
  };

  return <form className={`submit-form account-section ${className}`} onSubmit={submit}>
    <h2>{title}</h2>
    {children}
    <button disabled={state.busy} type="submit">{state.busy ? "저장 중…" : submitLabel}</button>
    {state.error && <p className="error" role="alert">{state.error}</p>}
    {state.done && <p className="ok" role="status">{state.done}</p>}
  </form>;
}

function Avatar({ profile, userId, onChanged }) {
  const [preview, setPreview] = useState(profile.avatar_url);
  const [state, setState] = useState({});

  const pick = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (file.size > MAX_AVATAR) return setState({ error: "이미지는 2MB 이하여야 합니다." });
    setState({ busy: true });
    // The path starts with the account id because that is what the storage policy checks.
    const path = `${userId}/${Date.now()}-${file.name.replace(/[^\w.]/g, "_").slice(-40)}`;
    const upload = await supabase.storage.from("avatars").upload(path, file, { upsert: true });
    if (upload.error) return setState({ error: upload.error.message });
    const { publicUrl } = supabase.storage.from("avatars").getPublicUrl(path).data;
    const { error } = await supabase.from("profiles").update({ avatar_url: publicUrl }).eq("id", userId);
    if (error) return setState({ error: error.message });
    setPreview(publicUrl);
    setState({ done: "프로필 사진을 바꿨습니다." });
    onChanged();
  };

  return <section className="submit-form account-section">
    <h2>프로필 사진</h2>
    <div className="avatar-row">
      {preview ? <img alt="현재 프로필 사진" className="avatar" src={preview} /> : <div aria-hidden="true" className="avatar avatar-empty">?</div>}
      <label>
        <span>이미지 선택<small>PNG · JPEG · WebP · GIF, 2MB 이하</small></span>
        <input accept="image/png,image/jpeg,image/webp,image/gif" disabled={state.busy} onChange={pick} type="file" />
      </label>
    </div>
    {state.error && <p className="error" role="alert">{state.error}</p>}
    {state.done && <p className="ok" role="status">{state.done}</p>}
  </section>;
}

function Settings({ isAdmin, profile, session, onChanged }) {
  const userId = session.user.id;

  const saveBio = async (form) => {
    const bio = String(form.get("bio")).slice(0, 120);
    const { error } = await supabase.from("profiles").update({ bio }).eq("id", userId);
    if (error) throw new Error(error.message);
    onChanged();
    return "자기소개를 저장했습니다.";
  };

  const saveUsername = async (form) => {
    const username = String(form.get("username")).trim().toLocaleLowerCase();
    if (!USERNAME.test(username)) throw new Error(USERNAME_RULE);
    if (username === profile.username) throw new Error("지금 쓰고 있는 닉네임입니다.");
    const { error } = await supabase.from("profiles").update({ username }).eq("id", userId);
    // The unique index is the real guard; this only turns it into a useful message.
    if (error) throw new Error(/duplicate key|profiles_username_ci/i.test(error.message) ? "이미 사용 중인 닉네임입니다."
      : /withdrawn username/i.test(error.message) ? "사용할 수 없는 닉네임입니다." : error.message);
    // The header reads the nickname off the token, so it has to move too.
    await supabase.auth.updateUser({ data: { username } });
    onChanged();
    return "닉네임을 바꿨습니다. 이전 닉네임으로 남아 있던 기록도 함께 옮겨집니다.";
  };

  const savePassword = async (form) => {
    const password = String(form.get("password"));
    if (password.length < 6) throw new Error("비밀번호는 6자 이상이어야 합니다.");
    if (password !== String(form.get("confirm"))) throw new Error("두 비밀번호가 다릅니다.");
    const { error } = await supabase.auth.updateUser({ password });
    if (error) throw new Error(error.message);
    return "비밀번호를 바꿨습니다.";
  };

  const withdraw = async (form) => {
    if (String(form.get("username")).trim().toLocaleLowerCase() !== profile.username) throw new Error("닉네임이 일치하지 않습니다.");
    if (!window.confirm("탈퇴하면 계정과 모든 클리어 기록이 바로 삭제되고, 30일 동안 이 이메일로 다시 가입할 수 없습니다. 계속할까요?")) return "";
    await callFunction("withdraw", { username: profile.username });
    await supabase.auth.signOut({ scope: "local" });
    window.location.assign("/");
    return "탈퇴했습니다.";
  };

  return <>
    <Avatar onChanged={onChanged} profile={profile} userId={userId} />

    <Section onSave={saveBio} title="자기소개">
      <label><span>소개<small>120자 이하</small></span><textarea defaultValue={profile.bio} maxLength="120" name="bio" rows="3" /></label>
    </Section>

    <Section onSave={saveUsername} submitLabel="닉네임 변경" title="닉네임">
      <label><span>새 닉네임<small>{USERNAME_RULE}</small></span><input defaultValue={profile.username} maxLength="20" minLength="2" name="username" pattern="[a-z0-9_]{2,20}" required /></label>
    </Section>

    <Section onSave={savePassword} submitLabel="비밀번호 변경" title="비밀번호">
      <label><span>새 비밀번호<small>6자 이상</small></span><input autoComplete="new-password" minLength="6" name="password" required type="password" /></label>
      <label><span>새 비밀번호 확인</span><input autoComplete="new-password" minLength="6" name="confirm" required type="password" /></label>
    </Section>

    {isAdmin ? <section className="submit-form account-section">
      <h2>회원 탈퇴</h2>
      <p className="field-hint">관리자 계정은 탈퇴할 수 없습니다. 관리자 권한을 먼저 해제해 주세요.</p>
    </section> : <Section className="account-danger" onSave={withdraw} submitLabel="회원 탈퇴" title="회원 탈퇴">
      <p className="field-hint">계정, 프로필, 프로필 사진이 삭제됩니다. 이 이메일로는 30일 뒤에 다시 가입할 수 있고, 지금 닉네임은 같은 이메일로 다시 가입할 때만 쓸 수 있습니다. 클리어 기록(레거시 포함)은 모두 삭제되고, 제작하거나 베리파이한 맵에는 제작자·베리파이어가 -로 남습니다.</p>
      <label><span>닉네임 확인<small>{profile.username} 입력</small></span><input autoComplete="off" name="username" required /></label>
    </Section>}
  </>;
}

export function AccountPage({ Navigation }) {
  const session = useSession();
  const [profile, setProfile] = useState(null);
  // admin_read RLS returns the row only to admins, so a row here means Root or admin.
  const [isAdmin, setIsAdmin] = useState(false);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    if (!session) return undefined;
    let active = true;
    supabase.from("profiles").select("username, bio, avatar_url").eq("id", session.user.id).maybeSingle()
      .then(({ data }) => { if (active) setProfile(data); });
    supabase.from("admins").select("user_id").eq("user_id", session.user.id).maybeSingle()
      .then(({ data }) => { if (active) setIsAdmin(Boolean(data)); });
    return () => { active = false; };
  }, [session, reload]);

  return <>
    <Navigation current="account" />
    <main className="page submit-page">
      <header className="detail-heading"><div><p className="eyebrow">FreeCL</p><h1>ACCOUNT</h1></div></header>
      {session === undefined ? <p className="muted">불러오는 중…</p>
        : !session ? <p className="muted">계정을 관리하려면 먼저 로그인해 주세요.</p>
        : !profile ? <p className="muted">불러오는 중…</p>
        : <>
            <p className="muted">{session.user.email} · <a href={`/user/?player=${encodeURIComponent(profile.username)}`}>내 프로필 보기</a></p>
            <Settings isAdmin={isAdmin} onChanged={() => setReload((count) => count + 1)} profile={profile} session={session} />
          </>}
    </main>
  </>;
}
