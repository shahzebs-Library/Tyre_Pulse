-- Mobile-observed delivery signals, not a claim of FCM background OS delivery.
create table if not exists public.team_push_device_events(
 id bigint generated always as identity primary key,
 user_id uuid not null references auth.users(id) on delete cascade,
 fcm_message_id text not null,
 event_type text not null check(event_type in ('received_foreground','opened_by_user')),
 entity_type text,
 entity_id uuid,
 occurred_at timestamptz not null default now(),
 unique(user_id,fcm_message_id,event_type)
);
alter table public.team_push_device_events enable row level security;
grant select,insert on public.team_push_device_events to authenticated;
drop policy if exists "own push events read" on public.team_push_device_events;
create policy "own push events read" on public.team_push_device_events for select to authenticated using(user_id=auth.uid());
drop policy if exists "own push events insert" on public.team_push_device_events;
create policy "own push events insert" on public.team_push_device_events for insert to authenticated with check(user_id=auth.uid() and length(fcm_message_id) between 1 and 400);
