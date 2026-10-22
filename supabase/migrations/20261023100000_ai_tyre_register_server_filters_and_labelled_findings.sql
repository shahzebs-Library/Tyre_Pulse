-- AI Tyre Inspection: (1) whole-register SERVER-side filters (condition, defect photos, AI job status,
-- reviewer status) with an exact total, (2) per-finding labelled review export for evaluation.
--
-- STATUS: AUTHORED, NOT APPLIED. Apply only on owner go-ahead (database-migration-safety).
--
-- Pre-flight
--  Data loss        : none. CREATE FUNCTION only; no table/column change, no UPDATE/DELETE, no trigger.
--  Locks/duration   : none (functions). Read cost: one filtered scan of inspections per page.
--  RLS              : both functions are SECURITY INVOKER, so the existing inspections / ai_tyre_inspection_jobs
--                     RLS (organisation + country + site) bounds every row. The labelled export additionally
--                     refuses non-supervisor roles in its body.
--  Grants           : revoked from public/anon; executable by authenticated + service_role.
--  PostgREST        : no RAISE 40001.
--
-- ROLLBACK:
--   drop function if exists public.ai_tyre_register_page(text,date,date,text,text,text,text,boolean,text,text,integer,integer);
--   drop function if exists public.get_ai_tyre_labelled_findings(date,date,integer);
--   drop function if exists public.ai_tyre_has_photo(jsonb);
--
-- VERIFY (as an authenticated user):
--   select count(*), max(total) from public.ai_tyre_register_page(null,null,null,null,null,null,'Worn',null,null,null,0,50);
begin;

-- True when a tyre-position entry carries any photo reference (mirrors normalizePhotographs' keys).
create or replace function public.ai_tyre_has_photo(p jsonb) returns boolean
language sql immutable parallel safe set search_path = pg_catalog, public as $$
 select coalesce(bool_or(
   p -> k is not null
   and (p -> k) not in ('null'::jsonb, '""'::jsonb, '[]'::jsonb, '{}'::jsonb)
 ), false)
 from unnest(array['photo_url','photo_uri','photo','photos','photo_refs','evidence']) k
$$;

create or replace function public.ai_tyre_register_page(
  p_country text default null, p_from date default null, p_to date default null,
  p_site text default null, p_status text default null, p_search text default null,
  p_condition text default null, p_photos boolean default null,
  p_ai_status text default null, p_review text default null,
  p_offset integer default 0, p_limit integer default 50
) returns table (id uuid, total bigint)
language sql stable security invoker set search_path = pg_catalog, public
set plan_cache_mode = force_custom_plan as $$
 with params as (
   select least(greatest(coalesce(p_limit, 50), 1), 200) as lim,
          greatest(coalesce(p_offset, 0), 0) as off,
          nullif(btrim(replace(replace(replace(coalesce(p_search, ''), '\', ''), '%', ''), '_', '')), '') as term
 ), matched as (
   select i.id, i.inspection_date,
          count(*) over () as total
     from public.inspections i, params
    where (p_country is null or p_country = 'All' or i.country = p_country)
      and (p_from is null or i.inspection_date >= p_from)
      and (p_to is null or i.inspection_date < p_to + 1)
      and (p_site is null or p_site = 'all' or i.site = p_site)
      and (p_status is null or p_status = 'all' or i.status = p_status)
      and (params.term is null or i.asset_no ilike '%' || params.term || '%' or i.site ilike '%' || params.term || '%')
      and (p_condition is null or p_condition = 'all' or exists (
            select 1 from jsonb_each(case when jsonb_typeof(i.tyre_conditions) = 'object' then i.tyre_conditions else '{}'::jsonb end) e
             where jsonb_typeof(e.value) = 'object' and e.value ->> 'condition' = p_condition))
      and (p_photos is not true or exists (
            select 1 from jsonb_each(case when jsonb_typeof(i.tyre_conditions) = 'object' then i.tyre_conditions else '{}'::jsonb end) e
             where jsonb_typeof(e.value) = 'object'
               and lower(coalesce(e.value ->> 'condition', e.value ->> 'status', e.value ->> 'risk', ''))
                   ~ '(worn|wear|damag|cut|crack|bulg|punct|flat|separat|cord|burst)'
               and public.ai_tyre_has_photo(e.value)))
      and (p_ai_status is null or p_ai_status = 'all'
           or (p_ai_status = 'none' and not exists (select 1 from public.ai_tyre_inspection_jobs j where j.inspection_id = i.id))
           or (p_ai_status <> 'none' and exists (select 1 from public.ai_tyre_inspection_jobs j where j.inspection_id = i.id and j.status = p_ai_status)))
      and (p_review is null or p_review = 'all'
           or exists (select 1 from public.ai_tyre_inspection_jobs j where j.inspection_id = i.id and coalesce(j.review_status, 'unreviewed') = p_review))
 )
 select m.id, m.total from matched m, params
  order by m.inspection_date desc nulls last, m.id asc
  offset (select off from params) limit (select lim from params)
$$;
revoke all on function public.ai_tyre_register_page(text,date,date,text,text,text,text,boolean,text,text,integer,integer) from public;
revoke all on function public.ai_tyre_register_page(text,date,date,text,text,text,text,boolean,text,text,integer,integer) from anon;
grant execute on function public.ai_tyre_register_page(text,date,date,text,text,text,text,boolean,text,text,integer,integer) to authenticated, service_role;

-- Per-finding labelled review rows for EVALUATION. The reviewer decision, note and the model's stored
-- findings sit side by side. Nothing here trains or tunes a model.
create or replace function public.get_ai_tyre_labelled_findings(p_from date default null, p_to date default null, p_limit integer default 5000)
returns table (
  job_id uuid, inspection_id uuid, asset_no text, tyre_position text, model_version text, prompt_version text,
  review_status text, reviewer_note text, reviewed_at timestamptz, assessable boolean, recommendation text,
  defects jsonb, photo_ref text, cost_usd numeric
) language sql stable security invoker set search_path = pg_catalog, public
set plan_cache_mode = force_custom_plan as $$
 select j.id, j.inspection_id, i.asset_no, j.tyre_position, j.model_version, j.prompt_version,
        j.review_status, j.reviewer_note, j.reviewed_at,
        case when j.analysis ? 'assessable' then (j.analysis ->> 'assessable')::boolean end,
        j.analysis ->> 'recommendation', coalesce(j.analysis -> 'defects', '[]'::jsonb), j.photo_ref, j.cost_usd
   from public.ai_tyre_inspection_jobs j
   left join public.inspections i on i.id = j.inspection_id
  where j.status = 'completed' and coalesce(j.review_status, 'unreviewed') <> 'unreviewed'
    and (lower(coalesce(public.get_my_role(), '')) in ('admin', 'manager', 'director', 'maintenance supervisor')
         or public.is_super_admin())
    and (p_from is null or j.reviewed_at >= p_from::timestamptz)
    and (p_to is null or j.reviewed_at < (p_to + 1)::timestamptz)
  order by j.reviewed_at desc nulls last, j.id
  limit least(greatest(coalesce(p_limit, 5000), 1), 20000)
$$;
revoke all on function public.get_ai_tyre_labelled_findings(date,date,integer) from public;
revoke all on function public.get_ai_tyre_labelled_findings(date,date,integer) from anon;
grant execute on function public.get_ai_tyre_labelled_findings(date,date,integer) to authenticated, service_role;

commit;
