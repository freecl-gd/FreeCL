-- Withdrawal is not a ban. A withdrawn email waits 30 days (banned_until on its row), then
-- may sign up again. The nickname stays reserved for that email only: records still carry
-- the old name and rankings credit unlinked records by name, so no one else may take it,
-- but the same person coming back may.
begin;
update public.blocked_emails set banned_until = created_at + interval '30 days'
 where reason = 'withdrawn' and banned_until is null;

create or replace function public.signup_blocked(p_email text, p_username text) returns text
language sql stable security definer set search_path = '' as $$
  select case
    when exists (select 1 from public.blocked_emails where email_hash = public.identity_hash(p_email)
                   and reason = 'ban' and (banned_until is null or banned_until > now())) then 'email'
    when exists (select 1 from public.blocked_emails where email_hash = public.identity_hash(p_email)
                   and reason = 'withdrawn' and banned_until > now()) then 'withdrawn'
    when exists (select 1 from public.blocked_emails where username_hash = public.identity_hash(p_username)
                   and email_hash <> public.identity_hash(p_email)) then 'username'
  end;
$$;

create or replace function public.block_withdrawn_username() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from public.blocked_emails
              where username_hash = public.identity_hash(new.username)
                and email_hash <> coalesce((select public.identity_hash(email) from auth.users where id = new.id), '')) then
    raise exception 'withdrawn username' using errcode = '42501';
  end if;
  return new;
end $$;
commit;
