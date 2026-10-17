import { createClient } from "@supabase/supabase-js";

export const supabase = createClient(import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_KEY);

export async function manageUser(body) {
  const { data, error } = await supabase.functions.invoke("admin-users", { body });
  if (error) throw new Error((await error.context?.json?.().catch(() => null))?.error ?? "계정 작업에 실패했습니다. 잠시 후 다시 시도해 주세요.");
  return data;
}
