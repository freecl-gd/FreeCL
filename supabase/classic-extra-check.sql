-- All fixtures and mutations are rolled back, including map moves and profile renames.
begin;
do $$
declare
  actor uuid;
  submission bigint;
  score_before numeric;
  fixture text := '__extra_check__';
  other text := '__extra_check_second__';
  blocked boolean;
begin
  assert (select relkind = 'r' from pg_class where oid = 'public.extra_maps'::regclass), 'EXTRA must be a physical table';
  assert public.length_seconds('59s') = 59;
  assert public.length_seconds('1:00') = 60;
  assert public.length_seconds('9m59s') = 599;
  assert public.length_seconds('10:00') = 600;
  assert public.length_seconds('1:60') is null;
  assert public.length_seconds('garbage') is null;
  assert not has_table_privilege('anon', 'public.extra_submissions', 'select');
  assert not has_table_privilege('authenticated', 'public.extra_submissions', 'insert');

  select user_id into actor from public.admins where role_id = 0 limit 1;
  assert actor is not null, 'requires an existing root account';
  perform set_config('request.jwt.claims', json_build_object('sub', actor, 'role', 'authenticated')::text, true);
  select points into score_before from public.rankings where user_id = actor and type = 'classic';

  perform public.create_map(jsonb_build_object('levelId', fixture, 'name', 'TIMED test', 'length', '59s'), 'classic');
  perform public.extra_create_map(jsonb_build_object('levelId', fixture, 'name', 'EXTRA test', 'length', '1:00'), 'extra');
  perform public.extra_create_map(jsonb_build_object('levelId', other, 'name', 'EXTRA last', 'length', '9:59'), 'extra');
  perform public.extra_move_map(other, 1);
  assert (select position = 1 from public.extra_maps where level_id = other);
  assert (select position > 1 from public.maps where level_id = fixture), 'EXTRA move changed TIMED';
  assert exists (select 1 from public.extra_position_history where level_id = other and from_position is not null);

  foreach fixture in array array['59s', '600s', '', '1:60'] loop
    blocked := false;
    begin
      update public.extra_maps set length = fixture where level_id = other;
    exception when check_violation then blocked := true;
    end;
    assert blocked, 'invalid EXTRA length accepted';
  end loop;
  fixture := '__extra_check__';
  blocked := false;
  begin
    update public.maps set length = '60s' where level_id = fixture;
  exception when check_violation then blocked := true;
  end;
  assert blocked, 'TIMED accepted 60 seconds';
  blocked := false;
  begin
    perform public.extra_create_map(jsonb_build_object('levelId', 'wrong_type', 'name', 'wrong', 'length', '60s'), 'classic');
  exception when check_violation then blocked := true;
  end;
  assert blocked, 'EXTRA accepted TIMED type';

  insert into public.extra_submissions(kind, user_id, type, payload)
  values ('map', actor, 'extra', '{"levelId":"__extra_submission__","name":"approval","length":"2m"}') returning id into submission;
  blocked := false;
  begin
    perform public.extra_approve_submission(submission);
  exception when raise_exception then blocked := true;
  end;
  assert blocked, 'approval without rank accepted';
  perform public.extra_approve_submission(submission, 1);
  assert exists (select 1 from public.extra_maps where level_id = '__extra_submission__' and position = 1);
  assert not exists (select 1 from public.maps where level_id = '__extra_submission__');

  insert into public.extra_submissions(kind, user_id, type, payload)
  values ('record', actor, 'extra', jsonb_build_object('levelId', fixture, 'percent', 80, 'platform', 'PC', 'video', 'test')) returning id into submission;
  perform public.extra_approve_submission(submission);
  assert exists (select 1 from public.extra_records where level_id = fixture and percent = 80 and user_id = actor);
  assert not exists (select 1 from public.records where level_id = fixture);
  assert (select points is not distinct from score_before from public.rankings where user_id = actor and type = 'classic'), 'EXTRA changed TIMED ranking';
  assert exists (select 1 from public.extra_rankings where user_id = actor and type = 'extra' and points > 0);

  blocked := false;
  begin
    insert into public.extra_records(level_id, user_id, player, percent)
    select fixture, actor, username, 80 from public.profiles where id = actor;
  exception when unique_violation then blocked := true;
  end;
  assert blocked, 'duplicate record accepted';
  insert into public.extra_records(level_id, user_id, player, percent)
  select fixture, actor, username, 100 from public.profiles where id = actor;
  assert (select count(*) = 1 and min(percent) = 100 from public.extra_records where level_id = fixture);

  blocked := false;
  begin
    perform public.extra_delete_map(fixture);
  exception when raise_exception then blocked := true;
  end;
  assert blocked, 'deletion discarded records without consent';
  assert public.extra_delete_map(fixture, true) = 1;
  assert exists (select 1 from public.maps where level_id = fixture), 'EXTRA deletion removed TIMED';
  assert not exists (select 1 from public.extra_position_history where level_id = fixture);

  -- Existing profile sync/link triggers must also keep EXTRA credits attached.
  update public.extra_maps set creator = (select username from public.profiles where id = actor),
    verifier = (select username from public.profiles where id = actor) where level_id = other;
  update public.profiles set username = 'extra_check_account' where id = actor;
  assert exists (select 1 from public.extra_maps where level_id = other and creator_id = actor and creator = 'extra_check_account' and verifier_id = actor and verifier = 'extra_check_account');

  perform set_config('request.jwt.claims', '{"role":"authenticated","sub":"00000000-0000-0000-0000-000000000000"}', true);
  blocked := false;
  begin
    perform public.extra_move_map(other, 1);
  exception when raise_exception then blocked := true;
  end;
  assert blocked, 'non-admin RPC allowed';
  perform set_config('request.jwt.claims', json_build_object('sub', actor, 'role', 'authenticated')::text, true);
end $$;

-- Exercise actual table/sequence privileges and RLS as browser roles, not postgres.
set local role authenticated;
insert into public.extra_maps(level_id, type, name, length, position)
values ('__extra_rls__', 'extra', 'RLS fixture', '60s', 10000);
insert into public.extra_records(level_id, user_id, player, percent)
select '__extra_rls__', id, username, 100 from public.profiles where id = auth.uid();
do $$
declare blocked boolean := false;
begin
  assert exists (select 1 from public.extra_records where level_id = '__extra_rls__');
  begin
    insert into public.extra_submissions(kind, type, user_id, payload)
    values ('map', 'extra', auth.uid(), '{}');
  exception when insufficient_privilege then blocked := true;
  end;
  assert blocked, 'captcha bypass: authenticated submission insert allowed';
  perform set_config('request.jwt.claims', '{"role":"authenticated","sub":"00000000-0000-0000-0000-000000000000"}', true);
  blocked := false;
  begin
    insert into public.extra_maps(level_id, type, name, length, position)
    values ('__extra_denied__', 'extra', 'denied', '60s', 10001);
  exception when insufficient_privilege then blocked := true;
  end;
  assert blocked, 'non-admin map insert allowed';
  assert not exists (select 1 from public.extra_submissions), 'submission RLS leaked another account';
end $$;
set local role anon;
select count(*) from public.extra_rankings;
rollback;
