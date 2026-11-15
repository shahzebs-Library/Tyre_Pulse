-- Staging tests for supabase/pending_migrations/20261117090000_report_pdf_cache.sql and
-- 20261117091000_report_pdf_autoqueue.sql. LOCAL staging copy only (run through
-- report_pdf_cache_tests.sh, which refuses any host but 127.0.0.1). Synthetic companies
-- Alpha / Beta / Gamma. Everything runs in ONE transaction that is rolled back.
\set ON_ERROR_STOP on
\set QUIET on
begin;

create temp table t_ctx (k text primary key, v text);
grant select, insert on t_ctx to authenticated, anon;
create temp table t_pass (n serial, name text);
grant insert, select on t_pass to authenticated, anon;
grant usage on sequence t_pass_n_seq to authenticated, anon;

create function pg_temp.login(p_email text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub',
    (select id from public.profiles where email = p_email), 'role', 'authenticated', 'aal', 'aal1')::text, true)
$$;
create function pg_temp.ctx(p text) returns text language sql stable as $$ select v from t_ctx where k = p $$;
create function pg_temp.ok(p_cond boolean, p_name text) returns void language plpgsql as $$
begin
  if p_cond is not true then raise exception 'FAIL: %', p_name; end if;
  insert into t_pass(name) values (p_name);
end $$;
-- shorthand for the key arguments
create function pg_temp.look(p_type text, p_src text, p_brand text default 'b-test', p_client text default '')
returns jsonb language sql as $$ select public.pdf_cache_lookup(p_type, p_src::uuid, 'tpl-test', p_brand, p_client) $$;
create function pg_temp.claim(p_type text, p_src text, p_retry boolean default false, p_brand text default 'b-test', p_client text default '')
returns jsonb language sql as $$ select public.pdf_cache_claim(p_type, p_src::uuid, 'tpl-test', p_brand, p_client, 'Tyre Insp TEST.pdf', 180, p_retry) $$;
-- stand-in for the Storage API upload: insert the object row as the caller, then complete
create function pg_temp.upload(p_path text, p_size bigint default 1000) returns void language sql as $$
  insert into storage.objects (bucket_id, name, owner, metadata)
  values ('report-pdfs', p_path, auth.uid(), jsonb_build_object('size', p_size, 'mimetype', 'application/pdf', 'eTag', md5(p_path)))
  on conflict (bucket_id, name) do update set metadata = excluded.metadata, updated_at = now()
$$;
create function pg_temp.sha(p text) returns text language sql as $$ select encode(sha256(convert_to(p, 'UTF8')), 'hex') $$;

-- ---------------------------------------------------------------- synthetic fixtures
insert into t_ctx
select 'alpha', '00000000-0000-0000-0000-000000000001' union all
select 'ins_ksa_pending', (select id::text from public.inspections where organisation_id = '00000000-0000-0000-0000-000000000001' and country = 'KSA' and site = 'ALPHA EAST PLANT' and approval_status = 'pending_approval' order by id limit 1) union all
select 'ins_ksa_approved', (select id::text from public.inspections where organisation_id = '00000000-0000-0000-0000-000000000001' and country = 'KSA' and site = 'ALPHA EAST PLANT' and approval_status = 'approved' order by id limit 1) union all
select 'ins_ksa_other_site', (select id::text from public.inspections where organisation_id = '00000000-0000-0000-0000-000000000001' and country = 'KSA' and site = 'ALPHA NORTH PLANT' order by id limit 1) union all
select 'ins_ksa_obs', (select id::text from public.inspections where organisation_id = '00000000-0000-0000-0000-000000000001' and country = 'KSA' and site = 'ALPHA CENTRAL YARD' and approval_status = 'pending_approval' order by id limit 1) union all
select 'ins_ksa_queue', (select id::text from public.inspections where organisation_id = '00000000-0000-0000-0000-000000000001' and country = 'KSA' and site = 'ALPHA CENTRAL YARD' and approval_status = 'pending_approval' order by id desc limit 1) union all
select 'ins_uae', (select id::text from public.inspections where organisation_id = '00000000-0000-0000-0000-000000000001' and country = 'UAE' order by id limit 1) union all
select 'ins_beta', (select id::text from public.inspections where organisation_id = 'bbbbbbbb-0000-4000-8000-000000000002' and country = 'KSA' order by id limit 1);
select pg_temp.ok((select count(*) from t_ctx where v is not null) = 8, 'fixtures: synthetic inspections found');

-- a site-restricted synthetic account: the Alpha tyre man sees ALPHA EAST PLANT only
set local session_replication_role = replica;
update public.profiles set sites = array['ALPHA EAST PLANT'] where email = 'alpha.tyreman@staging.tyrepulse.invalid';
set local session_replication_role = origin;

