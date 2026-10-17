// Server-side Turnstile check shared by `submit` and `login`. Fails closed.
const VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

// "misconfigured" means the secret is missing or Cloudflare rejected it — a server fault the
// caller should report as such, not as a failed captcha.
export async function captchaPassed(token: unknown, ip: string | null): Promise<boolean | "misconfigured"> {
  const secret = Deno.env.get("TURNSTILE_SECRET_KEY");
  if (!secret) return "misconfigured";
  if (typeof token !== "string" || !token) return false;
  const body = new FormData();
  body.append("secret", secret);
  body.append("response", token);
  if (ip) body.append("remoteip", ip);
  const response = await fetch(VERIFY_URL, { method: "POST", body });
  const result = response.ok ? await response.json() : {};
  if (result["error-codes"]?.includes("invalid-input-secret")) return "misconfigured";
  return result.success === true;
}

export const CAPTCHA_MISCONFIGURED = "서버 설정 오류: 캡차 시크릿이 없거나 올바르지 않습니다.";

// The visitor's address as Supabase's edge sees it.
export const clientIp = (request: Request) =>
  request.headers.get("CF-Connecting-IP") ?? request.headers.get("x-forwarded-for")?.split(",")[0].trim() ?? null;
