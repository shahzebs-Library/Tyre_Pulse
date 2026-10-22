-- Updated Flutter inspection schema stores position-linked images in photo_url.
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
    select p.value->'photo_url' v
    union all
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
