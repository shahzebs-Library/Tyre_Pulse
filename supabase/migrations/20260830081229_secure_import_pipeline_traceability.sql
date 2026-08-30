-- Secure, traceable import boundary. The browser may parse and preview files,
-- but PostgreSQL owns tenant identity, lifecycle integrity and promotion rights.

-- The bucket remains private and accepts only the formats used by Data Intake.
update storage.buckets
   set public = false,
       file_size_limit = 104857600,
       allowed_mime_types = array[
         'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
         'application/vnd.ms-excel',
         'application/vnd.ms-excel.sheet.macroenabled.12',
         'application/vnd.ms-excel.sheet.binary.macroenabled.12',
         'application/vnd.oasis.opendocument.spreadsheet',
         'text/csv', 'text/tab-separated-values', 'text/plain',
         'application/zip', 'application/octet-stream',
         'image/jpeg', 'image/png', 'image/webp', 'application/pdf'
       ]
 where id = 'import-files';

drop policy if exists import_files_auth_insert on storage.objects;
create policy import_files_auth_insert on storage.objects for insert to authenticated
  with check (
    bucket_id = 'import-files'
    and owner = auth.uid()
    and public.app_is_active()
    and public.app_user_can('upload_data', 'create')
    and (storage.foldername(name))[1] = public.app_current_org()::text
  );

drop policy if exists import_files_auth_delete on storage.objects;
create policy import_files_auth_delete on storage.objects for delete to authenticated
  using (
    bucket_id = 'import-files'
    and (public.get_my_role() = 'Admin' or public.is_super_admin())
    and public.storage_object_in_my_org(owner)
  );

-- Reject malformed metadata even through direct REST calls.
alter table public.import_files drop constraint if exists import_files_size_valid;
alter table public.import_files add constraint import_files_size_valid
  check (size_bytes is null or size_bytes between 1 and 104857600) not valid;
alter table public.import_files validate constraint import_files_size_valid;
alter table public.import_files drop constraint if exists import_files_sha256_valid;
alter table public.import_files add constraint import_files_sha256_valid
  check (sha256 is null or sha256 ~ '^[0-9a-f]{64}$') not valid;
alter table public.import_files validate constraint import_files_sha256_valid;
alter table public.import_files drop constraint if exists import_files_bucket_fixed;
alter table public.import_files add constraint import_files_bucket_fixed
  check (storage_bucket = 'import-files') not valid;
alter table public.import_files validate constraint import_files_bucket_fixed;

create or replace function public.secure_import_file_identity()
returns trigger language plpgsql security invoker set search_path = public as $$
declare v_org uuid := public.app_current_org();
begin
  if auth.uid() is null or not public.app_is_active() or v_org is null then
    raise exception 'Active organisation membership required.' using errcode = '42501';
  end if;
  new.organisation_id := v_org;
  new.created_by := auth.uid();
  if new.storage_path is null
     or split_part(new.storage_path, '/', 1) <> v_org::text then
    raise exception 'Storage path must belong to the current organisation.' using errcode = '42501';
  end if;
  if not public.import_user_can_commit_country(new.country) then
    raise exception 'Country scope denied.' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function public.secure_import_file_identity() from public, anon, authenticated;
drop trigger if exists trg_secure_import_file_identity on public.import_files;
create trigger trg_secure_import_file_identity before insert or update on public.import_files
  for each row execute function public.secure_import_file_identity();

create or replace function public.secure_import_batch_identity()
returns trigger language plpgsql security invoker set search_path = public as $$
declare v_org uuid := public.app_current_org(); v_file_org uuid; v_file_country text;
begin
  if auth.uid() is null or not public.app_is_active() or v_org is null then
    raise exception 'Active organisation membership required.' using errcode = '42501';
  end if;
  if not public.import_user_can_commit_country(new.country) then
    raise exception 'Country scope denied.' using errcode = '42501';
  end if;
  if new.file_id is not null then
    select organisation_id, country into v_file_org, v_file_country
      from public.import_files where id = new.file_id;
    if not found or v_file_org is distinct from v_org
       or v_file_country is distinct from new.country then
      raise exception 'The source file and batch must share organisation and country.' using errcode = '23514';
    end if;
  end if;
  new.organisation_id := v_org;
  if tg_op = 'INSERT' then
    new.created_by := auth.uid(); new.uploader := auth.uid();
  end if;
  return new;