-- ---------------------------------------------------------------- 1. anon is refused everywhere
select pg_temp.ok(not has_function_privilege('anon', 'public.pdf_cache_lookup(text,uuid,text,text,text)', 'execute')
  and not has_function_privilege('anon', 'public.pdf_cache_claim(text,uuid,text,text,text,text,integer,boolean)', 'execute')
  and not has_function_privilege('anon', 'public.pdf_cache_complete(uuid,text,bigint)', 'execute')
  and not has_function_privilege('anon', 'public.pdf_cache_fail(uuid,text,boolean,boolean)', 'execute')
  and not has_function_privilege('anon', 'public.pdf_cache_regenerate(text,uuid,text,text,text,text,text,integer)', 'execute')
  and not has_function_privilege('anon', 'public.pdf_cache_record_download(uuid,text)', 'execute')
  and not has_function_privilege('anon', 'public.pdf_cache_heartbeat(uuid,integer)', 'execute')
  and not has_function_privilege('anon', 'public.pdf_cache_pending(text,integer)', 'execute')
  and not has_function_privilege('anon', 'public.pdf_cache_queue_done(text,uuid)', 'execute'),
  'anon cannot execute any pdf_cache function');
select pg_temp.ok(not has_table_privilege('anon', 'public.report_pdf_files', 'select')
  and not has_table_privilege('anon', 'public.report_pdf_events', 'select')
  and not has_table_privilege('anon', 'public.report_pdf_queue', 'select'), 'anon has no table grant');
select pg_temp.ok(not has_function_privilege('authenticated', 'public.pdf_cache_source(text,uuid)', 'execute')
  and not has_function_privilege('authenticated', 'public.pdf_cache_key_for(text,uuid,text,text,text)', 'execute')
  and not has_function_privilege('authenticated', 'public.pdf_cache_can_see(uuid,text,text)', 'execute'),
  'internal helpers that bypass caller scope are not executable by authenticated');
select pg_temp.ok(not has_table_privilege('authenticated', 'public.report_pdf_files', 'insert')
  and not has_table_privilege('authenticated', 'public.report_pdf_files', 'update')
  and not has_table_privilege('authenticated', 'public.report_pdf_files', 'delete'), 'authenticated cannot write the table directly');
-- a signed-out caller reaching the function body (service path) gets a refusal, not data
select set_config('request.jwt.claims', '', true);
select pg_temp.ok(pg_temp.look('tyre_inspection', pg_temp.ctx('ins_ksa_pending'))->>'reason' = 'not_signed_in', 'no session: lookup refused');

-- ---------------------------------------------------------------- 2. first generation
select pg_temp.login('alpha.manager@staging.tyrepulse.invalid'); set local role authenticated;
select pg_temp.ok((pg_temp.look('tyre_inspection', pg_temp.ctx('ins_ksa_pending'))->>'state') = 'missing', 'first lookup: missing');
insert into t_ctx select 'claim1', pg_temp.claim('tyre_inspection', pg_temp.ctx('ins_ksa_pending'))::text;
select pg_temp.ok((pg_temp.ctx('claim1')::jsonb->>'state') = 'claimed', 'first claim wins');
select pg_temp.ok((pg_temp.ctx('claim1')::jsonb->>'path') =
  pg_temp.ctx('alpha') || '/tyre_inspection/' || pg_temp.ctx('ins_ksa_pending') || '/' || (pg_temp.ctx('claim1')::jsonb->>'cache_key') || '.pdf',
  'storage path is <org>/<type>/<source>/<cache_key>.pdf');
select pg_temp.ok((pg_temp.claim('tyre_inspection', pg_temp.ctx('ins_ksa_pending'))->>'file_id') = (pg_temp.ctx('claim1')::jsonb->>'file_id'),
  'same caller claiming again gets the same job (idempotent)');
select pg_temp.ok((pg_temp.look('tyre_inspection', pg_temp.ctx('ins_ksa_pending'))->>'state') = 'processing', 'lookup while generating: processing');

-- a second person at the same time is told to wait, and cannot upload to the path
reset role; select pg_temp.login('alpha.admin@staging.tyrepulse.invalid'); set local role authenticated;
select pg_temp.ok((pg_temp.claim('tyre_inspection', pg_temp.ctx('ins_ksa_pending'))->>'state') = 'processing', 'second claimer waits (one generator)');
do $$ begin
  perform pg_temp.upload(pg_temp.ctx('claim1')::jsonb->>'path');
  raise exception 'FAIL: a non-owner uploaded to the job path';
exception when insufficient_privilege then perform pg_temp.ok(true, 'storage: a user without the lease cannot upload to the path');
end $$;
select pg_temp.ok((public.pdf_cache_complete((pg_temp.ctx('claim1')::jsonb->>'file_id')::uuid, pg_temp.sha('x'), 1000)->>'reason') = 'not_your_job',
  'complete by a non-owner refused');

-- owner uploads and completes
reset role; select pg_temp.login('alpha.manager@staging.tyrepulse.invalid'); set local role authenticated;
do $$ begin
  perform pg_temp.upload(pg_temp.ctx('alpha') || '/tyre_inspection/' || pg_temp.ctx('ins_ksa_pending') || '/somethingelse.pdf');
  raise exception 'FAIL: upload to a path with no job';
exception when insufficient_privilege then perform pg_temp.ok(true, 'storage: a path that belongs to no job is refused');
end $$;
select pg_temp.ok((public.pdf_cache_complete((pg_temp.ctx('claim1')::jsonb->>'file_id')::uuid, pg_temp.sha('pdf-1'), 1000)->>'reason') = 'file_missing',
  'complete before the file exists refused');
