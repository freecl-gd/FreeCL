-- FreeCL database schema: the live state, exported with supabase/export-schema.sql.
-- Run once on an empty Supabase project, then notify-map-webhook.sql (needs
-- NOTIFY_SECRET) for the Discord alarm. Regenerate after any schema change.

set check_function_bodies = off;

-- Types

create type public.map_type as enum ('classic', 'platformer', 'extra');
create type public.sub_status as enum ('pending', 'approved', 'rejected');

-- Tables

create table public.admin_roles (
  id smallint not null,
  name text not null
);

create table public.admins (
  added_at timestamp with time zone not null default now(),
  user_id uuid not null,
  role_id smallint not null default 1
);

create table public.blocked_emails (
  email_hash text not null,
  username_hash text,
  created_at timestamp with time zone not null default now(),
  reason text not null,
  banned_until timestamp with time zone
);

create table public.extra_legacy_records (
  id bigint generated always as identity not null,
  level_id text not null,
  player text not null,
  percent integer,
  "time" numeric,
  platform text not null default ''::text,
  first boolean not null default false,
  note text
);

create table public.extra_maps (
  level_id text not null,
  type map_type not null,
  name text not null,
  creator text not null default ''::text,
  verifier text not null default ''::text,
  description text not null default ''::text,
  video text not null default ''::text,
  length text not null default ''::text,
  object_count text not null default ''::text,
  "position" integer not null,
  created_at timestamp with time zone not null default now(),
  creator_id uuid,
  verifier_id uuid
);

create table public.extra_position_history (
  id bigint generated always as identity not null,
  level_id text not null,
  from_position integer,
  to_position integer not null,
  changed_at timestamp with time zone not null default now()
);

create table public.extra_records (
  level_id text not null,
  user_id uuid,
  player text not null,
  percent integer,
  "time" numeric,
  platform text not null default ''::text,
  approved_at timestamp with time zone not null default now(),
  id bigint generated always as identity not null,
  first boolean not null default false,
  note text,
  submitted_at timestamp with time zone not null default now(),
  video text not null default ''::text
);

create table public.extra_submissions (
  id bigint generated always as identity not null,
  kind text not null,
  status sub_status not null default 'pending'::sub_status,
  user_id uuid not null,
  type map_type not null,
  payload jsonb not null,
  note text,
  created_at timestamp with time zone not null default now(),
  reviewed_at timestamp with time zone,
  reviewed_by text
);

create table public.legacy_records (
  id bigint generated always as identity not null,
  level_id text not null,
  player text not null,
  percent integer,
  "time" numeric,
  platform text not null default ''::text,
  first boolean not null default false,
  note text
);

create table public.maps (
  level_id text not null,
  type map_type not null,
  name text not null,
  creator text not null default ''::text,
  verifier text not null default ''::text,
  description text not null default ''::text,
  video text not null default ''::text,
  length text not null default ''::text,
  object_count text not null default ''::text,
  "position" integer not null,
  created_at timestamp with time zone not null default now(),
  creator_id uuid,
  verifier_id uuid
);

create table public.position_history (
  id bigint generated always as identity not null,
  level_id text not null,
  from_position integer,
  to_position integer not null,
  changed_at timestamp with time zone not null default now()
);

create table public.profiles (
  id uuid not null,
  username text not null,
  created_at timestamp with time zone not null default now(),
  bio text not null default ''::text,
  avatar_url text not null default ''::text
);

create table public.records (
  level_id text not null,
  user_id uuid,
  player text not null,
  percent integer,
  "time" numeric,
  platform text not null default ''::text,
  approved_at timestamp with time zone not null default now(),
  id bigint generated always as identity not null,
  first boolean not null default false,
  note text,
  submitted_at timestamp with time zone not null default now(),
  video text not null default ''::text
);

create table public.submissions (
  id bigint generated always as identity not null,
  kind text not null,
  status sub_status not null default 'pending'::sub_status,
  user_id uuid not null,
  type map_type not null,
  payload jsonb not null,
  note text,
  created_at timestamp with time zone not null default now(),
  reviewed_at timestamp with time zone,
  reviewed_by text
);

-- Functions

