-- 읽기 전용. 어떤 패치가 남았는지 보여줍니다. SQL Editor에 붙여넣고 실행하세요.
select '1. service-role-grants.sql' as patch,
       case when exists (select 1 from information_schema.role_table_grants
                          where grantee = 'service_role' and table_schema = 'public'
                            and table_name = 'admins' and privilege_type = 'INSERT')
            then '적용됨' else '필요함' end as status
union all
select '2. usernames.sql',
       case when exists (select 1 from pg_constraint where conname = 'profiles_username_shape')
            then '적용됨' else '필요함' end
union all
-- 이 패치는 정책을 없애는 것이라, 없어야 적용된 것입니다.
select '3. submissions-lockdown.sql',
       case when not exists (select 1 from pg_policies
                              where schemaname = 'public' and tablename = 'submissions'
                                and policyname = 'submit')
            then '적용됨' else '필요함' end
order by patch;
