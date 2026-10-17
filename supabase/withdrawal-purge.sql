-- Withdrawal erases the person's clears and leaves their map credits blank ('' renders as
-- "-"). Records, credits and the account go in one transaction, so a failure keeps all of
-- them. Matches by account id and by nickname: legacy clears and pre-account credits carry
-- only the name, and rankings would otherwise keep crediting them by it.
begin;
create or replace function public.purge_account(p_user_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_name text := (select lower(username) from public.profiles where id = p_user_id);
  v_records int; v_extra int; v_legacy int; v_extra_legacy int;
begin
  if v_name is null then raise exception 'no profile for %', p_user_id; end if;
  delete from public.records where user_id = p_user_id or lower(player) = v_name;
  get diagnostics v_records = row_count;
  delete from public.extra_records where user_id = p_user_id or lower(player) = v_name;
  get diagnostics v_extra = row_count;
  delete from public.legacy_records where lower(player) = v_name;
  get diagnostics v_legacy = row_count;
  delete from public.extra_legacy_records where lower(player) = v_name;
  get diagnostics v_extra_legacy = row_count;
  -- The credits trigger re-resolves the ids from the names; '' matches no one.
  update public.maps set creator = '' where creator_id = p_user_id or lower(creator) = v_name;
  update public.maps set verifier = '' where verifier_id = p_user_id or lower(verifier) = v_name;
  update public.extra_maps set creator = '' where creator_id = p_user_id or lower(creator) = v_name;
  update public.extra_maps set verifier = '' where verifier_id = p_user_id or lower(verifier) = v_name;
  -- Cascades to profiles, submissions and admins.
  delete from auth.users where id = p_user_id;
  return jsonb_build_object('records', v_records + v_extra, 'legacy', v_legacy + v_extra_legacy);
end $$;
revoke all on function public.purge_account(uuid) from public, anon, authenticated;
grant execute on function public.purge_account(uuid) to service_role;
commit;