CREATE OR REPLACE FUNCTION public.admin_list_users(p_query text DEFAULT ''::text, p_offset integer DEFAULT 0)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not public.is_admin() then raise exception '관리자 권한이 필요합니다.' using errcode = '42501'; end if;
  return (
    with matched as (
      select u.id, coalesce(p.username, u.email, u.id::text) as username,
             u.email, u.created_at, u.banned_until,
             coalesce(u.raw_app_meta_data->>'banned_permanently', 'false') = 'true' as permanent,
             a.role_id
        from auth.users u left join public.profiles p on p.id = u.id
        left join public.admins a on a.user_id = u.id
       where btrim(coalesce(p_query, '')) = ''
          or strpos(lower(coalesce(p.username, '') || ' ' || coalesce(u.email, '') || ' ' || u.id::text), lower(btrim(p_query))) > 0
    ), page as (select * from matched order by created_at desc, id limit 50 offset greatest(coalesce(p_offset, 0), 0))
    select jsonb_build_object('users', coalesce((select jsonb_agg(page) from page), '[]'::jsonb), 'total', (select count(*) from matched))
  );
end $function$
;

CREATE OR REPLACE FUNCTION public.approve_submission(submission_id bigint, at_position integer DEFAULT NULL::integer)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
end $function$
;

CREATE OR REPLACE FUNCTION public.block_banned_email()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if new.email is not null and public.email_blocked(new.email) then
    raise exception 'blocked email' using errcode = '42501';
  end if;
  return new;
end $function$
;

CREATE OR REPLACE FUNCTION public.block_withdrawn_username()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if exists (select 1 from public.blocked_emails
              where username_hash = public.identity_hash(new.username)
                and email_hash <> coalesce((select public.identity_hash(email) from auth.users where id = new.id), '')) then
    raise exception 'withdrawn username' using errcode = '42501';
  end if;
  return new;
end $function$
;

CREATE OR REPLACE FUNCTION public.create_map(p_payload jsonb, p_type map_type, p_position integer DEFAULT NULL::integer)
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
end $function$
;

CREATE OR REPLACE FUNCTION public.delete_map(p_level_id text, p_discard_records boolean DEFAULT false)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  entry public.maps;
  clears integer;
begin
  if not public.is_admin() then raise exception 'admin only'; end if;
  select * into entry from public.maps where level_id = p_level_id for update;
  if not found then raise exception '없는 맵입니다: %', p_level_id; end if;

  select (select count(*) from public.records where level_id = p_level_id)
       + (select count(*) from public.legacy_records where level_id = p_level_id)
    into clears;
  if clears > 0 and not p_discard_records then
    raise exception '이 맵에는 클리어 기록이 %건 있습니다. 기록까지 지우려면 다시 확인해 주세요.', clears;
  end if;

  delete from public.records where level_id = p_level_id;
  delete from public.legacy_records where level_id = p_level_id;
  update public.submissions
     set status = 'rejected',
         note = concat_ws(' ', note, '맵이 삭제되어 자동 거부되었습니다.'),
         reviewed_at = now()
   where status = 'pending' and kind = 'record' and payload->>'levelId' = p_level_id;

  delete from public.maps where level_id = p_level_id;  -- position_history cascades
  update public.maps set position = position - 1 where type = entry.type and position > entry.position;
  return clears;
end $function$
;

