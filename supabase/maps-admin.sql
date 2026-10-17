-- Map management. Run once in the Supabase SQL editor.

-- Deleting a map used to silently take every clear record with it. It now refuses, and
-- delete_map() is the only path that can discard them — deliberately, with a count first.
alter table records drop constraint records_level_id_fkey;
alter table records add constraint records_level_id_fkey
  foreign key (level_id) references maps (level_id) on delete restrict;

-- Positions stay a contiguous 1..n per type, so every rank change moves real rows and the
-- maps trigger writes each one to position_history.
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

  insert into public.maps (level_id, type, name, creator, verifier, description, video, length, object_count, temp_rank, position)
  values (
    v_level_id, p_type, p_payload->>'name',
    coalesce(p_payload->>'creator', ''), coalesce(p_payload->>'verifier', ''),
    coalesce(p_payload->>'description', ''), coalesce(p_payload->>'video', ''),
    coalesce(p_payload->>'length', ''), coalesce(p_payload->>'objectCount', ''),
    coalesce((p_payload->>'tempRank')::boolean, false), target
  );
  return v_level_id;
end $$;

create or replace function move_map(p_level_id text, p_position integer)
returns void language plpgsql security definer set search_path = '' as $$
declare
  entry public.maps;
  target integer;
  total integer;
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

-- Returns how many clear records went with it, so the caller can report the damage.
create or replace function delete_map(p_level_id text, p_discard_records boolean default false)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  entry public.maps;
  clears integer;
begin
  if not public.is_admin() then raise exception 'admin only'; end if;
  select * into entry from public.maps where level_id = p_level_id for update;
  if not found then raise exception '없는 맵입니다: %', p_level_id; end if;

  select count(*) into clears from public.records where level_id = p_level_id;
  if clears > 0 and not p_discard_records then
    raise exception '이 맵에는 클리어 기록이 %건 있습니다. 기록까지 지우려면 다시 확인해 주세요.', clears;
  end if;

  delete from public.records where level_id = p_level_id;
  -- A pending clear for a map that no longer exists can never be approved; close it now
  -- rather than leaving it in the queue forever.
  update public.submissions
     set status = 'rejected',
         note = concat_ws(' ', note, '맵이 삭제되어 자동 거부되었습니다.'),
         reviewed_at = now()
   where status = 'pending' and kind = 'record' and payload->>'levelId' = p_level_id;

  delete from public.maps where level_id = p_level_id;  -- position_history cascades
  update public.maps set position = position - 1 where type = entry.type and position > entry.position;
  return clears;
end $$;

-- One place builds a map row now.
create or replace function approve_submission(submission_id bigint, at_position integer default null)
returns void language plpgsql security definer set search_path = '' as $$
declare
  entry public.submissions;
begin
  if not public.is_admin() then raise exception 'admin only'; end if;

  select * into entry from public.submissions where id = submission_id and status = 'pending' for update;
  if not found then raise exception 'submission % is missing or already reviewed', submission_id; end if;

  if entry.kind = 'map' then
    perform public.create_map(entry.payload, entry.type, at_position);
  else
    insert into public.records (level_id, user_id, player, percent, time, platform)
    select entry.payload->>'levelId', entry.user_id, profile.username,
           (entry.payload->>'percent')::integer, (entry.payload->>'time')::numeric,
           coalesce(entry.payload->>'platform', '')
    from public.profiles profile where profile.id = entry.user_id;
  end if;

  update public.submissions
     set status = 'approved', reviewed_at = now(), reviewed_by = auth.jwt()->>'sub'
   where id = submission_id;
end $$;
