-- Closure workflow behaviour tests. Local staging only, synthetic data, ONE transaction, rolled back.
-- Every check runs as a real signed-in person (role authenticated + JWT claims), and results are
-- confirmed with a privileged read in the same transaction.
\set ON_ERROR_STOP 1
\pset tuples_only on
begin;
create function pg_temp.try(p_user uuid, p_sql text) returns text language plpgsql as $$
declare r text; n bigint;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated', 'aal', 'aal1')::text, true);
  perform set_config('role', 'authenticated', true);
  begin
    if p_sql ~* '^\s*(select|with)\M' then execute p_sql into r;
    else execute p_sql; get diagnostics n = row_count; r := n::text; end if;
    perform set_config('role', 'postgres', true);
    perform set_config('request.jwt.claims', '', true);
    return 'ok:' || coalesce(r, '');
  exception when others then
    perform set_config('role', 'postgres', true);
    perform set_config('request.jwt.claims', '', true);
    return sqlstate || ':' || sqlerrm;
  end;
end $$;
create function pg_temp.ok(p_name text, p_cond boolean, p_detail text default null) returns text language sql as $$
  select case when p_cond is true then 'ok - ' || p_name else 'not ok - ' || p_name || coalesce(' [' || p_detail || ']', '') end;
$$;
-- people
\set coll   '''c1000000-0000-4000-8000-000000000001'''
\set coll2  '''c1000000-0000-4000-8000-000000000002'''
\set supn   '''c1000000-0000-4000-8000-000000000003'''
\set supe   '''c1000000-0000-4000-8000-000000000004'''
\set am     '''c1000000-0000-4000-8000-000000000005'''
\set bsup   '''c1000000-0000-4000-8000-000000000007'''
\set admin  '''af52a86f-2c24-5ce2-a00d-7ac6ca5d715f'''
\set mgr    '''63e831d7-f511-5432-976d-439af4ccaf18'''
\set eng    '''2092b3bc-43f1-5167-b49d-b1fd7dc47fd8'''
\set tman   '''88ffa1f3-b090-5725-b4d0-7b8fa6c0912c'''
\set dir    '''6076c150-f41e-5b29-94dc-4b455cb61868'''
\set bmgr   '''cb2ee8ae-520a-5a55-818e-7786a74bfda8'''
\set badmin '''9c149942-c3b2-54c6-a6e8-c34b2933bb3c'''
-- records
\set a1 '''c4000000-0000-4000-8000-000000000001'''
\set a2 '''c4000000-0000-4000-8000-000000000002'''
\set a3 '''c4000000-0000-4000-8000-000000000003'''
\set a4 '''c4000000-0000-4000-8000-000000000004'''
\set a5 '''c4000000-0000-4000-8000-000000000005'''
\set a6 '''c4000000-0000-4000-8000-000000000006'''
\set s1 '''c3000000-0000-4000-8000-000000000001'''
\set s2 '''c3000000-0000-4000-8000-000000000002'''
\set s3 '''c3000000-0000-4000-8000-000000000003'''
\set s5 '''c3000000-0000-4000-8000-000000000005'''
\set s6 '''c3000000-0000-4000-8000-000000000006'''
\set s7 '''c3000000-0000-4000-8000-000000000007'''
\set s8 '''c3000000-0000-4000-8000-000000000008'''

-- Each action runs as its own statement (\gset) before the check that reads its effect, because
-- SQL does not promise the order in which the parts of one AND are evaluated.
-- ============================== A. corrective action closure ==============================
select pg_temp.ok('A01 anon cannot execute any closure writer',
  not has_function_privilege('anon', 'public.corrective_action_review(uuid,text,text)', 'execute')
  and not has_function_privilege('anon', 'public.corrective_action_submit_completion(uuid,text,jsonb)', 'execute')
  and not has_function_privilege('anon', 'public.corrective_action_request_exception(uuid,text)', 'execute')
  and not has_function_privilege('anon', 'public.corrective_action_decide_exception(uuid,text,text)', 'execute')
  and to_regprocedure('public.corrective_action_record_exception(uuid,text)') is null
  and not has_function_privilege('anon', 'public.acknowledge_checklist_faults(uuid,text,text)', 'execute')
  and not has_function_privilege('anon', 'public.save_closure_review_config(jsonb)', 'execute')
  and not has_function_privilege('authenticated', 'public.closure_review_settings(uuid)', 'execute')
  and not has_function_privilege('authenticated', 'public.corrective_action_is_assignee(uuid,uuid)', 'execute'));

select pg_temp.try(:coll, $$with u as (update public.corrective_actions set status = 'Closed' where id = 'c4000000-0000-4000-8000-000000000001' returning 1) select count(*)::text from u$$) as t1 \gset
select pg_temp.ok('A02 worker cannot close directly (row policy matches no row)',
  :'t1' = 'ok:0'
  and (select status from public.corrective_actions where id = :a1) = 'Open');

select pg_temp.try(:coll, $$select public.corrective_action_my_permissions('c4000000-0000-4000-8000-000000000001')::text$$) as t2 \gset
select pg_temp.try(:coll, $$select public.corrective_action_my_permissions('c4000000-0000-4000-8000-000000000001')::text$$) as t3 \gset
select pg_temp.ok('A03 worker sees own permissions: may submit, may not review',
  (:'t2') ~ '"can_submit": true'
  and (:'t3') ~ '"can_review": false');

select pg_temp.ok('A03b never-submitted action: the assigned worker may ask for an exception (true, not null)',
  (:'t2') ~ '"can_request_exception": true');

select pg_temp.try(:coll, $$select public.corrective_action_submit_completion('c4000000-0000-4000-8000-000000000001', '  ')::text$$) as t4 \gset
select pg_temp.ok('A04 submission without a completion note is refused',
  left(:'t4', 5) = '22023');

select pg_temp.try(:mgr, $$select public.save_closure_review_config('{"ca_min_photos":1}')::text$$) as t5 \gset
select pg_temp.try(:admin, $$select public.save_closure_review_config('{"ca_min_photos":1}')::text$$) as t6 \gset
select pg_temp.ok('A05 only an administrator changes the review settings',
  left(:'t5', 5) = '42501'
  and left(:'t6', 3) = 'ok:');

