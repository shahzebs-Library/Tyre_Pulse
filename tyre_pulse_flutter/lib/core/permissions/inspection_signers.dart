/// Who may sign off (approve or reject) a submitted inspection.
///
/// # This mirrors the server, it does not decide anything
///
/// The authority is `public.decide_inspection_approval`, last redefined in
/// `MIGRATIONS_V606_CHECKLIST_DATA_COLLECTOR_APPROVAL.sql` (the later
/// `supabase/migrations/20260910*_governed_approval_policies.sql` and
/// `..._approval_pre_execution_gates.sql` only CALL it). Its gate is:
///
/// ```sql
/// IF NOT public.is_super_admin() AND (v_role IS NULL OR v_role NOT IN (
///     'Admin','PMV Manager','Workshop Area Manager',
///     'Workshop Maintenance Area Manager','Tyre Data Collector')) THEN
///   RAISE EXCEPTION 'Only an area manager, ...';
/// ```
///
/// The `approvals` module is wider than that list (Manager and Director reach
/// the queue to read it), so "can open Approvals" is NOT "can sign". A screen
/// that shows a count of sheets "awaiting your signature" must use this
/// predicate, or it invites a person to act on work the server will refuse.
///
/// The SQL compares `profiles.role` case-sensitively. `normalize_profiles_role`
/// (V282) stores every role in its Title Case catalogue spelling, and
/// [RoleId.databaseName] carries exactly those spellings, so matching on the
/// resolved [RoleId] is the same test. An unknown or absent role is never a
/// signer, exactly as `v_role IS NULL OR v_role NOT IN (...)` refuses it.
///
/// Pure: no provider, no I/O. Change this set only together with the SQL.
library;

import 'package:tyre_pulse/core/permissions/access_resolver.dart';
import 'package:tyre_pulse/core/permissions/roles.dart';

/// The roles `decide_inspection_approval` (V606) accepts, super admin aside.
const Set<RoleId> inspectionApprovalSignerRoles = <RoleId>{
  RoleId.admin,
  RoleId.pmvManager,
  RoleId.workshopAreaManager,
  RoleId.workshopMaintenanceAreaManager,
  RoleId.tyreDataCollector,
};

/// True when [access] would pass `decide_inspection_approval`'s role gate.
bool canSignInspectionApprovals(AccessState access) {
  if (access.isSuperAdmin) return true;
  final RoleId? id = access.role.id;
  return id != null && inspectionApprovalSignerRoles.contains(id);
}
