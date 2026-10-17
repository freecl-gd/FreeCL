// Rows as the DB stores them -> the shape the pages were written against. No imports, so
// both the browser bundle and the fallback script can use it.
const toChallenge = (row) => ({
  name: row.name,
  creator: row.creator,
  verifier: row.verifier,
  // An id means the credit is a registered account; without one it is imported text.
  creatorId: row.creator_id ?? null,
  verifierId: row.verifier_id ?? null,
  description: row.description,
  video: row.video,
  levelId: row.level_id,
  length: row.length,
  objectCount: row.object_count,
});

// A platformer clear carries a time, a classic one a percent. Number() because a Postgres
// numeric can arrive as a string and the detail page calls .toFixed() on it.
const toClear = (row) => ({
  player: row.player,
  platform: row.platform,
  first: row.first ?? false,
  video: row.video ?? "",
  ...(row.time === null || row.time === undefined ? { percent: Number(row.percent) } : { time: Number(row.time) }),
  ...(row.submitted_at ? { submittedAt: row.submitted_at } : {}),
});

export function toSnapshots(maps, records, legacy = []) {
  const snapshots = {
    classic: { challenges: [], clearers: {}, legacy: {} },
    extra: { challenges: [], clearers: {}, legacy: {} },
    platformer: { challenges: [], clearers: {}, legacy: {} },
  };
  const typeOf = new Map(maps.map((row) => [row.level_id, row.type]));
  maps.forEach((row) => snapshots[row.type].challenges.push(toChallenge(row)));

  const collect = (bucket, rows) => rows.forEach((row) => {
    const type = typeOf.get(row.level_id);
    if (type) (snapshots[type][bucket][row.level_id] ??= []).push(toClear(row));
  });
  collect("clearers", records);
  collect("legacy", legacy);

  // Clears are listed in the order they were achieved, which the submission time records.
  Object.values(snapshots).forEach(({ clearers }) =>
    Object.values(clearers).forEach((list) => list.sort((a, b) => (a.submittedAt ?? "").localeCompare(b.submittedAt ?? ""))));
  return snapshots;
}
