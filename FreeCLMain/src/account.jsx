import { useEffect, useRef, useState } from "react";
import { callFunction, supabase } from "./supabase.js";
import { SITE_KEY, mountTurnstile } from "./turnstile.js";

const MESSAGES = {
  invalid_credentials: "닉네임 또는 비밀번호가 올바르지 않습니다.",
  check_constraint_violation: "닉네임 조건: 영문 소문자/숫자/_, 2~20자",
  email_not_confirmed: "메일함에서 인증 링크를 먼저 눌러 주세요.",
  user_already_exists: "이미 가입된 이메일입니다.",
  email_exists: "이미 가입된 이메일입니다.",
  weak_password: "비밀번호는 6자 이상이어야 합니다.",
  over_email_send_rate_limit: "메일 전송이 너무 잦습니다. 잠시 후 다시 시도해 주세요.",
  over_request_rate_limit: "요청이 너무 잦습니다. 잠시 후 다시 시도해 주세요.",
  captcha_failed: "캡차 확인에 실패했습니다. 다시 시도해 주세요.",
  otp_expired: "코드가 만료되었습니다. 다시 받아 주세요.",
  validation_failed: "입력값을 다시 확인해 주세요.",
};

const USERNAME = /^[a-z0-9_]{2,20}$/;
const USERNAME_RULE = "조건: 영문 소문자/숫자/_, 2~20자";

const describe = (error) => MESSAGES[error.code]
  ?? (/duplicate key|profiles_username_ci/i.test(error.message) ? "이미 사용 중인 닉네임입니다."
    : /Database error saving new user/i.test(error.message) ? "가입할 수 없는 이메일 또는 닉네임입니다."
    : `요청에 실패했습니다. (${error.code ?? error.message})`);

export function useSession() {
  const [session, setSession] = useState(undefined);
  useEffect(() => {
    let active = true;
    let current = null;
    let version = 0;
    const check = async (next) => {
      current = next;
      const request = ++version;
      if (!next) { if (active) setSession(null); return; }
      const { data, error } = await supabase.rpc("is_active_account");
      if (!active || request !== version) return;
      setSession(!error && data ? next : null);
      if (!error && !data) await supabase.auth.signOut({ scope: "local" });
    };
    supabase.auth.getSession().then(({ data }) => check(data.session));
    // Defer work outside the Auth callback, which holds the session lock.
    const { data } = supabase.auth.onAuthStateChange((_event, next) => { window.setTimeout(() => { if (active) check(next); }, 0); });
    const refresh = () => { if (current) check(current); };
    window.addEventListener("focus", refresh);
    const timer = window.setInterval(refresh, 60000);
    return () => { active = false; data.subscription.unsubscribe(); window.removeEventListener("focus", refresh); window.clearInterval(timer); };
  }, []);
  return session;
}

// A Turnstile token is single-use, so every attempt remounts the widget for a fresh one.
// `ready` keeps the submit button off until a token exists (always on without a site key).
export function useCaptcha() {
  const [token, setToken] = useState("");
  const [round, setRound] = useState(0);
  return {
    token,
    ready: !SITE_KEY || Boolean(token),
    element: <Captcha key={round} onToken={setToken} />,
    reset: () => { setToken(""); setRound((value) => value + 1); },
  };
}

export function Captcha({ onToken }) {
  const slot = useRef(null);
  const [failure, setFailure] = useState("");
  useEffect(() => mountTurnstile(slot.current, onToken, setFailure), [onToken]);
  if (!SITE_KEY) return null;
  return <div className="captcha">
    <div ref={slot} />
    {failure && <p className="error">캡차를 불러오지 못했습니다. ({failure})</p>}
  </div>;
}

