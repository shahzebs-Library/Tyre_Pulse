-- Storage (console /console/storage): super-admin readers over storage.buckets
-- and storage.objects, a retention-rule register, an orphan scan log and a
-- per-bucket file limit writer. Additive only.
--
-- NOTHING HERE DELETES A FILE. SQL cannot remove storage objects (the storage
-- protect_delete trigger), and the owner has not approved any new automatic
-- cleanup. A saved retention rule is recorded with enabled = false and is read
-- by no job; the only rule that runs is the existing tenant-exports 7-day job
-- (cron tenant-export-retention + edge fn tenant-export cleanup), which keeps
-- using its own setting (admin_tenant_export_set_retention).
--
-- Every function: SECURITY DEFINER, search_path pinned, is_super_admin() gate in
-- the body, revoked from PUBLIC then anon, granted to authenticated. Writes are
-- audited to console_sessions in the same transaction.
--
-- Rollback: drop the functions and the two tables. No other object depends on them.

create table if not exists public.storage_retention_rules (
  id uuid primary key default gen_random_uuid(),
  bucket text not null,
  prefix text,
  min_bytes bigint check (min_bytes is null or min_bytes >= 0),
  older_than_days int not null check (older_than_days between 1 and 3650),
  action text not null default 'delete' check (action in ('delete')),
  enabled boolean not null default false,
  reason text not null,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_by uuid,
  updated_at timestamptz not null default now()
);
alter table public.storage_retention_rules enable row level security;
drop policy if exists storage_retention_rules_super_read on public.storage_retention_rules;
create policy storage_retention_rules_super_read on public.storage_retention_rules
  for select to authenticated using ((select public.is_super_admin()));
revoke insert, update, delete, truncate on public.storage_retention_rules from anon, authenticated;

create table if not exists public.storage_scan_runs (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('orphans')),
  ran_at timestamptz not null default now(),
  ran_by uuid default auth.uid(),
  result jsonb not null default '{}'::jsonb
);
alter table public.storage_scan_runs enable row level security;
drop policy if exists storage_scan_runs_super_read on public.storage_scan_runs;
create policy storage_scan_runs_super_read on public.storage_scan_runs
  for select to authenticated using ((select public.is_super_admin()));
revoke insert, update, delete, truncate on public.storage_scan_runs from anon, authenticated;

-- ── summary ───────────────────────────────────────────────────────────────────
create or replace function public.admin_storage_summary()
returns jsonb
language plpgsql
security definer
set search_path = public, storage, pg_catalog
as $$
declare
  v jsonb;
