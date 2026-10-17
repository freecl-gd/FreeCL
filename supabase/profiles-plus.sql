-- Run once in the Supabase SQL editor, after no-temp.sql.
-- Profiles gain a picture and a bio, nicknames become editable (and stay unique), and a
-- map's creator/verifier is linked to a real account whenever the name matches one.

-- Folded in from usernames.sql, which was never run: the shape rule belongs in the
-- database, not only in the form.
update profiles set username = lower(username) where username <> lower(username);
alter table profiles drop constraint if exists profiles_username_shape;
alter table profiles add constraint profiles_username_shape check (username ~ '^[a-z0-9_]{2,20}$');

alter table profiles add column if not exists bio        text not null default '';
alter table profiles add column if not exists avatar_url text not null default '';
alter table profiles drop constraint if exists profiles_bio_length;
alter table profiles add constraint profiles_bio_length check (char_length(bio) <= 120);

-- A credit with an id belongs to a registered account; one without is imported text.
alter table maps add column if not exists creator_id  uuid references profiles on delete set null;
alter table maps add column if not exists verifier_id uuid references profiles on delete set null;

update maps set creator_id = profiles.id from profiles
 where maps.creator_id is null and lower(maps.creator) = lower(profiles.username);
update maps set verifier_id = profiles.id from profiles
 where maps.verifier_id is null and lower(maps.verifier) = lower(profiles.username);

-- Nicknames are editable now, so every copy of a nickname has to follow the rename.
create or replace function sync_username() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  update public.records set player = new.username where user_id = new.id;
  update public.maps set creator = new.username where creator_id = new.id;
  update public.maps set verifier = new.username where verifier_id = new.id;
  return new;
end $$;
drop trigger if exists profiles_rename on profiles;
create trigger profiles_rename after update of username on profiles
  for each row when (new.username is distinct from old.username) execute function sync_username();

-- One trigger owns the link, so create_map, the admin edit form and a later rename all
-- agree without any of them sending an id.
create or replace function link_credits() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  new.creator_id  := (select id from public.profiles where lower(username) = lower(new.creator));
  new.verifier_id := (select id from public.profiles where lower(username) = lower(new.verifier));
  return new;
end $$;
drop trigger if exists maps_credits on maps;
create trigger maps_credits before insert or update of creator, verifier on maps
  for each row execute function link_credits();

-- Avatars. A public bucket, but only the owner may write, and only inside their own folder.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', true, 2097152, array['image/png', 'image/jpeg', 'image/webp', 'image/gif'])
on conflict (id) do update set public = true, file_size_limit = 2097152,
  allowed_mime_types = array['image/png', 'image/jpeg', 'image/webp', 'image/gif'];

drop policy if exists avatars_read   on storage.objects;
drop policy if exists avatars_insert on storage.objects;
drop policy if exists avatars_update on storage.objects;
drop policy if exists avatars_delete on storage.objects;
create policy avatars_read on storage.objects for select using (bucket_id = 'avatars');
-- The folder is the immutable Supabase account id, so nickname changes do not move files.
create policy avatars_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
create policy avatars_update on storage.objects for update to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
create policy avatars_delete on storage.objects for delete to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
