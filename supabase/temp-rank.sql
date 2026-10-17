-- Run once in the Supabase SQL editor, after legacy.sql.
-- Temp registration becomes a one-way door: every new map is 임시등재, holds no rank while
-- it is, and gets its number only when an admin releases it. Replaces record-video.sql,
-- whose approve_submission body is folded in below.

alter table records add column if not exists video text not null default '';
alter table position_history add column if not exists temp boolean not null default false;

-- A temp map's position is a placeholder at the tail, so moving it around is noise: no row
-- is logged until it is released, and that release logs as a plain 등재 with no delta.
create or replace function log_position() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and new.temp_rank and not old.temp_rank then
    raise exception '정식등재된 맵을 임시등재로 되돌릴 수 없습니다.';
  end if;

  if tg_op = 'INSERT' then
    insert into public.position_history (level_id, from_position, to_position, temp)
    values (new.level_id, null, new.position, new.temp_rank);
  elsif old.temp_rank and not new.temp_rank then
    insert into public.position_history (level_id, from_position, to_position)
    values (new.level_id, null, new.position);
  elsif not new.temp_rank and new.position is distinct from old.position then
    insert into public.position_history (level_id, from_position, to_position)
    values (new.level_id, old.position, new.position);
  end if;
  return new;
end $$;

drop trigger if exists maps_position_history on maps;
create trigger maps_position_history after insert or update of position, temp_rank on maps
  for each row execute function log_position();

-- Ranked maps hold 1..k, temp maps the tail. Every map enters at the very end as temp, so
-- create_map no longer takes a position at all.
drop function if exists create_map(jsonb, map_type, integer);
create or replace function create_map(p_payload jsonb, p_type map_type)
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
  insert into public.maps (level_id, type, name, creator, verifier, description, video, length, object_count, temp_rank, position)
  values (
    v_level_id, p_type, p_payload->>'name',
    coalesce(p_payload->>'creator', ''), coalesce(p_payload->>'verifier', ''),
    coalesce(p_payload->>'description', ''), coalesce(p_payload->>'video', ''),
    coalesce(p_payload->>'length', ''), coalesce(p_payload->>'objectCount', ''),
    true, target
  );
  return v_level_id;
end $$;

-- Releasing is the only way a map gets a number, and it can only happen once.
create or replace function promote_map(p_level_id text, p_position integer)
returns void language plpgsql security definer set search_path = '' as $$
declare
  entry public.maps;
  ranked integer;
  target integer;
begin
  if not public.is_admin() then raise exception 'admin only'; end if;
  select * into entry from public.maps where level_id = p_level_id for update;
  if not found then raise exception '없는 맵입니다: %', p_level_id; end if;
  if not entry.temp_rank then raise exception '이미 정식등재된 맵입니다.'; end if;

  select count(*) into ranked from public.maps where type = entry.type and not temp_rank;
  target := least(greatest(coalesce(p_position, ranked + 1), 1), ranked + 1);

  update public.maps set position = position + 1
   where type = entry.type and position >= target and position < entry.position;
  update public.maps set position = target, temp_rank = false where level_id = p_level_id;
end $$;

-- A temp map has no number to move.
create or replace function move_map(p_level_id text, p_position integer)
returns void language plpgsql security definer set search_path = '' as $$
declare
  entry public.maps;
  ranked integer;
  target integer;
begin
  if not public.is_admin() then raise exception 'admin only'; end if;
  select * into entry from public.maps where level_id = p_level_id for update;
  if not found then raise exception '없는 맵입니다: %', p_level_id; end if;
  if entry.temp_rank then raise exception '임시등재된 맵은 순위를 매길 수 없습니다. 먼저 임시등재를 해제해 주세요.'; end if;

  select count(*) into ranked from public.maps where type = entry.type and not temp_rank;
  target := least(greatest(p_position, 1), ranked);
  if target = entry.position then return; end if;

  if target < entry.position then
    update public.maps set position = position + 1 where type = entry.type and position >= target and position < entry.position;
  else
    update public.maps set position = position - 1 where type = entry.type and position > entry.position and position <= target;
  end if;
  update public.maps set position = target where level_id = p_level_id;
end $$;

-- Approving a map no longer picks a rank: it always lands as 임시등재.
drop function if exists approve_submission(bigint, integer);
create or replace function approve_submission(submission_id bigint)
returns void language plpgsql security definer set search_path = '' as $$
declare
  entry public.submissions;
begin
  if not public.is_admin() then raise exception 'admin only'; end if;

  select * into entry from public.submissions where id = submission_id and status = 'pending' for update;
  if not found then raise exception 'submission % is missing or already reviewed', submission_id; end if;

  if entry.kind = 'map' then
    perform public.create_map(entry.payload, entry.type);
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

-- These six were listed as 임시등재 while their history still logged real numbers. Keep the
-- 임시등재 entry and, if they have since been released, the current rank. Nothing between.
-- SGN, ASURABALBALTA, AINXEN, Perfect Fly, ALPO, Iuvenis of Jawv
do $$
declare
  entry record;
  first_at timestamptz;
  last_at timestamptz;
begin
  for entry in
    select level_id, position, temp_rank from public.maps
     where level_id in ('147684444', '146811696', '125744781', '144908631', '145933084', '147732588')
  loop
    select min(changed_at), max(changed_at) into first_at, last_at
      from public.position_history where level_id = entry.level_id;
    delete from public.position_history where level_id = entry.level_id;

    insert into public.position_history (level_id, from_position, to_position, temp, changed_at)
    values (entry.level_id, null, entry.position, true, coalesce(first_at, now()));

    if not entry.temp_rank then
      insert into public.position_history (level_id, from_position, to_position, changed_at)
      values (entry.level_id, null, entry.position, coalesce(last_at, now()));
    end if;
  end loop;
end $$;