select pg_temp.try(:coll, $$select public.corrective_action_submit_completion('c4000000-0000-4000-8000-000000000001', 'Tyre replaced and torqued')::text$$) as t7 \gset
select pg_temp.ok('A06 evidence required: no photograph refused when the company requires one',
  left(:'t7', 5) = '22023');

select pg_temp.try(:coll2, $$select public.corrective_action_submit_completion('c4000000-0000-4000-8000-000000000001', 'Tyre replaced', '["data:image/jpeg;base64,AAAA"]')::text$$) as t8 \gset
select pg_temp.try(:tman, $$select public.corrective_action_submit_completion('c4000000-0000-4000-8000-000000000001', 'Tyre replaced', '["data:image/jpeg;base64,AAAA"]')::text$$) as t9 \gset
select pg_temp.ok('A07 someone the action is not assigned to cannot submit it',
  left(:'t8', 5) = '42501'
  and left(:'t9', 5) = '42501');

select pg_temp.try(:coll, $$select public.corrective_action_submit_completion('c4000000-0000-4000-8000-000000000001', 'Tyre replaced and torqued', '["data:image/jpeg;base64,AAAA"]')::text$$) as t10 \gset
select pg_temp.ok('A08 assigned worker submits completion evidence',
  left(:'t10', 3) = 'ok:'
  and (select status = 'In Progress' and review_status = 'submitted' and submitted_by = :coll and closed_at is null
         from public.corrective_actions where id = :a1));

select pg_temp.ok('A09 submission event keeps evidence and the linked asset and tyre',
  (select count(*) = 1 from public.corrective_action_review_events
    where action_id = :a1 and event_type = 'submitted' and actor_id = :coll and actor_role = 'Tyre Data Collector'
      and jsonb_array_length(evidence) = 1 and linked->>'asset_no' = 'TM001' and linked->>'tyre_serial' = 'SYN-0001'));

select pg_temp.try(:coll, $$select public.corrective_action_submit_completion('c4000000-0000-4000-8000-000000000001', 'again again', '["x"]')::text$$) as t11 \gset
select pg_temp.ok('A10 second submission while waiting is refused (409, never 40001)',
  left(:'t11', 5) = 'PT409');

-- role x site x country x company matrix on the submitted action (KSA, ALPHA NORTH PLANT)
select pg_temp.ok('A11 matrix: ' || m.who || ' -> ' || m.expect,
  left(pg_temp.try(m.uid, $$select public.corrective_action_review('c4000000-0000-4000-8000-000000000001', 'approve', 'checked')::text$$), 5) = m.expect,
  m.who)
from (values
  ('Tyre Man (not a reviewer role)', :tman::uuid, '42501'),
  ('second Tyre Data Collector (not a reviewer role)', :coll2::uuid, '42501'),
  ('Director (not in the company list)', :dir::uuid, '42501'),
  ('Tyre Engineer scoped to another country', :eng::uuid, '42501'),
  ('Workshop Supervisor scoped to another site', :supe::uuid, '42501'),
  ('Manager of another company', :bmgr::uuid, '42501'),
  ('the submitter', :coll::uuid, '42501')) m(who, uid, expect);
select pg_temp.ok('A12 nothing was closed by the refused attempts',
  (select status = 'In Progress' and review_status = 'submitted' from public.corrective_actions where id = :a1));

select pg_temp.try(:supn, $$select public.corrective_action_review('c4000000-0000-4000-8000-000000000001', 'return', '')::text$$) as t12 \gset
select pg_temp.ok('A13 return needs a comment',
  left(:'t12', 5) = '22023');
select pg_temp.try(:supn, $$select public.corrective_action_review('c4000000-0000-4000-8000-000000000001', 'return', 'Photograph does not show the wheel nuts')::text$$) as t13 \gset
select pg_temp.ok('A14 site supervisor returns the action for correction with a comment',
  left(:'t13', 3) = 'ok:'
  and (select status = 'In Progress' and review_status = 'returned' and reviewed_by = :supn and review_comment like 'Photograph%'
         from public.corrective_actions where id = :a1));
select pg_temp.try(:coll, $$select public.corrective_action_worker_update('c4000000-0000-4000-8000-000000000001', 'Retook the photograph')::text$$) as t14 \gset
select pg_temp.try(:coll, $$select public.corrective_action_submit_completion('c4000000-0000-4000-8000-000000000001', 'Wheel nuts torqued, new photograph', '["data:image/jpeg;base64,BBBB"]')::text$$) as t15 \gset
select pg_temp.ok('A15 worker updates and resubmits after the return',
  left(:'t14', 3) = 'ok:'
  and left(:'t15', 3) = 'ok:');
select pg_temp.try(:supn, $$select public.corrective_action_review('c4000000-0000-4000-8000-000000000001', 'approve', 'Verified on the vehicle')::text$$) as t16 \gset
select pg_temp.ok('A16 reviewer approves closure: reviewer, time, comment recorded',
  left(:'t16', 3) = 'ok:'
  and (select status = 'Closed' and review_status = 'approved' and reviewed_by = :supn and closed_by = :supn
              and closed_at is not null and verified_by = :supn and submitted_by = :coll
         from public.corrective_actions where id = :a1));
select pg_temp.ok('A17 history holds the whole loop in order',
  (select string_agg(event_type, ',' order by id) from public.corrective_action_review_events where action_id = :a1)
    = 'submitted,returned,progress,submitted,approved');
select pg_temp.try(:mgr, $$select public.corrective_action_review('c4000000-0000-4000-8000-000000000001', 'approve', 'x')::text$$) as t17 \gset
select pg_temp.ok('A18 a decided action cannot be decided again',
  left(:'t17', 5) = 'PT409');
select pg_temp.ok('A19 Action Center mirror follows the approved closure',
  (select status = 'resolved' from public.action_items where source = 'corrective:c4000000-0000-4000-8000-000000000001'));