select pg_temp.upload(pg_temp.ctx('claim1')::jsonb->>'path', 1000);
select pg_temp.ok((public.pdf_cache_complete((pg_temp.ctx('claim1')::jsonb->>'file_id')::uuid, 'not-a-hash', 1000)->>'reason') = 'bad_checksum', 'malformed sha256 refused');
select pg_temp.ok((public.pdf_cache_complete((pg_temp.ctx('claim1')::jsonb->>'file_id')::uuid, pg_temp.sha('pdf-1'), 999)->>'reason') = 'size_mismatch', 'size that differs from the stored object refused');
insert into t_ctx select 'done1', public.pdf_cache_complete((pg_temp.ctx('claim1')::jsonb->>'file_id')::uuid, pg_temp.sha('pdf-1'), 1000)::text;
select pg_temp.ok((pg_temp.ctx('done1')::jsonb->>'state') = 'ready' and (pg_temp.ctx('done1')::jsonb->>'current')::boolean
  and not (pg_temp.ctx('done1')::jsonb->>'immutable')::boolean, 'complete: ready, current, working copy (source not approved)');
select pg_temp.ok((public.pdf_cache_complete((pg_temp.ctx('claim1')::jsonb->>'file_id')::uuid, pg_temp.sha('other-bytes'), 1000)->>'reason') = 'already_stored',
  'a second complete with a different sha256 is refused (stored bytes are never replaced)');

-- ---------------------------------------------------------------- 3. repeat: no regeneration
select pg_temp.ok((pg_temp.look('tyre_inspection', pg_temp.ctx('ins_ksa_pending'))->>'state') = 'ready', 'repeat lookup: ready');
select pg_temp.ok((pg_temp.look('tyre_inspection', pg_temp.ctx('ins_ksa_pending'))->'file'->>'sha256') = pg_temp.sha('pdf-1'), 'repeat lookup returns the stored sha256');
select pg_temp.ok((pg_temp.claim('tyre_inspection', pg_temp.ctx('ins_ksa_pending'))->>'state') = 'ready', 'repeat claim: ready, nothing to generate');
select pg_temp.ok((select count(*) from public.report_pdf_files where source_id = pg_temp.ctx('ins_ksa_pending')::uuid) = 1, 'still one stored row');
select pg_temp.ok((select count(*) from storage.objects where bucket_id = 'report-pdfs') = 1, 'storage: the owner reads the stored object');
select pg_temp.ok((public.pdf_cache_record_download((pg_temp.ctx('claim1')::jsonb->>'file_id')::uuid, 'single')->>'ok')::boolean, 'download audited');
-- another reader in scope (site-restricted tyre man, own site) reads row and object
reset role; select pg_temp.login('alpha.tyreman@staging.tyrepulse.invalid'); set local role authenticated;
select pg_temp.ok((pg_temp.look('tyre_inspection', pg_temp.ctx('ins_ksa_pending'))->>'state') = 'ready', 'tyre man, own site: ready');
select pg_temp.ok((select count(*) from storage.objects where bucket_id = 'report-pdfs') = 1, 'tyre man, own site: can read the object');

-- ---------------------------------------------------------------- 4. wrong site / country / organisation / role
select pg_temp.ok((pg_temp.look('tyre_inspection', pg_temp.ctx('ins_ksa_other_site'))->>'reason') = 'not_available', 'wrong site: lookup refused');
select pg_temp.ok((pg_temp.claim('tyre_inspection', pg_temp.ctx('ins_ksa_other_site'))->>'reason') = 'not_available', 'wrong site: claim refused');
select pg_temp.ok((pg_temp.look('tyre_inspection', pg_temp.ctx('ins_uae'))->>'reason') = 'not_available', 'wrong country: lookup refused');
select pg_temp.ok((public.pdf_cache_regenerate('tyre_inspection', pg_temp.ctx('ins_ksa_pending')::uuid, 'tpl-test', 'b-test', '', null, null, 180)->>'reason') = 'not_allowed',
  'tyre man cannot regenerate (wrong role)');
select pg_temp.ok((pg_temp.look('tyre_inspection', gen_random_uuid()::text)->>'reason') = 'not_available', 'unknown id answers the same as a refusal');
reset role; select pg_temp.login('alpha.inspector@staging.tyrepulse.invalid'); set local role authenticated;   -- Egypt only
select pg_temp.ok((pg_temp.look('tyre_inspection', pg_temp.ctx('ins_ksa_pending'))->>'reason') = 'not_available', 'Egypt-only user: KSA lookup refused');
select pg_temp.ok((select count(*) from public.report_pdf_files) = 0, 'Egypt-only user: no KSA row visible');
select pg_temp.ok((select count(*) from storage.objects where bucket_id = 'report-pdfs') = 0, 'Egypt-only user: no KSA object visible');
select pg_temp.ok((public.pdf_cache_record_download((pg_temp.ctx('claim1')::jsonb->>'file_id')::uuid, 'single')->>'reason') = 'not_available', 'Egypt-only user: download audit refused');
reset role; select pg_temp.login('beta.manager@staging.tyrepulse.invalid'); set local role authenticated;
select pg_temp.ok((pg_temp.look('tyre_inspection', pg_temp.ctx('ins_ksa_pending'))->>'reason') = 'not_available', 'other organisation: lookup refused');
select pg_temp.ok((pg_temp.claim('tyre_inspection', pg_temp.ctx('ins_ksa_pending'))->>'reason') = 'not_available', 'other organisation: claim refused');
select pg_temp.ok((select count(*) from public.report_pdf_files) = 0 and (select count(*) from public.report_pdf_events) = 0, 'other organisation: no rows visible');
select pg_temp.ok((select count(*) from storage.objects where bucket_id = 'report-pdfs') = 0, 'other organisation: object not readable (no cross-organisation path access)');
do $$ begin
  perform pg_temp.upload(pg_temp.ctx('claim1')::jsonb->>'path');
  raise exception 'FAIL: other organisation overwrote a stored path';
