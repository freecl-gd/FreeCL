// Refreshes FreeCLMain/src/data/*.json, the snapshot the list pages paint before the
// Supabase fetch lands. Run before deploying: node supabase/refresh-fallback.mjs
import { writeFileSync } from "node:fs";
import { toSnapshots } from "../FreeCLMain/src/shape.js";

const BASE = "https://erpdomfrjxblrmapoceb.supabase.co/rest/v1";
const KEY = "sb_publishable_v44QyS3zcgDfpSSavZ3CAw_JuKL2Jfi";
const get = async (path) => {
  const response = await fetch(`${BASE}/${path}`, { headers: { apikey: KEY, Authorization: `Bearer ${KEY}` } });
  if (!response.ok) throw new Error(`${path}: ${response.status} ${await response.text()}`);
  return response.json();
};

const selfCheck = () => {
  const shaped = toSnapshots(
    [{ level_id: "1", type: "platformer", name: "n", creator: "c", verifier: "v", description: "", video: "", length: "", object_count: "0" }],
    [{ level_id: "1", player: "p", time: "2.5", percent: null, platform: "PC" }, { level_id: "9", player: "ghost", percent: 100, platform: "PC" }],
  );
  const [challenge] = shaped.platformer.challenges;
  if (challenge.levelId !== "1" || challenge.objectCount !== "0") throw new Error("challenge shape wrong");
  if (shaped.platformer.clearers["1"][0].time !== 2.5) throw new Error("numeric string not coerced");
  if (shaped.platformer.clearers["9"] || shaped.classic.challenges.length) throw new Error("orphan record kept");
  const ordered = toSnapshots(
    [{ level_id: "1", type: "classic", name: "n", creator: "", verifier: "", description: "", video: "", length: "", object_count: "" }],
    [{ level_id: "1", player: "second", percent: 100, submitted_at: "2026-02-01T00:00:00Z" }, { level_id: "1", player: "first", percent: 100, submitted_at: "2026-01-01T00:00:00Z" }],
    [{ level_id: "1", player: "old", percent: 100, platform: "" }],
  );
  if (ordered.classic.clearers["1"].map((clear) => clear.player).join() !== "first,second") throw new Error("clears not in submission order");
  if (ordered.classic.legacy["1"][0].player !== "old") throw new Error("legacy not separated");
};

selfCheck();

const [existing, extra] = await Promise.all(["", "extra_"].map(async (prefix) => toSnapshots(
  await get(`${prefix}maps?select=*&order=position`),
  await get(`${prefix}records?select=level_id,player,percent,time,platform,first,submitted_at&order=submitted_at`),
  await get(`${prefix}legacy_records?select=level_id,player,percent,time,platform,first`),
)));
const snapshots = { ...existing, extra: extra.extra };
for (const [type, { challenges, clearers, legacy }] of Object.entries(snapshots)) {
  const write = (file, value) => writeFileSync(new URL(`../FreeCLMain/src/data/${file}.json`, import.meta.url), JSON.stringify(value, null, 2) + "\n");
  write(type, challenges);
  write(`${type}-legacy`, legacy);
  console.log(`${type}: ${challenges.length} maps, ${Object.values(clearers).flat().length} records, ${Object.values(legacy).flat().length} legacy`);
}