begin
  if not public.is_super_admin() then
    raise exception 'Permission denied: super admin required' using errcode = '42501';
  end if;

  with o as (
    select bucket_id, name, created_at,
           coalesce((metadata->>'size')::bigint, 0) as bytes,
           metadata->>'eTag' as etag,
           coalesce(metadata->>'mimetype', 'unknown') as mime,
           split_part(name, '/', 1) as folder
      from storage.objects
  ),
  dup as (
    select bucket_id, bytes, row_number() over (partition by bucket_id, etag, bytes order by created_at, name) as rn
      from o where etag is not null and bytes > 0
  ),
  pol as (
    select b.id,
           exists (select 1 from pg_policies p
                    where p.schemaname = 'storage' and p.tablename = 'objects' and p.cmd = 'DELETE'
                      and p.qual like '%''' || b.id || '''%') as has_delete_policy
      from storage.buckets b
  )
  select jsonb_build_object(
    'generated_at', now(),
    'buckets', (select coalesce(jsonb_agg(x order by x.bytes desc, x.id), '[]'::jsonb) from (
        select b.id, b.public, b.file_size_limit, b.allowed_mime_types, b.created_at,
               count(o.name) as files, coalesce(sum(o.bytes), 0) as bytes,
               max(o.created_at) as last_upload,
               coalesce(max(o.bytes), 0) as largest_bytes,
               count(o.name) filter (where o.created_at >= date_trunc('day', now())) as files_today,
               count(o.name) filter (where o.created_at >= now() - interval '7 days') as files_7d,
               count(o.name) filter (where o.created_at >= date_trunc('month', now())) as files_month,
               count(o.name) filter (where o.created_at < now() - interval '60 days') as older_60_files,
               coalesce(sum(o.bytes) filter (where o.created_at < now() - interval '60 days'), 0) as older_60_bytes,
               (select count(*) from dup d where d.bucket_id = b.id and d.rn > 1) as duplicate_files,
               (select coalesce(sum(d.bytes), 0) from dup d where d.bucket_id = b.id and d.rn > 1) as duplicate_bytes,
               (select p.has_delete_policy from pol p where p.id = b.id) as has_delete_policy,
               (select coalesce(jsonb_object_agg(m.mime, m.n), '{}'::jsonb) from (
                   select mime, count(*) n from o o2 where o2.bucket_id = b.id group by mime order by count(*) desc limit 6) m) as mimes
          from storage.buckets b left join o on o.bucket_id = b.id
         group by b.id, b.public, b.file_size_limit, b.allowed_mime_types, b.created_at) x),
    'folders', (select coalesce(jsonb_agg(f order by f.bytes desc), '[]'::jsonb) from (
        select bucket_id as bucket, folder, count(*) as files, sum(bytes) as bytes
          from o group by bucket_id, folder order by sum(bytes) desc limit 40) f),
    'growth', (select coalesce(jsonb_agg(g order by g.month), '[]'::jsonb) from (
        select to_char(date_trunc('month', created_at), 'YYYY-MM') as month, count(*) as files, sum(bytes) as bytes
          from o where created_at >= date_trunc('month', now()) - interval '11 months'
         group by 1) g),
    'largest', (select coalesce(jsonb_agg(l order by l.bytes desc), '[]'::jsonb) from (
        select o.bucket_id as bucket, o.name, o.bytes, o.created_at, o.mime,
               (select count(*) from o o3 where o3.bucket_id = o.bucket_id and o3.etag = o.etag and o3.bytes = o.bytes) > 1 as has_copy
          from o order by o.bytes desc limit 12) l),
    'companies', (select coalesce(jsonb_agg(c order by c.bytes desc), '[]'::jsonb) from (
        select o.folder, org.name as org_name, count(*) as files, sum(o.bytes) as bytes,
               string_agg(distinct o.bucket_id, ', ') as buckets,
               min(o.created_at) as first_at, max(o.created_at) as last_at,
               (select count(*) from public.profiles p where p.org_id = org.id) as members
          from o join public.organisations org on org.id::text = o.folder
         where o.bucket_id in ('import-files', 'tenant-exports')
         group by o.folder, org.id, org.name) c),
    'retention_rules', (select coalesce(jsonb_agg(r order by r.created_at desc), '[]'::jsonb) from public.storage_retention_rules r),
    'tenant_export_days', (select public._tenant_export_retention_days()),
    'last_orphan_scan', (select to_jsonb(s) from public.storage_scan_runs s where s.kind = 'orphans' order by s.ran_at desc limit 1)
  ) into v;
  return v;
end;
$$;

-- ── browse one bucket (read only) ─────────────────────────────────────────────
create or replace function public.admin_storage_list(p_bucket text, p_prefix text default null, p_search text default null,
                                                     p_limit int default 100, p_offset int default 0)
returns jsonb
language plpgsql
security definer
set search_path = public, storage, pg_catalog
as $$
declare v jsonb; v_total bigint;
begin
  if not public.is_super_admin() then
    raise exception 'Permission denied: super admin required' using errcode = '42501';
  end if;
  select count(*) into v_total from storage.objects o
   where o.bucket_id = p_bucket
     and (p_prefix is null or o.name like replace(replace(p_prefix, '%', '\%'), '_', '\_') || '%')
     and (p_search is null or o.name ilike '%' || replace(replace(p_search, '%', '\%'), '_', '\_') || '%');
  select coalesce(jsonb_agg(x), '[]'::jsonb) into v from (
    select o.name, coalesce((o.metadata->>'size')::bigint, 0) as bytes, o.created_at,
           o.metadata->>'mimetype' as mime
      from storage.objects o
     where o.bucket_id = p_bucket
       and (p_prefix is null or o.name like replace(replace(p_prefix, '%', '\%'), '_', '\_') || '%')
       and (p_search is null or o.name ilike '%' || replace(replace(p_search, '%', '\%'), '_', '\_') || '%')
     order by o.created_at desc, o.name
     limit greatest(1, least(coalesce(p_limit, 100), 500)) offset greatest(0, coalesce(p_offset, 0))
  ) x;
  return jsonb_build_object('total', v_total, 'rows', v);
end;
$$;

-- ── exact copies (same eTag and size) ─────────────────────────────────────────
create or replace function public.admin_storage_duplicates(p_bucket text default null, p_limit int default 200)
returns jsonb
language plpgsql
security definer
set search_path = public, storage, pg_catalog
as $$
declare v jsonb;
begin
  if not public.is_super_admin() then
    raise exception 'Permission denied: super admin required' using errcode = '42501';
  end if;
  select coalesce(jsonb_agg(g order by g.extra_bytes desc), '[]'::jsonb) into v from (
    select bucket_id as bucket, bytes,
           count(*) as copies,
           (count(*) - 1) * bytes as extra_bytes,
           (array_agg(name order by created_at, name))[1] as kept,
           (array_agg(name order by created_at, name))[2:] as extras,
           min(created_at) as first_at, max(created_at) as last_at
      from (select bucket_id, name, created_at, metadata->>'eTag' as etag,
                   coalesce((metadata->>'size')::bigint, 0) as bytes
              from storage.objects) o
     where etag is not null and bytes > 0 and (p_bucket is null or bucket_id = p_bucket)
     group by bucket_id, etag, bytes
    having count(*) > 1
     order by (count(*) - 1) * bytes desc
     limit greatest(1, least(coalesce(p_limit, 200), 1000))
  ) g;
  return v;
end;
$$;

-- ── retention preview (read only) ─────────────────────────────────────────────
create or replace function public.admin_storage_retention_preview(p_bucket text, p_prefix text, p_min_bytes bigint, p_older_than_days int)
returns jsonb
language plpgsql
security definer
set search_path = public, storage, pg_catalog
as $$
declare v jsonb;
begin
  if not public.is_super_admin() then
    raise exception 'Permission denied: super admin required' using errcode = '42501';
  end if;
  if p_older_than_days is null or p_older_than_days < 1 then
    raise exception 'Choose how many days to keep files' using errcode = '22023';
  end if;
  with m as (
    select name, created_at, coalesce((metadata->>'size')::bigint, 0) as bytes
      from storage.objects
     where bucket_id = p_bucket
       and created_at < now() - make_interval(days => p_older_than_days)
       and (nullif(btrim(p_prefix), '') is null or name like replace(replace(btrim(p_prefix), '%', '\%'), '_', '\_') || '%')
       and (p_min_bytes is null or coalesce((metadata->>'size')::bigint, 0) >= p_min_bytes)
  )
  select jsonb_build_object(
    'files', (select count(*) from m),
    'bytes', (select coalesce(sum(bytes), 0) from m),
    'bucket_files', (select count(*) from storage.objects where bucket_id = p_bucket),
    'oldest', (select min(created_at) from m),
    'sample', (select coalesce(jsonb_agg(s), '[]'::jsonb) from (select name, bytes, created_at from m order by created_at limit 10) s)
  ) into v;
  return v;
end;
$$;

-- ── save / remove a retention rule (records only; runs nothing) ──────────────
create or replace function public.admin_save_storage_retention_rule(p_id uuid, p_bucket text, p_prefix text,
                                                                    p_min_bytes bigint, p_older_than_days int, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public, storage, pg_catalog
as $$
declare v_id uuid := p_id; v_before jsonb;
begin
  if not public.is_super_admin() then
    raise exception 'Permission denied: super admin required' using errcode = '42501';
  end if;
  if coalesce(length(btrim(p_reason)), 0) < 3 then
    raise exception 'A reason is required' using errcode = '22023';
  end if;
  if not exists (select 1 from storage.buckets where id = p_bucket) then
    raise exception 'Unknown bucket' using errcode = '22023';
  end if;
  if p_bucket in ('tyre-photos', 'accident-photos', 'driver-fine-evidence', 'inspection-photos') then
    raise exception 'Photos and evidence are kept. A rule on this bucket needs an owner decision.' using errcode = '22023';
  end if;
  if p_bucket = 'tenant-exports' then
    raise exception 'Tenant exports already have their own 7-day rule. Change it with the export retention setting.' using errcode = '22023';
  end if;
  if p_older_than_days is null or p_older_than_days < 1 or p_older_than_days > 3650 then
    raise exception 'Keep days must be between 1 and 3650' using errcode = '22023';
  end if;

  if v_id is null then
    insert into public.storage_retention_rules (bucket, prefix, min_bytes, older_than_days, reason)
    values (p_bucket, nullif(btrim(p_prefix), ''), p_min_bytes, p_older_than_days, btrim(p_reason))
    returning id into v_id;
  else
    select to_jsonb(r) into v_before from public.storage_retention_rules r where r.id = v_id;
    if v_before is null then raise exception 'Rule not found' using errcode = '22023'; end if;
    update public.storage_retention_rules
       set bucket = p_bucket, prefix = nullif(btrim(p_prefix), ''), min_bytes = p_min_bytes,
           older_than_days = p_older_than_days, reason = btrim(p_reason),
           updated_by = auth.uid(), updated_at = now()
     where id = v_id;
  end if;

  insert into public.console_sessions (admin_id, action, target_id, target_type, details)
  values (auth.uid(), 'storage_retention_rule_saved', v_id, 'storage_retention_rule',
          jsonb_build_object('bucket', p_bucket, 'prefix', nullif(btrim(p_prefix), ''), 'min_bytes', p_min_bytes,
                             'older_than_days', p_older_than_days, 'reason', btrim(p_reason), 'before', v_before));
  return jsonb_build_object('ok', true, 'id', v_id, 'enabled', false);
end;
$$;

create or replace function public.admin_remove_storage_retention_rule(p_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare v_before jsonb;
begin
  if not public.is_super_admin() then
    raise exception 'Permission denied: super admin required' using errcode = '42501';
  end if;
  if coalesce(length(btrim(p_reason)), 0) < 3 then
    raise exception 'A reason is required' using errcode = '22023';
  end if;
  select to_jsonb(r) into v_before from public.storage_retention_rules r where r.id = p_id;
  if v_before is null then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  delete from public.storage_retention_rules where id = p_id;
  insert into public.console_sessions (admin_id, action, target_id, target_type, details)
  values (auth.uid(), 'storage_retention_rule_removed', p_id, 'storage_retention_rule',
          jsonb_build_object('reason', btrim(p_reason), 'before', v_before));
  return jsonb_build_object('ok', true);
end;
$$;

-- ── per-bucket file limit ─────────────────────────────────────────────────────
create or replace function public.admin_set_bucket_file_limit(p_bucket text, p_bytes bigint, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public, storage, pg_catalog
as $$
declare v_before bigint;
begin
  if not public.is_super_admin() then
    raise exception 'Permission denied: super admin required' using errcode = '42501';
  end if;
  if coalesce(length(btrim(p_reason)), 0) < 3 then
    raise exception 'A reason is required' using errcode = '22023';
  end if;
  if p_bytes is null or p_bytes < 1024 * 1024 or p_bytes > 500 * 1024 * 1024 then
    raise exception 'The limit must be between 1 MB and 500 MB' using errcode = '22023';
  end if;
  select file_size_limit into v_before from storage.buckets where id = p_bucket;
  if not found then raise exception 'Unknown bucket' using errcode = '22023'; end if;
  update storage.buckets set file_size_limit = p_bytes, updated_at = now() where id = p_bucket;
  insert into public.console_sessions (admin_id, action, target_type, details)
  values (auth.uid(), 'storage_file_limit_changed', 'storage_bucket',
          jsonb_build_object('bucket', p_bucket, 'before_bytes', v_before, 'after_bytes', p_bytes, 'reason', btrim(p_reason)));
  return jsonb_build_object('ok', true, 'bucket', p_bucket, 'before_bytes', v_before, 'after_bytes', p_bytes);
end;
$$;

-- ── orphan scan (read only; lists, never deletes) ─────────────────────────────
create or replace function public.admin_storage_orphan_scan()
returns jsonb
language plpgsql
security definer
set search_path = public, storage, pg_catalog
as $$
declare v jsonb; v_id uuid;
begin
  if not public.is_super_admin() then
    raise exception 'Permission denied: super admin required' using errcode = '42501';
  end if;
  with o as (
    select bucket_id, name, created_at, coalesce((metadata->>'size')::bigint, 0) as bytes,
           split_part(name, '/', 1) as folder
      from storage.objects
  ),
  unrecorded_imports as (
    select o.* from o where o.bucket_id = 'import-files'
       and not exists (select 1 from public.import_files f where f.storage_path = o.name)
  ),
  unrecorded_exports as (
    select o.* from o where o.bucket_id = 'tenant-exports'
       and not exists (select 1 from public.tenant_export_jobs j
                        where j.files is not null and j.files::text like '%' || o.name || '%')
  ),
  memberless as (
    select o.*, org.name as org_name from o join public.organisations org on org.id::text = o.folder
     where not exists (select 1 from public.profiles p where p.org_id = org.id)
  )
  select jsonb_build_object(
    'scanned_files', (select count(*) from o),
    'unrecorded_imports', jsonb_build_object('files', (select count(*) from unrecorded_imports),
        'bytes', (select coalesce(sum(bytes), 0) from unrecorded_imports),
        'sample', (select coalesce(jsonb_agg(s), '[]'::jsonb) from (select name, bytes, created_at from unrecorded_imports order by created_at limit 10) s)),
    'unrecorded_exports', jsonb_build_object('files', (select count(*) from unrecorded_exports),
        'bytes', (select coalesce(sum(bytes), 0) from unrecorded_exports),
        'sample', (select coalesce(jsonb_agg(s), '[]'::jsonb) from (select name, bytes, created_at from unrecorded_exports order by created_at limit 10) s)),
    'memberless_company_files', jsonb_build_object('files', (select count(*) from memberless),
        'bytes', (select coalesce(sum(bytes), 0) from memberless),
        'sample', (select coalesce(jsonb_agg(s), '[]'::jsonb) from (select bucket_id as bucket, name, bytes, org_name, created_at from memberless order by created_at limit 10) s)),
    'empty_buckets', (select coalesce(jsonb_agg(b.id order by b.id), '[]'::jsonb) from storage.buckets b
                       where not exists (select 1 from storage.objects x where x.bucket_id = b.id)),
    'photos_not_checked', true
  ) into v;

  insert into public.storage_scan_runs (kind, result) values ('orphans', v) returning id into v_id;
  insert into public.console_sessions (admin_id, action, target_id, target_type, details)
  values (auth.uid(), 'storage_orphan_scan', v_id, 'storage_scan', jsonb_build_object(
    'unrecorded_imports', v->'unrecorded_imports'->'files', 'unrecorded_exports', v->'unrecorded_exports'->'files',
    'memberless_company_files', v->'memberless_company_files'->'files'));
  return v || jsonb_build_object('scan_id', v_id, 'ran_at', now());
end;
$$;

do $$
declare f text;
begin
  foreach f in array array[
    'public.admin_storage_summary()',
    'public.admin_storage_list(text, text, text, int, int)',
    'public.admin_storage_duplicates(text, int)',
    'public.admin_storage_retention_preview(text, text, bigint, int)',
    'public.admin_save_storage_retention_rule(uuid, text, text, bigint, int, text)',
    'public.admin_remove_storage_retention_rule(uuid, text)',
    'public.admin_set_bucket_file_limit(text, bigint, text)',
    'public.admin_storage_orphan_scan()'
  ] loop
    execute format('revoke all on function %s from public', f);
    execute format('revoke all on function %s from anon', f);
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;
end $$;
