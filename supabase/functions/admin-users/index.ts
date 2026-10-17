import { createClient } from "jsr:@supabase/supabase-js@2";
import { banAttributes, canManage } from "./rules.ts";
import { identityHash } from "../_shared/withdrawn.ts";

const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" };
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
  if (authError || !auth.user) return json({ error: "로그인이 필요합니다." }, 401);
  const permission = await caller.rpc("is_admin");
  if (permission.error || !permission.data) return json({ error: "관리자 권한이 필요합니다." }, 403);

  let input: Record<string, unknown>;
  try {
    input = await request.json();
    if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error();
  } catch { return json({ error: "요청 형식이 올바르지 않습니다." }, 400); }
  if (!["ban", "unban"].includes(String(input.action)) || typeof input.userId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(input.userId)) {
    return json({ error: "계정과 작업을 확인해 주세요." }, 400);
  }
  const targetId = input.userId;
  const [role, root] = await Promise.all([
    admin.from("admins").select("role_id").eq("user_id", targetId).maybeSingle(),
    caller.rpc("is_root"),
  ]);
  if (role.error || root.error) return json({ error: "계정 권한을 확인하지 못했습니다." }, 500);
  if (!canManage(auth.user.id, root.data === true, targetId, role.data?.role_id ?? null)) {
    return json({ error: "본인과 Root 계정은 변경할 수 없습니다. 관리자 계정은 Root만 관리할 수 있습니다." }, 403);
  }
  const { data: target, error: missing } = await admin.auth.admin.getUserById(targetId);
  if (missing || !target.user) return json({ error: "계정을 찾을 수 없습니다. 목록을 새로고침해 주세요." }, 404);

  let attributes;
  try { attributes = banAttributes(input); }
  catch (error) { return json({ error: (error as Error).message }, 400); }
  const { until, ...authAttributes } = attributes;
  const { error: banError } = await admin.auth.admin.updateUserById(targetId, authAttributes);
  if (banError) return json({ error: "계정 정지 상태를 변경하지 못했습니다. 다시 시도해 주세요." }, 500);

  // The ban is per email: blocked_emails keeps the same email from signing up again while
  // the ban lasts. Both writes are idempotent, so a retry repairs a half-applied change.
  if (target.user.email) {
    const emailHash = await identityHash(target.user.email);
    const { error: listError } = input.action === "unban"
      ? await admin.from("blocked_emails").delete().eq("email_hash", emailHash).eq("reason", "ban")
      : await admin.from("blocked_emails").upsert({ email_hash: emailHash, reason: "ban", banned_until: until }, { onConflict: "email_hash" });
    if (listError) return json({ error: "차단 이메일 목록을 갱신하지 못했습니다. 다시 시도해 주세요." }, 500);
  }
  return json({ ok: true });
}

if (import.meta.main) Deno.serve(handle);