-- history is immutable for everyone
select pg_temp.try(:admin, $$with u as (update public.corrective_action_review_events set note = 'x' returning 1) select count(*)::text from u$$) as t18 \gset
select pg_temp.try(:admin, $$with u as (delete from public.corrective_action_review_events returning 1) select count(*)::text from u$$) as t19 \gset
select pg_temp.ok('A20 history rows cannot be changed or removed, even by the database owner',
  (select :'t18' like '42501%')
  and (select :'t19' like '42501%'));
do $$ begin
  begin update public.corrective_action_review_events set note = 'tamper'; raise exception 'owner update was allowed';
  exception when insufficient_privilege then null; end;
  begin delete from public.corrective_action_review_events; raise exception 'owner removal was allowed';
  exception when insufficient_privilege then null; end;
end $$;
select pg_temp.ok('A21 owner-level update and removal of history both refused', true);

-- self review
select pg_temp.try(:supn, $$select public.corrective_action_submit_completion('c4000000-0000-4000-8000-000000000006', 'Done by me', '["p"]')::text$$) as t20 \gset
select pg_temp.try(:supn, $$select public.corrective_action_review('c4000000-0000-4000-8000-000000000006', 'approve', 'mine')::text$$) as t21 \gset
select pg_temp.try(:supn, $$select public.corrective_action_my_permissions('c4000000-0000-4000-8000-000000000006')::text$$) as t22 \gset
select pg_temp.ok('A22 a reviewer who submitted cannot approve the same action',
  left(:'t20', 3) = 'ok:'
  and left(:'t21', 5) = '42501'
  and (:'t22') ~ '"self_review_blocked": true');
select pg_temp.try(:supn, $$update public.corrective_actions set status = 'Closed' where id = 'c4000000-0000-4000-8000-000000000006'$$) as t23 \gset
select pg_temp.ok('A23 a reviewer who submitted cannot close it through the status field either',
  (left(:'t23', 5) = '42501' or :'t23' = 'ok:0')
  and (select status <> 'Closed' from public.corrective_actions where id = :a6));
select pg_temp.try(:admin, $$select public.save_closure_review_config('{"ca_allow_self_review":true}')::text$$) as t24 \gset
select pg_temp.try(:supn, $$select public.corrective_action_review('c4000000-0000-4000-8000-000000000006', 'approve', 'Company allows self review')::text$$) as t25 \gset
select pg_temp.try(:admin, $$select public.save_closure_review_config('{"ca_allow_self_review":false}')::text$$) as t26 \gset
select pg_temp.ok('A24 self review works only after the company switches it on',
  left(:'t24', 3) = 'ok:'
  and left(:'t25', 3) = 'ok:'
  and left(:'t26', 3) = 'ok:');

-- country: the Tyre Engineer reviews in their own country
select pg_temp.try(:coll, $$select public.corrective_action_submit_completion('c4000000-0000-4000-8000-000000000004', 'Done', '["p"]')::text$$) as t27 \gset
select pg_temp.ok('A25 worker cannot act on an action in a country outside their scope',
  left(:'t27', 5) = '42501');
select pg_temp.try(:admin, $$select public.corrective_action_submit_completion('c4000000-0000-4000-8000-000000000004', 'Done by the admin', '["p"]')::text$$) as t28 \gset
select pg_temp.try(:eng, $$select public.corrective_action_review('c4000000-0000-4000-8000-000000000004', 'approve', 'ok')::text$$) as t29 \gset
select pg_temp.ok('A26 Tyre Engineer approves in their own country',
  left(:'t28', 3) = 'ok:'
  and left(:'t29', 3) = 'ok:');

-- guard on direct writes
select pg_temp.try(:mgr, $$update public.corrective_actions set review_comment = 'edited' where id = 'c4000000-0000-4000-8000-000000000001'$$) as t30 \gset
select pg_temp.try(:mgr, $$update public.corrective_actions set review_status = 'approved', status = 'Closed' where id = 'c4000000-0000-4000-8000-000000000002'$$) as t31 \gset
select pg_temp.ok('A27 review details cannot be edited directly, even by a Manager',
  left(:'t30', 5) = '42501'
  and left(:'t31', 5) = '42501');
select pg_temp.try(:mgr, $$update public.corrective_actions set status = 'Closed' where id = 'c4000000-0000-4000-8000-000000000002'$$) as t32 \gset
select pg_temp.ok('A28 a reviewer closing directly (old screens) still works and is recorded',
  left(:'t32', 3) = 'ok:'
  and (select status = 'Closed' and review_status = 'approved' and reviewed_by = :mgr and closed_by = :mgr from public.corrective_actions where id = :a2)
  and (select count(*) = 1 from public.corrective_action_review_events where action_id = :a2 and event_type = 'direct_closed' and actor_id = :mgr));
select pg_temp.try(:coll, $$with u as (update public.corrective_actions set status = 'Open' where id = 'c4000000-0000-4000-8000-000000000002' returning 1) select count(*)::text from u$$) as t33 \gset
select pg_temp.try(:mgr, $$update public.corrective_actions set status = 'Open' where id = 'c4000000-0000-4000-8000-000000000002'$$) as t34 \gset
select pg_temp.ok('A29 reviewer reopens a closed action, recorded; worker cannot',
  :'t33' = 'ok:0'
  and left(:'t34', 3) = 'ok:'
  and (select status = 'Open' and review_status is null from public.corrective_actions where id = :a2)
  and (select count(*) = 1 from public.corrective_action_review_events where action_id = :a2 and event_type = 'reopened'));
select pg_temp.try(:admin, $$select public.save_closure_review_config('{"ca_allow_direct_close":false}')::text$$) as t35 \gset
select pg_temp.try(:mgr, $$update public.corrective_actions set status = 'Closed' where id = 'c4000000-0000-4000-8000-000000000002'$$) as t36 \gset
select pg_temp.try(:admin, $$select public.save_closure_review_config('{"ca_allow_direct_close":true,"ca_min_photos":0}')::text$$) as t37 \gset
select pg_temp.ok('A30 direct close refused once the company requires review',
  left(:'t35', 3) = 'ok:'
  and left(:'t36', 5) = '42501'
  and left(:'t37', 3) = 'ok:');

