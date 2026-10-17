-- Run once in the Supabase SQL editor. Archives the sheet-era clears and starts `records`
-- empty, with a submission time on every new row.

create table legacy_records (
  id       bigint generated always as identity primary key,
  level_id text not null references maps on delete restrict,
  player   text not null,
  percent  integer,
  time     numeric,
  platform text not null default '',
  first    boolean not null default false,
  note     text
);
create index legacy_by_map on legacy_records (level_id);

insert into legacy_records (level_id, player, percent, time, platform, first, note)
select level_id, player, percent, time, platform, first, note from records;
delete from records;

-- Clears are listed in the order they were achieved, and the submission is the evidence
-- of when that was. Legacy rows have no submission, which is exactly why they are legacy.
alter table records add column submitted_at timestamptz not null default now();
create index records_by_time on records (level_id, submitted_at);

alter table legacy_records enable row level security;
create policy public_read on legacy_records for select using (true);
create policy admin_write on legacy_records for all using (is_admin()) with check (is_admin());
grant select on legacy_records to anon, authenticated;
grant insert, update, delete on legacy_records to authenticated;

-- An approved clear is dated by when the player submitted it, not by when an admin
-- got around to reviewing it.
create or replace function approve_submission(submission_id bigint, at_position integer default null)
returns void language plpgsql security definer set search_path = '' as $$
declare
  entry public.submissions;
begin
  if not public.is_admin() then raise exception 'admin only'; end if;

  select * into entry from public.submissions where id = submission_id and status = 'pending' for update;
  if not found then raise exception 'submission % is missing or already reviewed', submission_id; end if;

  if entry.kind = 'map' then
    perform public.create_map(entry.payload, entry.type, at_position);
  else
    insert into public.records (level_id, user_id, player, percent, time, platform, submitted_at)
    select entry.payload->>'levelId', entry.user_id, profile.username,
           (entry.payload->>'percent')::integer, (entry.payload->>'time')::numeric,
           coalesce(entry.payload->>'platform', ''), entry.created_at
    from public.profiles profile where profile.id = entry.user_id;
  end if;

  update public.submissions
     set status = 'approved', reviewed_at = now(), reviewed_by = auth.jwt()->>'sub'
   where id = submission_id;
end $$;

-- delete_map now has a second table pointing at maps, and legacy rows count as records
-- that would be destroyed.
create or replace function delete_map(p_level_id text, p_discard_records boolean default false)
returns integer language plpgsql security definer set search_path = '' as $$
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
end $$;
