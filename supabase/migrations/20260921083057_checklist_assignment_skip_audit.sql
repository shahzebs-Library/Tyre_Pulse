-- A skipped obligation is an auditable exception, not a silent status change.
alter table public.checklist_assignments
  add column skip_reason text,
  add column skipped_by uuid,
  add column skipped_at timestamptz;

create index checklist_assignments_skipped_by_idx
  on public.checklist_assignments (skipped_by)
  where skipped_by is not null;

create or replace function public.guard_checklist_assignment_skip()
returns trigger
language plpgsql
set search_path = ''
as $fn$
begin
  if new.status = 'skipped' and old.status is distinct from 'skipped' then
    if nullif(btrim(new.skip_reason), '') is null then
      raise exception 'A reason is required to skip a checklist assignment'
        using errcode = '22023';
    end if;
    new.skip_reason := btrim(new.skip_reason);
    new.skipped_by := auth.uid();
    new.skipped_at := now();
  elsif old.status = 'skipped' and (
    new.skip_reason is distinct from old.skip_reason
    or new.skipped_by is distinct from old.skipped_by
    or new.skipped_at is distinct from old.skipped_at
  ) then
    raise exception 'Checklist skip evidence is immutable'
      using errcode = '22023';
  end if;
  return new;
end;
$fn$;

drop trigger if exists trg_guard_checklist_assignment_skip
  on public.checklist_assignments;
create trigger trg_guard_checklist_assignment_skip
  before update on public.checklist_assignments
  for each row execute function public.guard_checklist_assignment_skip();

revoke all on function public.guard_checklist_assignment_skip()
  from public, anon, authenticated;