-- per-company configuration
select pg_temp.try(:badmin, $$select public.save_closure_review_config('{"ca_reviewer_roles":["Admin"]}')::text$$) as t38 \gset
select pg_temp.try(:badmin, $$select public.corrective_action_submit_completion('c4000000-0000-4000-8000-000000000005', 'Done in Beta')::text$$) as t39 \gset
select pg_temp.try(:bmgr, $$select public.corrective_action_review('c4000000-0000-4000-8000-000000000005', 'approve', 'x')::text$$) as t40 \gset
select pg_temp.try(:bsup, $$select public.corrective_action_review('c4000000-0000-4000-8000-000000000005', 'approve', 'x')::text$$) as t41 \gset
select pg_temp.try(:admin, $$select public.get_closure_review_config()::text$$) as t42 \gset
select pg_temp.try(:admin, $$select count(*)::text from public.closure_review_config where organisation_id = 'bbbbbbbb-0000-4000-8000-000000000002'$$) as t43 \gset
select pg_temp.ok('A31 reviewer roles are per company: Beta narrows its list, Alpha is untouched',
  left(:'t38', 3) = 'ok:'
  and left(:'t39', 3) = 'ok:'
  and left(:'t40', 5) = '42501'
  and left(:'t41', 5) = '42501'
  and (:'t42') ~ 'Workshop Supervisor'
  and :'t43' = 'ok:0');
select pg_temp.try(:badmin, $$select public.save_closure_review_config('{"ca_reviewer_roles":[]}')::text$$) as t44 \gset
select pg_temp.ok('A32 an empty reviewer list is refused (no action could ever close)',
  left(:'t44', 5) = '22023');
select pg_temp.try(:coll, $$select public.corrective_action_submit_completion('c4000000-0000-4000-8000-000000000005', 'cross company')::text$$) as t45 \gset
select pg_temp.ok('A33 a worker of one company cannot touch another company''s action even when the mirror names them',
  left(:'t45', 5) = '42501');
select pg_temp.ok('A34 the old closed action is untouched and has no invented review',
  (select status = 'Closed' and review_status is null and reviewed_by is null from public.corrective_actions where id = :a3)
  and (select count(*) = 0 from public.corrective_action_review_events where action_id = :a3));

-- ============================== B. checklist sign-off with a fault ==============================
select pg_temp.try(:am, $$select public.decide_checklist_approval('c3000000-0000-4000-8000-000000000003', 'approved', null, 'sig')::text$$) as t46 \gset
select pg_temp.try(:am, $$select public.decide_checklist_approval('c3000000-0000-4000-8000-000000000001', 'approved', null, 'sig')::text$$) as t47 \gset
select pg_temp.ok('B01 blocking-mark rule still holds: approval refused while an item is Not OK',
  :'t46' like '22023%Not OK%'
  and :'t47' like '22023%Not OK%'
  and (select approval_status from public.checklist_submissions where id = :s3) = 'pending_area_manager');
select pg_temp.try(:am, $$select public.acknowledge_checklist_faults('c3000000-0000-4000-8000-000000000002', null, 'sig')::text$$) as t48 \gset
select pg_temp.ok('B02 a clean checklist cannot be acknowledged, it is approved normally',
  left(:'t48', 5) = '22023');
select pg_temp.try(:am, $$update public.checklist_submissions set approval_status = 'acknowledged' where id = 'c3000000-0000-4000-8000-000000000003'$$) as t49 \gset
select pg_temp.ok('B03 the acknowledged status cannot be written directly',
  left(:'t49', 5) = '42501');
select pg_temp.try(:coll, $$select public.acknowledge_checklist_faults('c3000000-0000-4000-8000-000000000001', null, 'sig')::text$$) as t50 \gset
select pg_temp.try(:tman, $$select public.acknowledge_checklist_faults('c3000000-0000-4000-8000-000000000001', null, 'sig')::text$$) as t51 \gset
select pg_temp.ok('B04 a supervisor cannot give the final acknowledgement on a two-signature sheet; a Tyre Man cannot sign at all',
  left(:'t50', 5) = '42501'
  and left(:'t51', 5) = '42501');
select pg_temp.try(:coll, $$select public.decide_checklist_approval('c3000000-0000-4000-8000-000000000001', 'approved', 'seen the fault', 'sig-coll')::text$$) as t52 \gset
select pg_temp.ok('B05 supervisor gives the first signature on a sheet with a fault (existing step)',
  left(:'t52', 3) = 'ok:'
  and (select approval_status from public.checklist_submissions where id = :s1) = 'pending_area_manager');
select pg_temp.try(:am, $$select public.acknowledge_checklist_faults('c3000000-0000-4000-8000-000000000001', 'note', '')::text$$) as t53 \gset
select pg_temp.ok('B06 acknowledgement needs a signature',
  left(:'t53', 5) = '22023');
select pg_temp.try(:am, $$select public.acknowledge_checklist_faults('c3000000-0000-4000-8000-000000000001', 'Brake fault raised to the workshop', 'sig-am')::text$$) as t54 \gset
select pg_temp.ok('B07 final signer acknowledges: fault preserved, sheet locked, not approved',
  left(:'t54', 3) = 'ok:'
  and (select approval_status = 'acknowledged' and locked and acknowledged_by = :am and acknowledged_at is not null
              and approved_by is null and approved_at is null and answers->>'f1' = 'Not OK' and supervisor_by = :coll
         from public.checklist_submissions where id = :s1));
select pg_temp.ok('B08 acknowledged with an open fault is not compliant',
  (select fault_state = 'fault_open' and compliant is false and fault_count = 1 and linked_count = 1
     from public.v_checklist_fault_compliance where submission_id = :s1));
select pg_temp.ok('B09 decision history has the first signature and the acknowledgement, with who and when',
  (select string_agg(to_status, ',' order by id) from public.checklist_decision_events where submission_id = :s1) = 'pending_area_manager,acknowledged'
  and (select actor_id = :am and actor_role = 'Workshop Maintenance Area Manager' and (detail->>'open_faults')::int = 1
         from public.checklist_decision_events where submission_id = :s1 and to_status = 'acknowledged'));
