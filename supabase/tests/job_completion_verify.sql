do $verify$
declare
  c_org uuid := '00000000-0000-0000-0000-000000000001';
  c_mech uuid := '82072ee6-2e1f-4fc3-9158-6afcfb1a4e04';
  c_mech2 uuid := '9394e53f-cec7-453f-9c1d-02733ef97a53';
  c_helper uuid := 'cdd86ce1-3eea-4996-8d82-3d5801c542ec';
  c_sup uuid := '27ad28d7-f04e-43b1-955a-596bc351f1f3';
  c_sup2 uuid := '35e1995d-7e07-458b-846a-0a6b8d6ee927';
  c_dmo uuid := '5640bf61-801c-4fb8-8654-21c99c921c14';
  v_job uuid; v_job2 uuid; v_job3 uuid; v_job4 uuid; v_taskA uuid; v_cid4 uuid;
  v_out text[] := '{}';
  v_r jsonb; v_t text; v_n int; v_cid uuid; v_cid3 uuid;
  v_sig text := 'data:image/png;base64,' || repeat('A', 60);
  v_ref text := 'tp-storage://tyre-photos/modules/workshop/82072ee6/zz_verify_1.jpg';
  v_ref2 text := 'tp-storage://tyre-photos/modules/workshop/9394e53f/zz_verify_2.jpg';
  v_payload jsonb;
