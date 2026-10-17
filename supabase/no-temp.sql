-- Run once in the Supabase SQL editor, after temp-rank.sql, which this reverses.
-- 임시등재 is gone: a map gets its rank when it is approved, and its history says so in a
-- single 등재 row instead of a placeholder plus the release that followed it.

-- Step 55's view, repeated here because the live one still reads temp_rank and would block
-- the drop below. Harmless if it has already been run.
create or replace view map_scores with (security_invoker = on) as
select level_id, type, map_points(position) as points from maps;

-- Collapse the placeholder pairs. Runs while position_history.temp still exists.
do $$
declare entry record; kept timestamptz;
begin
  for entry in
    select distinct history.level_id, maps.position
      from public.position_history history
      join public.maps on maps.level_id = history.level_id
     where history.temp
  loop
    -- The row that gave the map its real number carries the date worth keeping.
    select max(changed_at) into kept from public.position_history
     where level_id = entry.level_id and from_position is null and not temp;
    delete from public.position_history where level_id = entry.level_id;
    insert into public.position_history (level_id, from_position, to_position, changed_at)
    values (entry.level_id, null, entry.position, coalesce(kept, now()));
  end loop;
end $$;

-- The trigger names temp_rank in its UPDATE OF list, so it goes first.
drop trigger if exists maps_position_history on maps;
alter table position_history drop column if exists temp;
alter table maps drop column if exists temp_rank;

create or replace function log_position() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    insert into public.position_history (level_id, from_position, to_position) values (new.level_id, null, new.position);
  elsif new.position is distinct from old.position then
    insert into public.position_history (level_id, from_position, to_position) values (new.level_id, old.position, new.position);
  end if;
  return new;
end $$;
create trigger maps_position_history after insert or update of position on maps
  for each row execute function log_position();

-- A new map lands on the rank it was given and pushes everything below it down one.
drop function if exists promote_map(text, integer);
drop function if exists create_map(jsonb, map_type);
create or replace function create_map(p_payload jsonb, p_type map_type, p_position integer default null)
returns text language plpgsql security definer set search_path = '' as $$
declare
  v_level_id text := p_payload->>'levelId';
  target integer;
begin
  if not public.is_admin() then raise exception 'admin only'; end if;
  if coalesce(v_level_id, '') = '' then raise exception '레벨 ID가 필요합니다.'; end if;
  if coalesce(p_payload->>'name', '') = '' then raise exception '맵 이름이 필요합니다.'; end if;
  if exists (select 1 from public.maps where maps.level_id = v_level_id) then
    raise exception '이미 등재된 레벨 ID입니다: %', v_level_id;
  end if;

  select coalesce(max(position), 0) + 1 into target from public.maps where type = p_type;
  target := least(greatest(coalesce(p_position, target), 1), target);
  update public.maps set position = position + 1 where type = p_type and position >= target;

  insert into public.maps (level_id, type, name, creator, verifier, description, video, length, object_count, position)
  values (
    v_level_id, p_type, p_payload->>'name',
    coalesce(p_payload->>'creator', ''), coalesce(p_payload->>'verifier', ''),
    coalesce(p_payload->>'description', ''), coalesce(p_payload->>'video', ''),
    coalesce(p_payload->>'length', ''), coalesce(p_payload->>'objectCount', ''), target
  );
  return v_level_id;
end $$;

create or replace function move_map(p_level_id text, p_position integer)
returns void language plpgsql security definer set search_path = '' as $$
declare
  entry public.maps;
  total integer;
  target integer;
begin
  if not public.is_admin() then raise exception 'admin only'; end if;
  select * into entry from public.maps where level_id = p_level_id for update;
  if not found then raise exception '없는 맵입니다: %', p_level_id; end if;

  select count(*) into total from public.maps where type = entry.type;
  target := least(greatest(p_position, 1), total);
  if target = entry.position then return; end if;

  if target < entry.position then
    update public.maps set position = position + 1 where type = entry.type and position >= target and position < entry.position;
  else
    update public.maps set position = position - 1 where type = entry.type and position > entry.position and position <= target;
  end if;
  update public.maps set position = target where level_id = p_level_id;
end $$;

-- Map approval requires its rank; a blank value must not silently append it.
drop function if exists approve_submission(bigint);
create or replace function approve_submission(submission_id bigint, at_position integer default null)
returns void language plpgsql security definer set search_path = '' as $$
declare
  entry public.submissions;
begin
  if not public.is_admin() then raise exception 'admin only'; end if;

  select * into entry from public.submissions where id = submission_id and status = 'pending' for update;
  if not found then raise exception 'submission % is missing or already reviewed', submission_id; end if;

  if entry.kind = 'map' then
    if at_position is null or at_position < 1 then raise exception '맵 승인에는 순위를 입력해야 합니다.'; end if;
    perform public.create_map(entry.payload, entry.type, at_position);
  else
    insert into public.records (level_id, user_id, player, percent, time, platform, video, submitted_at)
    select entry.payload->>'levelId', entry.user_id, profile.username,
           (entry.payload->>'percent')::integer, (entry.payload->>'time')::numeric,
           coalesce(entry.payload->>'platform', ''), coalesce(entry.payload->>'video', ''), entry.created_at
    from public.profiles profile where profile.id = entry.user_id;
  end if;

  update public.submissions
     set status = 'approved', reviewed_at = now(), reviewed_by = auth.jwt()->>'sub'
   where id = submission_id;
end $$;