select pg_temp.try(:am, $$select public.decide_checklist_approval('c3000000-0000-4000-8000-000000000001', 'approved', null, 'sig')::text$$) as t55 \gset
select pg_temp.try(:am, $$update public.checklist_submissions set approval_status = 'approved', approver_name = 'x', approver_signature = 'x' where id = 'c3000000-0000-4000-8000-000000000001'$$) as t56 \gset
select pg_temp.try(:admin, $$update public.checklist_submissions set answers = '{"f1":"OK"}' where id = 'c3000000-0000-4000-8000-000000000001'$$) as t57 \gset
select pg_temp.ok('B10 an acknowledged sheet keeps its decision: cannot be approved, rejected or edited',
  left(:'t55', 3) <> 'ok:'
  and left(:'t56', 5) = '22023'
  and left(:'t57', 5) = '22023'
  and (select answers->>'f1' = 'Not OK' and approval_status = 'acknowledged' from public.checklist_submissions where id = :s1));
select pg_temp.try(:supn, $$select public.corrective_action_submit_completion((select id from public.corrective_actions where source_id = 'c3000000-0000-4000-8000-000000000001'), 'Brake pads replaced')::text$$) as t58 \gset
select pg_temp.try(:mgr, $$select public.corrective_action_review((select id from public.corrective_actions where source_id = 'c3000000-0000-4000-8000-000000000001'), 'approve', 'Road tested')::text$$) as t59 \gset
select pg_temp.ok('B11 sheet becomes compliant once the fault is closed on review (verified resolution)',
  left(:'t58', 3) = 'ok:'
  and left(:'t59', 3) = 'ok:'
  and (select fault_state = 'fault_resolved' and compliant from public.v_checklist_fault_compliance where submission_id = :s1)
  and (select approval_status = 'acknowledged' and answers->>'f1' = 'Not OK' from public.checklist_submissions where id = :s1));

-- exception path on a sheet with two faults
select pg_temp.try(:am, $$select public.acknowledge_checklist_faults('c3000000-0000-4000-8000-000000000003', null, 'sig-am')::text$$) as t60 \gset
select pg_temp.ok('B12 final signer acknowledges the two-fault sheet',
  left(:'t60', 3) = 'ok:'
  and (select fault_count = 2 and open_count = 2 and not compliant from public.v_checklist_fault_compliance where submission_id = :s3));
select pg_temp.try(:tman, $$select public.corrective_action_request_exception((select id from public.corrective_actions where source_id = 'c3000000-0000-4000-8000-000000000003' and source_detail = 'Mirrors'), 'Vehicle is being sold next week')::text$$) as t61 \gset
select pg_temp.try(:supn, $$select public.corrective_action_decide_exception((select id from public.corrective_actions where source_id = 'c3000000-0000-4000-8000-000000000003' and source_detail = 'Mirrors'), 'approve')::text$$) as t62 \gset
select pg_temp.try(:mgr, $$select public.corrective_action_request_exception((select id from public.corrective_actions where source_id = 'c3000000-0000-4000-8000-000000000003' and source_detail = 'Mirrors'), 'short')::text$$) as t63 \gset
select pg_temp.ok('B13 an exception request needs a person with a part in the action and a reason; nothing to decide before a request',
  left(:'t61', 5) = '42501'
  and left(:'t62', 5) = '42501'
  and left(:'t63', 5) = '22023');
select pg_temp.try(:mgr, $$select public.corrective_action_request_exception((select id from public.corrective_actions where source_id = 'c3000000-0000-4000-8000-000000000003' and source_detail = 'Mirrors'), 'Vehicle is being sold next week, mirror not replaced')::text$$) as t64 \gset
select pg_temp.ok('B14a asking for an exception does not close the action and the sheet stays non-compliant',
  left(:'t64', 3) = 'ok:'
  and (select status <> 'Closed' and review_status = 'exception_requested' and exception_requested_by = :mgr
              and exception_reason like 'Vehicle is being sold%' and closed_at is null
         from public.corrective_actions where source_id = :s3 and source_detail = 'Mirrors')
  and (select fault_state = 'fault_open' and not compliant and exception_count = 0 from public.v_checklist_fault_compliance where submission_id = :s3));
select pg_temp.try(:mgr, $$select public.corrective_action_decide_exception((select id from public.corrective_actions where source_id = 'c3000000-0000-4000-8000-000000000003' and source_detail = 'Mirrors'), 'approve', 'my own')::text$$) as t64b \gset
select pg_temp.try(:mgr, $$update public.corrective_actions set status = 'Closed' where source_id = 'c3000000-0000-4000-8000-000000000003' and source_detail = 'Mirrors'$$) as t64c \gset
select pg_temp.try(:mgr, $$select public.corrective_action_my_permissions((select id from public.corrective_actions where source_id = 'c3000000-0000-4000-8000-000000000003' and source_detail = 'Mirrors'))::text$$) as t64d \gset
select pg_temp.try(:admin, $$select public.save_closure_review_config('{"ca_allow_self_review":true}')::text$$) as t64e \gset
select pg_temp.try(:mgr, $$select public.corrective_action_decide_exception((select id from public.corrective_actions where source_id = 'c3000000-0000-4000-8000-000000000003' and source_detail = 'Mirrors'), 'approve', 'self review is on')::text$$) as t64f \gset
select pg_temp.try(:admin, $$select public.save_closure_review_config('{"ca_allow_self_review":false}')::text$$) as t64g \gset
select pg_temp.ok('B14b the person who asked can never approve or close their own exception, even when self review is switched on',
  left(:'t64b', 5) = '42501' and :'t64b' like '%You asked for this exception%'
  and left(:'t64c', 5) = 'PT409'
  and (:'t64d')::text like '%"can_decide_exception": false%' and (:'t64d')::text like '%"exception_self_blocked": true%'
  and left(:'t64e', 3) = 'ok:' and left(:'t64f', 5) = '42501' and left(:'t64g', 3) = 'ok:'
  and (select status <> 'Closed' and review_status = 'exception_requested' from public.corrective_actions where source_id = :s3 and source_detail = 'Mirrors'));
