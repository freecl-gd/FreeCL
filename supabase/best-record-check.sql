-- Self-check for best-record.sql. Changes nothing: the last line raises, which rolls
-- every insert back, and the error message IS the report. Needs one classic and one
-- platformer record to exist.
do $$
declare
  c public.records;
  p public.records;
  report text := '';
begin
  select r.* into c from public.records r join public.maps m on m.level_id = r.level_id where m.type = 'classic' limit 1;
  select r.* into p from public.records r join public.maps m on m.level_id = r.level_id where m.type = 'platformer' limit 1;

  begin
    insert into public.records (level_id, user_id, player, percent, platform, video) values (c.level_id, c.user_id, c.player, c.percent, 't', '');
    report := report || '1 FAIL same percent was inserted | ';
  exception when unique_violation then report := report || '1 ok duplicate refused | ';
  end;

  begin
    insert into public.records (level_id, user_id, player, percent, platform, video) values (c.level_id, c.user_id, c.player, c.percent - 10, 't', '');
    report := report || '2 FAIL lower percent was inserted | ';
  exception when raise_exception then report := report || '2 ok lower percent refused | ';
  end;

  begin
    insert into public.records (level_id, user_id, player, percent, platform, video) values (c.level_id, null, upper(c.player), c.percent, 't', '');
    report := report || '3 FAIL name in other case was inserted | ';
  exception when unique_violation then report := report || '3 ok matched by name, any case | ';
  end;

  insert into public.records (level_id, user_id, player, time, platform, video) values (p.level_id, p.user_id, p.player, p.time - 0.001, 't', '');
  if exists (select 1 from public.records where id = p.id) then
    report := report || '4 FAIL faster time kept the old row | ';
  elsif (select count(*) from public.records where level_id = p.level_id and user_id = p.user_id) <> 1 then
    report := report || '4 FAIL faster time left more than one row | ';
  else
    report := report || '4 ok faster time replaced the old row | ';
  end if;

  begin
    insert into public.records (level_id, user_id, player, time, platform, video) values (p.level_id, p.user_id, p.player, p.time + 5, 't', '');
    report := report || '5 FAIL slower time was inserted | ';
  exception when raise_exception then report := report || '5 ok slower time refused | ';
  end;

  raise exception 'SELFTEST rolled back: %', report;
end $$;
