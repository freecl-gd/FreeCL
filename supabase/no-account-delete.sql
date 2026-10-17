-- 계정 삭제 기능 제거. Supabase SQL Editor에서 한 번 실행한다.
-- admin_user_files 는 Auth 삭제 전에 지울 Storage 파일을 열거하기 위한 삭제 전용 함수였다.
-- 삭제 경로가 없어졌으므로 남겨 둘 이유가 없다 (service_role 전용이었고 호출자는 admin-users
-- 함수 하나뿐이었다). 밴/해제는 admin_list_users 와 Auth Admin API 만 쓴다.
drop function if exists public.admin_user_files(uuid);
