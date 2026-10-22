-- AI Tyre Inspection: automatic evidence queue and metered usage.
-- Only immutable inspection evidence linked to an abnormal tyre position is queued.
-- Reprocessing an unchanged photo never creates another job.
alter table public.ai_tyre_inspection_jobs
 add column if not exists input_tokens bigint,
 add column if not exists output_tokens bigint,
 add column if not exists total_tokens bigint,
 add column if not exists provider text,
 add column if not exists pricing_usd_per_million_input numeric(12,6),
 add column if not exists pricing_usd_per_million_output numeric(12,6),
 add column if not exists billed_at timestamptz;
alter table public.ai_tyre_inspection_jobs
 add constraint ai_tyre_usage_nonnegative check (
 (input_tokens is null or input_tokens >= 0) and
 (output_tokens is null or output_tokens >= 0) and
 (total_tokens is null or total_tokens >= 0)
 );
create schema if not exists ai_tyre_private;
revoke all on schema ai_tyre_private from public,anon,authenticated;
create or replace function ai_tyre_private.collect_evidence(p_inspection public.inspections)
returns integer language plpgsql security definer
set search_path=pg_catalog,public,extensions
as $$
declare p record; image_ref text; v_photo jsonb; v_count int:=0;
begin
 if p_inspection.organisation_id is null then return 0; end if;
 for p in select key,value from jsonb_each(coalesce(p_inspection.tyre_conditions,'{}'::jsonb)) loop
  if coalesce(p.value->>'condition',p.value->>'status','') !~* '(worn|wear|damag|cut|crack|bulg|punct|flat|separat|cord|burst)'
     then continue; end if;
  -- Current inspection uploader stores the position photo in photo.
  -- Preserve photos arrays too; no artificial photo count limit.
  for v_photo in
   select v from (
    select p.value->'photo' v
    union all
    select value v from jsonb_array_elements(
      case when jsonb_typeof(p.value->'photos')='array'
        then p.value->'photos' else '[]'::jsonb end)
    union all
    select value v from jsonb_array_elements(
      case when jsonb_typeof(p.value->'photo_refs')='array'
        then p.value->'photo_refs' else '[]'::jsonb end)
   ) links
  loop
   image_ref:=case
     when jsonb_typeof(v_photo)='string' then trim(both '"' from v_photo::text)
     when jsonb_typeof(v_photo)='object' then coalesce(v_photo->>'ref',v_photo->>'path')
     else null end;
   if image_ref is null or image_ref !~ '^tp-storage://[a-z0-9_-]+/[^ ]+$'
      or image_ref like '%..%' or length(image_ref)>2048 then continue; end if;
   insert into public.ai_tyre_inspection_jobs(
     organisation_id,inspection_id,tyre_position,photo_ref,photo_sha256,status)
   values (p_inspection.organisation_id,p_inspection.id,left(p.key,80),image_ref,
     encode(extensions.digest(image_ref,'sha256'),'hex'),'pending')
   on conflict(organisation_id,inspection_id,tyre_position,photo_sha256)
   do nothing;
   if found then v_count:=v_count+1; end if;
  end loop;
 end loop;
 return v_count;
end $$;
revoke all on function ai_tyre_private.collect_evidence(public.inspections) from public,anon,authenticated;
create or replace function ai_tyre_private.queue_after_inspection()
returns trigger language plpgsql security definer
set search_path=pg_catalog,public,extensions
as $$
begin
 perform ai_tyre_private.collect_evidence(new);
 return new;
end $$;
revoke all on function ai_tyre_private.queue_after_inspection() from public,anon,authenticated;
drop trigger if exists ai_tyre_queue_inspection on public.inspections;
create trigger ai_tyre_queue_inspection after insert or update of tyre_conditions
on public.inspections for each row
execute function ai_tyre_private.queue_after_inspection();

-- Explicit historical backfill is service-side, bounded and repeatable.
-- It is NOT run automatically on all historic inspections during migration.
create or replace function ai_tyre_private.backfill_inspections(
 p_since timestamptz,p_until timestamptz,p_limit integer default 100)
returns table(inspections_scanned integer,jobs_added integer)
language plpgsql security definer set search_path=pg_catalog,public,extensions
as $$
declare item public.inspections; n int:=0; added int:=0;
begin
 if p_since is null or p_until is null or p_since>=p_until
 or p_limit<1 or p_limit>250 then raise exception 'Invalid backfill range'; end if;
 for item in select * from public.inspections
 where created_at>=p_since and created_at<p_until
 order by created_at,id limit p_limit
 loop
  n:=n+1;
  added:=added+ai_tyre_private.collect_evidence(item);
 end loop;
 return query select n,added;
end $$;
revoke all on function ai_tyre_private.backfill_inspections(timestamptz,timestamptz,integer)
 from public,anon,authenticated;
