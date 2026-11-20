-- Approver capability grants for test approvers (per 94_prepared/approver_roles_template.sql capability list)
insert into public.user_access_grants (org_id, user_id, module_key, capability, effect, granted_by, note)
select '00000000-0000-0000-0000-000000000001'::uuid, u::uuid, 'stock', c, 'grant', 'a0000000-0000-4000-8000-000000000001'::uuid, 'qa-acceptance'
from (values
 ('a0000000-0000-4000-8000-000000000002', array['view_value','adjustment_approve','discrepancy_review','financial_post','audit_create','audit_history','recount']),
 ('a0000000-0000-4000-8000-000000000004', array['view','view_value','audit_create','audit_history','recount','discrepancy_review','adjustment_approve']),
 ('a0000000-0000-4000-8000-000000000005', array['view','view_value','financial_post','adjustment_approve'])
) v(u, caps), unnest(caps) c on conflict do nothing;
