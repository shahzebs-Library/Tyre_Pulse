-- domain_events is an outbox, not a fully immutable audit ledger. Its event
-- identity and payload remain immutable, while the trusted dispatcher must be
-- able to advance delivery state. The generic audit trigger prevented every
-- process_domain_events() UPDATE and caused the minute cron job to fail.

create or replace function public.guard_domain_event_mutation()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Domain events cannot be deleted.' using errcode = '42501';
  end if;

  if new.id is distinct from old.id
     or new.event_type is distinct from old.event_type
     or new.entity_type is distinct from old.entity_type
     or new.entity_id is distinct from old.entity_id
     or new.organisation_id is distinct from old.organisation_id
     or new.actor_id is distinct from old.actor_id
     or new.payload is distinct from old.payload
     or new.created_at is distinct from old.created_at then
    raise exception 'Domain event identity and payload are immutable.' using errcode = '42501';
  end if;

  return new;
end;
$$;

revoke all on function public.guard_domain_event_mutation() from public, anon, authenticated;

drop trigger if exists prevent_audit_mutation_trigger on public.domain_events;
drop trigger if exists guard_domain_event_mutation_trigger on public.domain_events;

create trigger guard_domain_event_mutation_trigger
before update or delete on public.domain_events
for each row execute function public.guard_domain_event_mutation();
