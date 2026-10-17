-- A map submission cannot be approved without its explicit destination rank.
create or replace function public.approve_submission(submission_id bigint, at_position integer default null)
returns void language plpgsql security definer set search_path = '' as $$
declare
  entry public.submissions;
begin
  if not public.is_admin() then raise exception 'admin only'; end if;

  select * into entry from public.submissions where id = submission_id and status = 'pending' for update;
  if not found then raise exception 'submission % is missing or already reviewed', submission_id; end if;

  if entry.kind = 'map' then
    if at_position is null or at_position < 1 then raise exception '맵 승인에는 순위를 입력해야 합니다.'; end if;
    perform public.create_map(entry.payload, entry.type, at_position);
  else
    insert into public.records (level_id, user_id, player, percent, time, platform, video, submitted_at)
    select entry.payload->>'levelId', entry.user_id, profile.username,
           (entry.payload->>'percent')::integer, (entry.payload->>'time')::numeric,
           coalesce(entry.payload->>'platform', ''), coalesce(entry.payload->>'video', ''), entry.created_at
    from public.profiles profile where profile.id = entry.user_id;
  end if;

  update public.submissions
     set status = 'approved', reviewed_at = now(), reviewed_by = auth.jwt()->>'sub'
   where id = submission_id;
end $$;
