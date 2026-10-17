-- Replace Firebase/email grants with site-account IDs. Safe to rerun.
create table if not exists public.admin_roles (
  id smallint primary key,
  name text not null unique
);
insert into public.admin_roles (id, name) values (0, 'root'), (1, 'admin')
on conflict (id) do update set name = excluded.name;

alter table public.admins add column if not exists user_id uuid references public.profiles(id) on delete cascade;
alter table public.admins add column if not exists role_id smallint references public.admin_roles(id);

-- Preserve old grants only when their email resolves to an existing site account.
do $$
begin
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'admins' and column_name = 'email') then
    execute 'update public.admins a set user_id = p.id, role_id = coalesce(a.role_id, 1) from auth.users u join public.profiles p on p.id = u.id where lower(u.email) = lower(a.email) and a.user_id is null';
  end if;
end $$;

-- Email-only Firebase grants without a site account cannot be carried over.
delete from public.admins where user_id is null;

do $$
begin
  if not exists (select 1 from public.profiles where lower(username) = 'xisik') then
    raise exception 'profiles에서 xisik 계정을 찾을 수 없습니다.';
  end if;
end $$;

alter table public.admins alter column user_id set not null;
alter table public.admins alter column role_id set default 1;
alter table public.admins alter column role_id set not null;
alter table public.admins drop constraint if exists admins_pkey;
alter table public.admins drop column if exists uid;
alter table public.admins drop column if exists email;
alter table public.admins add constraint admins_pkey primary key (user_id);

insert into public.admins (user_id, role_id)
select id, 0 from public.profiles where lower(username) = 'xisik'
on conflict (user_id) do update set role_id = 0;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.admins where user_id = auth.uid());
$$;

create or replace function public.is_root() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.admins where user_id = auth.uid() and role_id = 0);
$$;

create or replace function public.grant_admin(target_user_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_root() then raise exception 'root only'; end if;
  insert into public.admins (user_id, role_id) values (target_user_id, 1)
  on conflict (user_id) do update set role_id = 1 where public.admins.role_id <> 0;
end $$;

create or replace function public.revoke_admin(target_user_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_root() then raise exception 'root only'; end if;
  delete from public.admins where user_id = target_user_id and role_id <> 0;
end $$;

drop policy if exists admin_read on public.admins;
create policy admin_read on public.admins for select using (public.is_admin());
drop policy if exists own_profile on public.profiles;
create policy own_profile on public.profiles for update using (id = auth.uid()) with check (id = auth.uid());
drop policy if exists read_own on public.submissions;
create policy read_own on public.submissions for select using (user_id = auth.uid());
drop policy if exists avatars_insert on storage.objects;
create policy avatars_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists avatars_update on storage.objects;
create policy avatars_update on storage.objects for update to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists avatars_delete on storage.objects;
create policy avatars_delete on storage.objects for delete to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
grant select on public.admins to authenticated;
revoke all on function public.grant_admin(uuid), public.revoke_admin(uuid) from public;
grant execute on function public.grant_admin(uuid), public.revoke_admin(uuid), public.is_root() to authenticated;
