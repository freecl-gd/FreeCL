-- Run once. Widens what earns ranking points; one person scores a map at most once.
--   1. records        — approved clears, tied to an account by user_id or by nickname.
--   2. legacy_records — sheet-era clears, only when the name IS a current nickname.
--   3. maps.verifier  — the first clear of a map, by verifier_id or by nickname.
-- A name that belongs to no account scores nothing and does not appear in the ranking.
-- Same columns, same types as before, so the site's queries are unchanged.
create or replace view rankings with (security_invoker = on) as
with credits as (
  select records.level_id, profiles.id
    from records join profiles on profiles.id = records.user_id or profiles.username = lower(records.player)
  union
  select legacy_records.level_id, profiles.id
    from legacy_records join profiles on profiles.username = lower(legacy_records.player)
  union
  select maps.level_id, profiles.id
    from maps join profiles on profiles.id = maps.verifier_id or profiles.username = lower(maps.verifier)
)
select totals.*, rank() over (partition by type order by points desc) as position
from (
  select scores.type,
         profiles.username as player,
         profiles.id as user_id,
         round(sum(scores.points), 1) as points,
         count(*)::integer as clears
  from credits
  join map_scores scores using (level_id)
  join profiles using (id)
  group by scores.type, profiles.id, profiles.username
) totals;
