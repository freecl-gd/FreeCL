-- Bans (= blocks) are per email. blocked_emails is the one list: a ban row keeps that email
-- from signing up again while it lasts, a withdrawn row forever. Existing accounts are still
-- held off by the Auth ban the admin function sets alongside the row.
-- Replaces withdrawal.sql's withdrawn_accounts (renamed, rows kept).
begin;
alter table public.withdrawn_accounts rename to blocked_emails;
alter index public.withdrawn_accounts_username rename to blocked_emails_username;
alter table public.blocked_emails rename column withdrawn_at to created_at;
alter table public.blocked_emails
  add column reason text not null default 'withdrawn' check (reason in ('ban', 'withdrawn')),
  add column banned_until timestamptz; -- null: no end
alter table public.blocked_emails alter column reason drop default;
grant select, insert, update, delete on public.blocked_emails to service_role;

create or replace function public.email_blocked(p_email text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.blocked_emails
                  where email_hash = public.identity_hash(p_email)
                    and (banned_until is null or banned_until > now()));
$$;
revoke all on function public.email_blocked(text) from public, anon, authenticated;

create or replace function public.signup_blocked(p_email text, p_username text) returns text
language sql stable security definer set search_path = '' as $$
  select case
    when public.email_blocked(p_email) then 'email'
    when exists (select 1 from public.blocked_emails where username_hash = public.identity_hash(p_username)) then 'username'
  end;
$$;

drop trigger if exists block_withdrawn_email on auth.users;
drop function if exists public.block_withdrawn_email();
create or replace function public.block_banned_email() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.email is not null and public.email_blocked(new.email) then
    raise exception 'blocked email' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger block_banned_email before insert or update of email on auth.users
  for each row execute function public.block_banned_email();

create or replace function public.block_withdrawn_username() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from public.blocked_emails where username_hash = public.identity_hash(new.username)) then
    raise exception 'withdrawn username' using errcode = '42501';
  end if;
  return new;
end $$;

-- Carry over the bans that already exist on accounts.
insert into public.blocked_emails (email_hash, reason, banned_until)
select public.identity_hash(email), 'ban',
       case when coalesce(raw_app_meta_data->>'banned_permanently', 'false') = 'true' then null else banned_until end
  from auth.users
 where email is not null
   and (coalesce(raw_app_meta_data->>'banned_permanently', 'false') = 'true' or banned_until > now())
on conflict (email_hash) do nothing;
commit;
