-- Withdrawal deletes the account. Only SHA-256 digests of its email and nickname remain, so
-- that email cannot sign up again and the nickname cannot be taken over (records still carry
-- the old name, and rankings credit unlinked records by name).
begin;
create table if not exists public.withdrawn_accounts (
  email_hash    text primary key,
  username_hash text,
  withdrawn_at  timestamptz not null default now()
);
create index if not exists withdrawn_accounts_username on public.withdrawn_accounts (username_hash);
alter table public.withdrawn_accounts enable row level security;
revoke all on public.withdrawn_accounts from anon, authenticated;
grant select, insert, delete on public.withdrawn_accounts to service_role;

-- Must match identityHash() in supabase/functions/_shared/withdrawn.ts.
create or replace function public.identity_hash(value text) returns text
language sql immutable set search_path = '' as $$
  select encode(sha256(convert_to(lower(btrim(value)), 'UTF8')), 'hex');
$$;

-- Lets the signup form say why before GoTrue answers with a generic database error.
-- Answers for one address at a time, and only "email" / "username" / null.
create or replace function public.signup_blocked(p_email text, p_username text) returns text
language sql stable security definer set search_path = '' as $$
  select case
    when exists (select 1 from public.withdrawn_accounts where email_hash = public.identity_hash(p_email)) then 'email'
    when exists (select 1 from public.withdrawn_accounts where username_hash = public.identity_hash(p_username)) then 'username'
  end;
$$;
revoke all on function public.signup_blocked(text, text) from public;
grant execute on function public.signup_blocked(text, text) to anon, authenticated;

-- The enforcement, whichever client calls GoTrue: no account for a withdrawn email.
create or replace function public.block_withdrawn_email() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.email is not null and exists (select 1 from public.withdrawn_accounts where email_hash = public.identity_hash(new.email)) then
    raise exception 'withdrawn email' using errcode = '42501';
  end if;
  return new;
end $$;
drop trigger if exists block_withdrawn_email on auth.users;
create trigger block_withdrawn_email before insert or update of email on auth.users
  for each row execute function public.block_withdrawn_email();

-- And no profile under a withdrawn nickname, at signup (on_signup inserts) or on rename.
create or replace function public.block_withdrawn_username() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from public.withdrawn_accounts where username_hash = public.identity_hash(new.username)) then
    raise exception 'withdrawn username' using errcode = '42501';
  end if;
  return new;
end $$;
drop trigger if exists block_withdrawn_username on public.profiles;
create trigger block_withdrawn_username before insert or update of username on public.profiles
  for each row execute function public.block_withdrawn_username();
commit;