select pg_temp.try(:supn, $$select public.corrective_action_decide_exception((select id from public.corrective_actions where source_id = 'c3000000-0000-4000-8000-000000000003' and source_detail = 'Mirrors'), 'approve')::text$$) as t64h \gset
select pg_temp.try(:am, $$select public.corrective_action_decide_exception((select id from public.corrective_actions where source_id = 'c3000000-0000-4000-8000-000000000003' and source_detail = 'Mirrors'), 'approve', 'Agreed with the fleet manager')::text$$) as t64i \gset
select pg_temp.ok('B14c a different authorised person approves: who asked, who decided, when and why are all recorded',
  left(:'t64h', 5) = '42501'
  and left(:'t64i', 3) = 'ok:'
  and (select status = 'Closed' and review_status = 'exception' and reviewed_by = :am and closed_by = :am and reviewed_at is not null
              and exception_requested_by = :mgr and review_comment like 'Vehicle is being sold%' and verified_at is null
         from public.corrective_actions where source_id = :s3 and source_detail = 'Mirrors')
  and (select string_agg(e.event_type, ',' order by e.id) = 'exception_requested,exception'
         from public.corrective_action_review_events e join public.corrective_actions a on a.id = e.action_id
        where a.source_id = :s3 and a.source_detail = 'Mirrors')
  and (select count(*) = 1 from public.corrective_action_review_events e join public.corrective_actions a on a.id = e.action_id
        where a.source_id = :s3 and e.event_type = 'exception' and e.note like 'Vehicle is being sold%' and e.actor_id = :am
          and e.actor_name is not null and e.linked->>'source_id' = 'c3000000-0000-4000-8000-000000000003')
  and (select fault_state = 'fault_open' and not compliant and exception_count = 1 from public.v_checklist_fault_compliance where submission_id = :s3));
select pg_temp.try(:coll, $$select public.corrective_action_submit_completion((select id from public.corrective_actions where source_id = 'c3000000-0000-4000-8000-000000000003' and source_detail = 'Brakes'), 'Brakes adjusted')::text$$) as t65 \gset
select pg_temp.try(:supn, $$select public.corrective_action_review((select id from public.corrective_actions where source_id = 'c3000000-0000-4000-8000-000000000003' and source_detail = 'Brakes'), 'approve', 'ok')::text$$) as t66 \gset
select pg_temp.ok('B15 with the second fault resolved the sheet is compliant by exception',
  left(:'t65', 3) = 'ok:'
  and left(:'t66', 3) = 'ok:'
  and (select fault_state = 'exception' and compliant from public.v_checklist_fault_compliance where submission_id = :s3));

-- self acknowledgement, one-signature close, site and company walls
select pg_temp.try(:am, $$select public.acknowledge_checklist_faults('c3000000-0000-4000-8000-000000000008', null, 'sig')::text$$) as t67 \gset
select pg_temp.ok('B16 the submitter cannot acknowledge their own sheet',
  left(:'t67', 5) = '42501');
select pg_temp.try(:admin, $$select public.acknowledge_checklist_faults('c3000000-0000-4000-8000-000000000008', null, 'sig-admin')->>'both_steps'$$) as t68 \gset
select pg_temp.ok('B17 a final signer acknowledges in one signature, recorded on both steps',
  :'t68' = 'ok:true'
  and (select approval_status = 'acknowledged' and supervisor_by = :admin and acknowledged_by = :admin from public.checklist_submissions where id = :s8));
select pg_temp.try(:supn, $$select public.acknowledge_checklist_faults('c3000000-0000-4000-8000-000000000006', null, 'sig')::text$$) as t69 \gset
select pg_temp.try(:supe, $$select public.acknowledge_checklist_faults('c3000000-0000-4000-8000-000000000006', null, 'sig-supe')::text$$) as t70 \gset
select pg_temp.ok('B18 single-signature sheet: supervisor of another site refused, supervisor of the site acknowledges',
  left(:'t69', 5) = '42501'
  and left(:'t70', 3) = 'ok:'
  and (select approval_status = 'acknowledged' and acknowledged_by = :supe from public.checklist_submissions where id = :s6));
select pg_temp.try(:am, $$select public.acknowledge_checklist_faults('c3000000-0000-4000-8000-000000000007', null, 'sig')::text$$) as t71 \gset
select pg_temp.ok('B19 another company''s sheet cannot be acknowledged',
  left(:'t71', 5) = '42501'
  and (select approval_status from public.checklist_submissions where id = :s7) = 'pending');

-- per-company final signer roles
insert into public.checklist_submissions (id, organisation_id, template_id, template_name, country, site, asset_no, answers, submitted_by, approval_status,
  supervisor_by, supervisor_name, supervisor_signature, supervisor_at)
values ('c3000000-0000-4000-8000-000000000009','00000000-0000-0000-0000-000000000001','c2000000-0000-4000-8000-000000000001','Synthetic Workshop Daily','KSA','ALPHA NORTH PLANT','TM001',
  '{"f1":"OK","f2":"OK","f3":"Not OK"}','c1000000-0000-4000-8000-000000000001','pending_area_manager','c1000000-0000-4000-8000-000000000002','Test clo.collector2','sig',now());
select pg_temp.try(:supn, $$select public.acknowledge_checklist_faults('c3000000-0000-4000-8000-000000000009', null, 'sig')::text$$) as t72 \gset
select pg_temp.ok('B20 Workshop Supervisor is not a final signer by default',
  left(:'t72', 5) = '42501');
select pg_temp.try(:admin, $$select public.save_closure_review_config('{"checklist_final_signer_roles":["Workshop Supervisor"]}')::text$$) as t73 \gset
select pg_temp.try(:supe, $$select public.acknowledge_checklist_faults('c3000000-0000-4000-8000-000000000009', null, 'sig')::text$$) as t74 \gset
select pg_temp.try(:supn, $$select public.acknowledge_checklist_faults('c3000000-0000-4000-8000-000000000009', null, 'sig-supn')::text$$) as t75 \gset
select pg_temp.try(:bsup, $$select public.checklist_is_area_manager()::text$$) as t76 \gset
select pg_temp.ok('B21 company adds Workshop Supervisor as final signer: acknowledges within own site only',
  left(:'t73', 3) = 'ok:'
  and left(:'t74', 5) = '42501'
  and left(:'t75', 3) = 'ok:'
  and left(:'t76', 8) = 'ok:false');
