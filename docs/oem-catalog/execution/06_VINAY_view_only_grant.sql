-- FILE 06 (after file 05 is clean): give Vinay Kumar T the route key for the OEM catalog page, VIEW ONLY.
-- Verified read-only against the live database on 2026-11-18/19:
--   profile 06161659-c666-48ac-82f3-5887b1082dc2: VINAY KUMAR T, role 'Workshop Maintenance Area Manager' (custom role, active), approved, not locked, not super admin,
--   org_id = organisation_id = 00000000-0000-0000-0000-000000000001, country {KSA}, sites {ALL}, no existing user_access_grants rows.
--   module_permissions has a row for his role only for 'stock'; none for 'parts_catalog_oem_preview'.
--   The route /parts-catalog/oem-preview allows Admin, Manager, Director; a custom role passes only with an explicit grant or an enabled matrix row,
--   so this grant IS required for the page to open for him. governingModuleKey('/parts-catalog/oem-preview') = 'parts_catalog_oem_preview'.
--   His DATABASE rights (read published manuals, no writes) do not depend on this grant (RLS read = any signed-in member of the organisation).
--   The sidebar item /parts-catalog is Admin/Manager/Director only, so he opens the OEM page by its address or a link, not from the sidebar.
-- Provenance: user_access_grants has two audit triggers (access_audit via log_access_audit_generic, org admin audit). The SQL editor has no
--   signed-in user, so access_audit.actor will be NULL; we therefore set the audit reason and granted_by explicitly
--   (granted_by = 58787cc7-818b-4fd5-8b7b-c93e4e01f641, shahzeb Rahman, super admin; FK to profiles, nullable).
begin;
select set_config('app.access_reason', 'OEM catalog view-only route grant for Vinay Kumar T (owner decision 2026-11-18, run in SQL editor)', true);
insert into public.user_access_grants (org_id, user_id, module_key, capability, effect, granted_by, note)
select p.org_id, p.id, 'parts_catalog_oem_preview', 'view', 'grant', '58787cc7-818b-4fd5-8b7b-c93e4e01f641', 'OEM catalog: view only (owner decision 2026-11-18)'
from public.profiles p
where p.id = '06161659-c666-48ac-82f3-5887b1082dc2' and p.approved and not p.locked and not p.is_super_admin and p.role = 'Workshop Maintenance Area Manager'
on conflict (user_id, module_key, capability, effect) do nothing;
do $a$ begin
  if (select count(*) from public.user_access_grants where user_id = '06161659-c666-48ac-82f3-5887b1082dc2') <> 1 then raise exception 'ASSERT: Vinay must have exactly one grant row'; end if;
end $a$;
commit;
-- Verify: one row (grant, view, granted_by shahzeb) and one access_audit row with the reason text
select user_id, module_key, capability, effect, granted_by, note from public.user_access_grants where user_id = '06161659-c666-48ac-82f3-5887b1082dc2';
select action, entity, target_user, actor, reason, at from public.access_audit where target_user = '06161659-c666-48ac-82f3-5887b1082dc2' order by at desc limit 3;
-- Undo: delete from public.user_access_grants where user_id = '06161659-c666-48ac-82f3-5887b1082dc2' and module_key = 'parts_catalog_oem_preview';
