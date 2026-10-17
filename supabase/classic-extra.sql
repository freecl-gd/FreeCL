-- Apply classic-extra-type.sql first, in a separate transaction.
-- Run after the existing patches through approval-rank-required.sql.
-- Existing CLASSIC rows, IDs, ranks and records stay in place as TIMED.
begin;

-- LIKE copies columns, checks, indexes and independent identity sequences, not FKs,
-- triggers, grants or RLS. Those are explicitly restored below.
create table public.extra_maps (like public.maps including all);
create table public.extra_records (like public.records including all);
create table public.extra_legacy_records (like public.legacy_records including all);
create table public.extra_submissions (like public.submissions including all);
create table public.extra_position_history (like public.position_history including all);

alter table public.extra_maps
  add foreign key (creator_id) references public.profiles(id) on delete set null,
  add foreign key (verifier_id) references public.profiles(id) on delete set null,
  add constraint extra_maps_type check (type = 'extra');
alter table public.extra_records
  add foreign key (level_id) references public.extra_maps(level_id) on delete restrict,
  add foreign key (user_id) references public.profiles(id) on delete set null,
  add constraint extra_records_percent check (percent is not null and time is null);
alter table public.extra_legacy_records
  add foreign key (level_id) references public.extra_maps(level_id) on delete restrict;
alter table public.extra_submissions
  add foreign key (user_id) references public.profiles(id) on delete cascade,
  add constraint extra_submissions_type check (type = 'extra');
alter table public.extra_position_history
  add foreign key (level_id) references public.extra_maps(level_id) on delete cascade;
alter table public.maps add constraint maps_existing_types check (type in ('classic', 'platformer'));
alter table public.submissions add constraint submissions_existing_types check (type in ('classic', 'platformer'));

-- Same integer-second formats as functions/_shared/lists.js: 90, 90s, 1:30, 1m30s.
create function public.length_seconds(value text) returns integer
language plpgsql immutable set search_path = '' as $$
declare
  normalized text := lower(btrim(value));
  parts text[];
begin
  if normalized ~ '^[0-9]{1,3}s?$' then return rtrim(normalized, 's')::integer; end if;
  parts := regexp_match(normalized, '^([0-9]{1,2}):([0-5][0-9])$');
  if parts is not null then return parts[1]::integer * 60 + parts[2]::integer; end if;
  parts := regexp_match(normalized, '^([0-9]{1,2})m(?:\s*([0-5]?[0-9])s)?$');
  if parts is not null then return parts[1]::integer * 60 + coalesce(parts[2]::integer, 0); end if;
  return null;
end $$;
alter table public.maps add constraint timed_length
  check (type <> 'classic' or coalesce(public.length_seconds(length) between 1 and 59, false));
alter table public.extra_maps add constraint extra_length
  check (coalesce(public.length_seconds(length) between 60 and 599, false));

alter table public.extra_maps enable row level security;
alter table public.extra_records enable row level security;
alter table public.extra_legacy_records enable row level security;
alter table public.extra_position_history enable row level security;
alter table public.extra_submissions enable row level security;
create policy public_read on public.extra_maps for select using (true);
create policy public_read on public.extra_records for select using (true);
create policy public_read on public.extra_legacy_records for select using (true);
create policy public_read on public.extra_position_history for select using (true);
create policy admin_write on public.extra_maps for all using (public.is_admin()) with check (public.is_admin());
create policy admin_write on public.extra_records for all using (public.is_admin()) with check (public.is_admin());
create policy admin_write on public.extra_legacy_records for all using (public.is_admin()) with check (public.is_admin());
create policy read_own on public.extra_submissions for select using (user_id = auth.uid());
create policy admin_queue on public.extra_submissions for all using (public.is_admin()) with check (public.is_admin());
-- Remove any project-wide default grants, then grant only the required operations.
revoke all on public.extra_maps, public.extra_records, public.extra_legacy_records,
  public.extra_position_history, public.extra_submissions from anon, authenticated;
grant select on public.extra_maps, public.extra_records, public.extra_legacy_records,
  public.extra_position_history to anon, authenticated;
grant insert, update, delete on public.extra_maps, public.extra_records, public.extra_legacy_records to authenticated;
grant select, update, delete on public.extra_submissions to authenticated;
grant all on public.extra_maps, public.extra_records, public.extra_legacy_records,
  public.extra_position_history, public.extra_submissions to service_role;

