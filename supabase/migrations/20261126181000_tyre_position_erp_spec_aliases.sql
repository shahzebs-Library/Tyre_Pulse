-- 20261126181000_tyre_position_erp_spec_aliases.sql
-- STATUS: APPLIED LIVE 2026-11-26 on owner approval; recorded in supabase_migrations.schema_migrations.
--
-- PURPOSE
--   Owner decision (2026-11-26): ERP tyre-change matching must accept the concrete pump's
--   wheel codes from the ONE shared tyre map (docs/document-specs/tyre-layouts.json):
--   LHF1 LHF2 LHR1-I LHRCO/LHRCI LHRRO/LHRRI (and the right side), plus the legacy
--   aliases the map records for the same wheels (LHR1-O, LHR1, LHF3, LHCO, LHRO, LHR2-O ...).
--   Until now tyre_position_resolve() refused EVERY rear ERP code on a pump layout
--   (reason erp_spelling_not_verified), so no pump job card could ever be compared.
--
--   * public.tyre_layout_spec_erp_tokens(p_key): the map's code (rank 1) and each recorded
--     alias (rank 2) per wheel, GENERATED from the JSON by scripts/gen-tyre-erp-spec-tokens.mjs
--     (same derivation as erpSpecTokens() in src/lib/tyreLayoutSpec.js; the two are pinned by
--     src/test/tyreErpSpecTokens.test.js). Never hand-edit the generated block.
--   * public.tyre_position_spec_token(p): upper case, spaces / hyphens / underscores removed
--     (the web's spelling rule), so LHR1-O and LHR1O compare.
--   * tyre_position_resolve(): reading a position CODE on a BUILT-IN layout, after a verified
--     per-layout mapping (still wins) and BEFORE the old pump refusal: a spelling the map names
--     for exactly one wheel of the layout resolves to that wheel (reason tyre_map_code); a
--     spelling naming two wheels stays pending (tyre_map_code_ambiguous). The best rank wins
--     (a map code outranks an alias). Everything else is unchanged. Patched in place from the
--     LIVE body by anchored replacement; aborts unless each anchor occurs exactly once.
--   * rules version position-service-3 -> position-service-4 in observation_erp_rules() and
--     observation_erp_evaluate() (the web offers a decision only when its own version,
--     ERP_RULES_VERSION in src/lib/tyrePositionService.js, is the same).
--
--   WEB COMPATIBILITY: the web may ship before this migration. It accepts BOTH versions
--   (ERP_RULES_VERSIONS_SUPPORTED): against a database still on position-service-3 it reads the
--   evidence by the old rules (pump rear codes pending, exactly as before); on position-service-4
--   it reads the shared map like this migration. The client follows the version the database
--   reports, so the two never decide differently.
--
--   STAGING TEST: supabase/tests/staging/observation_erp_position_tests.py already expects
--   position-service-4, so it fails against staging until this migration is applied there.
--
--   COMPARISON ONLY. Nothing here writes a business row: no stored position, tyre record,
--   job card or observation is renamed or "corrected". A pending case stays pending for a
--   person to decide.
--
--   NOTE FOR THE OWNER: the map places LHR1-O / LHR1 on the pump's axle-3 single wheel (F3L),
--   not on the first dual axle as the old built-in numbering did. That is the map's rule
--   ("the codes concrete pump records carry in live data").
--
-- VERIFY (after apply)
--   select public.tyre_position_resolve(public.tyre_layout_for('PUMPS','MP001',null,null,null,null),'LHRCO','erp')->>'slot'; -- R1Lo
--   select public.tyre_position_resolve(public.tyre_layout_for('PUMPS','MP001',null,null,null,null),'LHR2-O','erp')->>'slot'; -- R2Lo
--   select public.tyre_position_resolve(public.tyre_layout_for('PUMPS','MP001',null,null,null,null),'LHR1-I','erp')->>'slot'; -- F3L
--   select public.tyre_position_resolve(public.tyre_layout_for('TR-MIXER','TM001',null,null,null,null),'LHRCO','erp')->>'status'; -- ambiguous (unchanged)
--   select public.observation_erp_rules()->>'rules_version';                                                              -- position-service-4
--
-- ROLLBACK
--   begin;
--   do $u$ begin execute (select def from _bak.tyre_position_resolve_v181000 order by id desc limit 1); end $u$;
--   do $u$ begin execute (select def from _bak.observation_erp_rules_v181000 order by id desc limit 1); end $u$;   -- when present
--   do $u$ begin execute (select def from _bak.observation_erp_evaluate_v181000 order by id desc limit 1); end $u$; -- when present
--   drop function if exists public.tyre_layout_spec_erp_tokens(text), public.tyre_position_spec_token(text);
--   commit;
--   (and ERP_RULES_VERSION back to 'position-service-3' in src/lib/tyrePositionService.js)

begin;

create schema if not exists _bak;
create table if not exists _bak.tyre_position_resolve_v181000 (id bigserial primary key, saved_at timestamptz default now(), def text not null);
insert into _bak.tyre_position_resolve_v181000(def)
  select pg_get_functiondef('public.tyre_position_resolve(jsonb,text,text)'::regprocedure);

create or replace function public.tyre_position_spec_token(p text)
returns text language sql immutable parallel safe set search_path = '' as $$
  select upper(regexp_replace(coalesce(p, ''), '[\s_-]+', '', 'g'))
$$;

create or replace function public.tyre_layout_spec_erp_tokens(p_key text)
returns table(slot text, token text, rank integer)
language sql immutable parallel safe set search_path = '' as $$
  select w.slot, w.token, w.rank from (values
-- BEGIN GENERATED SPEC ERP TOKENS
    ('Concrete pump', 'F1L', 'LHF1', 1),
    ('Concrete pump', 'F1R', 'RHF1', 1),
    ('Concrete pump', 'F2L', 'LHF2', 1),
    ('Concrete pump', 'F2R', 'RHF2', 1),
    ('Concrete pump', 'F3L', 'LHR1I', 1),
    ('Concrete pump', 'F3L', 'LHR1O', 2),
    ('Concrete pump', 'F3L', 'LHR1', 2),
    ('Concrete pump', 'F3L', 'LHF3', 2),
    ('Concrete pump', 'F3R', 'RHR1I', 1),
    ('Concrete pump', 'F3R', 'RHR1O', 2),
    ('Concrete pump', 'F3R', 'RHR1', 2),
    ('Concrete pump', 'F3R', 'RHF3', 2),
    ('Concrete pump', 'R1Lo', 'LHRCO', 1),
    ('Concrete pump', 'R1Lo', 'LHCO', 2),
    ('Concrete pump', 'R1Li', 'LHRCI', 1),
    ('Concrete pump', 'R1Li', 'LHCI', 2),
    ('Concrete pump', 'R1Ri', 'RHRCI', 1),
    ('Concrete pump', 'R1Ri', 'RHCI', 2),
    ('Concrete pump', 'R1Ro', 'RHRCO', 1),
    ('Concrete pump', 'R1Ro', 'RHCO', 2),
    ('Concrete pump', 'R2Lo', 'LHRRO', 1),
    ('Concrete pump', 'R2Lo', 'LHRO', 2),
    ('Concrete pump', 'R2Lo', 'LHR2O', 2),
    ('Concrete pump', 'R2Li', 'LHRRI', 1),
    ('Concrete pump', 'R2Li', 'LHRI', 2),
    ('Concrete pump', 'R2Li', 'LHR2I', 2),
    ('Concrete pump', 'R2Ri', 'RHRRI', 1),
    ('Concrete pump', 'R2Ri', 'RHRI', 2),
    ('Concrete pump', 'R2Ri', 'RHR2I', 2),
    ('Concrete pump', 'R2Ro', 'RHRRO', 1),
    ('Concrete pump', 'R2Ro', 'RHRO', 2),
    ('Concrete pump', 'R2Ro', 'RHR2O', 2),
    ('Concrete pump 4-axle', 'F1L', 'LHF1', 1),
    ('Concrete pump 4-axle', 'F1R', 'RHF1', 1),
    ('Concrete pump 4-axle', 'F2L', 'LHF2', 1),
    ('Concrete pump 4-axle', 'F2R', 'RHF2', 1),
    ('Concrete pump 4-axle', 'R1Lo', 'LHRCO', 1),
    ('Concrete pump 4-axle', 'R1Lo', 'LHCO', 2),
    ('Concrete pump 4-axle', 'R1Li', 'LHRCI', 1),
    ('Concrete pump 4-axle', 'R1Li', 'LHCI', 2),
    ('Concrete pump 4-axle', 'R1Ri', 'RHRCI', 1),
    ('Concrete pump 4-axle', 'R1Ri', 'RHCI', 2),
    ('Concrete pump 4-axle', 'R1Ro', 'RHRCO', 1),
    ('Concrete pump 4-axle', 'R1Ro', 'RHCO', 2),
    ('Concrete pump 4-axle', 'R2Lo', 'LHRRO', 1),
    ('Concrete pump 4-axle', 'R2Lo', 'LHRO', 2),
    ('Concrete pump 4-axle', 'R2Lo', 'LHR2O', 2),
    ('Concrete pump 4-axle', 'R2Li', 'LHRRI', 1),
    ('Concrete pump 4-axle', 'R2Li', 'LHRI', 2),
    ('Concrete pump 4-axle', 'R2Li', 'LHR2I', 2),
    ('Concrete pump 4-axle', 'R2Ri', 'RHRRI', 1),
    ('Concrete pump 4-axle', 'R2Ri', 'RHRI', 2),
    ('Concrete pump 4-axle', 'R2Ri', 'RHR2I', 2),
    ('Concrete pump 4-axle', 'R2Ro', 'RHRRO', 1),
    ('Concrete pump 4-axle', 'R2Ro', 'RHRO', 2),
    ('Concrete pump 4-axle', 'R2Ro', 'RHR2O', 2)
-- END GENERATED SPEC ERP TOKENS
  ) as w(k, slot, token, rank)
  where w.k = p_key
$$;

do $patch$
declare
  src text := replace(pg_get_functiondef('public.tyre_position_resolve(jsonb,text,text)'::regprocedure), chr(13), '');
  a_decl text := E'  v_layout_numbered boolean;\nbegin';
  a_calc text := E'  -- ---- as a position code\n  -- 1. A mapping VERIFIED for this layout (tyre_layout_position_mappings) wins.\n';
  a_branch text := E'''reason'', ''verified_mapping'');\n  elsif u ~ ''^(L|R)HR([CR])([IO])$''';
  n int;
begin
  if src like '%tyre_map_code%' then
    raise notice 'tyre_position_resolve already reads the shared map; skipping';
    return;
  end if;
  foreach n in array array[
      (length(src) - length(replace(src, a_decl, ''))) / length(a_decl),
      (length(src) - length(replace(src, a_calc, ''))) / length(a_calc),
      (length(src) - length(replace(src, a_branch, ''))) / length(a_branch)] loop
    if n <> 1 then
      raise exception 'tyre_position_resolve differs from the reviewed definition (anchor count %); nothing changed', n;
    end if;
  end loop;
  src := replace(src, a_decl, E'  v_layout_numbered boolean;\n  v_spec jsonb;      -- the one wheel the shared tyre map names for this spelling\n  v_spec_n int;\nbegin');
  src := replace(src, a_calc, a_calc || E'  -- 1b. The shared tyre map''s code or recorded alias for a wheel of this BUILT-IN layout\n'
    || E'  --     (tyre-layouts.json, generated into tyre_layout_spec_erp_tokens). Best rank only.\n'
    || E'  select count(distinct w->>''slot''), (array_agg(w order by w->>''slot''))[1] into v_spec_n, v_spec\n'
    || E'    from jsonb_array_elements(v_wheels) w\n'
    || E'   where coalesce(p_layout->>''source'', '''') = ''builtin''\n'
    || E'     and w->>''slot'' in (select t.slot from public.tyre_layout_spec_erp_tokens(p_layout->>''key'') t\n'
    || E'        where t.token = public.tyre_position_spec_token(p_token)\n'
    || E'          and t.rank = (select min(t2.rank) from public.tyre_layout_spec_erp_tokens(p_layout->>''key'') t2\n'
    || E'                         where t2.token = public.tyre_position_spec_token(p_token)));\n');
  src := replace(src, a_branch, E'''reason'', ''verified_mapping'');\n'
    || E'  elsif coalesce(v_spec_n, 0) = 1 then\n'
    || E'    v_code := jsonb_build_object(''canonical'', v_spec->>''code'', ''slot'', v_spec->>''slot'', ''status'', ''resolved'', ''reason'', ''tyre_map_code'');\n'
    || E'  elsif coalesce(v_spec_n, 0) > 1 then\n'
    || E'    v_code := jsonb_build_object(''canonical'', null, ''slot'', null, ''status'', ''ambiguous'', ''reason'', ''tyre_map_code_ambiguous'');\n'
    || E'  elsif u ~ ''^(L|R)HR([CR])([IO])$''');
  execute src;
