-- =====================================================================
-- V437 - DATA INTAKE: COMMIT EXACT LIVE COPIES, DROP ONLY AFTER DB CHECK
-- =====================================================================
-- The preview used to turn a live exact match into action='skip', so the row
-- never entered the commit path. The client now stages it as an insert and
-- carries the preview's candidate id in import_rows.target_record_id. Commit
-- re-reads that row under the current organisation and compares every supplied
-- target field. Only a verified exact copy is marked processed as a duplicate.

create or replace function public.import_exact_supplied_match(
  p_live jsonb,
  p_uploaded jsonb,
  p_target_columns text[]
)
returns boolean
language sql
immutable
set search_path = public
as $function$
  select case when count(*) = 0 then false else bool_and(
    case
      when public.import_jsonb_blank(p_live -> u.key)
       and public.import_jsonb_blank(u.value) then true
      when public.import_jsonb_blank(p_live -> u.key)
        or public.import_jsonb_blank(u.value) then false
      when jsonb_typeof(u.value) = 'string' then
        lower(btrim(p_live ->> u.key)) = lower(btrim(u.value #>> '{}'))
      else (p_live -> u.key) = u.value
    end
  ) end
  from jsonb_each(coalesce(p_uploaded, '{}'::jsonb)) as u(key, value)
  where u.key = any(coalesce(p_target_columns, array[]::text[]));
$function$;

do $migration$
declare
  v_def text;
  v_hits int;
begin
  select pg_get_functiondef(p.oid) into v_def
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname = 'import_commit_batch'
    and pg_get_function_identity_arguments(p.oid) = 'p_batch_id uuid, p_max_rows integer';

  if v_def is null then
    raise exception 'V437: import_commit_batch(uuid,integer) not found';
  end if;

  select count(*) into v_hits
  from regexp_matches(v_def, E'  v_new_id   text;\\n  v_inserted int := 0;', 'g');
  if v_hits <> 1 then
    raise exception 'V437: declaration anchor count %, expected 1', v_hits;
  end if;
  v_def := replace(v_def,
    E'  v_new_id   text;\n  v_inserted int := 0;',
    E'  v_new_id   text;\n  v_existing jsonb;\n  v_child_count int := 0;\n  v_exact_dups int := 0;\n  v_inserted int := 0;');

  select count(*) into v_hits
  from regexp_matches(v_def, E'    END IF;\\n\\n    v_enriched := v_data', 'g');
  if v_hits <> 1 then
    raise exception 'V437: row-enrichment anchor count %, expected 1', v_hits;
  end if;
  v_def := replace(v_def,
    E'    END IF;\n\n    v_enriched := v_data',
    E'    END IF;\n\n'
    || E'    -- target_record_id is only a preview candidate at this point. Re-read\n'
    || E'    -- it in this organisation and verify every uploaded target field.\n'
    || E'    IF r.target_record_id IS NOT NULL THEN\n'
    || E'      v_existing := NULL;\n'
    || E'      EXECUTE format(\n'
    || E'        ''SELECT to_jsonb(t) FROM public.%I AS t WHERE t.id::text = $1 AND t.organisation_id = $2 LIMIT 1'',\n'
    || E'        v_target)\n'
    || E'      USING r.target_record_id, v_org INTO v_existing;\n\n'
    || E'      IF v_existing IS NOT NULL\n'
    || E'         AND public.import_exact_supplied_match(v_existing, v_data, v_tcols) THEN\n'
    || E'        v_child_count := 0;\n'
    || E'        UPDATE public.import_rows\n'
    || E'          SET target_module = b.module, processed_at = now(), dup_status = ''duplicate''\n'
    || E'          WHERE id = r.id;\n\n'
    || E'        IF v_children ? r.id::text THEN\n'
    || E'          v_child_count := jsonb_array_length(v_children -> r.id::text);\n'
    || E'          UPDATE public.import_rows\n'
    || E'            SET target_record_id = r.target_record_id,\n'
    || E'                target_module = b.module, processed_at = now(), dup_status = ''duplicate''\n'
    || E'            WHERE id IN (\n'
    || E'              SELECT (jsonb_array_elements_text(v_children -> r.id::text))::uuid\n'
    || E'            );\n'
    || E'        END IF;\n\n'
    || E'        v_skipped := v_skipped + 1 + v_child_count;\n'
    || E'        v_exact_dups := v_exact_dups + 1 + v_child_count;\n'
    || E'        INSERT INTO public.import_row_issues (row_id, severity, issue_code, message)\n'
    || E'          VALUES (r.id, ''warning'', ''EXACT_LIVE_DUPLICATE'',\n'
    || E'                  ''Every supplied value matches the live record; exact duplicate dropped.'');\n'
    || E'        CONTINUE;\n'
    || E'      ELSE\n'
    || E'        -- The live row changed after preview (or disappeared). Do not trust\n'
    || E'        -- the stale candidate; continue through the normal insert path.\n'
    || E'        UPDATE public.import_rows SET target_record_id = NULL WHERE id = r.id;\n'
    || E'      END IF;\n'
    || E'    END IF;\n\n'
    || E'    v_enriched := v_data');

  select count(*) into v_hits
  from regexp_matches(v_def, E'WHEN v_total_ins > 0 THEN ''committed''', 'g');
  if v_hits <> 2 then
    raise exception 'V437: committed-status anchor count %, expected 2', v_hits;
  end if;
  v_def := replace(v_def,
    'WHEN v_total_ins > 0 THEN ''committed''',
    'WHEN v_total_ins > 0 OR v_exact_dups > 0 THEN ''committed''');

  select count(*) into v_hits
  from regexp_matches(v_def, E'''skipped'',  v_skipped,\\n    ''not_eligible''', 'g');
  if v_hits <> 1 then
    raise exception 'V437: result anchor count %, expected 1', v_hits;
  end if;
  v_def := replace(v_def,
    E'''skipped'',  v_skipped,\n    ''not_eligible''',
    E'''skipped'',  v_skipped,\n    ''exact_duplicates'', v_exact_dups,\n    ''not_eligible''');

  select count(*) into v_hits
  from regexp_matches(v_def, E'''failed'', v_failed, ''merged'', v_merged,', 'g');
  if v_hits <> 1 then
    raise exception 'V437: audit anchor count %, expected 1', v_hits;
  end if;
  v_def := replace(v_def,
    '''failed'', v_failed, ''merged'', v_merged,',
    '''failed'', v_failed, ''merged'', v_merged, ''exact_duplicates'', v_exact_dups,');

  execute v_def;
end
$migration$;

comment on function public.import_exact_supplied_match(jsonb,jsonb,text[]) is
  'True only when every uploaded target column matches the candidate live row; blank/null and trimmed case-insensitive text are normalized.';

comment on function public.import_commit_batch(uuid,integer) is
  'V437: stages preview live matches as inserts, then drops only database-verified exact copies and reports exact_duplicates.';
