/// Workshop Status -> Vehicle intake, phone side (pure, no I/O).
///
/// Mirrors supabase/migrations/20261128090000_workshop_intake.sql and the web
/// `src/lib/workshopStatus/intake.js`. The server decides every rule; this
/// only avoids offering an action it would refuse.
library;

/// Priorities the server accepts (CHECK workshop_status_records_priority_check).
const List<String> kIntakePriorities = <String>[
  'Low',
  'Medium',
  'High',
  'Critical',
];

/// Work types that map onto work_orders.work_type when a job card is linked.
const List<String> kIntakeWorkTypes = <String>[
  'Repair',
  'Emergency',
  'Preventive Maintenance',
  'Service',
  'Tyre Change',
  'Inspection',
  'Other',
];

/// The minimum reason length the server accepts.
const int kIntakeMinReason = 5;

/// The caller's intake flags from workshop_status_my_permissions(). Fails
/// closed: anything that is not exactly `true` is false.
final class WorkshopIntakePermissions {
  const WorkshopIntakePermissions({
    this.intake = false,
    this.intakeConfirm = false,
  });

  factory WorkshopIntakePermissions.fromJson(Object? raw) {
    if (raw is! Map) return const WorkshopIntakePermissions();
    return WorkshopIntakePermissions(
      intake: raw['intake'] == true,
      intakeConfirm: raw['intake_confirm'] == true,
    );
  }

  final bool intake;
  final bool intakeConfirm;
  bool get any => intake || intakeConfirm;
}

/// One vehicle waiting for (or already past) confirmation.
final class WorkshopIntakeRecord {
  const WorkshopIntakeRecord({
    required this.id,
    required this.assetNo,
    required this.confirmStatus,
    required this.source,
    required this.routedTo,
    required this.active,
    this.site,
    this.regNo,
    this.complaint,
    this.jobCardRef,
    this.priority,
    this.submittedBy,
    this.submittedByName,
    this.submittedAt,
    this.updatedAt,
  });

  factory WorkshopIntakeRecord.fromRow(Map<String, dynamic> row) {
    String? s(String k) {
      final Object? v = row[k];
      final String t = v == null ? '' : v.toString().trim();
      return t.isEmpty ? null : t;
    }

    final Object? routed = row['routed_to'];
    return WorkshopIntakeRecord(
      id: s('id') ?? '',
      assetNo: s('asset_no') ?? '',
      confirmStatus: s('confirm_status') ?? 'confirmed',
      source: s('intake_source') ?? 'excel_upload',
      routedTo: routed is List
          ? routed.map((Object? e) => e.toString()).toList(growable: false)
          : const <String>[],
      active: row['current_active'] == true,
      site: s('site'),
      regNo: s('reg_no'),
      complaint: s('complaint'),
      jobCardRef: s('job_card_ref'),
      priority: s('priority'),
      submittedBy: s('submitted_by'),
      submittedByName: s('submitted_by_name'),
      submittedAt: DateTime.tryParse(s('submitted_at') ?? ''),
      updatedAt: s('updated_at'),
    );
  }

  final String id;
  final String assetNo;
  final String confirmStatus;
  final String source;
  final List<String> routedTo;
  final bool active;
  final String? site;
  final String? regNo;
  final String? complaint;
  final String? jobCardRef;
  final String? priority;
  final String? submittedBy;
  final String? submittedByName;
  final DateTime? submittedAt;
  final String? updatedAt;

  bool get isPending => active && confirmStatus == 'pending_confirm';

  /// Routed to this person and still waiting.
  bool isWaitingFor(String userId) =>
      isPending && userId.isNotEmpty && routedTo.contains(userId);

  /// Nobody confirms a vehicle they entered (the database trigger refuses it
  /// too; this only hides the button).
  bool isOwnEntry(String userId) => userId.isNotEmpty && submittedBy == userId;

  bool canConfirm(String userId) => isWaitingFor(userId) && !isOwnEntry(userId);
}

/// Upper case, no spaces: the server's asset key.
String intakeAssetKey(String value) =>
    value.replaceAll(RegExp(r'\s+'), '').toUpperCase();

/// Is a reason long enough for the server?
bool intakeReasonOk(String reason) => reason.trim().length >= kIntakeMinReason;

/// The ingest outcome of one row, as the server reports it.
enum IntakeOutcome {
  added,
  updated,
  unchanged,
  alreadyListed,
  invalid,
  released,
  unknown
}

IntakeOutcome intakeOutcomeOf(Object? raw) {
  if (raw is! Map) return IntakeOutcome.unknown;
  final Object? rows = raw['rows'];
  final Object? first = rows is List && rows.isNotEmpty ? rows.first : null;
  final String o = first is Map ? (first['outcome']?.toString() ?? '') : '';
  return switch (o) {
    'new' => IntakeOutcome.added,
    'updated' => IntakeOutcome.updated,
    'unchanged' => IntakeOutcome.unchanged,
    'already_listed' => IntakeOutcome.alreadyListed,
    'invalid' => IntakeOutcome.invalid,
    'released' => IntakeOutcome.released,
    _ => IntakeOutcome.unknown,
  };
}

/// The confirm outcome for one id (`confirmed`, `refused`, `already_confirmed`,
/// `not_routed_to_you`, `released`).
String intakeConfirmOutcome(Object? raw, String id) {
  if (raw is! Map) return 'unknown';
  final Object? results = raw['results'];
  if (results is! List) return 'unknown';
  for (final Object? r in results) {
    if (r is Map && r['id']?.toString() == id) {
      return r['outcome']?.toString() ?? 'unknown';
    }
  }
  return 'unknown';
}