end $patch$;

-- Rules version 3 -> 4 wherever the live database reports it (each occurrence once per function).
do $ver$
declare f text; src text; n int;
begin
  foreach f in array array['public.observation_erp_rules()', 'public.observation_erp_evaluate(uuid,uuid)'] loop
    if to_regprocedure(f) is null then
      raise notice '% not present; rules version left alone', f;
      continue;
    end if;
    src := replace(pg_get_functiondef(f::regprocedure), chr(13), '');
    if src like '%position-service-4%' then continue; end if;
    n := (length(src) - length(replace(src, '''position-service-3''', ''))) / length('''position-service-3''');
    if n <> 1 then
      raise exception '% reports the rules version % times; nothing changed', f, n;
    end if;
    execute format('create table if not exists _bak.%I (id bigserial primary key, saved_at timestamptz default now(), def text not null)',
      replace(split_part(f, '(', 1), 'public.', '') || '_v181000');
    execute format('insert into _bak.%I(def) values ($1)', replace(split_part(f, '(', 1), 'public.', '') || '_v181000') using src;
    execute replace(src, '''position-service-3''', '''position-service-4''');
  end loop;
end $ver$;

revoke all on function public.tyre_position_spec_token(text), public.tyre_layout_spec_erp_tokens(text) from public;
revoke all on function public.tyre_position_spec_token(text), public.tyre_layout_spec_erp_tokens(text) from anon;
grant execute on function public.tyre_position_spec_token(text), public.tyre_layout_spec_erp_tokens(text)
  to authenticated, service_role;

commit;
