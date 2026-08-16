-- V550  SCOPE THE WRITE, NOT JUST THE ARGUMENT
-- STATUS: APPLIED + VERIFIED LIVE on jhssdmeruxtrlqnwfksc (org Company A).
--
-- V547 guarded the NAMED-country path on these two writers. That was not enough,
-- and the gap is the default case rather than an edge case.
--
-- `p_country` DEFAULTS TO NULL on both, null legitimately means "no country
-- filter", and the writes themselves are keyed on serial plus organisation with
-- no country predicate at all. So omitting the argument - which is what a caller
-- does normally - walked straight past the guard.
--
-- MEASURED, as the real approved KSA-only Manager 34793423 with NO country
-- argument: scrap_tyre_by_serial SCRAPPED 2 real UAE tyre_records and
-- tyre_learn_confirm REBRANDED 1. Scrapping takes equipment out of service, so
-- of everything found today this is the one with physical consequences.
--
-- THE FIX SCOPES THE WRITE. Every affected row must be one the caller may see:
--   and (country is null or public.app_can_see_country(country))
-- `country is null` still passes, matching the convention every RLS policy here
-- uses - a null-country row is visible to everyone.
--
-- scrap_tyre_by_serial gets it in TWO places: the update, and the read that
-- captures prior status, so a row the caller cannot touch is never recorded as
-- having been scrapped either.
--
-- tyre_learn_confirm gets it in BOTH of its occurrences - the count and the CTE
-- that drives the update - because scoping only the update would leave the
-- function promising a match count it then refuses to deliver.
--
-- VERIFIED AFTER, all in rolled-back transactions:
--   * KSA-only Manager, no country argument, against a real UAE serial:
--     0 UAE rows scrapped (was 2). The target had to be selected as a
--     PRIVILEGED reader, because that user cannot see the row to name it -
--     which is precisely why the hole was invisible from inside their session.
--   * CONTROL, same user, their OWN country: 1 row scrapped. The feature works.
--   * tyre_learn_confirm with no country argument now matches 0 rows.
--
-- ROLLBACK: re-create from _bak.rpc_defs_v550.
--
-- STILL OPEN, and named rather than implied: set_store_site_map performs the
-- same class of cross-country write (it re-attributes UAE expense by mapping a
-- store to a site) but returns void, so it cannot carry a jsonb refusal. It
-- needs a RAISE-based guard, which changes its caller contract, and that is a
-- deliberate change rather than a mechanical one.

create schema if not exists _bak;
drop table if exists _bak.rpc_defs_v550;
create table _bak.rpc_defs_v550 (proname text, def text, saved_at timestamptz default now());

do $mig$
declare
  def text;
  newdef text;
  scope constant text := ' and (country is null or public.app_can_see_country(country))';
  n int;
begin
  ---------------------------------------------------------------- scrap
  select pg_get_functiondef(p.oid) into def
  from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
  where ns.nspname = 'public' and p.proname = 'scrap_tyre_by_serial';
  insert into _bak.rpc_defs_v550 values ('scrap_tyre_by_serial', def);

  n := (length(def) - length(replace(def, E'     and coalesce(t.status, \'\') <> \'Scrapped\'', ''))) /
       length(E'     and coalesce(t.status, \'\') <> \'Scrapped\'');
  if n <> 1 then raise exception 'V550: scrap prior-status anchor matched % times', n; end if;
  newdef := replace(def, E'     and coalesce(t.status, \'\') <> \'Scrapped\'',
                         E'     and coalesce(t.status, \'\') <> \'Scrapped\'\n     and (t.country is null or public.app_can_see_country(t.country))');

  n := (length(newdef) - length(replace(newdef, E'   where serial_no = v_s\n     and organisation_id = v_org;', ''))) /
       length(E'   where serial_no = v_s\n     and organisation_id = v_org;');
  if n <> 1 then raise exception 'V550: scrap update anchor matched % times', n; end if;
  newdef := replace(newdef, E'   where serial_no = v_s\n     and organisation_id = v_org;',
                            E'   where serial_no = v_s\n     and organisation_id = v_org' || scope || ';');
  execute newdef;

  ---------------------------------------------------- tyre_learn_confirm
  select pg_get_functiondef(p.oid) into def
  from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
  where ns.nspname = 'public' and p.proname = 'tyre_learn_confirm';
  insert into _bak.rpc_defs_v550 values ('tyre_learn_confirm', def);

  n := (length(def) - length(replace(def, '(%L::text is null or country=%L)', ''))) /
       length('(%L::text is null or country=%L)');
  if n <> 2 then raise exception 'V550: learn_confirm anchor matched % times, expected 2', n; end if;
  newdef := replace(def, '(%L::text is null or country=%L)',
                         '(%L::text is null or country=%L)' || scope);
  execute newdef;
end
$mig$;

do $chk$
declare bad text;
begin
  select string_agg(p.proname, ', ') into bad
  from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
  where ns.nspname = 'public'
    and p.proname in ('scrap_tyre_by_serial','tyre_learn_confirm')
    and pg_get_functiondef(p.oid) not like '%app_can_see_country(country)%'
    and pg_get_functiondef(p.oid) not like '%app_can_see_country(t.country)%';
  if bad is not null then raise exception 'V550: scope predicate missing on %', bad; end if;
end
$chk$;
