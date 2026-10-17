-- Account bans use Supabase Auth; app checks also reject outstanding access tokens.
begin;
create or replace function public.is_active_account() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from auth.users where id = auth.uid()
      and coalesce(raw_app_meta_data->>'banned_permanently', 'false') <> 'true'
      and (banned_until is null or banned_until <= now())
  );
$$;
revoke all on function public.is_active_account() from public;
grant execute on function public.is_active_account() to authenticated, service_role;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select public.is_active_account() and exists (select 1 from public.admins where user_id = auth.uid());
$$;
create or replace function public.is_root() returns boolean
language sql stable security definer set search_path = '' as $$
  select public.is_active_account() and exists (select 1 from public.admins where user_id = auth.uid() and role_id = 0);
$$;

create or replace function public.admin_list_users(p_query text default '', p_offset integer default 0)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
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
end $$;
revoke all on function public.admin_list_users(text, integer) from public;
grant execute on function public.admin_list_users(text, integer) to authenticated;

-- Only the server may enumerate the files that must be removed before Auth deletion.
create or replace function public.admin_user_files(p_user_id uuid)
returns table(bucket_id text, name text) language sql stable security definer set search_path = '' as $$
  select o.bucket_id, o.name from storage.objects o
   where o.owner_id = p_user_id::text or o.owner = p_user_id
      or (o.bucket_id = 'avatars' and (storage.foldername(o.name))[1] = p_user_id::text)
   order by o.bucket_id, o.name limit 100;
$$;
revoke all on function public.admin_user_files(uuid) from public, anon, authenticated;
grant execute on function public.admin_user_files(uuid) to service_role;

alter policy own_profile on public.profiles
  using (id = auth.uid() and public.is_active_account())
  with check (id = auth.uid() and public.is_active_account());
alter policy read_own on public.submissions using (user_id = auth.uid() and public.is_active_account());
alter policy read_own on public.extra_submissions using (user_id = auth.uid() and public.is_active_account());
alter policy avatars_insert on storage.objects
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text and public.is_active_account());
alter policy avatars_update on storage.objects
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text and public.is_active_account())
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text and public.is_active_account());
alter policy avatars_delete on storage.objects
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text and public.is_active_account());
notify pgrst, 'reload schema';
commit;