exception when insufficient_privilege then perform pg_temp.ok(true, 'other organisation: cannot write to the path');
end $$;
select pg_temp.ok((public.pdf_cache_complete((pg_temp.ctx('claim1')::jsonb->>'file_id')::uuid, pg_temp.sha('x'), 1000)->>'reason') = 'not_available', 'other organisation: complete refused');
select pg_temp.ok((public.pdf_cache_heartbeat((pg_temp.ctx('claim1')::jsonb->>'file_id')::uuid, 180)->>'ok')::boolean = false, 'other organisation: heartbeat refused');
-- Beta works normally on its own record, and Alpha cannot see it
select pg_temp.ok((pg_temp.claim('tyre_inspection', pg_temp.ctx('ins_beta'))->>'state') = 'claimed', 'Beta can generate its own report');
reset role; select pg_temp.login('alpha.admin@staging.tyrepulse.invalid'); set local role authenticated;
select pg_temp.ok((select count(*) from public.report_pdf_files where source_id = pg_temp.ctx('ins_beta')::uuid) = 0, 'Alpha admin cannot see the Beta job');

-- ---------------------------------------------------------------- 5. ready rows are frozen
reset role;
do $$ begin
  update public.report_pdf_files set sha256 = repeat('0', 64) where source_id = pg_temp.ctx('ins_ksa_pending')::uuid;
  raise exception 'FAIL: stored sha256 was changed';
exception when sqlstate 'PT409' then perform pg_temp.ok(true, 'ready row: sha256 cannot be changed, even by the table owner');
end $$;
do $$ begin
  update public.report_pdf_files set storage_path = storage_path || 'x' where source_id = pg_temp.ctx('ins_ksa_pending')::uuid;
  raise exception 'FAIL: stored path was changed';
exception when sqlstate 'PT409' then perform pg_temp.ok(true, 'ready row: path cannot be changed');
end $$;

-- ---------------------------------------------------------------- 6. the inspection changes -> new revision
set local session_replication_role = replica;
update public.inspections set notes = coalesce(notes, '') || ' Recheck pressure on steer axle.' where id = pg_temp.ctx('ins_ksa_pending')::uuid;
set local session_replication_role = origin;
select pg_temp.login('alpha.manager@staging.tyrepulse.invalid'); set local role authenticated;
insert into t_ctx select 'look2', pg_temp.look('tyre_inspection', pg_temp.ctx('ins_ksa_pending'))::text;
select pg_temp.ok((pg_temp.ctx('look2')::jsonb->>'state') = 'missing' and (pg_temp.ctx('look2')::jsonb->>'cache_key') <> (pg_temp.ctx('claim1')::jsonb->>'cache_key'),
  'inspection edited: key changed, current revision missing');
select pg_temp.ok((pg_temp.ctx('look2')::jsonb->'previous'->>'sha256') = pg_temp.sha('pdf-1'), 'the old copy is offered as PREVIOUS, not as current');
insert into t_ctx select 'claim2', pg_temp.claim('tyre_inspection', pg_temp.ctx('ins_ksa_pending'))::text;
select pg_temp.upload(pg_temp.ctx('claim2')::jsonb->>'path', 1200);
select pg_temp.ok((public.pdf_cache_complete((pg_temp.ctx('claim2')::jsonb->>'file_id')::uuid, pg_temp.sha('pdf-2'), 1200)->>'state') = 'ready', 'new revision stored');
select pg_temp.ok((select superseded_by::text from public.report_pdf_files where id = (pg_temp.ctx('claim1')::jsonb->>'file_id')::uuid) = (pg_temp.ctx('claim2')::jsonb->>'file_id')
  and (select sha256 from public.report_pdf_files where id = (pg_temp.ctx('claim1')::jsonb->>'file_id')::uuid) = pg_temp.sha('pdf-1'),
  'old revision kept, marked superseded by the new one, bytes untouched');
select pg_temp.ok((pg_temp.look('tyre_inspection', pg_temp.ctx('ins_ksa_pending'))->'file'->>'sha256') = pg_temp.sha('pdf-2'), 'lookup now returns the new revision');

