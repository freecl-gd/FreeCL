-- Patch for schema.sql already applied. Run once in the Supabase SQL editor.
-- 1. RLS decides which rows a role sees; it does not grant the role access to the table
--    at all. Without these the API answers 42501 permission denied.
grant usage on schema public to anon, authenticated;
grant select on maps, records, profiles, position_history to anon, authenticated;
grant insert, update, delete on maps, records to authenticated;
grant select, insert, update, delete on submissions to authenticated;
grant update on profiles to authenticated;
grant select on admins to authenticated;

-- 2. log_position() ran as the admin updating maps, who has no way to write history.
--    As a definer it writes on its own authority; no client is ever granted insert here.
create or replace function log_position() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    insert into public.position_history (level_id, from_position, to_position) values (new.level_id, null, new.position);
  elsif new.position is distinct from old.position then
    insert into public.position_history (level_id, from_position, to_position) values (new.level_id, old.position, new.position);
  end if;
  return new;
end $$;

create policy trigger_insert on position_history for insert with check (true);