end;
$$;
revoke all on function public.secure_import_batch_identity() from public, anon, authenticated;
drop trigger if exists trg_secure_import_batch_identity on public.import_batches;
create trigger trg_secure_import_batch_identity before insert or update on public.import_batches
  for each row execute function public.secure_import_batch_identity();

-- Each lifecycle transition is append-only and answers who/when/what.
create or replace function public.audit_import_batch_transition()
returns trigger language plpgsql security invoker set search_path = public as $$
begin
  if tg_op = 'INSERT' or old.approval_status is distinct from new.approval_status
     or old.import_status is distinct from new.import_status
     or old.imported_rows is distinct from new.imported_rows
     or old.skipped_rows is distinct from new.skipped_rows then
    insert into public.import_audit_events(organisation_id, batch_id, actor, action, detail)
    values (
      new.organisation_id, new.id, auth.uid(),
      case when tg_op = 'INSERT' then 'BATCH_CREATED' else 'BATCH_TRANSITION' end,
      jsonb_build_object(
        'before', case when tg_op = 'INSERT' then null else jsonb_build_object(
          'approval_status', old.approval_status, 'import_status', old.import_status,
          'imported_rows', old.imported_rows, 'skipped_rows', old.skipped_rows) end,
        'after', jsonb_build_object(
          'approval_status', new.approval_status, 'import_status', new.import_status,
          'imported_rows', new.imported_rows, 'skipped_rows', new.skipped_rows)
      )
    );
  end if;
  return new;
end;
$$;
revoke all on function public.audit_import_batch_transition() from public, anon, authenticated;
drop trigger if exists trg_audit_import_batch_transition on public.import_batches;
create trigger trg_audit_import_batch_transition after insert or update on public.import_batches
  for each row execute function public.audit_import_batch_transition();

create index if not exists idx_import_audit_org_created
  on public.import_audit_events(organisation_id, created_at desc);
create index if not exists idx_import_files_org_created
  on public.import_files(organisation_id, created_at desc);
create index if not exists idx_import_batches_org_created
  on public.import_batches(organisation_id, created_at desc);

-- Post-commit proof: every target id recorded by staging must exist in the
-- canonical destination table selected by the server-side module registry.
create or replace function public.import_verify_landing(p_batch_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_batch public.import_batches%rowtype; v_target text;
  v_expected integer := 0; v_landed integer := 0; v_dangling integer := 0;
begin
  if auth.uid() is null or not public.app_is_active() then
    raise exception 'Not authorised.' using errcode = '42501';
  end if;
  select * into v_batch from public.import_batches where id = p_batch_id;
  if not found or v_batch.organisation_id is distinct from public.app_current_org()
     or not public.import_user_can_commit_country(v_batch.country) then
    raise exception 'Import batch not found.' using errcode = '42501';
  end if;
  v_target := public.import_target_table(v_batch.module);
  if v_target is null then raise exception 'Unknown import destination.'; end if;
  select count(distinct target_record_id) into v_expected
    from public.import_rows
   where batch_id = p_batch_id and target_record_id is not null;
  execute format(
    'select count(distinct r.target_record_id) from public.import_rows r join public.%I t on t.id::text = r.target_record_id where r.batch_id = $1 and r.target_record_id is not null',
    v_target
  ) into v_landed using p_batch_id;
  v_dangling := greatest(v_expected - v_landed, 0);
  return jsonb_build_object(
    'batch_id', p_batch_id, 'module', v_batch.module, 'target_table', v_target,
    'status', v_batch.import_status, 'expected_distinct', v_expected,
    'landed_distinct', v_landed, 'dangling', v_dangling,
    'verified_at', now()
  );
end;
$$;
revoke all on function public.import_verify_landing(uuid) from public, anon;
grant execute on function public.import_verify_landing(uuid) to authenticated;
