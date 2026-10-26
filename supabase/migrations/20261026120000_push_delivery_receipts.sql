-- Push delivery receipts: one row per device attempt made by the workflow-notify
-- edge function (Expo + FCM). Written by the service role only; super admins read.
-- status: accepted = provider took the message; failed = provider refused or the
-- call errored; invalid_token = provider said the device token is dead (revoked).
-- NOTE: "accepted" is the provider's acknowledgement, not proof the handset showed it.

create table if not exists public.push_delivery_receipts (
  id              uuid primary key default gen_random_uuid(),
  organisation_id uuid,
  user_id         uuid,
  channel         text not null check (channel in ('expo', 'fcm')),
  token_hint      text not null,
  event_type      text,
  entity_id       text,
  status          text not null check (status in ('accepted', 'failed', 'invalid_token')),
  provider_ref    text,
  error           text,
  created_at      timestamptz not null default now()
);

create index if not exists push_receipts_created_idx on public.push_delivery_receipts (created_at desc);
create index if not exists push_receipts_user_idx on public.push_delivery_receipts (user_id, created_at desc);
create index if not exists push_receipts_status_idx on public.push_delivery_receipts (status, created_at desc);

alter table public.push_delivery_receipts enable row level security;

drop policy if exists push_receipts_super_admin_read on public.push_delivery_receipts;
create policy push_receipts_super_admin_read on public.push_delivery_receipts
  for select to authenticated using ((select public.is_super_admin()));

revoke all on public.push_delivery_receipts from anon, authenticated;
grant select on public.push_delivery_receipts to authenticated;

create or replace function public.get_push_delivery_summary(p_days integer default 7)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_days integer := greatest(1, least(coalesce(p_days, 7), 90));
begin
  if not public.is_super_admin() then
    raise exception 'Not authorised' using errcode = '42501';
  end if;
  return (
    select jsonb_build_object(
      'days', v_days,
      'total', count(*),
      'accepted', count(*) filter (where status = 'accepted'),
      'failed', count(*) filter (where status = 'failed'),
      'invalid_token', count(*) filter (where status = 'invalid_token'),
      'by_channel', coalesce((
        select jsonb_object_agg(channel, n) from (
          select channel, count(*) n from public.push_delivery_receipts
          where created_at >= now() - make_interval(days => v_days) group by channel) c), '{}'::jsonb),
      'top_errors', coalesce((
        select jsonb_agg(jsonb_build_object('error', error, 'count', n)) from (
          select error, count(*) n from public.push_delivery_receipts
          where created_at >= now() - make_interval(days => v_days) and status <> 'accepted' and error is not null
          group by error order by n desc limit 5) e), '[]'::jsonb)
    )
    from public.push_delivery_receipts
    where created_at >= now() - make_interval(days => v_days)
  );
end;
$$;

revoke all on function public.get_push_delivery_summary(integer) from public;
revoke all on function public.get_push_delivery_summary(integer) from anon;
grant execute on function public.get_push_delivery_summary(integer) to authenticated;