function AuthForm({ mode, onDone }) {
  const signingUp = mode === "signup";
  const captcha = useCaptcha();
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  const signUp = async ({ username, email, password }) => {
    // The unique index on profiles is the real guard; this only turns the collision into
    // a useful message instead of a failed trigger.
    const { data: taken } = await supabase.from("profiles").select("id").eq("username", username).maybeSingle();
    if (taken) return setError("이미 사용 중인 닉네임입니다.");
    // Banned emails, withdrawn emails within 30 days and other people's withdrawn nicknames are
    // refused by database triggers; this only says why.
    // If the check itself fails, GoTrue still refuses and the generic message below applies.
    const { data: blocked } = await supabase.rpc("signup_blocked", { p_email: email, p_username: username });
    if (blocked === "email") return setError("정지된 계정입니다.");
    if (blocked === "withdrawn") return setError("탈퇴한 이메일은 탈퇴 30일 후에 다시 가입할 수 있습니다.");
    if (blocked === "username") return setError("사용할 수 없는 닉네임입니다.");

    const { data, error: failure } = await supabase.auth.signUp({
      email,
      password,
      // No redirect override on purpose: Supabase then uses the dashboard's Site URL, so a
      // signup made from localhost still confirms on the real site.
      options: { captchaToken: captcha.token || undefined, data: { username } },
    });
    if (failure) return setError(describe(failure));
    // Supabase hides "this email is taken" behind a fake success to stop address probing;
    // an empty identities array is what gives it away.
    if (data.user && data.user.identities?.length === 0) return setError("이미 가입된 이메일입니다.");
    if (!data.session) return setNotice("인증 메일을 보냈습니다. 링크를 눌러 가입을 완료해 주세요.");
    onDone();
  };

  const signIn = async ({ username, password }) => {
    const session = await callFunction("login", { username, password, captchaToken: captcha.token || undefined });
    await supabase.auth.setSession({ access_token: session.access_token, refresh_token: session.refresh_token });
    onDone();
  };

  const submit = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    const values = Object.fromEntries(new FormData(event.currentTarget));
    const username = values.username.trim();
    if (!USERNAME.test(username)) {
      setError(USERNAME_RULE);
      setBusy(false);
      return;
    }
    try {
      await (signingUp ? signUp({ ...values, username }) : signIn({ ...values, username }));
    } catch (failure) {
      setError(failure.message);
    }
    captcha.reset();
    setBusy(false);
  };

  if (notice) return <p className="ok" role="status">{notice}</p>;

  return (
    <form onSubmit={submit}>
      <label>닉네임<input name="username" autoComplete="username" pattern="[a-z0-9_]{2,20}" maxLength="20" minLength="2" required title={USERNAME_RULE} /></label>
      <p className="field-hint">{USERNAME_RULE}</p>
      {signingUp && <label>이메일<input name="email" type="email" autoComplete="email" required /></label>}
      <label>비밀번호<input name="password" type="password" autoComplete={signingUp ? "new-password" : "current-password"} minLength="6" required /></label>
      {captcha.element}
      <button disabled={busy || !captcha.ready} type="submit">{busy ? "처리 중…" : signingUp ? "가입하기" : "로그인"}</button>
      {error && <p className="error" role="alert">{error}</p>}
    </form>
  );
}

