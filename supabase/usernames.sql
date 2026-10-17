-- Nicknames are lowercase only. The database is the guard; the form just avoids the
-- round trip.
update profiles set username = lower(username) where username <> lower(username);

alter table profiles drop constraint if exists profiles_username_shape;
alter table profiles add constraint profiles_username_shape
  check (username ~ '^[a-z0-9_]{2,20}$');

create or replace function on_signup() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, username)
  values (new.id, lower(coalesce(nullif(btrim(new.raw_user_meta_data->>'username'), ''), 'user_' || left(new.id::text, 8))));
  return new;
end $$;
