// Signs in by nickname. The nickname -> email lookup happens here so the address never
// reaches the browser, and the sign-in itself still goes through GoTrue, which keeps its
// rate limiting and captcha checks.
import { createClient } from "jsr:@supabase/supabase-js@2";
import { CAPTCHA_MISCONFIGURED, captchaPassed, clientIp } from "../_shared/turnstile.ts";
import { SUSPENDED, identityHash } from "../_shared/withdrawn.ts";

const SITE_URL = Deno.env.get("SUPABASE_URL")!;
// Projects on the new API keys are given sb_secret_/sb_publishable_ names; older ones get
// the legacy JWTs. Supabase refuses to let you set a secret whose name starts with
// SUPABASE_, so ADMIN_SECRET_KEY is the name to set by hand if neither is injected.
const SECRET_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? Deno.env.get("SUPABASE_SECRET_KEY") ?? Deno.env.get("ADMIN_SECRET_KEY");
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("SUPABASE_PUBLISHABLE_KEY");
// Every sign-in leaves from this function, so GoTrue would rate-limit all visitors as one
// IP. An sb_secret_ key may pass the visitor's IP in Sb-Forwarded-For (legacy service_role
// JWTs may not). GoTrue skips its own captcha for a secret key, so this function checks
// Turnstile itself on that path.
const FORWARD_KEY = (Object.values(JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") ?? "{}")) as string[])
  .find((key) => typeof key === "string" && key.startsWith("sb_secret_"));
// Names only, never values. Without this a key problem is indistinguishable from a wrong
// password, which is what made this bug take so long to find.
const KEYS_PRESENT = ["SUPABASE_URL", "SUPABASE_ANON_KEY", "SUPABASE_PUBLISHABLE_KEY", "SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_SECRET_KEY", "ADMIN_SECRET_KEY"]
  .map((name) => `${name}=${Deno.env.get(name) ? "Y" : "N"}`).join(" ");
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
// One message for "no such nickname" and "wrong password", so this cannot be used to
// find out which nicknames exist. Everything that is NOT a credential problem gets its
// own message — hiding those made a broken deployment look like a wrong password.
const REJECTED = { error: "닉네임 또는 비밀번호가 올바르지 않습니다." };
const SIGN_IN_MESSAGES: Record<string, string> = {
  invalid_credentials: REJECTED.error,
  email_not_confirmed: "이메일 인증이 아직 완료되지 않았습니다. 메일함의 링크를 눌러 주세요.",
  over_request_rate_limit: "시도가 너무 잦습니다. 잠시 후 다시 시도해 주세요.",
  captcha_failed: "캡차 확인에 실패했습니다. 다시 시도해 주세요.",
  user_banned: SUSPENDED,
};

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (request.method !== "POST") return json({ error: "POST only" }, 405);

  let input: { username?: string; password?: string; captchaToken?: string };
  try {
    input = await request.json();
  } catch {
    return json({ error: "요청 형식이 올바르지 않습니다." }, 400);
  }

  if (!ANON_KEY) return json({ error: `서버 설정 오류: 공개 키 없음. ${KEYS_PRESENT}` }, 500);
  if (!SECRET_KEY) return json({ error: `서버 설정 오류: 비밀 키 없음. ${KEYS_PRESENT}` }, 500);

  const username = (input.username ?? "").trim();
  const password = input.password ?? "";
  if (!username || !password) return json(REJECTED, 400);
  // The shape of a nickname is not a secret, so say so plainly rather than pretending
  // the password was wrong.
  if (!/^[a-z0-9_]{2,20}$/.test(username)) {
    return json({ error: "닉네임 조건: 영문 소문자/숫자/_, 2~20자" }, 400);
  }

  const ip = clientIp(request);
  if (FORWARD_KEY) {
    const captcha = await captchaPassed(input.captchaToken, ip);
    if (captcha === "misconfigured") return json({ error: CAPTCHA_MISCONFIGURED }, 500);
    if (!captcha) return json({ error: SIGN_IN_MESSAGES.captcha_failed }, 400);
  }

  // profiles is public, so this read does not need the secret key at all.
  const anon = createClient(SITE_URL, ANON_KEY);
  const admin = createClient(SITE_URL, SECRET_KEY);
  // Nicknames are stored lowercase, so this is an exact match — no LIKE, no wildcards.
  const { data: profile, error: lookupFailed } = await anon
    .from("profiles").select("id").eq("username", username).maybeSingle();
  if (lookupFailed) {
    console.error("profile lookup failed", lookupFailed);
    return json({ error: `서버 오류: profiles 조회 실패 — ${lookupFailed.message} [${lookupFailed.code ?? "?"}] ${KEYS_PRESENT}` }, 500);
  }
  if (!profile) {
    // A withdrawn nickname belongs to no one now, whoever types it; say so instead of
    // "wrong password". A lookup error falls back to the ordinary rejection.
    const { data: gone } = await admin.from("blocked_emails").select("email_hash").eq("username_hash", await identityHash(username)).limit(1);
    return gone?.length ? json({ error: "사용할 수 없는 닉네임입니다." }, 400) : json(REJECTED, 400);
  }

  const { data: account, error: adminFailed } = await admin.auth.admin.getUserById(profile.id);
  if (adminFailed || !account?.user?.email) {
    console.error("getUserById failed", adminFailed);
    return json({ error: `서버 오류: 계정 정보 읽기 실패 — ${adminFailed?.message ?? "email 없음"} ${KEYS_PRESENT}` }, 500);
  }

  const signer = FORWARD_KEY
    ? createClient(SITE_URL, FORWARD_KEY, { global: { headers: ip ? { "sb-forwarded-for": ip } : {} } })
    : anon;
  const { data, error } = await signer.auth.signInWithPassword({
    email: account.user.email,
    password,
    options: FORWARD_KEY ? {} : { captchaToken: input.captchaToken },
  });
  if (error || !data.session) {
    console.error("signInWithPassword failed", error);
    return json({ error: SIGN_IN_MESSAGES[error?.code ?? ""] ?? `로그인에 실패했습니다. (${error?.code ?? error?.message ?? "unknown"})` }, 400);
  }
  return json({ access_token: data.session.access_token, refresh_token: data.session.refresh_token });
});
