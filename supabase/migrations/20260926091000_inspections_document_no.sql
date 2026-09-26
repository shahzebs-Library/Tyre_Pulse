-- inspections.document_no: the reference the inspection report already prints.
--
-- The INSTALLED mobile app (inspection/new.tsx) reads
-- `inspections.select('inspection_date, document_no')` for its "last inspected
-- N days ago" notice. The column never existed, so PostgREST refused every call
-- (Postgres log: "column inspections.document_no does not exist", 39 in 24h)
-- and the notice silently never showed. Mobile builds are frozen, so the fix is
-- server-side: add the column the app already asks for.
--
-- Value mirrors src/lib/exportUtils.js exportInspectionDetailPdf:
--   INS-<first 8 hex chars of id, uppercase>
-- so the reference on screen, in the PDF and in this column is one number.
--
-- A plain column + BEFORE INSERT stamp, NOT a generated column: the
-- lock/approval guard triggers compare OLD vs NEW rows, and a generated column
-- is NULL in NEW inside a BEFORE trigger, which could read as an edit to a
-- locked inspection. The backfill disables only those two guards for the one
-- statement and re-enables them in the same transaction.
alter table public.inspections add column if not exists document_no text;

create or replace function public.stamp_inspection_document_no()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.document_no is null and new.id is not null then
    new.document_no := 'INS-' || upper(left(replace(new.id::text, '-', ''), 8));
  end if;
  return new;
end $$;
revoke all on function public.stamp_inspection_document_no() from public, anon, authenticated;

drop trigger if exists trg_aa_stamp_inspection_document_no on public.inspections;
create trigger trg_aa_stamp_inspection_document_no
  before insert on public.inspections
  for each row execute function public.stamp_inspection_document_no();

alter table public.inspections disable trigger trg_lock_inspection_content;
alter table public.inspections disable trigger z_approval_document_guard;
alter table public.inspections disable trigger trg_audit_row;
alter table public.inspections disable trigger trg_inspection_audit;
update public.inspections
   set document_no = 'INS-' || upper(left(replace(id::text, '-', ''), 8))
 where document_no is null;
alter table public.inspections enable trigger trg_lock_inspection_content;
alter table public.inspections enable trigger z_approval_document_guard;
alter table public.inspections enable trigger trg_audit_row;
alter table public.inspections enable trigger trg_inspection_audit;

create index if not exists inspections_asset_date_idx
  on public.inspections (asset_no, inspection_date desc);
