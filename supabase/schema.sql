-- FreeCL Supabase schema. Run once in the Supabase SQL editor.
-- Site users  -> Supabase Auth (email + captcha, configured in the dashboard).
-- Admins      -> the same Supabase Auth accounts as site users, linked by profile id.

create type map_type   as enum ('classic', 'platformer');
create type sub_status as enum ('pending', 'approved', 'rejected');

-- level_id stays the public id of a map and of its site page.
create table maps (
  level_id     text primary key,
  type         map_type not null,
  name         text not null,
  creator      text not null default '',
  verifier     text not null default '',
  description  text not null default '',
  video        text not null default '',
  length       text not null default '',
  object_count text not null default '',
  temp_rank    boolean not null default false,
  position     integer not null,
  created_at   timestamptz not null default now()
);
create index maps_order on maps (type, position);

create table profiles (
  id         uuid primary key references auth.users on delete cascade,
  username   text not null,
  created_at timestamptz not null default now()
);
create unique index profiles_username_ci on profiles (lower(username));

-- Approved clears. player is free text so imported rows survive without an account.
create table records (
  level_id    text not null references maps on delete cascade,
  user_id     uuid references profiles on delete set null,
  player      text not null,
  percent     integer check (percent between 1 and 100),   -- classic
  time        numeric check (time > 0),                    -- platformer
  platform    text not null default '',
  approved_at timestamptz not null default now(),
  id          bigint generated always as identity primary key
);
create index records_by_map    on records (level_id);
create index records_by_player on records (user_id);

-- One queue for both submission kinds; payload holds the sheet fields verbatim.
create table submissions (
  id          bigint generated always as identity primary key,
  kind        text not null check (kind in ('map', 'record')),
  status      sub_status not null default 'pending',
  user_id     uuid not null references profiles on delete cascade,
  type        map_type not null,
  payload     jsonb not null,
  note        text,
  created_at  timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by text
);
create index submissions_queue on submissions (status, created_at);

create table position_history (
  id            bigint generated always as identity primary key,
  level_id      text not null references maps on delete cascade,
  from_position integer,
  to_position   integer not null,
  changed_at    timestamptz not null default now()
);
create index position_history_by_map on position_history (level_id, changed_at desc);

create table admin_roles (
  id   smallint primary key,
  name text not null unique
);
insert into admin_roles (id, name) values (0, 'root'), (1, 'admin');
create table admins (
  user_id  uuid primary key references profiles(id) on delete cascade,
  role_id  smallint not null default 1 references admin_roles(id),
  added_at timestamptz not null default now()
);

-- The DB writes rank history itself, so no app code can forget to.
create function log_position() returns trigger language plpgsql security definer set search_path = '' as $$
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

-- Signup metadata becomes the profile row.
create function on_signup() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, username) values (new.id, coalesce(new.raw_user_meta_data->>'username', 'user_' || left(new.id::text, 8)));
  return new;
end $$;
create trigger auth_user_created after insert on auth.users
  for each row execute function on_signup();

-- Admins are site accounts, joined through their stable profile id.
create function is_admin() returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.admins where user_id = auth.uid());
$$;
create function is_root() returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.admins where user_id = auth.uid() and role_id = 0);
$$;
create function grant_admin(target_user_id uuid) returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_root() then raise exception 'root only'; end if;
  insert into public.admins (user_id, role_id) values (target_user_id, 1)
  on conflict (user_id) do update set role_id = 1 where public.admins.role_id <> 0;
end $$;
create function revoke_admin(target_user_id uuid) returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_root() then raise exception 'root only'; end if;
  delete from public.admins where user_id = target_user_id and role_id <> 0;
end
$$;

alter table maps             enable row level security;
alter table records          enable row level security;
alter table profiles         enable row level security;
alter table submissions      enable row level security;
alter table position_history enable row level security;
alter table admins           enable row level security;

create policy public_read on maps             for select using (true);
create policy public_read on records          for select using (true);
create policy public_read on profiles         for select using (true);
create policy public_read on position_history for select using (true);
create policy trigger_insert on position_history for insert with check (true);

create policy admin_write on maps    for all using (is_admin()) with check (is_admin());
create policy admin_write on records for all using (is_admin()) with check (is_admin());
create policy admin_read  on admins  for select using (is_admin());

create policy own_profile on profiles for update using (id = auth.uid()) with check (id = auth.uid());

create policy read_own   on submissions for select using (user_id = auth.uid());
create policy admin_queue on submissions for all using (is_admin()) with check (is_admin());

-- RLS decides which rows a role sees; it does not grant the role access to the table at
-- all. Both are required, so these grants stay as tight as the policies above.
grant usage on schema public to anon, authenticated;
grant select on maps, records, profiles, position_history to anon, authenticated;
grant insert, update, delete on maps, records to authenticated;
-- No insert: submissions arrive only through the submit Edge Function, which checks the captcha.
grant select, update, delete on submissions to authenticated;
grant update on profiles to authenticated;
grant select on admins to authenticated;
revoke all on function grant_admin(uuid), revoke_admin(uuid) from public;
grant execute on function grant_admin(uuid), revoke_admin(uuid), is_root() to authenticated;

-- The secret key acts as service_role: it bypasses RLS but still needs table privileges.
grant usage on schema public to service_role;
grant select, insert, update, delete on all tables in schema public to service_role;
alter default privileges in schema public grant select, insert, update, delete on tables to service_role;

-- Approving touches two tables and must not half-apply, so it happens in one statement
-- inside the database rather than as a sequence of calls from the admin page.
-- Rejecting is a single UPDATE, which the admin RLS policy already allows.
create or replace function approve_submission(submission_id bigint, at_position integer default null)
returns void language plpgsql security definer set search_path = '' as $$
declare
  entry public.submissions;
  target integer;
begin
  if not public.is_admin() then
    raise exception 'admin only';
  end if;

  select * into entry from public.submissions where id = submission_id and status = 'pending' for update;
  if not found then
    raise exception 'submission % is missing or already reviewed', submission_id;
  end if;

  if entry.kind = 'map' then
    if at_position is null or at_position < 1 then
      raise exception '맵 승인에는 순위를 입력해야 합니다.';
    end if;
    select coalesce(max(position), 0) + 1 into target from public.maps where type = entry.type;
    target := least(at_position, target);
    -- Shifting rows down writes their history through the maps trigger, as intended.
    update public.maps set position = position + 1 where type = entry.type and position >= target;
    insert into public.maps (level_id, type, name, creator, verifier, description, video, length, object_count, position)
    values (
      entry.payload->>'levelId', entry.type, entry.payload->>'name',
      coalesce(entry.payload->>'creator', ''), coalesce(entry.payload->>'verifier', ''),
      coalesce(entry.payload->>'description', ''), coalesce(entry.payload->>'video', ''),
      coalesce(entry.payload->>'length', ''), coalesce(entry.payload->>'objectCount', ''), target
    );
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
