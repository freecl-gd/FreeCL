// The only way into `submissions`. PostgREST insert is revoked, so the captcha here
// cannot be skipped by calling the table directly.
import { TYPES, tableFor, lengthError } from "../_shared/lists.js";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { CAPTCHA_MISCONFIGURED, captchaPassed, clientIp } from "../_shared/turnstile.ts";

const SITE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? Deno.env.get("SUPABASE_SECRET_KEY") ?? Deno.env.get("ADMIN_SECRET_KEY")!;
const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;
const YOUTUBE_URL_ID = /(?:youtu\.be\/|[?&]v=|\/(?:embed|shorts|live)\/)([A-Za-z0-9_-]{11})(?:[?&#/]|$)/i;
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const fail = (status: number, error: string) => new Response(JSON.stringify({ error }), { status, headers: { ...CORS, "Content-Type": "application/json" } });
const text = (value: unknown, max: number) => (typeof value === "string" ? value.trim().slice(0, max) : "");

// Accepts a bare id or any of the YouTube URL shapes, same rule the sheet used.
function youtubeId(value: unknown) {
  const raw = text(value, 200);
  if (!raw) return "";
  if (YOUTUBE_ID.test(raw)) return raw;
  return raw.match(YOUTUBE_URL_ID)?.[1] ?? null;
}

function mapPayload(input: Record<string, unknown>) {
  const name = text(input.name, 80);
  const levelId = text(input.levelId, 20);
  const video = youtubeId(input.video);
  if (!name) return "맵 이름을 입력해 주세요.";
  if (!/^\d{1,20}$/.test(levelId)) return "레벨 ID는 숫자만 입력해 주세요.";
  if (video === null) return "YouTube 주소나 영상 ID를 확인해 주세요.";
  return {
    name,
    levelId,
    video,
    creator: text(input.creator, 80),
    verifier: text(input.verifier, 80),
    description: text(input.description, 120),
    length: text(input.length, 20),
    objectCount: text(input.objectCount, 20),
  };
}

// 순위가 뒤로 갈수록 더 높은 달성도를 요구한다. 1위 30%에서 마지막 순위 약 80%까지 선형.
// 같은 식이 submit.jsx에도 있지만 안내용이고, 실제로 막는 곳은 여기다.
const minPercent = (position: number, total: number) => Math.round(30 + ((position - 1) / Math.max(total, 1)) * 50);

function recordPayload(input: Record<string, unknown>, type: string, floor: number) {
  const levelId = text(input.levelId, 20);
  const platform = text(input.platform, 40);
  const video = youtubeId(input.video);
  if (!levelId) return "맵을 선택해 주세요.";
  if (!platform) return "플랫폼을 입력해 주세요.";
  if (video === null) return "YouTube 주소나 영상 ID를 확인해 주세요.";
  if (!video) return "클리어 영상을 입력해 주세요.";
  if (type === "platformer") {
    const time = Number(input.time);
    if (!Number.isFinite(time) || time <= 0) return "기록 시간을 확인해 주세요.";
    return { levelId, platform, video, time };
  }
  const percent = Number(input.percent);
  if (!Number.isInteger(percent) || percent < 1 || percent > 100) return "달성도는 1에서 100 사이여야 합니다.";
  if (percent < floor) return `${floor}% 이상만 제출할 수 있는 순위의 맵입니다.`;
  return { levelId, platform, video, percent };
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (request.method !== "POST") return fail(405, "POST only");

  const authorization = request.headers.get("Authorization") ?? "";
  const admin = createClient(SITE_URL, SERVICE_KEY);
  const { data: auth } = await admin.auth.getUser(authorization.replace("Bearer ", ""));
  if (!auth.user) return fail(401, "로그인이 필요합니다.");
  const caller = createClient(SITE_URL, SERVICE_KEY, { global: { headers: { Authorization: authorization } }, auth: { persistSession: false } });
  const active = await caller.rpc("is_active_account");
  if (active.error) return fail(503, "계정 상태를 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.");
  if (!active.data) return fail(403, "정지되었거나 삭제된 계정입니다.");

  let input: Record<string, unknown>;
  try {
    input = await request.json();
  } catch {
    return fail(400, "요청 형식이 올바르지 않습니다.");
  }

  const captcha = await captchaPassed(input.captchaToken, clientIp(request));
  if (captcha === "misconfigured") return fail(500, CAPTCHA_MISCONFIGURED);
  if (!captcha) return fail(400, "캡차 확인에 실패했습니다. 다시 시도해 주세요.");

  const kind = input.kind === "map" ? "map" : input.kind === "record" ? "record" : null;
  if (!kind) return fail(400, "알 수 없는 제출 종류입니다.");

  let type = input.type === undefined ? "classic" : String(input.type);
  if (!TYPES.some(([value]) => value === type)) return fail(400, "알 수 없는 분류입니다.");
  let floor = 1;
  if (kind === "record") {
    // The map decides classic vs platformer, never the client — and its position decides
    // the minimum percent, so the client cannot argue that either.
    const { data: map } = await admin.from(tableFor(type, "maps")).select("type, position").eq("level_id", text(input.levelId, 20)).maybeSingle();
    if (!map) return fail(400, "등재되지 않은 맵입니다.");
    type = map.type;
    if (type !== "platformer") {
      const { count } = await admin.from(tableFor(type, "maps")).select("level_id", { count: "exact", head: true }).eq("type", type);
      floor = minPercent(map.position, count ?? 1);
    }
  }

  const payload = kind === "map" ? mapPayload(input) : recordPayload(input, type, floor);
  if (typeof payload === "string") return fail(400, payload);

  if (kind === "record") {
    // The records trigger is the rule; this only says so while the player is still on the
    // form, instead of leaving a submission that can never be approved.
    const record = payload as { levelId: string; percent?: number; time?: number };
    const { data: best } = await admin.from(tableFor(type, "records")).select("percent, time").eq("level_id", record.levelId).eq("user_id", auth.user.id).maybeSingle();
    if (best) {
      const isTime = record.time !== undefined;
      const mine = isTime ? `${Number(best.time)}s` : `${best.percent}%`;
      if (isTime ? record.time === Number(best.time) : record.percent === best.percent) return fail(409, `이미 같은 기록이 있습니다. (${mine})`);
      if (isTime ? record.time! > Number(best.time) : record.percent! < best.percent) return fail(400, `기존 기록(${mine})보다 좋지 않은 기록입니다.`);
    }
  }

  if (kind === "map") {
    const invalidLength = lengthError(type, (payload as { length: string }).length);
    if (invalidLength) return fail(400, invalidLength);
    // Credits must name a registered account. The form only searches profiles, so this is
    // the check that makes that a rule rather than a convention.
    for (const [field, label] of [["creator", "제작자"], ["verifier", "베리파이어"]] as const) {
      const name = (payload as Record<string, string>)[field].toLowerCase();
      if (!name) continue;
      const { data: profile } = await admin.from("profiles").select("id").eq("username", name).maybeSingle();
      if (!profile) return fail(400, `${label}는 가입된 닉네임이어야 합니다. 검색 후 목록에서 선택해 주세요.`);
    }
  }

  const { error } = await admin.from(tableFor(type, "submissions")).insert({ kind, type, payload, user_id: auth.user.id });
  if (error) return fail(500, `저장에 실패했습니다. (${error.code})`);
  return new Response(JSON.stringify({ ok: true }), { headers: { ...CORS, "Content-Type": "application/json" } });
});
