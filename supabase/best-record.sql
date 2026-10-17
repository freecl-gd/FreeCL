-- Run once. One record per player per map, and it is always their best.
-- Both write paths — the admin form's insert and approve_submission — land in `records`,
-- so this trigger is the one place the rule can live.
--   better → the old row goes and the new one goes in, with its own submission time
--   same   → refused as a duplicate (409)
--   worse  → refused; it would only bury their real best
-- "Better" is a higher percent for classic, a lower time for platformer.
create or replace function keep_best_record() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  existing public.records;
begin
  select * into existing from public.records
   where level_id = new.level_id
     and (user_id = new.user_id or lower(player) = lower(new.player))
   for update;
  if not found then return new; end if;

  if new.percent is not distinct from existing.percent and new.time is not distinct from existing.time then
    raise exception '이미 같은 기록이 있습니다. (%)', coalesce(existing.percent || '%', existing.time || 's')
      using errcode = 'unique_violation';
  end if;

  if new.percent > existing.percent or new.time < existing.time then
    delete from public.records where id = existing.id;
    return new;
  end if;

  raise exception '기존 기록(%)보다 좋지 않은 기록입니다.', coalesce(existing.percent || '%', existing.time || 's');
end $$;

drop trigger if exists keep_best_record on records;
create trigger keep_best_record before insert on records
for each row execute function keep_best_record();