-- ---------------------------------------------------------------- 7. approved source -> immutable revision, preserved
insert into t_ctx select 'claimA', pg_temp.claim('tyre_inspection', pg_temp.ctx('ins_ksa_approved'))::text;
select pg_temp.upload(pg_temp.ctx('claimA')::jsonb->>'path', 2000);
select pg_temp.ok((public.pdf_cache_complete((pg_temp.ctx('claimA')::jsonb->>'file_id')::uuid, pg_temp.sha('approved-1'), 2000)->>'immutable')::boolean, 'approved inspection: stored revision is immutable');
select pg_temp.ok((public.pdf_cache_regenerate('tyre_inspection', pg_temp.ctx('ins_ksa_approved')::uuid, 'tpl-test', 'b-test', '', null, 'looks wrong', 180)->>'reason') = 'approved_needs_admin',
  'manager cannot replace an approved revision');
reset role;
do $$ begin
  delete from public.report_pdf_files where id = (pg_temp.ctx('claimA')::jsonb->>'file_id')::uuid;
  raise exception 'FAIL: an approved revision was removed';
exception when sqlstate 'PT409' then perform pg_temp.ok(true, 'approved revision cannot be removed');
end $$;
select pg_temp.login('alpha.admin@staging.tyrepulse.invalid'); set local role authenticated;
select pg_temp.ok((public.pdf_cache_regenerate('tyre_inspection', pg_temp.ctx('ins_ksa_approved')::uuid, 'tpl-test', 'b-test', '', null, null, 180)->>'reason') = 'reason_required',
  'admin must give a reason to replace an approved revision');
insert into t_ctx select 'regenA', public.pdf_cache_regenerate('tyre_inspection', pg_temp.ctx('ins_ksa_approved')::uuid, 'tpl-test', 'b-test', '', null, 'Logo was missing on the first copy', 180)::text;
select pg_temp.ok((pg_temp.ctx('regenA')::jsonb->>'state') = 'claimed' and (pg_temp.ctx('regenA')::jsonb->>'generation')::int = 2
  and (pg_temp.ctx('regenA')::jsonb->>'path') like '%.g2.pdf', 'admin regenerate: generation 2 on its own path');
select pg_temp.upload(pg_temp.ctx('regenA')::jsonb->>'path', 2100);
select pg_temp.ok((public.pdf_cache_complete((pg_temp.ctx('regenA')::jsonb->>'file_id')::uuid, pg_temp.sha('approved-2'), 2100)->>'state') = 'ready', 'regenerated copy stored');
select pg_temp.ok((select count(*) from public.report_pdf_files where source_id = pg_temp.ctx('ins_ksa_approved')::uuid and status = 'ready' and immutable) = 2
  and (select sha256 from public.report_pdf_files where id = (pg_temp.ctx('claimA')::jsonb->>'file_id')::uuid) = pg_temp.sha('approved-1')
  and (select superseded_at is not null from public.report_pdf_files where id = (pg_temp.ctx('claimA')::jsonb->>'file_id')::uuid),
  'first approved revision preserved byte for byte as a previous version');
-- the approved record itself changes later (for example a correction): a new revision, the old one stays
reset role; set local session_replication_role = replica;
update public.inspections set findings = coalesce(findings, '') || ' Correction noted.' where id = pg_temp.ctx('ins_ksa_approved')::uuid;
set local session_replication_role = origin;
select pg_temp.login('alpha.admin@staging.tyrepulse.invalid'); set local role authenticated;
insert into t_ctx select 'claimA3', pg_temp.claim('tyre_inspection', pg_temp.ctx('ins_ksa_approved'))::text;
select pg_temp.upload(pg_temp.ctx('claimA3')::jsonb->>'path', 2200);
select pg_temp.ok((public.pdf_cache_complete((pg_temp.ctx('claimA3')::jsonb->>'file_id')::uuid, pg_temp.sha('approved-3'), 2200)->>'state') = 'ready', 'changed approved record: new revision');
select pg_temp.ok((select count(*) from public.report_pdf_files where source_id = pg_temp.ctx('ins_ksa_approved')::uuid and status = 'ready') = 3
  and (select count(*) from public.report_pdf_files where source_id = pg_temp.ctx('ins_ksa_approved')::uuid and status = 'ready' and superseded_at is null) = 1,
  'three stored revisions, exactly one current');

-- ---------------------------------------------------------------- 8. observation vs inspection independence
insert into t_ctx select 'k_ins_0', pg_temp.look('tyre_inspection', pg_temp.ctx('ins_ksa_obs'))->>'cache_key';
insert into t_ctx select 'k_obs_0', pg_temp.look('tyre_observation', pg_temp.ctx('ins_ksa_obs'))->>'cache_key';
select pg_temp.ok(pg_temp.ctx('k_ins_0') <> pg_temp.ctx('k_obs_0'), 'inspection and observation have different keys for the same record');
-- a corrective action is raised from the inspection, then confirmed against an ERP job card
reset role;
insert into public.corrective_actions (id, organisation_id, country, site, title, priority, status, asset_no, source_type, source_id, source_detail)
select '99999999-0000-4000-8000-000000000001', i.organisation_id, i.country, i.site, 'Synthetic action', 'High', 'Open', i.asset_no, 'inspection', i.id, 'damage:LHF1'
  from public.inspections i where i.id = pg_temp.ctx('ins_ksa_obs')::uuid;
