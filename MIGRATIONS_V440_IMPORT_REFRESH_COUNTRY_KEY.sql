-- V440 - Ensure Data Intake refresh uses the batch country in its live lookup.
-- V439 includes this on fresh installs; this migration repairs databases where
-- the first V439 deployment completed before the country-key fix was added.

do $migration$
declare v_def text;
begin
  select pg_get_functiondef(p.oid) into v_def
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname='import_enrich_batch';

  if v_def is null then raise exception 'V440: import_enrich_batch not found'; end if;
  if position('jsonb_build_object(''country'', b.country)' in v_def) > 0 then return; end if;
  if position(E'    v_data := COALESCE(NULLIF(r.transformed_data,''{}''::jsonb), r.mapped_data);\n    v_key := public.import_natural_key' in v_def) = 0 then
    raise exception 'V440: country-key anchor not found';
  end if;

  v_def := replace(
    v_def,
    E'    v_data := COALESCE(NULLIF(r.transformed_data,''{}''::jsonb), r.mapped_data);\n    v_key := public.import_natural_key',
    E'    v_data := COALESCE(NULLIF(r.transformed_data,''{}''::jsonb), r.mapped_data)\n              || jsonb_build_object(''country'', b.country);\n    v_key := public.import_natural_key'
  );
  execute v_def;
end
$migration$;