CREATE OR REPLACE FUNCTION public.extra_log_position()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if tg_op = 'INSERT' then
    insert into public.extra_position_history (level_id, from_position, to_position) values (new.level_id, null, new.position);
  elsif new.position is distinct from old.position then
    insert into public.extra_position_history (level_id, from_position, to_position) values (new.level_id, old.position, new.position);
  end if;
  return new;
end $function$
;

CREATE OR REPLACE FUNCTION public.extra_create_map(p_payload jsonb, p_type map_type, p_position integer DEFAULT NULL::integer)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_level_id text := p_payload->>'levelId';
  target integer;
begin
  if not public.is_admin() then raise exception 'admin only'; end if;
  if coalesce(v_level_id, '') = '' then raise exception '레벨 ID가 필요합니다.'; end if;
  if coalesce(p_payload->>'name', '') = '' then raise exception '맵 이름이 필요합니다.'; end if;
  if exists (select 1 from public.extra_maps where extra_maps.level_id = v_level_id) then
    raise exception '이미 등재된 레벨 ID입니다: %', v_level_id;
  end if;

  select coalesce(max(position), 0) + 1 into target from public.extra_maps where type = p_type;
  target := least(greatest(coalesce(p_position, target), 1), target);
  update public.extra_maps set position = position + 1 where type = p_type and position >= target;

  insert into public.extra_maps (level_id, type, name, creator, verifier, description, video, length, object_count, position)
  values (
    v_level_id, p_type, p_payload->>'name',
    coalesce(p_payload->>'creator', ''), coalesce(p_payload->>'verifier', ''),
    coalesce(p_payload->>'description', ''), coalesce(p_payload->>'video', ''),
    coalesce(p_payload->>'length', ''), coalesce(p_payload->>'objectCount', ''), target
  );
  return v_level_id;
end $function$
;

CREATE OR REPLACE FUNCTION public.extra_move_map(p_level_id text, p_position integer)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  entry public.extra_maps;
  total integer;
  target integer;
begin
  if not public.is_admin() then raise exception 'admin only'; end if;
  select * into entry from public.extra_maps where level_id = p_level_id for update;
  if not found then raise exception '없는 맵입니다: %', p_level_id; end if;

  select count(*) into total from public.extra_maps where type = entry.type;
  target := least(greatest(p_position, 1), total);
  if target = entry.position then return; end if;

  if target < entry.position then
    update public.extra_maps set position = position + 1 where type = entry.type and position >= target and position < entry.position;
  else
    update public.extra_maps set position = position - 1 where type = entry.type and position > entry.position and position <= target;
  end if;
  update public.extra_maps set position = target where level_id = p_level_id;
end $function$
;

CREATE OR REPLACE FUNCTION public.extra_delete_map(p_level_id text, p_discard_records boolean DEFAULT false)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  entry public.extra_maps;
  clears integer;
begin
  if not public.is_admin() then raise exception 'admin only'; end if;
  select * into entry from public.extra_maps where level_id = p_level_id for update;
  if not found then raise exception '없는 맵입니다: %', p_level_id; end if;

  select (select count(*) from public.extra_records where level_id = p_level_id)
       + (select count(*) from public.extra_legacy_records where level_id = p_level_id)
    into clears;
  if clears > 0 and not p_discard_records then
    raise exception '이 맵에는 클리어 기록이 %건 있습니다. 기록까지 지우려면 다시 확인해 주세요.', clears;
  end if;

  delete from public.extra_records where level_id = p_level_id;
  delete from public.extra_legacy_records where level_id = p_level_id;
  update public.extra_submissions
     set status = 'rejected',
         note = concat_ws(' ', note, '맵이 삭제되어 자동 거부되었습니다.'),
         reviewed_at = now()
   where status = 'pending' and kind = 'record' and payload->>'levelId' = p_level_id;

  delete from public.extra_maps where level_id = p_level_id;  -- extra_position_history cascades
  update public.extra_maps set position = position - 1 where type = entry.type and position > entry.position;
  return clears;
end $function$
;