CREATE OR REPLACE FUNCTION public.email_blocked(p_email text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select exists (select 1 from public.blocked_emails
                  where email_hash = public.identity_hash(p_email)
                    and (banned_until is null or banned_until > now()));
$function$
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

CREATE OR REPLACE FUNCTION public.grant_admin(target_user_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not public.is_root() then raise exception 'root only'; end if;
  insert into public.admins (user_id, role_id) values (target_user_id, 1)
  on conflict (user_id) do update set role_id = 1 where public.admins.role_id <> 0;
end $function$
;

CREATE OR REPLACE FUNCTION public.identity_hash(value text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  select encode(sha256(convert_to(lower(btrim(value)), 'UTF8')), 'hex');
$function$
;

CREATE OR REPLACE FUNCTION public.is_active_account()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select exists (
    select 1 from auth.users where id = auth.uid()
      and coalesce(raw_app_meta_data->>'banned_permanently', 'false') <> 'true'
      and (banned_until is null or banned_until <= now())
  );
$function$
;

CREATE OR REPLACE FUNCTION public.is_admin()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select public.is_active_account() and exists (select 1 from public.admins where user_id = auth.uid());
$function$
;

CREATE OR REPLACE FUNCTION public.is_root()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select public.is_active_account() and exists (select 1 from public.admins where user_id = auth.uid() and role_id = 0);
$function$
;

CREATE OR REPLACE FUNCTION public.keep_best_record()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
end $function$
;

CREATE OR REPLACE FUNCTION public.length_seconds(value text)
 RETURNS integer
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO ''
AS $function$
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
end $function$
;

CREATE OR REPLACE FUNCTION public.link_credits()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  new.creator_id  := (select id from public.profiles where lower(username) = lower(new.creator));
  new.verifier_id := (select id from public.profiles where lower(username) = lower(new.verifier));
  return new;
end $function$
;

CREATE OR REPLACE FUNCTION public.link_profile_credits()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  update public.maps set creator_id = new.id
   where creator_id is null and lower(creator) = lower(new.username);
  update public.maps set verifier_id = new.id
   where verifier_id is null and lower(verifier) = lower(new.username);
  return new;
end $function$
;

CREATE OR REPLACE FUNCTION public.log_position()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if tg_op = 'INSERT' then
    insert into public.position_history (level_id, from_position, to_position) values (new.level_id, null, new.position);
  elsif new.position is distinct from old.position then
    insert into public.position_history (level_id, from_position, to_position) values (new.level_id, old.position, new.position);
  end if;
  return new;
end $function$
;

CREATE OR REPLACE FUNCTION public.map_points(p_position integer)
 RETURNS numeric
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  select round(100 * power(0.94, greatest(p_position, 1) - 1), 1);
$function$
;

CREATE OR REPLACE FUNCTION public.move_map(p_level_id text, p_position integer)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
end $function$
;

CREATE OR REPLACE FUNCTION public.on_signup()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  insert into public.profiles (id, username)
  values (new.id, lower(coalesce(nullif(btrim(new.raw_user_meta_data->>'username'), ''), 'user_' || left(new.id::text, 8))));
  return new;
end $function$
;

CREATE OR REPLACE FUNCTION public.purge_account(p_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_name text := (select lower(username) from public.profiles where id = p_user_id);
  v_records int; v_extra int; v_legacy int; v_extra_legacy int;
begin
  if v_name is null then raise exception 'no profile for %', p_user_id; end if;
  delete from public.records where user_id = p_user_id or lower(player) = v_name;
  get diagnostics v_records = row_count;
  delete from public.extra_records where user_id = p_user_id or lower(player) = v_name;
  get diagnostics v_extra = row_count;
  delete from public.legacy_records where lower(player) = v_name;
  get diagnostics v_legacy = row_count;
  delete from public.extra_legacy_records where lower(player) = v_name;
  get diagnostics v_extra_legacy = row_count;
  update public.maps set creator = '' where creator_id = p_user_id or lower(creator) = v_name;
  update public.maps set verifier = '' where verifier_id = p_user_id or lower(verifier) = v_name;
  update public.extra_maps set creator = '' where creator_id = p_user_id or lower(creator) = v_name;
  update public.extra_maps set verifier = '' where verifier_id = p_user_id or lower(verifier) = v_name;
  delete from auth.users where id = p_user_id;
  return jsonb_build_object('records', v_records + v_extra, 'legacy', v_legacy + v_extra_legacy);
end $function$
;

CREATE OR REPLACE FUNCTION public.revoke_admin(target_user_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not public.is_root() then raise exception 'root only'; end if;
  delete from public.admins where user_id = target_user_id and role_id <> 0;
end $function$
;

CREATE OR REPLACE FUNCTION public.signup_blocked(p_email text, p_username text)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select case
    when exists (select 1 from public.blocked_emails where email_hash = public.identity_hash(p_email)
                   and reason = 'ban' and (banned_until is null or banned_until > now())) then 'email'
    when exists (select 1 from public.blocked_emails where email_hash = public.identity_hash(p_email)
                   and reason = 'withdrawn' and banned_until > now()) then 'withdrawn'
    when exists (select 1 from public.blocked_emails where username_hash = public.identity_hash(p_username)
                   and email_hash <> public.identity_hash(p_email)) then 'username'
  end;
$function$
;

CREATE OR REPLACE FUNCTION public.sync_username()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  update public.records set player = new.username where user_id = new.id;
  update public.maps set creator = new.username
   where creator_id = new.id
      or (creator_id is null and lower(creator) = lower(old.username));
  update public.maps set verifier = new.username
   where verifier_id = new.id
      or (verifier_id is null and lower(verifier) = lower(old.username));
  return new;
end $function$
;

-- Constraints

alter table public.admin_roles add constraint admin_roles_name_key UNIQUE (name);
alter table public.admin_roles add constraint admin_roles_pkey PRIMARY KEY (id);
alter table public.admins add constraint admins_pkey PRIMARY KEY (user_id);
alter table public.blocked_emails add constraint blocked_emails_reason_check CHECK ((reason = ANY (ARRAY['ban'::text, 'withdrawn'::text])));
alter table public.blocked_emails add constraint withdrawn_accounts_pkey PRIMARY KEY (email_hash);
alter table public.extra_legacy_records add constraint extra_legacy_records_pkey PRIMARY KEY (id);
alter table public.extra_maps add constraint extra_length CHECK (COALESCE(((length_seconds(length) >= 60) AND (length_seconds(length) <= 599)), false));
alter table public.extra_maps add constraint extra_maps_pkey PRIMARY KEY (level_id);
alter table public.extra_maps add constraint extra_maps_type CHECK ((type = 'extra'::map_type));
alter table public.extra_position_history add constraint extra_position_history_pkey PRIMARY KEY (id);
alter table public.extra_records add constraint extra_records_percent CHECK (((percent IS NOT NULL) AND ("time" IS NULL)));
alter table public.extra_records add constraint extra_records_pkey PRIMARY KEY (id);
alter table public.extra_records add constraint records_percent_check CHECK (((percent >= 1) AND (percent <= 100)));
alter table public.extra_records add constraint records_time_check CHECK (("time" > (0)::numeric));
alter table public.extra_submissions add constraint extra_submissions_pkey PRIMARY KEY (id);
alter table public.extra_submissions add constraint extra_submissions_type CHECK ((type = 'extra'::map_type));
alter table public.extra_submissions add constraint submissions_kind_check CHECK ((kind = ANY (ARRAY['map'::text, 'record'::text])));
alter table public.legacy_records add constraint legacy_records_pkey PRIMARY KEY (id);
alter table public.maps add constraint maps_existing_types CHECK ((type = ANY (ARRAY['classic'::map_type, 'platformer'::map_type])));
alter table public.maps add constraint maps_pkey PRIMARY KEY (level_id);
alter table public.maps add constraint timed_length CHECK (((type <> 'classic'::map_type) OR COALESCE(((length_seconds(length) >= 1) AND (length_seconds(length) <= 59)), false)));
alter table public.position_history add constraint position_history_pkey PRIMARY KEY (id);
alter table public.profiles add constraint profiles_bio_length CHECK ((char_length(bio) <= 120));
alter table public.profiles add constraint profiles_pkey PRIMARY KEY (id);
alter table public.profiles add constraint profiles_username_shape CHECK ((username ~ '^[a-z0-9_]{2,20}$'::text));
alter table public.records add constraint records_percent_check CHECK (((percent >= 1) AND (percent <= 100)));
alter table public.records add constraint records_pkey PRIMARY KEY (id);
alter table public.records add constraint records_time_check CHECK (("time" > (0)::numeric));
alter table public.submissions add constraint submissions_existing_types CHECK ((type = ANY (ARRAY['classic'::map_type, 'platformer'::map_type])));
alter table public.submissions add constraint submissions_kind_check CHECK ((kind = ANY (ARRAY['map'::text, 'record'::text])));
alter table public.submissions add constraint submissions_pkey PRIMARY KEY (id);
alter table public.admins add constraint admins_role_id_fkey FOREIGN KEY (role_id) REFERENCES admin_roles(id);
alter table public.admins add constraint admins_user_id_fkey FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE;
alter table public.extra_legacy_records add constraint extra_legacy_records_level_id_fkey FOREIGN KEY (level_id) REFERENCES extra_maps(level_id) ON DELETE RESTRICT;
alter table public.extra_maps add constraint extra_maps_creator_id_fkey FOREIGN KEY (creator_id) REFERENCES profiles(id) ON DELETE SET NULL;
alter table public.extra_maps add constraint extra_maps_verifier_id_fkey FOREIGN KEY (verifier_id) REFERENCES profiles(id) ON DELETE SET NULL;
alter table public.extra_position_history add constraint extra_position_history_level_id_fkey FOREIGN KEY (level_id) REFERENCES extra_maps(level_id) ON DELETE CASCADE;
alter table public.extra_records add constraint extra_records_level_id_fkey FOREIGN KEY (level_id) REFERENCES extra_maps(level_id) ON DELETE RESTRICT;
alter table public.extra_records add constraint extra_records_user_id_fkey FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE SET NULL;
alter table public.extra_submissions add constraint extra_submissions_user_id_fkey FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE;
alter table public.legacy_records add constraint legacy_records_level_id_fkey FOREIGN KEY (level_id) REFERENCES maps(level_id) ON DELETE RESTRICT;
alter table public.maps add constraint maps_creator_id_fkey FOREIGN KEY (creator_id) REFERENCES profiles(id) ON DELETE SET NULL;
alter table public.maps add constraint maps_verifier_id_fkey FOREIGN KEY (verifier_id) REFERENCES profiles(id) ON DELETE SET NULL;
alter table public.position_history add constraint position_history_level_id_fkey FOREIGN KEY (level_id) REFERENCES maps(level_id) ON DELETE CASCADE;
alter table public.profiles add constraint profiles_id_fkey FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.records add constraint records_level_id_fkey FOREIGN KEY (level_id) REFERENCES maps(level_id) ON DELETE RESTRICT;
alter table public.records add constraint records_user_id_fkey FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE SET NULL;
alter table public.submissions add constraint submissions_user_id_fkey FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE;

-- Views

create view public.extra_map_scores as
 SELECT level_id,
    type,
    map_points("position") AS points
   FROM extra_maps;

create view public.extra_rankings as
 WITH credits AS (
         SELECT extra_records.level_id,
            profiles.id
           FROM extra_records
             JOIN profiles ON profiles.id = extra_records.user_id OR profiles.username = lower(extra_records.player)
        UNION
         SELECT extra_legacy_records.level_id,
            profiles.id
           FROM extra_legacy_records
             JOIN profiles ON profiles.username = lower(extra_legacy_records.player)
        UNION
         SELECT extra_maps.level_id,
            profiles.id
           FROM extra_maps
             JOIN profiles ON profiles.id = extra_maps.verifier_id OR profiles.username = lower(extra_maps.verifier)
        )
 SELECT type,
    player,
    user_id,
    points,
    clears,
    rank() OVER (PARTITION BY type ORDER BY points DESC) AS "position"
   FROM ( SELECT scores.type,
            profiles.username AS player,
            profiles.id AS user_id,
            round(sum(scores.points), 1) AS points,
            count(*)::integer AS clears
           FROM credits
             JOIN extra_map_scores scores USING (level_id)
             JOIN profiles USING (id)
          GROUP BY scores.type, profiles.id, profiles.username) totals;

create view public.map_scores as
 SELECT level_id,
    type,
    map_points("position") AS points
   FROM maps;

create view public.rankings as
 WITH credits AS (
         SELECT records.level_id,
            profiles.id
           FROM records
             JOIN profiles ON profiles.id = records.user_id OR profiles.username = lower(records.player)
        UNION
         SELECT legacy_records.level_id,
            profiles.id
           FROM legacy_records
             JOIN profiles ON profiles.username = lower(legacy_records.player)
        UNION
         SELECT maps.level_id,
            profiles.id
           FROM maps
             JOIN profiles ON profiles.id = maps.verifier_id OR profiles.username = lower(maps.verifier)
        )
 SELECT type,
    player,
    user_id,
    points,
    clears,
    rank() OVER (PARTITION BY type ORDER BY points DESC) AS "position"
   FROM ( SELECT scores.type,
            profiles.username AS player,
            profiles.id AS user_id,
            round(sum(scores.points), 1) AS points,
            count(*)::integer AS clears
           FROM credits
             JOIN map_scores scores USING (level_id)
             JOIN profiles USING (id)
          GROUP BY scores.type, profiles.id, profiles.username) totals;

-- Indexes

CREATE INDEX extra_submissions_status_created_at_idx ON public.extra_submissions USING btree (status, created_at);
CREATE INDEX position_history_by_map ON public.position_history USING btree (level_id, changed_at DESC);
CREATE UNIQUE INDEX profiles_username_ci ON public.profiles USING btree (lower(username));
CREATE INDEX submissions_queue ON public.submissions USING btree (status, created_at);
CREATE INDEX extra_legacy_records_level_id_idx ON public.extra_legacy_records USING btree (level_id);
CREATE INDEX maps_order ON public.maps USING btree (type, "position");
CREATE INDEX blocked_emails_username ON public.blocked_emails USING btree (username_hash);
CREATE INDEX extra_position_history_level_id_changed_at_idx ON public.extra_position_history USING btree (level_id, changed_at DESC);
CREATE INDEX records_by_time ON public.records USING btree (level_id, submitted_at);
CREATE INDEX extra_records_level_id_idx ON public.extra_records USING btree (level_id);
CREATE INDEX extra_maps_type_position_idx ON public.extra_maps USING btree (type, "position");
CREATE INDEX extra_records_user_id_idx ON public.extra_records USING btree (user_id);
CREATE INDEX records_by_player ON public.records USING btree (user_id);
CREATE INDEX legacy_by_map ON public.legacy_records USING btree (level_id);
CREATE INDEX records_by_map ON public.records USING btree (level_id);
CREATE INDEX extra_records_level_id_submitted_at_idx ON public.extra_records USING btree (level_id, submitted_at);

-- Triggers (Database Webhooks: notify-map-webhook.sql)

CREATE TRIGGER extra_maps_credits BEFORE INSERT OR UPDATE OF creator, verifier ON public.extra_maps FOR EACH ROW EXECUTE FUNCTION link_credits();
CREATE TRIGGER extra_maps_position_history AFTER INSERT OR UPDATE OF "position" ON public.extra_maps FOR EACH ROW EXECUTE FUNCTION extra_log_position();
CREATE TRIGGER extra_keep_best_record BEFORE INSERT ON public.extra_records FOR EACH ROW EXECUTE FUNCTION extra_keep_best_record();
CREATE TRIGGER maps_credits BEFORE INSERT OR UPDATE OF creator, verifier ON public.maps FOR EACH ROW EXECUTE FUNCTION link_credits();
CREATE TRIGGER maps_position_history AFTER INSERT OR UPDATE OF "position" ON public.maps FOR EACH ROW EXECUTE FUNCTION log_position();
CREATE TRIGGER block_withdrawn_username BEFORE INSERT OR UPDATE OF username ON public.profiles FOR EACH ROW EXECUTE FUNCTION block_withdrawn_username();
CREATE TRIGGER profiles_extra_link_credits AFTER INSERT ON public.profiles FOR EACH ROW EXECUTE FUNCTION extra_link_profile_credits();
CREATE TRIGGER profiles_extra_rename AFTER UPDATE OF username ON public.profiles FOR EACH ROW WHEN ((new.username IS DISTINCT FROM old.username)) EXECUTE FUNCTION extra_sync_username();
CREATE TRIGGER profiles_link_credits AFTER INSERT ON public.profiles FOR EACH ROW EXECUTE FUNCTION link_profile_credits();
CREATE TRIGGER profiles_rename AFTER UPDATE OF username ON public.profiles FOR EACH ROW WHEN ((new.username IS DISTINCT FROM old.username)) EXECUTE FUNCTION sync_username();
CREATE TRIGGER keep_best_record BEFORE INSERT ON public.records FOR EACH ROW EXECUTE FUNCTION keep_best_record();
CREATE TRIGGER auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION on_signup();
CREATE TRIGGER block_banned_email BEFORE INSERT OR UPDATE OF email ON auth.users FOR EACH ROW EXECUTE FUNCTION block_banned_email();

-- Row level security

alter table public.admins enable row level security;
alter table public.blocked_emails enable row level security;
alter table public.extra_legacy_records enable row level security;
alter table public.extra_maps enable row level security;
alter table public.extra_position_history enable row level security;
alter table public.extra_records enable row level security;
alter table public.extra_submissions enable row level security;
alter table public.legacy_records enable row level security;
alter table public.maps enable row level security;
alter table public.position_history enable row level security;
alter table public.profiles enable row level security;
alter table public.records enable row level security;
alter table public.submissions enable row level security;

-- Policies

create policy admin_read on public.admins as PERMISSIVE for SELECT to public
  using (is_admin());

create policy admin_write on public.extra_legacy_records as PERMISSIVE for ALL to public
  using (is_admin())
  with check (is_admin());

create policy public_read on public.extra_legacy_records as PERMISSIVE for SELECT to public
  using (true);

create policy admin_write on public.extra_maps as PERMISSIVE for ALL to public
  using (is_admin())
  with check (is_admin());

create policy public_read on public.extra_maps as PERMISSIVE for SELECT to public
  using (true);

create policy public_read on public.extra_position_history as PERMISSIVE for SELECT to public
  using (true);

create policy admin_write on public.extra_records as PERMISSIVE for ALL to public
  using (is_admin())
  with check (is_admin());

create policy public_read on public.extra_records as PERMISSIVE for SELECT to public
  using (true);

create policy admin_queue on public.extra_submissions as PERMISSIVE for ALL to public
  using (is_admin())
  with check (is_admin());

create policy read_own on public.extra_submissions as PERMISSIVE for SELECT to public
  using (((user_id = auth.uid()) AND is_active_account()));

create policy admin_write on public.legacy_records as PERMISSIVE for ALL to public
  using (is_admin())
  with check (is_admin());

create policy public_read on public.legacy_records as PERMISSIVE for SELECT to public
  using (true);

create policy admin_write on public.maps as PERMISSIVE for ALL to public
  using (is_admin())
  with check (is_admin());

create policy public_read on public.maps as PERMISSIVE for SELECT to public
  using (true);

create policy public_read on public.position_history as PERMISSIVE for SELECT to public
  using (true);

create policy trigger_insert on public.position_history as PERMISSIVE for INSERT to public
  with check (true);

create policy own_profile on public.profiles as PERMISSIVE for UPDATE to public
  using (((id = auth.uid()) AND is_active_account()))
  with check (((id = auth.uid()) AND is_active_account()));

create policy public_read on public.profiles as PERMISSIVE for SELECT to public
  using (true);

create policy admin_write on public.records as PERMISSIVE for ALL to public
  using (is_admin())
  with check (is_admin());

create policy public_read on public.records as PERMISSIVE for SELECT to public
  using (true);

create policy admin_queue on public.submissions as PERMISSIVE for ALL to public
  using (is_admin())
  with check (is_admin());

create policy read_own on public.submissions as PERMISSIVE for SELECT to public
  using (((user_id = auth.uid()) AND is_active_account()));

create policy avatars_delete on storage.objects as PERMISSIVE for DELETE to authenticated
  using (((bucket_id = 'avatars'::text) AND ((storage.foldername(name))[1] = (auth.uid())::text) AND is_active_account()));

create policy avatars_insert on storage.objects as PERMISSIVE for INSERT to authenticated
  with check (((bucket_id = 'avatars'::text) AND ((storage.foldername(name))[1] = (auth.uid())::text) AND is_active_account()));

create policy avatars_read on storage.objects as PERMISSIVE for SELECT to public
  using ((bucket_id = 'avatars'::text));

create policy avatars_update on storage.objects as PERMISSIVE for UPDATE to authenticated
  using (((bucket_id = 'avatars'::text) AND ((storage.foldername(name))[1] = (auth.uid())::text) AND is_active_account()))
  with check (((bucket_id = 'avatars'::text) AND ((storage.foldername(name))[1] = (auth.uid())::text) AND is_active_account()));

-- Table grants (Supabase grants everything by default; start from nothing)

revoke all on all tables in schema public from anon, authenticated, service_role;

grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.admin_roles to service_role;
grant SELECT on public.admins to authenticated;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.admins to service_role;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.blocked_emails to service_role;
grant SELECT on public.extra_legacy_records to anon;
grant DELETE, INSERT, SELECT, UPDATE on public.extra_legacy_records to authenticated;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.extra_legacy_records to service_role;
grant SELECT on public.extra_map_scores to anon;
grant SELECT on public.extra_map_scores to authenticated;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.extra_map_scores to service_role;
grant SELECT on public.extra_maps to anon;
grant DELETE, INSERT, SELECT, UPDATE on public.extra_maps to authenticated;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.extra_maps to service_role;
grant SELECT on public.extra_position_history to anon;
grant SELECT on public.extra_position_history to authenticated;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.extra_position_history to service_role;
grant SELECT on public.extra_rankings to anon;
grant SELECT on public.extra_rankings to authenticated;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.extra_rankings to service_role;
grant SELECT on public.extra_records to anon;
grant DELETE, INSERT, SELECT, UPDATE on public.extra_records to authenticated;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.extra_records to service_role;
grant DELETE, SELECT, UPDATE on public.extra_submissions to authenticated;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.extra_submissions to service_role;
grant SELECT on public.legacy_records to anon;
grant DELETE, INSERT, SELECT, UPDATE on public.legacy_records to authenticated;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.legacy_records to service_role;
grant SELECT on public.map_scores to anon;
grant SELECT on public.map_scores to authenticated;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.map_scores to service_role;
grant SELECT on public.maps to anon;
grant DELETE, INSERT, SELECT, UPDATE on public.maps to authenticated;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.maps to service_role;
grant SELECT on public.position_history to anon;
grant SELECT on public.position_history to authenticated;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.position_history to service_role;
grant SELECT on public.profiles to anon;
grant SELECT, UPDATE on public.profiles to authenticated;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.profiles to service_role;
grant SELECT on public.rankings to anon;
grant SELECT on public.rankings to authenticated;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.rankings to service_role;
grant SELECT on public.records to anon;
grant DELETE, INSERT, SELECT, UPDATE on public.records to authenticated;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.records to service_role;
grant DELETE, SELECT, UPDATE on public.submissions to authenticated;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.submissions to service_role;

-- Function grants (functions not listed keep the default PUBLIC execute)

revoke execute on all functions in schema public from anon, authenticated, service_role;

grant execute on function admin_list_users(text,integer) to authenticated;
grant execute on function extra_approve_submission(bigint,integer) to authenticated;
grant execute on function extra_create_map(jsonb,map_type,integer) to authenticated;
grant execute on function extra_delete_map(text,boolean) to authenticated;
grant execute on function extra_move_map(text,integer) to authenticated;
grant execute on function grant_admin(uuid) to authenticated;
grant execute on function is_active_account() to authenticated;
grant execute on function is_active_account() to service_role;
grant execute on function is_root() to authenticated;
grant execute on function purge_account(uuid) to service_role;
grant execute on function revoke_admin(uuid) to authenticated;
grant execute on function signup_blocked(text,text) to anon;
grant execute on function signup_blocked(text,text) to authenticated;
revoke all on function admin_list_users(text,integer) from public;
revoke all on function email_blocked(text) from public;
revoke all on function extra_approve_submission(bigint,integer) from public;
revoke all on function extra_create_map(jsonb,map_type,integer) from public;
revoke all on function extra_delete_map(text,boolean) from public;
revoke all on function extra_move_map(text,integer) from public;
revoke all on function grant_admin(uuid) from public;
revoke all on function is_active_account() from public;
revoke all on function purge_account(uuid) from public;
revoke all on function revoke_admin(uuid) from public;
revoke all on function signup_blocked(text,text) from public;

-- Storage

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values ('avatars', 'avatars', true, 2097152, '{image/png,image/jpeg,image/webp,image/gif}') on conflict (id) do nothing;

-- Seed rows

insert into public.admin_roles (id, name) values (0, 'root') on conflict (id) do nothing;
insert into public.admin_roles (id, name) values (1, 'admin') on conflict (id) do nothing;
