/// Targeting - how a template reaches a user.
///
/// Ported per `docs/flutter-migration/08-checklist-engine-parity-tests.md`
/// section 9 and section 10 group N, mirroring
/// `mobile/lib/checklistRoles.ts` (pinned identical to the web
/// `src/lib/checklist/checklistRoles.js` by that repo's own drift test - no
/// mobile/web divergence to choose between here).
///
/// THREE independent mechanisms, all ported:
///
///   9a. `checklist_templates.assignee_roles` (nullable `text[]`, no
///   default). NULL OR EMPTY BOTH MEAN "EVERY ROLE" - the opposite of an
///   intuitive default, and deliberate: "A narrowing column that defaults
///   to hiding would have silently taken the three published checklists
///   away from the 17 Tyre Men who use them the moment it shipped." This is
///   TARGETING, not a security boundary - templates are already walled by
///   org and country RLS, and a published template is a list of questions
///   with no PII, so the filter runs client-side by design.
///
///   9b. THE ROLE-VOCABULARY TRAP. `profiles.role` is stored Title Case
///   (`'Tyre Man'`); this app's own role vocabulary is snake_case
///   (`'tyre_man'`). A raw string compare between the two matches NOTHING,
///   "so a targeted checklist would silently disappear for exactly the
///   person it was written for." [normaliseRoleKey] folds BOTH sides
///   (lowercase, `\s`/`-` runs collapsed to `_`) before every comparison in
///   this file.
///
///   9d. `checklist_assignments.assignee_role` - a SINGLE nullable role
///   inherited from the schedule that generated the row. `null` means
///   anyone may pick it up.
///
/// [isOversightRole] (Admin/Manager/Director, or any super admin) always
/// passes regardless of targeting - these roles run and review the
/// programme rather than being assigned by it. A BLANK/UNKNOWN role (a
/// profile still loading) is the opposite case: it matches NOTHING against
/// a targeted template, "so the list re-renders as soon as the profile
/// arrives" - fail closed only on the READER side, never on the template's
/// own targeting list (an untargeted template still shows to everyone,
/// including a loading profile - N6).
library;

import 'package:tyre_pulse/features/checklists/domain/checklist_template.dart';

/// The shortlist a template BUILDER offers when picking who a sheet is
/// for. Not consulted by any comparison in this file - carried for parity
/// with the source's own exported constant.
const List<String> kChecklistTradeRoles = <String>[
  'Mechanic',
  'Electrician',
  'Driver',
  'Tyre Man',
  'Inspector',
  'Maintenance Supervisor',
];

/// Roles that see every checklist regardless of targeting: they run and
/// review the programme rather than being assigned by it.
const List<String> kChecklistOversightRoles = <String>['Admin', 'Manager', 'Director'];

/// Folds [role] to the comparison key both sides of every targeting check
/// in this file use: trimmed, lower-cased, with runs of whitespace or `-`
/// collapsed to a single `_`. `'Tyre Man'` -> `'tyre_man'`;
/// `'Workshop Maintenance Area Manager'` and
/// `'workshop_maintenance_area_manager'` both fold to the same key (N3/L12
/// - shown here so an unlisted role is never silently mismatched).
String normaliseRoleKey(Object? role) {
  final String s = role?.toString().trim().toLowerCase() ?? '';
  return s.replaceAll(RegExp(r'[\s\-]+'), '_');
}

/// [template]'s `assigneeRoles`, normalised and filtered of blanks. `[]`
/// for a `null` or malformed value - the caller reads that as "everyone".
List<String> templateRoleKeys(ChecklistTemplate? template) {
  final List<String>? raw = template?.assigneeRoles;
  if (raw == null) return const <String>[];
  return <String>[
    for (final String r in raw)
      if (normaliseRoleKey(r).isNotEmpty) normaliseRoleKey(r),
  ];
}

/// `true` for a `null` `assigneeRoles` AND for an explicit empty list
/// (N1/N2) - both mean "every role", never "match nothing".
bool templateTargetsEveryone(ChecklistTemplate? template) =>
    templateRoleKeys(template).isEmpty;

/// Is [role] one of the 3 oversight roles, or a super admin?
bool isOversightRole(Object? role, {bool isSuperAdmin = false}) {
  if (isSuperAdmin) return true;
  final String key = normaliseRoleKey(role);
  return kChecklistOversightRoles.any(
    (String r) => normaliseRoleKey(r) == key,
  );
}

/// Should [role] be OFFERED [template]? In order:
///   1. an untargeted template -> true (N1/N2)
///   2. an oversight role, or a super admin -> true (N5)
///   3. a blank/unknown role -> FALSE, even against a TARGETED template
///      (N6) - a loading profile does not unlock a targeted sheet, but
///      still passes step 1 for an untargeted one
///   4. otherwise the normalised key must be in [template]'s normalised
///      list (N3/N4)
bool templateAllowsRole(
  ChecklistTemplate? template,
  Object? role, {
  bool isSuperAdmin = false,
}) {
  if (templateTargetsEveryone(template)) return true;
  if (isOversightRole(role, isSuperAdmin: isSuperAdmin)) return true;
  final String key = normaliseRoleKey(role);
  if (key.isEmpty) return false;
  return templateRoleKeys(template).contains(key);
}

/// [templates] narrowed to the ones [role] should be offered.
List<ChecklistTemplate> filterTemplatesForRole(
  List<ChecklistTemplate>? templates,
  Object? role, {
  bool isSuperAdmin = false,
}) {
  return <ChecklistTemplate>[
    for (final ChecklistTemplate t in templates ?? const <ChecklistTemplate>[])
      if (templateAllowsRole(t, role, isSuperAdmin: isSuperAdmin)) t,
  ];
}

/// `checklist_assignments.assignee_role` - a single nullable role
/// inherited from the schedule that generated the row.
final class ChecklistAssignment {
  const ChecklistAssignment({this.assigneeRole});

  final String? assigneeRole;

  @override
  String toString() => 'ChecklistAssignment(assigneeRole: $assigneeRole)';
}

/// Should [role] be allowed to act on [assignment]? A `null`/blank target
/// means anyone may pick it up (N7); an oversight role always passes;
/// otherwise the normalised keys must match.
bool assignmentAllowsRole(
  ChecklistAssignment? assignment,
  Object? role, {
  bool isSuperAdmin = false,
}) {
  final String target = normaliseRoleKey(assignment?.assigneeRole);
  if (target.isEmpty) return true;
  if (isOversightRole(role, isSuperAdmin: isSuperAdmin)) return true;
  return normaliseRoleKey(role) == target;
}

List<ChecklistAssignment> filterAssignmentsForRole(
  List<ChecklistAssignment>? assignments,
  Object? role, {
  bool isSuperAdmin = false,
}) {
  return <ChecklistAssignment>[
    for (final ChecklistAssignment a in assignments ?? const <ChecklistAssignment>[])
      if (assignmentAllowsRole(a, role, isSuperAdmin: isSuperAdmin)) a,
  ];
}

/// Who [template] is for, joined for display - or `null` when it is for
/// everyone, so the caller renders nothing (N8) rather than an empty
/// string or a stray comma. Uses the RAW names a template author typed,
/// never the normalised keys - this is for a human to read.
String? roleTargetLabel(ChecklistTemplate? template) {
  final List<String>? raw = template?.assigneeRoles;
  if (raw == null) return null;
  final List<String> names = <String>[
    for (final String r in raw)
      if (r.trim().isNotEmpty) r.trim(),
  ];
  return names.isEmpty ? null : names.join(', ');
}
