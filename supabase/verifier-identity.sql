-- Run once after profiles-plus.sql. Restore xisik's pre-rename verifier credits.
update public.maps m
   set verifier = p.username, verifier_id = p.id
  from public.profiles p
 where p.username = 'xisik'
   and lower(m.verifier) = 'hyobeen06'
   and m.verifier_id is null;

-- Keep unlinked legacy credits attached when their owner first creates an account,
-- and attach old-name rows during a rename before that name can be reused.
create or replace function sync_username() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  update public.records set player = new.username where user_id = new.id;
  update public.maps set creator = new.username
   where creator_id = new.id
      or (creator_id is null and lower(creator) = lower(old.username));
  update public.maps set verifier = new.username
   where verifier_id = new.id
      or (verifier_id is null and lower(verifier) = lower(old.username));
  return new;
end $$;
drop trigger if exists profiles_rename on public.profiles;
create trigger profiles_rename after update of username on public.profiles
  for each row when (new.username is distinct from old.username) execute function sync_username();

create or replace function link_profile_credits() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  update public.maps set creator_id = new.id
   where creator_id is null and lower(creator) = lower(new.username);
  update public.maps set verifier_id = new.id
   where verifier_id is null and lower(verifier) = lower(new.username);
  return new;
end $$;
drop trigger if exists profiles_link_credits on public.profiles;
create trigger profiles_link_credits after insert on public.profiles
  for each row execute function link_profile_credits();