select pg_temp.try(:coll, $$select public.decide_checklist_approval('c3000000-0000-4000-8000-000000000002', 'approved', null, 'sig-coll')::text$$) as t77 \gset
select pg_temp.try(:supe, $$select public.decide_checklist_approval('c3000000-0000-4000-8000-000000000002', 'approved', null, 'sig')::text$$) as t78 \gset
select pg_temp.try(:supn, $$select public.decide_checklist_approval('c3000000-0000-4000-8000-000000000002', 'approved', null, 'sig-supn')::text$$) as t79 \gset
select pg_temp.ok('B22 the same setting lets the site supervisor approve a clean sheet; the blocking rule is untouched',
  left(:'t77', 3) = 'ok:'
  and left(:'t78', 3) <> 'ok:'
  and left(:'t79', 3) = 'ok:'
  and (select approval_status = 'approved' and compliant from public.v_checklist_fault_compliance where submission_id = :s2));

select pg_temp.ok('B23 historical approved sheets keep their result, including one approved before the blocking rule',
  (select bool_and(s.approval_status = 'approved' and s.acknowledged_by is null) from public.checklist_submissions s
    where s.id in ('c3000000-0000-4000-8000-000000000004', 'c3000000-0000-4000-8000-000000000005'))
  and (select compliant and fault_count = 1 from public.v_checklist_fault_compliance where submission_id = :s5));
do $$ begin
  begin update public.checklist_decision_events set note = 'tamper'; raise exception 'owner update was allowed';
  exception when insufficient_privilege then null; end;
  begin delete from public.checklist_decision_events; raise exception 'owner removal was allowed';
  exception when insufficient_privilege then null; end;
end $$;
select pg_temp.ok('B24 checklist decision history cannot be changed or removed', true);
select pg_temp.try(:bmgr, $$select count(*)::text from public.v_checklist_fault_compliance where organisation_id = '00000000-0000-0000-0000-000000000001'$$) as t80 \gset
select pg_temp.try(:bmgr, $$select count(*)::text from public.corrective_action_review_events where organisation_id = '00000000-0000-0000-0000-000000000001'$$) as t81 \gset
select pg_temp.try(:supe, $$select count(*)::text from public.corrective_action_review_events where site = 'ALPHA NORTH PLANT'$$) as t82 \gset
select pg_temp.ok('B25 the compliance view obeys the reader''s own scope (other company sees nothing of Alpha)',
  :'t80' = 'ok:0'
  and :'t81' = 'ok:0'
  and :'t82' = 'ok:0');
-- ============================== C. round 2 owner decisions ==============================
insert into public.corrective_actions (id, organisation_id, title, priority, status, site, country, region, asset_no, created_by, source_type)
values
 ('c4000000-0000-4000-8000-00000000000a','00000000-0000-0000-0000-000000000001','Synthetic: round 2 north','Medium','Open','ALPHA NORTH PLANT','KSA','KSA','TM001','c1000000-0000-4000-8000-000000000001','manual'),
 ('c4000000-0000-4000-8000-00000000000b','00000000-0000-0000-0000-000000000001','Synthetic: round 2 north two','Medium','Open','ALPHA NORTH PLANT','KSA','KSA','TM004','c1000000-0000-4000-8000-000000000001','manual'),
 ('c4000000-0000-4000-8000-00000000000c','00000000-0000-0000-0000-000000000001','Synthetic: round 2 east','Medium','Open','ALPHA EAST PLANT','KSA','KSA','TM007','c1000000-0000-4000-8000-000000000001','manual');

-- C4: resubmitting without a photograph keeps the stored evidence
select pg_temp.try(:coll, $$select public.corrective_action_submit_completion('c4000000-0000-4000-8000-00000000000a', 'Valve replaced', '["data:image/jpeg;base64,P1"]')::text$$) as c1 \gset
select pg_temp.try(:supn, $$select public.corrective_action_review('c4000000-0000-4000-8000-00000000000a', 'return', 'Add the torque value')::text$$) as c2 \gset
select pg_temp.try(:coll, $$select public.corrective_action_submit_completion('c4000000-0000-4000-8000-00000000000a', 'Valve replaced, torque 600 Nm')::text$$) as c3 \gset
select pg_temp.ok('C01 resubmitting after a return without a new photograph keeps the stored photograph',
  left(:'c1', 3) = 'ok:' and left(:'c2', 3) = 'ok:' and left(:'c3', 3) = 'ok:'
  and (select review_status = 'submitted' and completion_photos = '["data:image/jpeg;base64,P1"]'::jsonb
         from public.corrective_actions where id = 'c4000000-0000-4000-8000-00000000000a'));
select pg_temp.ok('C02 history names the person and keeps the time of each step',
  (select bool_and(e.actor_name is not null and e.created_at is not null)
          and bool_or(e.actor_name = 'Test clo.collector') and bool_or(e.actor_name = 'Test clo.sup.north')
     from public.corrective_action_review_events e where e.action_id = 'c4000000-0000-4000-8000-00000000000a'));