// Recovery goes through Supabase's own recovery mail, which can carry a one-time code
// instead of a link. Verifying the code signs the account in, which is what lets the same
// step both reveal the nickname and set a new password.
function RecoverForm({ onDone }) {
  const captcha = useCaptcha();
  const [stage, setStage] = useState({ step: "request" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const request = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    const email = String(new FormData(event.currentTarget).get("email")).trim();
    const { error: failure } = await supabase.auth.resetPasswordForEmail(email, { captchaToken: captcha.token || undefined });
    captcha.reset();
    setBusy(false);
    // Supabase answers the same for an unknown address, which is what stops this being an
    // account probe. Say what was sent, not whether it matched.
    if (failure) return setError(describe(failure));
    setStage({ step: "verify", email });
  };

  const verify = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    const values = Object.fromEntries(new FormData(event.currentTarget));
    if (String(values.password).length < 6) { setBusy(false); return setError("비밀번호는 6자 이상이어야 합니다."); }
    if (values.password !== values.confirm) { setBusy(false); return setError("두 비밀번호가 다릅니다."); }

    const { data, error: failure } = await supabase.auth.verifyOtp({ email: stage.email, token: String(values.token).trim(), type: "recovery" });
    if (failure || !data.user) { setBusy(false); return setError(describe(failure ?? { code: "otp_expired" })); }
    const updated = await supabase.auth.updateUser({ password: String(values.password) });
    if (updated.error) { setBusy(false); return setError(describe(updated.error)); }
    const { data: profile } = await supabase.from("profiles").select("username").eq("id", data.user.id).maybeSingle();
    setBusy(false);
    setStage({ step: "done", username: profile?.username ?? "" });
  };

  if (stage.step === "done") {
    return <div className="recover-done">
      <p className="ok" role="status">비밀번호를 새로 설정했습니다.</p>
      <p>회원님의 아이디는 <strong>{stage.username || "확인할 수 없습니다"}</strong> 입니다.</p>
      <button onClick={onDone} type="button">확인</button>
    </div>;
  }

  if (stage.step === "verify") {
    return <form key="verify" onSubmit={verify}>
      <p className="ok" role="status">{stage.email} 로 8자리 코드를 보냈습니다. 메일함(스팸함 포함)을 확인해 주세요.</p>
      <label>인증 코드<small>8자리</small><input autoComplete="one-time-code" inputMode="numeric" name="token" required /></label>
      <label>새 비밀번호<input autoComplete="new-password" minLength="6" name="password" required type="password" /></label>
      <label>새 비밀번호 확인<input autoComplete="new-password" minLength="6" name="confirm" required type="password" /></label>
      <button disabled={busy} type="submit">{busy ? "확인 중…" : "아이디 확인 및 비밀번호 재설정"}</button>
      <button className="link-button" onClick={() => setStage({ step: "request" })} type="button">다른 이메일로 다시 받기</button>
      {error && <p className="error" role="alert">{error}</p>}
    </form>;
  }

  return <form key="request" onSubmit={request}>
    <p className="field-hint">가입할 때 쓴 이메일 주소를 넣어 주세요. 그 주소로 인증 코드를 보냅니다.</p>
    <label>이메일<input autoComplete="email" name="email" required type="email" /></label>
    {captcha.element}
    <button disabled={busy || !captcha.ready} type="submit">{busy ? "보내는 중…" : "코드 받기"}</button>
    {error && <p className="error" role="alert">{error}</p>}
  </form>;
}

export function AccountButton({ session }) {
  const dialog = useRef(null);
  const [mode, setMode] = useState("login");
  // A closed <dialog> is display:none, and Turnstile will not draw into a hidden box.
  // Mount the form only while the dialog is actually open.
  const [open, setOpen] = useState(false);

  const show = () => {
    setOpen(true);
    dialog.current.showModal();
  };
  const hide = () => {
    dialog.current?.close();
    setOpen(false);
  };

  if (session === undefined) return null;
  if (session) {
    return <div className="nav-account">
      <a className="account-name" href="/account/">{session.user.user_metadata?.username ?? "계정"}</a>
      <button className="nav-link" onClick={() => supabase.auth.signOut()} type="button">LOGOUT</button>
    </div>;
  }

  return <div className="nav-account">
    <button className="nav-link" onClick={show} type="button">LOGIN</button>
    {/* <dialog> brings its own focus trap, Esc handling and backdrop. */}
    <dialog className="account-dialog" onClose={() => setOpen(false)} ref={dialog}>
      <div className="account-tabs" role="tablist">
        <button aria-selected={mode === "login"} onClick={() => setMode("login")} role="tab" type="button">로그인</button>
        <button aria-selected={mode === "signup"} onClick={() => setMode("signup")} role="tab" type="button">회원가입</button>
        <button aria-selected={mode === "recover"} onClick={() => setMode("recover")} role="tab" type="button">계정 찾기</button>
      </div>
      {open && (mode === "recover" ? <RecoverForm key={mode} onDone={hide} /> : <AuthForm key={mode} mode={mode} onDone={hide} />)}
      <button className="account-close" onClick={hide} type="button">닫기</button>
    </dialog>
  </div>;
}
