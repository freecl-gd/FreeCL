-- Run once in the Supabase SQL editor.

-- 1. The sheet packed two extra facts into the player name: a "(First)" marker and, in one
-- row, a bracketed note. Ranking by that string splits four players in two, so the facts
-- move into columns of their own instead of being thrown away.
alter table records add column if not exists first boolean not null default false;
alter table records add column if not exists note text;

update records
   set first  = player ~* '\(first\)',
       note   = coalesce(note, nullif(btrim((regexp_match(player, '\[([^\]]*)\]'))[1]), '')),
       player = btrim(regexp_replace(regexp_replace(player, '\(first\)', '', 'gi'), '\[[^\]]*\]', '', 'g'))
 where player ~* '\(first\)' or player ~ '\[';

-- 2. Points per map. The decay rate is the one number worth tuning, so it lives here alone.
create or replace function map_points(p_position integer) returns numeric
language sql immutable set search_path = '' as $$
  select round(100 * power(0.94, greatest(p_position, 1) - 1), 1);
$$;

-- Temp maps take no clears at all -- neither the submit form nor the admin record form
-- will point at one -- so their score never gets read and needs no special case.
create or replace view map_scores with (security_invoker = on) as
select level_id, type, map_points(position) as points from maps;

-- 3. One row per player per list. user_id is present only where a record is tied to an
-- account; imported rows predate accounts entirely.
create or replace view rankings with (security_invoker = on) as
select totals.*, rank() over (partition by type order by points desc) as position
from (
  select scores.type,
         records.player,
         (array_agg(records.user_id) filter (where records.user_id is not null))[1] as user_id,
         round(sum(scores.points), 1) as points,
         count(*)::integer as clears
  from records
  join map_scores scores using (level_id)
  group by scores.type, records.player
) totals;

grant select on map_scores, rankings to anon, authenticated;
