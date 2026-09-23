-- Deploy before the account-recovery Edge Function. Existing mobile contracts
-- are unchanged; these internal RPCs can only be called by the service role.
create or replace function public.reserve_recovery_challenge(p_challenge jsonb)
returns boolean language plpgsql security invoker set search_path = '' as $$
declare
  v_requester text := p_challenge->>'requester_hash';
  v_destination text := p_challenge->>'destination_hash';
  v_key text;
  v_count integer;
begin
  if coalesce(v_requester, '') = '' or coalesce(v_destination, '') = '' then
    raise exception 'Missing recovery rate-limit identity';
  end if;
  -- Both dimensions must serialize, including different requesters targeting
  -- the same destination. Deterministic ordering avoids crossed-key deadlocks.
  for v_key in select distinct k from unnest(array['recovery-requester:' || v_requester,
      'recovery-destination:' || v_destination]) as keys(k) order by k loop
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_key, 0));
  end loop;
  select count(*) into v_count from public.password_recovery_challenges
    where created_at >= clock_timestamp() - interval '15 minutes'
      and (requester_hash = v_requester or destination_hash = v_destination);
  if v_count >= 5 then return false; end if;
  insert into public.password_recovery_challenges
    (id, user_id, purpose, channel, destination_hash, code_hash, requester_hash, expires_at)
  values ((p_challenge->>'id')::uuid, (p_challenge->>'user_id')::uuid,
    p_challenge->>'purpose', p_challenge->>'channel', v_destination,
    p_challenge->>'code_hash', v_requester, clock_timestamp() + interval '10 minutes');
  return true;
end $$;

create or replace function public.claim_recovery_attempt(p_id uuid, p_purpose text,
  p_channel text, p_user_id uuid default null)
returns jsonb language sql security invoker set search_path = '' as $$
  -- PostgreSQL rechecks the predicate after waiting for a concurrent update.
  -- Only the first five requests receive a challenge to verify.
  update public.password_recovery_challenges set attempts = attempts + 1
  where id = p_id and purpose = p_purpose and channel = p_channel
    and (p_purpose = 'password_recovery' or user_id = p_user_id)
    and consumed_at is null and expires_at > clock_timestamp() and attempts < 5
  returning to_jsonb(password_recovery_challenges.*);
$$;

revoke all on function public.reserve_recovery_challenge(jsonb) from public, anon, authenticated;
revoke all on function public.claim_recovery_attempt(uuid,text,text,uuid) from public, anon, authenticated;
grant execute on function public.reserve_recovery_challenge(jsonb) to service_role;
grant execute on function public.claim_recovery_attempt(uuid,text,text,uuid) to service_role;