-- Tyre Data Collector: submits evidence and documents, no final closure authority
select pg_temp.try(:coll, $$select public.corrective_action_review('c4000000-0000-4000-8000-00000000000a', 'approve', 'mine')::text$$) as c4 \gset
select pg_temp.try(:coll2, $$select public.corrective_action_review('c4000000-0000-4000-8000-00000000000a', 'approve', 'for a colleague')::text$$) as c5 \gset
select pg_temp.try(:coll, $$with u as (update public.corrective_actions set status = 'Closed' where id = 'c4000000-0000-4000-8000-00000000000b' returning 1) select count(*)::text from u$$) as c6 \gset
select pg_temp.try(:coll, $$select public.corrective_action_request_exception('c4000000-0000-4000-8000-00000000000b', 'Asset is parked awaiting disposal')::text$$) as c7 \gset
select pg_temp.try(:coll, $$select public.corrective_action_decide_exception('c4000000-0000-4000-8000-00000000000b', 'approve')::text$$) as c8 \gset
select pg_temp.try(:coll2, $$select public.corrective_action_decide_exception('c4000000-0000-4000-8000-00000000000b', 'approve')::text$$) as c9 \gset
select pg_temp.try(:coll, $$select public.corrective_action_my_permissions('c4000000-0000-4000-8000-00000000000b')::text$$) as c10 \gset
select pg_temp.try(:coll, $$select public.corrective_action_worker_update('c4000000-0000-4000-8000-00000000000b', 'More work done')::text$$) as c11 \gset
select pg_temp.ok('C03 Tyre Data Collector submits evidence and may ask for an exception, but cannot approve, close or decide anything',
  left(:'c4', 5) = '42501' and left(:'c5', 5) = '42501'
  and (:'c6' = 'ok:0' or left(:'c6', 5) = '42501')
  and left(:'c7', 3) = 'ok:' and left(:'c8', 5) = '42501' and left(:'c9', 5) = '42501'
  and (:'c10')::text like '%"can_review": false%' and (:'c10')::text like '%"can_decide_exception": false%'
  and left(:'c11', 5) = 'PT409'
  and (select count(*) = 0 from public.corrective_actions where id in ('c4000000-0000-4000-8000-00000000000a','c4000000-0000-4000-8000-00000000000b') and status = 'Closed'));

-- the completion submitter cannot decide the exception either; refusal returns the action
select pg_temp.try(:am, $$select public.corrective_action_decide_exception('c4000000-0000-4000-8000-00000000000b', 'refuse', '')::text$$) as c12 \gset
select pg_temp.try(:am, $$select public.corrective_action_decide_exception('c4000000-0000-4000-8000-00000000000b', 'refuse', 'Disposal is not approved, repair it')::text$$) as c13 \gset
select pg_temp.ok('C04 refusing an exception needs a reason and returns the action to the worker, still open',
  left(:'c12', 5) = '22023' and left(:'c13', 3) = 'ok:'
  and (select status = 'In Progress' and review_status = 'returned' and review_comment like 'Disposal is not approved%' and closed_at is null
         from public.corrective_actions where id = 'c4000000-0000-4000-8000-00000000000b')
  and (select string_agg(event_type, ',' order by id) = 'exception_requested,exception_refused'
         from public.corrective_action_review_events where action_id = 'c4000000-0000-4000-8000-00000000000b'));
select pg_temp.try(:mgr, $$select public.corrective_action_submit_completion('c4000000-0000-4000-8000-00000000000b', 'Repaired by the manager')::text$$) as c14 \gset
select pg_temp.try(:admin, $$select public.corrective_action_request_exception('c4000000-0000-4000-8000-00000000000b', 'Close as exception, asset is leaving the fleet')::text$$) as c15 \gset
select pg_temp.try(:mgr, $$select public.corrective_action_decide_exception('c4000000-0000-4000-8000-00000000000b', 'approve')::text$$) as c16 \gset
select pg_temp.try(:admin, $$select public.corrective_action_decide_exception('c4000000-0000-4000-8000-00000000000b', 'approve')::text$$) as c17 \gset
select pg_temp.try(:am, $$select public.corrective_action_decide_exception('c4000000-0000-4000-8000-00000000000b', 'approve')::text$$) as c18 \gset
select pg_temp.ok('C05 neither the person who submitted the completion nor the person who asked can decide; a third person does',
  left(:'c14', 3) = 'ok:' and left(:'c15', 3) = 'ok:'
  and left(:'c16', 5) = '42501' and :'c16' like '%You submitted this action%'
  and left(:'c17', 5) = '42501' and :'c17' like '%You asked for this exception%'
  and left(:'c18', 3) = 'ok:'
  and (select status = 'Closed' and review_status = 'exception' and reviewed_by = :am from public.corrective_actions where id = 'c4000000-0000-4000-8000-00000000000b'));

-- Workshop Supervisor: review within authorised sites only
select pg_temp.try(:coll, $$select public.corrective_action_submit_completion('c4000000-0000-4000-8000-00000000000c', 'Pressure corrected at East')::text$$) as c19 \gset
select pg_temp.try(:supn, $$select public.corrective_action_my_permissions('c4000000-0000-4000-8000-00000000000c')::text$$) as c20 \gset
select pg_temp.try(:supn, $$select public.corrective_action_review('c4000000-0000-4000-8000-00000000000c', 'approve', 'not my site')::text$$) as c21 \gset
select pg_temp.try(:supn, $$select public.corrective_action_request_exception('c4000000-0000-4000-8000-00000000000c', 'Trying from another site')::text$$) as c22 \gset
select pg_temp.try(:supn, $$select count(*)::text from public.corrective_action_review_events where action_id = 'c4000000-0000-4000-8000-00000000000c'$$) as c23 \gset
select pg_temp.try(:supe, $$select public.corrective_action_my_permissions('c4000000-0000-4000-8000-00000000000c')::text$$) as c24 \gset
select pg_temp.try(:supe, $$select public.corrective_action_review('c4000000-0000-4000-8000-00000000000c', 'approve', 'Checked at East')::text$$) as c25 \gset
select pg_temp.ok('C06 Workshop Supervisor reviews corrective actions at an authorised site and is refused everywhere else',
  left(:'c19', 3) = 'ok:'
  and (:'c20')::text like '%"ok": false%' and left(:'c21', 5) = '42501' and left(:'c22', 5) = '42501' and :'c23' = 'ok:0'
  and (:'c24')::text like '%"can_review": true%' and left(:'c25', 3) = 'ok:'
  and (select status = 'Closed' and reviewed_by = :supe from public.corrective_actions where id = 'c4000000-0000-4000-8000-00000000000c'));

select pg_temp.ok('C07 no existing action or sheet outcome was changed by any of the above',
  (select status = 'Closed' and review_status is null and reviewed_by is null and exception_requested_by is null
     from public.corrective_actions where id = :a3)
  and (select bool_and(approval_status = 'approved') from public.checklist_submissions
        where id in ('c3000000-0000-4000-8000-000000000004', 'c3000000-0000-4000-8000-000000000005')));
rollback;
