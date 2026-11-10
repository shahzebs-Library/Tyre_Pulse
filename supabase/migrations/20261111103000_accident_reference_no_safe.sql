-- 20261111103000_accident_reference_no_safe
-- accident_derive_fields numbered a new case ACC-YYYY-#### as count(*)+1 of that org's
-- cases in the year. Two faults: (1) deleting any case makes the next one reuse the last
-- number; (2) two reports saved at the same moment both read the same count. Nothing
-- stopped the duplicate (no unique index). Now: the next number is max(existing suffix)+1,
-- taken under a per-org-per-year transaction advisory lock, and a unique index enforces it.
-- Verified before applying: 0 duplicate (organisation_id, reference_no) pairs (the two
-- ACC-2026-0001/0002 pairs are different organisations: Company A and the demo org).
-- Anchored replace on the LIVE body; aborts unless the anchor occurs exactly once.
-- Rollback: drop index accidents_org_reference_no_uidx; re-apply the count(*)+1 body.
do $$
declare
  def text := pg_get_functiondef('public.accident_derive_fields()'::regprocedure);
  a text := $a$      SELECT count(*) + 1 INTO v_seq
        FROM public.accidents
        WHERE organisation_id IS NOT DISTINCT FROM NEW.organisation_id
          AND to_char(COALESCE(incident_date, created_at::date), 'YYYY') = v_year;$a$;
  b text := $b$      PERFORM pg_advisory_xact_lock(hashtext('accident_ref|' || COALESCE(NEW.organisation_id::text, '') || '|' || v_year));
      SELECT COALESCE(max(substring(reference_no from '^ACC-' || v_year || '-(\d+)$')::int), 0) + 1 INTO v_seq
        FROM public.accidents
        WHERE organisation_id IS NOT DISTINCT FROM NEW.organisation_id
          AND reference_no LIKE 'ACC-' || v_year || '-%';$b$;
  n int;
begin
  n := (length(def) - length(replace(def, a, ''))) / length(a);
  if n <> 1 then raise exception 'anchor found % times', n; end if;
  execute replace(def, a, b);
end $$;

create unique index if not exists accidents_org_reference_no_uidx
  on public.accidents (organisation_id, reference_no) where reference_no is not null;