begin
  -- fixtures (as postgres)
  insert into public.work_orders (work_order_no, asset_no, status, work_type, country, site, organisation_id)
  values ('ZZ-JC-VERIFY-1', 'TM514', 'In Progress', 'Repair', 'KSA', 'NHC', c_org) returning id into v_job;
  insert into public.work_orders (work_order_no, asset_no, status, work_type, country, site, organisation_id)
  values ('ZZ-JC-VERIFY-2', 'TM514', 'Completed', 'Repair', 'KSA', 'NHC', c_org) returning id into v_job2;
  insert into public.work_orders (work_order_no, asset_no, status, work_type, country, site, organisation_id)
  values ('ZZ-JC-VERIFY-3', 'TM515', 'In Progress', 'Repair', 'KSA', 'NHC', c_org) returning id into v_job3;
  insert into public.work_orders (work_order_no, asset_no, status, work_type, country, site, organisation_id)
  values ('ZZ-JC-VERIFY-4', 'TM514', 'In Progress', 'Repair', 'KSA', 'NHC', c_org) returning id into v_job4;
  insert into public.wo_tasks (organisation_id, country, site, job_id, seq, title, status, assignee_user_id)
  values (c_org, 'KSA', 'NHC', v_job4, 1, 'ZZ task A', 'in_progress', c_mech) returning id into v_taskA;
  insert into public.wo_tasks (organisation_id, country, site, job_id, seq, title, status, assignee_user_id)
  values (c_org, 'KSA', 'NHC', v_job4, 2, 'ZZ task B', 'pending', c_mech2);
  insert into public.wo_assignments (organisation_id, country, site, job_id, user_id, role, active, assigned_at)
  values (c_org, 'KSA', 'NHC', v_job4, c_mech, 'primary', true, now() - interval '1 day');
  insert into public.wo_assignments (organisation_id, country, site, job_id, user_id, role, active, assigned_at)
  values (c_org, 'KSA', 'NHC', v_job, c_mech, 'primary', true, now() - interval '1 day'),
         (c_org, 'KSA', 'NHC', v_job, c_mech2, 'helper', true, now() - interval '1 day'),
         (c_org, 'KSA', 'NHC', v_job2, c_mech, 'primary', true, now() - interval '1 day'),
         (c_org, 'KSA', 'NHC', v_job3, c_mech, 'primary', true, now() - interval '1 day'),
         (c_org, 'KSA', 'NHC', v_job3, c_sup2, 'helper', true, now() - interval '1 day');
  insert into storage.objects (bucket_id, name, owner) values
    ('tyre-photos', 'modules/workshop/82072ee6/zz_verify_1.jpg', c_mech),
    ('tyre-photos', 'modules/workshop/9394e53f/zz_verify_2.jpg', c_mech2);

  v_payload := jsonb_build_object('client_uuid', 'jobdone_zzverify01', 'job_id', v_job,
    'work_done', 'Replaced the brake pads', 'quick_picks', jsonb_build_array('replaced'),
    'parts_used', jsonb_build_array(jsonb_build_object('name', 'Brake pad', 'qty', 2)),
    'after_photos', jsonb_build_array(v_ref), 'before_photos', '[]'::jsonb,
    'km', 123456, 'engine_hours', 4321, 'signature', v_sig,
    'country', 'UAE', 'site', 'FAKE');

  -- 1. mechanic submits
  perform set_config('request.jwt.claims', json_build_object('sub', c_mech, 'role', 'authenticated')::text, true);
  set local role authenticated;
  v_r := public.submit_job_completion(v_payload);
  v_out := v_out || ('01 mech submit: ' || v_r::text);
  v_r := public.submit_job_completion(v_payload);
  v_out := v_out || ('02 same key again: ' || v_r::text);
  v_r := public.submit_job_completion(v_payload || jsonb_build_object('client_uuid', 'jobdone_zzverify02', 'after_photos', jsonb_build_array(v_ref2)));
  v_out := v_out || ('03 photo owned by someone else: ' || v_r::text);
  v_r := public.submit_job_completion(v_payload || jsonb_build_object('client_uuid', 'jobdone_zzverify03', 'job_id', 'not-a-uuid'));
  v_out := v_out || ('04 bad job id: ' || v_r::text);
  v_r := public.submit_job_completion(v_payload || jsonb_build_object('client_uuid', 'jobdone_zzverify04', 'after_photos', '"x"'::jsonb));
  v_out := v_out || ('05 non-array photos: ' || v_r::text);
  v_r := public.submit_job_completion(v_payload || jsonb_build_object('client_uuid', 'jobdone_zzverify05', 'job_id', v_job2));
  v_out := v_out || ('06 job closed meanwhile: ' || v_r::text);
  begin
    update public.work_orders set qc_status = 'passed' where id = v_job;
    v_out := v_out || '07 mech sets qc directly: NOT BLOCKED';
  exception when others then
    v_out := v_out || ('07 mech sets qc directly: ' || sqlstate || ' ' || sqlerrm);
  end;
  select count(*) into v_n from public.work_order_completions where job_id = v_job;
  v_out := v_out || ('08 mech sees own completions: ' || v_n);
  reset role;

  select status || ' / qc=' || coalesce(qc_status, 'null') into v_t from public.work_orders where id = v_job;
  v_out := v_out || ('09 job after submit: ' || v_t);
  select country || '/' || site || '/' || kind into v_t from public.work_order_completions where client_uuid = 'jobdone_zzverify01';
  v_out := v_out || ('10 completion country/site/kind (payload said UAE/FAKE): ' || v_t);
  select count(*) into v_n from public.odometer_logs where client_uuid = 'jobdone_zzverify01_km' and source = 'job_completion';
  v_out := v_out || ('11 odometer rows: ' || v_n);
  select count(*) into v_n from public.engine_hours_logs where client_uuid = 'jobdone_zzverify01_hrs';
  v_out := v_out || ('12 hours rows: ' || v_n);
  select count(*) into v_n from public.notifications where entity_id = v_job and title = 'Job ready to check';
  v_out := v_out || ('13 supervisors notified: ' || v_n);
  select count(*) into v_n from public.notifications n join public.profiles p on p.id = n.user_id
   where n.entity_id = v_job and n.title = 'Job ready to check'
     and p.role = any (public._job_completion_return_desk_roles());
  v_out := v_out || ('13b data desk among them: ' || v_n);
  select jsonb_array_length(evidence_objects)::text || ' ' || coalesce(evidence_objects->0->>'object_id', 'null') into v_t
    from public.work_order_completions where client_uuid = 'jobdone_zzverify01';
  v_out := v_out || ('13c evidence fingerprints: ' || v_t);

  -- 2. never-assigned helper
  perform set_config('request.jwt.claims', json_build_object('sub', c_helper, 'role', 'authenticated')::text, true);
  set local role authenticated;
  v_r := public.submit_job_completion(v_payload || jsonb_build_object('client_uuid', 'jobdone_zzverify06'));
  v_out := v_out || ('14 unassigned helper: ' || v_r::text);
  select count(*) into v_n from public.work_order_completions;
  v_out := v_out || ('15 helper sees completions: ' || v_n);
  reset role;

  -- 3. second assigned technician while in QI -> extra
  perform set_config('request.jwt.claims', json_build_object('sub', c_mech2, 'role', 'authenticated')::text, true);
  set local role authenticated;
  v_r := public.submit_job_completion(v_payload || jsonb_build_object('client_uuid', 'jobdone_zzverify01', 'after_photos', jsonb_build_array(v_ref2), 'km', null, 'engine_hours', null));
  v_out := v_out || ('16 second tech, same key text as tech 1: ' || v_r::text);
  reset role;
  select string_agg(kind, ',' order by created_at) into v_t from public.work_order_completions where job_id = v_job;
  v_out := v_out || ('17 kinds on job: ' || v_t);

  -- 4. supervisor
  select id into v_cid from public.work_order_completions where client_uuid = 'jobdone_zzverify01' and submitted_by = c_mech;
  perform set_config('request.jwt.claims', json_build_object('sub', c_sup, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into v_n from public.work_order_completions where job_id = v_job;
  v_out := v_out || ('18 supervisor sees: ' || v_n);
  v_r := public.decide_job_completion(v_cid, 'return', '', 'dec_zz_1');
  v_out := v_out || ('19 return without note: ' || v_r::text);
  reset role;
  -- technician tries to overwrite the photo after submit (storage policy)
  perform set_config('request.jwt.claims', json_build_object('sub', c_mech, 'role', 'authenticated')::text, true);
  set local role authenticated;
  with u as (update storage.objects set metadata = '{"eTag":"swap"}'::jsonb
              where bucket_id = 'tyre-photos' and name = 'modules/workshop/82072ee6/zz_verify_1.jpg' returning 1)
  select count(*) into v_n from u;
  v_out := v_out || ('19a technician overwrite after submit, rows changed: ' || v_n);
  begin
    delete from storage.objects where bucket_id = 'tyre-photos' and name = 'modules/workshop/82072ee6/zz_verify_1.jpg';
    get diagnostics v_n = row_count;
    v_out := v_out || ('19b technician delete, rows: ' || v_n);
  exception when others then
    v_out := v_out || ('19b technician delete: ' || sqlstate || ' ' || left(sqlerrm, 80));
  end;
  reset role;
  -- the object is changed behind the app (service role)
  update storage.objects set metadata = '{"eTag":"swap"}'::jsonb
   where bucket_id = 'tyre-photos' and name = 'modules/workshop/82072ee6/zz_verify_1.jpg';
  perform set_config('request.jwt.claims', json_build_object('sub', c_sup, 'role', 'authenticated')::text, true);
  set local role authenticated;
  v_r := public.decide_job_completion(v_cid, 'pass', null, 'dec_zz_1b');
  v_out := v_out || ('19c pass after the photo changed: ' || v_r::text);
  reset role;
  update public.work_order_completions c
     set evidence_objects = (select jsonb_agg(public._job_completion_photo_print(e->>'ref'))
                               from jsonb_array_elements(c.evidence_objects) e)
   where c.job_id = v_job and c.status = 'submitted';
  -- data desk cannot decide (RPC) nor write qc directly
  perform set_config('request.jwt.claims', json_build_object('sub', c_dmo, 'role', 'authenticated')::text, true);
  set local role authenticated;
  v_r := public.decide_job_completion(v_cid, 'pass', null, 'dec_zz_dmo');
  v_out := v_out || ('19d data desk decides: ' || v_r::text);
  begin
    update public.work_orders set qc_status = 'passed', status = 'Completed' where id = v_job;
    get diagnostics v_n = row_count;
    v_out := v_out || ('19e data desk direct pass: NOT BLOCKED rows=' || v_n);
  exception when others then
    v_out := v_out || ('19e data desk direct pass: ' || sqlstate || ' ' || left(sqlerrm, 90));
  end;
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', c_sup, 'role', 'authenticated')::text, true);
  set local role authenticated;
  v_r := public.decide_job_completion(v_cid, 'pass', null, 'dec_zz_2');
  v_out := v_out || ('20 pass: ' || v_r::text);
  v_r := public.decide_job_completion(v_cid, 'return', 'Again', 'dec_zz_3');
  v_out := v_out || ('21 decide again new key: ' || v_r::text);
  v_r := public.decide_job_completion(v_cid, 'pass', null, 'dec_zz_2');
  v_out := v_out || ('22 decide again same key: ' || v_r::text);
  reset role;
  select status || ' / qc=' || coalesce(qc_status, 'null') into v_t from public.work_orders where id = v_job;
  v_out := v_out || ('23 job after pass: ' || v_t);
  select string_agg(status, ',' order by created_at) into v_t from public.work_order_completions where job_id = v_job;
  v_out := v_out || ('24 completions after pass: ' || v_t);
  select count(*) into v_n from public.notifications where entity_id = v_job and title = 'Job approved' and user_id = c_mech;
  v_out := v_out || ('25 tech told approved: ' || v_n);

  -- 5. job 3: return flow, and supervisor assigned to the job cannot decide
  perform set_config('request.jwt.claims', json_build_object('sub', c_mech, 'role', 'authenticated')::text, true);
  set local role authenticated;
  v_r := public.submit_job_completion(v_payload || jsonb_build_object('client_uuid', 'jobdone_zzverify07', 'job_id', v_job3, 'km', null, 'engine_hours', null));
  v_out := v_out || ('26 mech submit job3: ' || v_r::text);
  reset role;
  select id into v_cid3 from public.work_order_completions where client_uuid = 'jobdone_zzverify07';
  perform set_config('request.jwt.claims', json_build_object('sub', c_sup2, 'role', 'authenticated')::text, true);
  set local role authenticated;
  v_r := public.decide_job_completion(v_cid3, 'pass', null, 'dec_zz_4');
  v_out := v_out || ('27 supervisor assigned to job3 decides: ' || v_r::text);
  begin
    update public.work_orders set qc_status = 'passed', status = 'Completed' where id = v_job3;
    v_out := v_out || '28 assigned supervisor direct web write: NOT BLOCKED';
  exception when others then
    v_out := v_out || ('28 assigned supervisor direct web write: ' || sqlstate || ' ' || sqlerrm);
  end;
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', c_sup, 'role', 'authenticated')::text, true);
  set local role authenticated;
  v_r := public.decide_job_completion(v_cid3, 'return', 'Brake still squeaks', 'dec_zz_5');
  v_out := v_out || ('29 return job3: ' || v_r::text);
  reset role;
  select status || ' / qc=' || coalesce(qc_status, 'null') into v_t from public.work_orders where id = v_job3;
  v_out := v_out || ('30 job3 after return: ' || v_t);
  select count(*) into v_n from public.wo_assignments where job_id = v_job3 and active;
  v_out := v_out || ('31 job3 active assignments kept (was 2): ' || v_n);
  select count(*) into v_n from public.notifications where entity_id = v_job3 and title = 'Returned job to reassign' and user_id = c_dmo;
  v_out := v_out || ('32 data monitor officer notified: ' || v_n);
  select count(*) into v_n from public.notifications where entity_id = v_job3 and title = 'Returned job to reassign';
  v_out := v_out || ('33 data desk notified total: ' || v_n);
  perform set_config('request.jwt.claims', json_build_object('sub', c_dmo, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*), max(decision_note) into v_n, v_t from public.work_order_completions where status = 'returned';
  v_out := v_out || ('34 DMO sees returned queue: ' || v_n || ' note=' || coalesce(v_t, 'null'));
  select count(*) into v_n from public.work_order_completions where status <> 'returned';
  v_out := v_out || ('35 DMO sees non-returned: ' || v_n);
  reset role;

  -- resubmit after the return: back to QI, qc cleared
  perform set_config('request.jwt.claims', json_build_object('sub', c_mech, 'role', 'authenticated')::text, true);
  set local role authenticated;
  v_r := public.submit_job_completion(v_payload || jsonb_build_object('client_uuid', 'jobdone_zzverify08', 'job_id', v_job3, 'km', null, 'engine_hours', null));
  v_out := v_out || ('35a resubmit job3: ' || v_r::text);
  reset role;
  select status || ' / qc=' || coalesce(qc_status, 'null') into v_t from public.work_orders where id = v_job3;
  v_out := v_out || ('35b job3 after resubmit: ' || v_t);

  -- job 4: one of two tasks done -> partial, job stays, nobody asked; km held
  perform set_config('request.jwt.claims', json_build_object('sub', c_mech, 'role', 'authenticated')::text, true);
  set local role authenticated;
  v_r := public.submit_job_completion(v_payload || jsonb_build_object('client_uuid', 'jobdone_zzverify09', 'job_id', v_job4,
           'task_id', v_taskA, 'km', 5000000, 'engine_hours', null));
  v_out := v_out || ('35c task A done, B open: ' || v_r::text);
  reset role;
  select c.kind || ' / job=' || w.status || ' / held=' || coalesce(c.meter_held::text, 'null'), c.id into v_t, v_cid4
    from public.work_order_completions c join public.work_orders w on w.id = c.job_id
   where c.client_uuid = 'jobdone_zzverify09';
  v_out := v_out || ('35d job4: ' || v_t);
  select count(*) into v_n from public.odometer_logs where client_uuid = 'jobdone_zzverify09_km';
  v_out := v_out || ('35e held km written to odometer_logs: ' || v_n);
  select count(*) into v_n from public.notifications where entity_id = v_job4 and title = 'Job ready to check';
  v_out := v_out || ('35f supervisors asked for job4: ' || v_n);
  perform set_config('request.jwt.claims', json_build_object('sub', c_sup, 'role', 'authenticated')::text, true);
  set local role authenticated;
  v_r := public.decide_job_completion(v_cid4, 'pass', null, 'dec_zz_6');
  v_out := v_out || ('35g pass with task B open: ' || v_r::text);
  reset role;

  -- 6. anon
  v_out := v_out || ('36 anon execute submit/decide: ' ||
    has_function_privilege('anon', 'public.submit_job_completion(jsonb)', 'execute')::text || '/' ||
    has_function_privilege('anon', 'public.decide_job_completion(uuid,text,text,text)', 'execute')::text);

  raise exception 'VERIFY RESULTS (rolled back): %', array_to_string(v_out, E'\n');
end
$verify$;
