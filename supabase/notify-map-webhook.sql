-- 등재 Discord 알람. Supabase SQL Editor에 한 번 붙여넣고 실행한다.
-- 먼저 Database -> Webhooks -> Enable webhooks 를 눌러 둬야 한다 (supabase_functions 스키마와
-- pg_net 이 그때 생긴다).
--
-- <NOTIFY_SECRET> 를 notify-map 함수에 등록한 NOTIFY_SECRET 값으로 바꾼다. 아래 두 군데 모두
-- 같은 값이어야 하고, 다르면 함수가 403으로 거절한다.
--
-- EXTRA 는 classic-extra.sql 에서 만든 extra_maps 에 들어가므로 테이블마다 트리거가 필요하다.
-- maps 는 TIMED 와 PLAT 을 함께 담으므로 이 둘로 세 분류가 전부 덮인다. 두 트리거 모두 이미
-- 배포된 같은 함수를 호출한다.
--
-- supabase_functions.http_request 의 인자는 url, method, headers, params, timeout_ms 이고
-- POST 페이로드는 {record, old_record, type, table, schema} 다 (pg_proc 에서 확인).
-- AFTER INSERT 이므로 롤백된 등재는 알람을 보내지 않는다.

create or replace trigger notify_map
after insert on public.maps
for each row execute function supabase_functions.http_request(
  'https://erpdomfrjxblrmapoceb.supabase.co/functions/v1/notify-map',
  'POST',
  '{"Content-Type":"application/json","x-notify-secret":"<NOTIFY_SECRET>"}',
  '{}',
  -- 기본값 1000ms 는 함수 콜드 스타트 + Discord 왕복에 모자란다.
  '5000'
);

create or replace trigger notify_extra_map
after insert on public.extra_maps
for each row execute function supabase_functions.http_request(
  'https://erpdomfrjxblrmapoceb.supabase.co/functions/v1/notify-map',
  'POST',
  '{"Content-Type":"application/json","x-notify-secret":"<NOTIFY_SECRET>"}',
  '{}',
  '5000'
);
