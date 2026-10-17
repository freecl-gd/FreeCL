// Must match public.identity_hash() in supabase/withdrawal.sql (used by email-bans.sql).
export async function identityHash(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value.trim().toLowerCase()));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export const SUSPENDED = "정지된 계정입니다.";