CREATE OR REPLACE FUNCTION public.extra_approve_submission(submission_id bigint, at_position integer DEFAULT NULL::integer)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  entry public.extra_submissions;
begin
  if not public.is_admin() then raise exception 'admin only'; end if;

  select * into entry from public.extra_submissions where id = submission_id and status = 'pending' for update;
  if not found then raise exception 'submission % is missing or already reviewed', submission_id; end if;

  if entry.kind = 'map' then
    if at_position is null or at_position < 1 then raise exception '맵 승인에는 순위를 입력해야 합니다.'; end if;
    perform public.extra_create_map(entry.payload, entry.type, at_position);
  else
    insert into public.extra_records (level_id, user_id, player, percent, time, platform, video, submitted_at)
    select entry.payload->>'levelId', entry.user_id, profile.username,
           (entry.payload->>'percent')::integer, (entry.payload->>'time')::numeric,
           coalesce(entry.payload->>'platform', ''), coalesce(entry.payload->>'video', ''), entry.created_at
    from public.profiles profile where profile.id = entry.user_id;
  end if;

  update public.extra_submissions
     set status = 'approved', reviewed_at = now(), reviewed_by = auth.jwt()->>'sub'
   where id = submission_id;
end $function$
;

CREATE OR REPLACE FUNCTION public.extra_keep_best_record()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  existing public.extra_records;
begin
  select * into existing from public.extra_records
   where level_id = new.level_id
     and (user_id = new.user_id or lower(player) = lower(new.player))
   for update;
  if not found then return new; end if;

  if new.percent is not distinct from existing.percent and new.time is not distinct from existing.time then
    raise exception '이미 같은 기록이 있습니다. (%)', coalesce(existing.percent || '%', existing.time || 's')
      using errcode = 'unique_violation';
  end if;

  if new.percent > existing.percent or new.time < existing.time then
    delete from public.extra_records where id = existing.id;
    return new;
  end if;

  raise exception '기존 기록(%)보다 좋지 않은 기록입니다.', coalesce(existing.percent || '%', existing.time || 's');
end $function$
;

create trigger extra_maps_position_history after insert or update of position on public.extra_maps
  for each row execute function public.extra_log_position();
create trigger extra_maps_credits before insert or update of creator, verifier on public.extra_maps
  for each row execute function public.link_credits();
create trigger extra_keep_best_record before insert on public.extra_records
  for each row execute function public.extra_keep_best_record();

CREATE OR REPLACE FUNCTION public.extra_sync_username()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  update public.extra_records set player = new.username where user_id = new.id;
  update public.extra_maps set creator = new.username
   where creator_id = new.id
      or (creator_id is null and lower(creator) = lower(old.username));
  update public.extra_maps set verifier = new.username
   where verifier_id = new.id
      or (verifier_id is null and lower(verifier) = lower(old.username));
  return new;
end $function$
;

CREATE OR REPLACE FUNCTION public.extra_link_profile_credits()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  update public.extra_maps set creator_id = new.id
   where creator_id is null and lower(creator) = lower(new.username);
  update public.extra_maps set verifier_id = new.id
   where verifier_id is null and lower(verifier) = lower(new.username);
  return new;
end $function$
;

create trigger profiles_extra_rename after update of username on public.profiles
  for each row when (new.username is distinct from old.username) execute function public.extra_sync_username();
create trigger profiles_extra_link_credits after insert on public.profiles
  for each row execute function public.extra_link_profile_credits();

create view public.extra_map_scores with (security_invoker = on) as
select level_id, type, public.map_points(position) as points from public.extra_maps;
create or replace view extra_rankings with (security_invoker = on) as
with credits as (
  select extra_records.level_id, profiles.id
    from extra_records join profiles on profiles.id = extra_records.user_id or profiles.username = lower(extra_records.player)
  union
  select extra_legacy_records.level_id, profiles.id
    from extra_legacy_records join profiles on profiles.username = lower(extra_legacy_records.player)
  union
  select extra_maps.level_id, profiles.id
    from extra_maps join profiles on profiles.id = extra_maps.verifier_id or profiles.username = lower(extra_maps.verifier)
)
select totals.*, rank() over (partition by type order by points desc) as position
from (
  select scores.type,
         profiles.username as player,
         profiles.id as user_id,
         round(sum(scores.points), 1) as points,
         count(*)::integer as clears
  from credits
  join extra_map_scores scores using (level_id)
  join profiles using (id)
  group by scores.type, profiles.id, profiles.username
) totals;

grant select on public.extra_map_scores, public.extra_rankings to anon, authenticated, service_role;
revoke all on function public.extra_create_map(jsonb, public.map_type, integer),
  public.extra_move_map(text, integer), public.extra_delete_map(text, boolean),
  public.extra_approve_submission(bigint, integer) from public, anon;
grant execute on function public.extra_create_map(jsonb, public.map_type, integer),
  public.extra_move_map(text, integer), public.extra_delete_map(text, boolean),
  public.extra_approve_submission(bigint, integer) to authenticated;

notify pgrst, 'reload schema';
commit;
