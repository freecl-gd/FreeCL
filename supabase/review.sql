-- Approving touches two tables and must not half-apply, so it happens in one statement
-- inside the database rather than as a sequence of calls from the admin page.
-- Rejecting is a single UPDATE, which the admin RLS policy already allows.
create or replace function approve_submission(submission_id bigint, at_position integer default null)
returns void language plpgsql security definer set search_path = '' as $$
declare
  entry public.submissions;
  target integer;
begin
  if not public.is_admin() then
    raise exception 'admin only';
  end if;

  select * into entry from public.submissions where id = submission_id and status = 'pending' for update;
  if not found then
    raise exception 'submission % is missing or already reviewed', submission_id;
  end if;

  if entry.kind = 'map' then
    select coalesce(max(position), 0) + 1 into target from public.maps where type = entry.type;
    target := least(greatest(coalesce(at_position, target), 1), target);
    -- Shifting rows down writes their history through the maps trigger, as intended.
    update public.maps set position = position + 1 where type = entry.type and position >= target;
    insert into public.maps (level_id, type, name, creator, verifier, description, video, length, object_count, position)
    values (
      entry.payload->>'levelId', entry.type, entry.payload->>'name',
      coalesce(entry.payload->>'creator', ''), coalesce(entry.payload->>'verifier', ''),
      coalesce(entry.payload->>'description', ''), coalesce(entry.payload->>'video', ''),
      coalesce(entry.payload->>'length', ''), coalesce(entry.payload->>'objectCount', ''), target
    );
  else
    insert into public.records (level_id, user_id, player, percent, time, platform)
    select entry.payload->>'levelId', entry.user_id, profile.username,
           (entry.payload->>'percent')::integer, (entry.payload->>'time')::numeric,
           coalesce(entry.payload->>'platform', '')
    from public.profiles profile where profile.id = entry.user_id;
  end if;

  update public.submissions
     set status = 'approved', reviewed_at = now(), reviewed_by = auth.jwt()->>'sub'
   where id = submission_id;
end $$;
