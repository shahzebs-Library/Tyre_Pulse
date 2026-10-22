-- Originator can see ONLY observed FCM events for broadcasts they sent.
drop policy if exists "broadcast sender sees app-observed events" on public.team_push_device_events;
create policy "broadcast sender sees app-observed events" on public.team_push_device_events
 for select to authenticated using (
  entity_type in ('broadcast','broadcast.sent')
  and exists(select 1 from public.broadcast_messages b
    where b.id = team_push_device_events.entity_id and b.sent_by = auth.uid())
 );