select pg_temp.login('alpha.admin@staging.tyrepulse.invalid'); set local role authenticated;
insert into t_ctx select 'k_ins_1', pg_temp.look('tyre_inspection', pg_temp.ctx('ins_ksa_obs'))->>'cache_key';
insert into t_ctx select 'k_obs_1', pg_temp.look('tyre_observation', pg_temp.ctx('ins_ksa_obs'))->>'cache_key';
select pg_temp.ok(pg_temp.ctx('k_ins_1') = pg_temp.ctx('k_ins_0'), 'action raised: inspection key unchanged');
select pg_temp.ok(pg_temp.ctx('k_obs_1') <> pg_temp.ctx('k_obs_0'), 'action raised: observation key changed');
reset role;
insert into public.observation_erp_links (organisation_id, country, action_id, work_order_id, source_job_card, work_order_snapshot, decision_note, reviewed_by)
select a.organisation_id, a.country, a.id, (select w.id from public.work_orders w where w.organisation_id = a.organisation_id limit 1),
       'SYN/JC/0001', '{"status":"Completed"}'::jsonb, 'Synthetic confirmation for the test', (select id from public.profiles where email = 'alpha.admin@staging.tyrepulse.invalid')
  from public.corrective_actions a where a.id = '99999999-0000-4000-8000-000000000001';
select pg_temp.login('alpha.admin@staging.tyrepulse.invalid'); set local role authenticated;
insert into t_ctx select 'k_ins_2', pg_temp.look('tyre_inspection', pg_temp.ctx('ins_ksa_obs'))->>'cache_key';
insert into t_ctx select 'k_obs_2', pg_temp.look('tyre_observation', pg_temp.ctx('ins_ksa_obs'))->>'cache_key';
select pg_temp.ok(pg_temp.ctx('k_ins_2') = pg_temp.ctx('k_ins_0'), 'ERP confirmation: inspection key unchanged');
select pg_temp.ok(pg_temp.ctx('k_obs_2') <> pg_temp.ctx('k_obs_1'), 'ERP confirmation: observation key changed');

-- ---------------------------------------------------------------- 9. branding, client revision, template, photos
select pg_temp.ok((pg_temp.look('tyre_inspection', pg_temp.ctx('ins_ksa_obs'), 'b-other')->>'cache_key') <> pg_temp.ctx('k_ins_0'), 'branding change: new key');
select pg_temp.ok((pg_temp.look('tyre_observation', pg_temp.ctx('ins_ksa_obs'), 'b-test', 'c-abc')->>'cache_key') <> pg_temp.ctx('k_obs_2'), 'client-derived content change: new key');
select pg_temp.ok((public.pdf_cache_lookup('tyre_inspection', pg_temp.ctx('ins_ksa_obs')::uuid, 'tpl-test-2', 'b-test', '')->>'cache_key') <> pg_temp.ctx('k_ins_0'), 'template version change: new key');
select pg_temp.ok((public.pdf_cache_lookup('tyre_inspection', pg_temp.ctx('ins_ksa_obs')::uuid, '', 'b-test', '')->>'reason') = 'bad_request', 'empty template refused');
reset role; set local session_replication_role = replica;
update public.inspections set tyre_conditions = jsonb_set(coalesce(tyre_conditions, '{}'::jsonb), '{LHF1}',
  coalesce(tyre_conditions->'LHF1', '{}'::jsonb) || '{"photo_url":"tp-storage://tyre-photos/synthetic/org/lhf1.jpg"}'::jsonb)
 where id = pg_temp.ctx('ins_ksa_obs')::uuid;
set local session_replication_role = origin;
select pg_temp.login('alpha.admin@staging.tyrepulse.invalid'); set local role authenticated;
insert into t_ctx select 'k_ins_3', pg_temp.look('tyre_inspection', pg_temp.ctx('ins_ksa_obs'))->>'cache_key';
select pg_temp.ok(pg_temp.ctx('k_ins_3') <> pg_temp.ctx('k_ins_0'), 'photo added: new key');
reset role;
insert into storage.objects (bucket_id, name, metadata) values ('tyre-photos', 'synthetic/org/lhf1.jpg', '{"eTag":"v1","size":10}');
select pg_temp.login('alpha.admin@staging.tyrepulse.invalid'); set local role authenticated;
insert into t_ctx select 'k_ins_4', pg_temp.look('tyre_inspection', pg_temp.ctx('ins_ksa_obs'))->>'cache_key';
reset role;
update storage.objects set metadata = '{"eTag":"v2","size":12}' where bucket_id = 'tyre-photos' and name = 'synthetic/org/lhf1.jpg';
select pg_temp.login('alpha.admin@staging.tyrepulse.invalid'); set local role authenticated;
select pg_temp.ok(pg_temp.ctx('k_ins_4') <> pg_temp.ctx('k_ins_3')
  and (pg_temp.look('tyre_inspection', pg_temp.ctx('ins_ksa_obs'))->>'cache_key') <> pg_temp.ctx('k_ins_4'),
  'photo replaced under the same reference: new key');

