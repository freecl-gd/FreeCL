-- Execute after user-management.sql. Every change is rolled back.
begin;
select set_config('request.jwt.claims', json_build_object('sub', (select user_id from public.admins where role_id = 0 limit 1), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare result jsonb;
begin
  assert public.is_admin() and public.is_root() and public.is_active_account();
  result := public.admin_list_users(auth.uid()::text, 0);
  assert jsonb_array_length(result->'users') = 1;
  assert (result->'users'->0->>'id')::uuid = auth.uid();
  assert result->'users'->0 ? 'permanent';
  assert not (result->'users'->0 ? 'encrypted_password');
  assert jsonb_array_length(public.admin_list_users('', 1000000)->'users') = 0;
  assert not has_function_privilege('anon', 'public.admin_list_users(text,integer)', 'execute');
end $$;
reset role;
-- Uncommitted changes to the test actor cannot affect real sessions.
update auth.users set banned_until = now() + interval '1 day' where id = auth.uid();
set local role authenticated;
do $$
declare blocked boolean := false;
begin
  assert not public.is_active_account();
  assert not public.is_admin() and not public.is_root();
  begin
    perform public.admin_list_users();
  exception when insufficient_privilege then blocked := true;
  end;
  assert blocked, 'banned admin listed users';
  update public.profiles set bio = bio where id = auth.uid();
  assert not found, 'banned account modified its profile';
end $$;
reset role;
update auth.users set banned_until = now() - interval '1 second' where id = auth.uid();
select public.is_active_account() as expired_ban_is_active;
do $$ begin assert public.is_active_account(); end $$;
update auth.users set raw_app_meta_data = coalesce(raw_app_meta_data, '{}') || '{"banned_permanently":true}' where id = auth.uid();
do $$ begin assert not public.is_active_account(), 'permanent flag expired'; end $$;
update auth.users set raw_app_meta_data = raw_app_meta_data || '{"banned_permanently":false}', banned_until = null where id = auth.uid();
do $$ begin assert public.is_active_account(), 'unban did not restore access'; end $$;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000000","role":"authenticated"}', true);
set local role authenticated;
do $$
declare blocked boolean := false;
begin
  assert not public.is_active_account(), 'deleted account token remained active';
  begin perform public.admin_list_users(); exception when insufficient_privilege then blocked := true; end;
  assert blocked, 'non-admin listed users';
end $$;
rollback;
