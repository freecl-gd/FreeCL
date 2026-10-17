import { tableFor } from "../../supabase/functions/_shared/lists.js";
import { createClient } from "@supabase/supabase-js";
import { toSnapshots } from "./shape.js";

export const supabase = createClient(import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_KEY);

async function fetchListSnapshots(type) {
  // ponytail: PostgREST caps a response at 1000 rows, so records silently truncates past
  // that. Paginate, or move this to an RPC, once clears approach 1000.
  const [maps, records, legacy] = await Promise.all([
    supabase.from(tableFor(type, "maps")).select("*").order("position"),
    supabase.from(tableFor(type, "records")).select("level_id, player, percent, time, platform, first, video, submitted_at").order("submitted_at"),
    supabase.from(tableFor(type, "legacy_records")).select("level_id, player, percent, time, platform, first"),
  ]);
  for (const result of [maps, records, legacy]) if (result.error) throw result.error;
  return toSnapshots(maps.data, records.data, legacy.data);
}

export async function fetchSnapshots() {
  const [existing, extra] = await Promise.all([fetchListSnapshots("classic"), fetchListSnapshots("extra")]);
  return { ...existing, extra: extra.extra };
}

export async function fetchPositionHistory(levelId, type) {
  const { data, error } = await supabase
    .from(tableFor(type, "position_history"))
    .select("id, from_position, to_position, changed_at")
    .eq("level_id", levelId)
    .order("id", { ascending: false })
    .limit(50);
  if (error) throw error;
  return data;
}

export async function fetchRankings(type) {
  const { data, error } = await supabase.from(tableFor(type, "rankings")).select("*").eq("type", type).lte("position", 100).order("position");
  if (error) throw error;
  return data;
}

async function fetchPlayerList(player, type) {
  const [totals, clears, legacy, profile] = await Promise.all([
    supabase.from(tableFor(type, "rankings")).select("*").eq("player", player),
    supabase.from(tableFor(type, "records")).select(`level_id, percent, time, platform, first, note, maps:${tableFor(type, "maps")}(name, type, position)`).eq("player", player),
    supabase.from(tableFor(type, "legacy_records")).select(`level_id, percent, time, platform, first, note, maps:${tableFor(type, "maps")}(name, type, position)`).ilike("player", player.replace(/[\\%_]/g, "\\$&")),
    supabase.from("profiles").select("id, username, bio, avatar_url").eq("username", player.toLocaleLowerCase()).maybeSingle(),
  ]);
  // IDs survive renames; only unlinked legacy credits fall back to the current name.
  const verifier = profile.data?.username.replace(/[\\%_]/g, "\\$&");
  const verified = profile.data
    ? await supabase.from(tableFor(type, "maps")).select("level_id, name, type, position")
      .or(`verifier_id.eq.${profile.data.id},and(verifier_id.is.null,verifier.ilike.${verifier})`)
    : { data: [], error: null };
  for (const result of [totals, clears, legacy, profile, verified]) if (result.error) throw result.error;
  // A name with no account scores nothing, so its legacy rows stay off the list too. One
  // row per map: a new clear beats a legacy one beats a verification, as in the view.
  const rows = [
    ...clears.data.map((row) => ({ ...row, kind: "record" })),
    ...(profile.data ? legacy.data.map((row) => ({ ...row, kind: "legacy" })) : []),
    ...(profile.data ? verified.data.map(({ level_id, ...maps }) => ({ level_id, maps, kind: "verified" })) : []),
  ];
  const seen = new Set();
  const unique = rows.filter((row) => row.maps && !seen.has(row.level_id) && seen.add(row.level_id));
  return { totals: totals.data, clears: unique, profile: profile.data ?? null };
}

export async function fetchPlayer(player) {
  const lists = await Promise.all([fetchPlayerList(player, "classic"), fetchPlayerList(player, "extra")]);
  return { totals: lists.flatMap((list) => list.totals), clears: lists.flatMap((list) => list.clears), profile: lists[0].profile };
}

// A comma or parenthesis in the needle would be read as PostgREST or() syntax, and % or _
// would be a wildcard inside ilike.
const forOr = (value) => value.replace(/[,()%_]/g, " ").trim();

export async function searchProfiles(query, limit = 8) {
  const needle = forOr(query);
  if (!needle) return [];
  const { data, error } = await supabase.from("profiles").select("id, username").ilike("username", `%${needle}%`).order("username").limit(limit);
  if (error) throw error;
  return data;
}

export async function searchMaps(query, { type, from, to }) {
  const needle = forOr(query);
  let request = supabase.from(tableFor(type, "maps")).select("*").order("type").order("position").limit(100);
  if (needle) request = request.or(`name.ilike.%${needle}%,creator.ilike.%${needle}%,verifier.ilike.%${needle}%,level_id.ilike.%${needle}%`);
  if (type) request = request.eq("type", type);
  if (from) request = request.gte("position", Number(from));
  if (to) request = request.lte("position", Number(to));
  const { data, error } = await request;
  if (error) throw error;
  return data;
}

// A non-2xx reply from an Edge Function arrives as FunctionsHttpError, whose message
// hides the server's own text.
export async function callFunction(name, body) {
  const { data, error } = await supabase.functions.invoke(name, { body });
  if (error) throw new Error((await error.context?.json?.().catch(() => null))?.error ?? "요청에 실패했습니다. 잠시 후 다시 시도해 주세요.");
  return data;
}