-- ---------------------------------------------------------------- 10. failure, backoff, bounds, manual retry
insert into t_ctx select 'claimF', pg_temp.claim('tyre_inspection', pg_temp.ctx('ins_ksa_other_site'))::text;
insert into t_ctx select 'fail1', public.pdf_cache_fail((pg_temp.ctx('claimF')::jsonb->>'file_id')::uuid, 'generator_error', true, true)::text;
select pg_temp.ok((pg_temp.ctx('fail1')::jsonb->>'state') = 'retry_scheduled' and (pg_temp.ctx('fail1')::jsonb->>'attempts')::int = 1
  and (pg_temp.ctx('fail1')::jsonb->>'next_retry_at')::timestamptz between now() + interval '29 seconds' and now() + interval '31 seconds',
  'first failure: retry in 30 seconds');
select pg_temp.ok((pg_temp.claim('tyre_inspection', pg_temp.ctx('ins_ksa_other_site'))->>'state') = 'retry_scheduled', 'backoff respected by a background claim');
select pg_temp.ok((pg_temp.claim('tyre_inspection', pg_temp.ctx('ins_ksa_other_site'), true)->>'state') = 'claimed', 'a person pressing Retry may claim during backoff');
insert into t_ctx select 'fail2', public.pdf_cache_fail((pg_temp.ctx('claimF')::jsonb->>'file_id')::uuid, 'e', true, true)::text;
select pg_temp.ok((pg_temp.ctx('fail2')::jsonb->>'next_retry_at')::timestamptz
  between now() + interval '59 seconds' and now() + interval '61 seconds', 'second failure: retry in 1 minute (exponential)');
do $$
declare r jsonb; i int;
begin
  for i in 3..5 loop
    r := pg_temp.claim('tyre_inspection', pg_temp.ctx('ins_ksa_other_site'), true);
    r := public.pdf_cache_fail((r->>'file_id')::uuid, 'e', true, true);
  end loop;
  perform pg_temp.ok(r->>'state' = 'failed' and (r->>'attempts')::int = 5, 'fifth failure: failed (retries are bounded)');
end $$;
select pg_temp.ok((pg_temp.look('tyre_inspection', pg_temp.ctx('ins_ksa_other_site'))->>'state') = 'failed', 'lookup: failed');
select pg_temp.ok((pg_temp.claim('tyre_inspection', pg_temp.ctx('ins_ksa_other_site'))->>'state') = 'failed', 'a failed job is not restarted automatically');
insert into t_ctx select 'claimF2', pg_temp.claim('tyre_inspection', pg_temp.ctx('ins_ksa_other_site'), true)::text;
select pg_temp.ok((pg_temp.ctx('claimF2')::jsonb->>'state') = 'claimed' and (pg_temp.ctx('claimF2')::jsonb->>'attempts')::int = 0, 'manual Retry starts a fresh bounded series');
-- released without blame (evidence incomplete): back to queued, attempt not counted
select pg_temp.ok((public.pdf_cache_fail((pg_temp.ctx('claimF2')::jsonb->>'file_id')::uuid, 'evidence_incomplete', true, false)->>'state') = 'queued', 'release: queued, attempt not counted');

-- ---------------------------------------------------------------- 11. lease expiry recovery
insert into t_ctx select 'claimL', pg_temp.claim('tyre_inspection', pg_temp.ctx('ins_ksa_other_site'))::text;
reset role;
update public.report_pdf_files set lease_expires_at = now() - interval '1 minute' where id = (pg_temp.ctx('claimL')::jsonb->>'file_id')::uuid;
select pg_temp.login('alpha.manager@staging.tyrepulse.invalid'); set local role authenticated;
select pg_temp.ok((pg_temp.look('tyre_inspection', pg_temp.ctx('ins_ksa_other_site'))->>'state') = 'queued', 'expired lease reads as queued');
insert into t_ctx select 'claimL2', pg_temp.claim('tyre_inspection', pg_temp.ctx('ins_ksa_other_site'))::text;
select pg_temp.ok((pg_temp.ctx('claimL2')::jsonb->>'state') = 'claimed' and (pg_temp.ctx('claimL2')::jsonb->>'attempts')::int = 1, 'another person takes over an abandoned job; the lost attempt is counted');
reset role; select pg_temp.login('alpha.admin@staging.tyrepulse.invalid'); set local role authenticated;
select pg_temp.ok((public.pdf_cache_complete((pg_temp.ctx('claimL')::jsonb->>'file_id')::uuid, pg_temp.sha('late'), 1000)->>'reason') = 'not_your_job', 'the original generator, returning late, cannot complete');
reset role; select pg_temp.login('alpha.manager@staging.tyrepulse.invalid'); set local role authenticated;
select pg_temp.upload(pg_temp.ctx('claimL2')::jsonb->>'path', 900);
select pg_temp.ok((public.pdf_cache_complete((pg_temp.ctx('claimL2')::jsonb->>'file_id')::uuid, pg_temp.sha('recovered'), 900)->>'state') = 'ready', 'recovered job completes');

