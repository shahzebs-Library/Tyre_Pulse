-- Assertions for 20261117102000_recalls_number_unique_per_org.sql, on a private copy of the
-- LOCAL staging mirror only (synthetic companies Alpha, Beta). Never run on production.
-- Driver: supabase/tests/staging_recalls_unique_per_org.sh
-- Each case runs in a sub-transaction that is rolled back; the file ends in ROLLBACK.
\set ON_ERROR_STOP on
begin;

create or replace function pg_temp.try_recall(p_org text, p_no text, p_country text) returns text language plpgsql as $$
begin
  insert into public.recalls (organisation_id, recall_number, brand, country)
  values (p_org::uuid, p_no, 'ZZBRAND', p_country);
  return 'ok';
exception when unique_violation then
  return '23505';
end $$;

do $t$
declare a text := '00000000-0000-0000-0000-000000000001'; b text := 'bbbbbbbb-0000-4000-8000-000000000002';
        r1 text; r2 text;
begin
  -- 1. Two companies may use the same recall number in the same country.
  begin
    r1 := pg_temp.try_recall(a, 'ZZ-RC-001', 'KSA');
    r2 := pg_temp.try_recall(b, 'ZZ-RC-001', 'KSA');
    raise notice '% two companies, same number + country: both saved (alpha=% beta=%)',
      case when r1 = 'ok' and r2 = 'ok' then 'PASS' else 'FAIL' end, r1, r2;
    raise exception 'case_done';
  exception when others then if sqlerrm <> 'case_done' then raise notice 'FAIL case 1 error % %', sqlstate, sqlerrm; end if;
  end;
  -- 2. Same company, same number + country: refused with 23505.
  begin
    r1 := pg_temp.try_recall(a, 'ZZ-RC-002', 'KSA');
    r2 := pg_temp.try_recall(a, 'ZZ-RC-002', 'KSA');
    raise notice '% same company duplicate refused (first=% second=%)',
      case when r1 = 'ok' and r2 = '23505' then 'PASS' else 'FAIL' end, r1, r2;
    raise exception 'case_done';
  exception when others then if sqlerrm <> 'case_done' then raise notice 'FAIL case 2 error % %', sqlstate, sqlerrm; end if;
  end;
  -- 3. Same company, two country-less recalls with the same number: refused.
  begin
    r1 := pg_temp.try_recall(a, 'ZZ-RC-003', null);
    r2 := pg_temp.try_recall(a, 'ZZ-RC-003', null);
    raise notice '% same company, two country-NULL duplicates refused (first=% second=%)',
      case when r1 = 'ok' and r2 = '23505' then 'PASS' else 'FAIL' end, r1, r2;
    raise exception 'case_done';
  exception when others then if sqlerrm <> 'case_done' then raise notice 'FAIL case 3 error % %', sqlstate, sqlerrm; end if;
  end;
  -- 4. Same number, different countries, one company: still allowed.
  begin
    r1 := pg_temp.try_recall(a, 'ZZ-RC-004', 'KSA');
    r2 := pg_temp.try_recall(a, 'ZZ-RC-004', 'UAE');
    raise notice '% same company, same number in two countries: both saved (ksa=% uae=%)',
      case when r1 = 'ok' and r2 = 'ok' then 'PASS' else 'FAIL' end, r1, r2;
    raise exception 'case_done';
  exception when others then if sqlerrm <> 'case_done' then raise notice 'FAIL case 4 error % %', sqlstate, sqlerrm; end if;
  end;
end $t$;

rollback;
