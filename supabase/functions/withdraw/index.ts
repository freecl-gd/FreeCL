// Self-service withdrawal. Deletes the account after recording digests of its email and
// nickname (see email-bans.sql, withdrawal-cooldown.sql): the email may sign up again after
// 30 days, and the nickname stays reserved for that email. Their clears are erased and
// their map credits left blank.
import { createClient } from "jsr:@supabase/supabase-js@2";
import { identityHash } from "../_shared/withdrawn.ts";

const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" };
const COOLDOWN_MS = 30 * 86400 * 1000;
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

export async function handle(request: Request) {
  if (request.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (request.method !== "POST") return json({ error: "POST only" }, 405);
  const authorization = request.headers.get("Authorization") ?? "";
  const url = Deno.env.get("SUPABASE_URL")!;
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? Deno.env.get("SUPABASE_SECRET_KEY") ?? Deno.env.get("ADMIN_SECRET_KEY")!;
  const admin = createClient(url, key, { auth: { persistSession: false } });
  const caller = createClient(url, key, { global: { headers: { Authorization: authorization } }, auth: { persistSession: false } });
  const { data: auth, error: authError } = await admin.auth.getUser(authorization.replace(/^Bearer /i, ""));
  const user = auth?.user;
  const email = user?.email;
  if (authError || !user || !email) return json({ error: "로그인이 필요합니다." }, 401);

  let input: { username?: unknown };
  try { input = await request.json(); } catch { return json({ error: "요청 형식이 올바르지 않습니다." }, 400); }

  // A banned account keeps its ban: it cannot withdraw (it normally cannot even sign in;
  // this covers an access token issued before the ban).
  const [active, profile, role] = await Promise.all([
    caller.rpc("is_active_account"),
    admin.from("profiles").select("username").eq("id", user.id).maybeSingle(),
    admin.from("admins").select("role_id").eq("user_id", user.id).maybeSingle(),
  ]);
  if (active.error || profile.error || role.error) return json({ error: "계정 상태를 확인하지 못했습니다." }, 500);
  if (!active.data) return json({ error: "정지된 계정은 탈퇴할 수 없습니다." }, 403);
  // Any admin row, Root (role 0) or admin (role 1): revoke the grant first, then withdraw.
  if (role.data) return json({ error: "관리자 계정은 탈퇴할 수 없습니다. 관리자 권한을 먼저 해제해 주세요." }, 403);
  const username = profile.data?.username ?? "";
  if (typeof input.username !== "string" || input.username.trim().toLowerCase() !== username) {
    return json({ error: "닉네임이 일치하지 않습니다." }, 400);
  }

  const emailHash = await identityHash(email);
  const { error: recordFailed } = await admin.from("blocked_emails")
    .upsert({ email_hash: emailHash, username_hash: await identityHash(username), reason: "withdrawn", banned_until: new Date(Date.now() + COOLDOWN_MS).toISOString() }, { onConflict: "email_hash" });
  if (recordFailed) return json({ error: "탈퇴를 처리하지 못했습니다. 다시 시도해 주세요." }, 500);

  const { data: files } = await admin.storage.from("avatars").list(user.id, { limit: 100 });
  if (files?.length) await admin.storage.from("avatars").remove(files.map((file) => `${user.id}/${file.name}`));

  // Clears, map credits and the account in one transaction (withdrawal-purge.sql).
  const { error: deleteFailed } = await admin.rpc("purge_account", { p_user_id: user.id });
  if (deleteFailed) {
    // The account still exists, so the block must not outlive the failure.
    await admin.from("blocked_emails").delete().eq("email_hash", emailHash);
    return json({ error: "탈퇴를 처리하지 못했습니다. 다시 시도해 주세요." }, 500);
  }
  return json({ ok: true });
}

if (import.meta.main) Deno.serve(handle);