-- ---------------------------------------------------------------- 12. manager regenerate of a working copy
insert into t_ctx select 'regenW', public.pdf_cache_regenerate('tyre_inspection', pg_temp.ctx('ins_ksa_pending')::uuid, 'tpl-test', 'b-test', '', null, null, 180)::text;
select pg_temp.ok((pg_temp.ctx('regenW')::jsonb->>'state') = 'claimed' and (pg_temp.ctx('regenW')::jsonb->>'generation')::int = 2, 'manager regenerates a working copy: generation 2');
select pg_temp.ok((select count(*) from public.report_pdf_files where id = (pg_temp.ctx('claim2')::jsonb->>'file_id')::uuid and status = 'ready' and superseded_at is not null) = 1,
  'the copy it replaces is kept');

-- ---------------------------------------------------------------- 13. corrective action and job card types resolve
select pg_temp.ok((pg_temp.look('corrective_action', '99999999-0000-4000-8000-000000000001')->>'state') = 'missing', 'corrective action report type resolves');
select pg_temp.ok((pg_temp.look('maintenance_job_card', (select id::text from public.work_orders where country = 'KSA' limit 1))->>'state') = 'missing', 'job card report type resolves');
select pg_temp.ok((pg_temp.look('unknown_type', pg_temp.ctx('ins_ksa_obs'))->>'reason') = 'bad_request', 'unknown report type refused');

-- ---------------------------------------------------------------- 14. audit
reset role;
select pg_temp.ok((select count(*) from public.report_pdf_events where event = 'claimed') >= 5
  and (select count(*) from public.report_pdf_events where event = 'generated') = 6
  and (select count(*) from public.report_pdf_events where event = 'superseded') >= 2
  and (select count(*) from public.report_pdf_events where event = 'downloaded') = 1
  and (select count(*) from public.report_pdf_events where event = 'retry_scheduled') = 4
  and (select count(*) from public.report_pdf_events where event = 'failed') = 1
  and (select count(*) from public.report_pdf_events where event = 'manual_retry') >= 1
  and (select count(*) from public.report_pdf_events where event = 'lease_recovered') = 1
  and (select count(*) from public.report_pdf_events where event = 'released') = 1
  and (select count(*) from public.report_pdf_events where event = 'regenerate_requested') = 2
  and (select count(*) from public.report_pdf_events where actor is null) = 0,
  'audit: every generation and download event is recorded with its actor');
select pg_temp.login('alpha.tyreman@staging.tyrepulse.invalid'); set local role authenticated;
select pg_temp.ok((select count(*) from public.report_pdf_events) = 0, 'audit events are readable by managers and administrators only');

-- ---------------------------------------------------------------- 15. auto queue
reset role;
select pg_temp.ok((select count(*) from public.report_pdf_queue) = 0, 'queue empty before');
select pg_temp.login('alpha.admin@staging.tyrepulse.invalid');
update public.inspections set approval_status = 'approved', status = 'Done' where id = pg_temp.ctx('ins_ksa_queue')::uuid;
select pg_temp.ok((select count(*) from public.report_pdf_queue where source_id = pg_temp.ctx('ins_ksa_queue')::uuid and reason = 'approved' and done_at is null) = 1,
  'approving an inspection queues its report');
update public.inspections set notes = coalesce(notes, '') || ' x' where id = pg_temp.ctx('ins_ksa_queue')::uuid;
select pg_temp.ok((select count(*) from public.report_pdf_queue where source_id = pg_temp.ctx('ins_ksa_queue')::uuid) = 1, 'a later edit does not queue it twice');
set local role authenticated;
select pg_temp.ok(public.pdf_cache_pending('tyre_inspection', 5) @> jsonb_build_array(jsonb_build_object('source_id', pg_temp.ctx('ins_ksa_queue'))), 'an authorised browser sees the request');
reset role; select pg_temp.login('beta.manager@staging.tyrepulse.invalid'); set local role authenticated;
select pg_temp.ok(public.pdf_cache_pending('tyre_inspection', 5) = '[]'::jsonb, 'another organisation does not see it');
reset role; select pg_temp.login('alpha.admin@staging.tyrepulse.invalid'); set local role authenticated;
select pg_temp.ok((public.pdf_cache_queue_done('tyre_inspection', pg_temp.ctx('ins_ksa_queue')::uuid)->>'closed')::int = 0, 'a request cannot be closed before the report is stored');
insert into t_ctx select 'claimQ', pg_temp.claim('tyre_inspection', pg_temp.ctx('ins_ksa_queue'))::text;
select pg_temp.ok(public.pdf_cache_pending('tyre_inspection', 5) = '[]'::jsonb, 'a request being generated is not offered again');
select pg_temp.upload(pg_temp.ctx('claimQ')::jsonb->>'path', 800);
select pg_temp.ok((public.pdf_cache_complete((pg_temp.ctx('claimQ')::jsonb->>'file_id')::uuid, pg_temp.sha('queued'), 800)->>'immutable')::boolean, 'queued report stored as an approved revision');
select pg_temp.ok((public.pdf_cache_queue_done('tyre_inspection', pg_temp.ctx('ins_ksa_queue')::uuid)->>'closed')::int = 1, 'request closed once stored');

reset role;
select count(*) || ' checks passed' as result from t_pass;
rollback;
