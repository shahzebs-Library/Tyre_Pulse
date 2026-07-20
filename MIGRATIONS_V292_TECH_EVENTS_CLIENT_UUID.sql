-- V292: idempotency for the append-only technician activity log.
-- The mobile technician screen records events through the offline queue; a lost
-- response / crash could otherwise double-insert an event (which would inflate
-- completed-task counts and distort segment timing). A client_uuid column + a
-- single-column partial unique index lets the queue upsert on client_uuid
-- (onConflict:'client_uuid', ignoreDuplicates) so every event is at-most-once.
-- Applied live via Supabase MCP. Next free migration V293.

alter table public.tech_activity_events
  add column if not exists client_uuid text;

create unique index if not exists tech_activity_events_client_uuid_uidx
  on public.tech_activity_events (client_uuid)
  where client_uuid is not null;
