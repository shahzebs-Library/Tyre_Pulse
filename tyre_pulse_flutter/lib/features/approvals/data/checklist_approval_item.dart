/// One `checklist_submissions` row, decoded for the checklist approvals
/// queue and its review screen.
///
/// Ported field-for-field from `mobile/lib/checklists.ts`'s own
/// `ChecklistSubmission` interface and its `SUBMISSION_COLS` constant
/// (`mobile/` is READ-ONLY reference material - see `AGENTS.md`).
///
/// # Two column sets, for a reason the reference source does NOT act on
///
/// `mobile/lib/checklists.ts`'s `listPendingApprovals` selects the SAME
/// `SUBMISSION_COLS` the review screen's `getSubmission` does - the full
/// row, `answers`/`photos`/`notes`/`signatures`/`signature_data` included -
/// for every entry in a queue that can hold up to 200 rows. This is exactly
/// the mistake `checklist_history_row.dart`'s own library comment names,
/// over the SAME table, for the SAME reason: "pulling a whole page of them
/// onto a low-end handset to render a date and a status is the same mistake
/// that made mobile Analytics an out-of-memory crash." The checklist queue
/// screen this file backs renders only [templateId]/[templateName]/[title]/
/// [site]/[assetNo]/[status]/[approvalStatus]/[submittedAt]/[documentNo]/
/// [scorePct]/[scorePassed]/[supervisorName]/[supervisorAt]/[approverName]/
/// [approvedAt]/[reviewNote]/[locked] - never the heavy jsonb blobs - so
/// [checklistApprovalListColumns] is a LEAN subset (byte-identical to
/// `checklist_history_row.dart`'s own `checklistHistoryColumns`, which
/// already applies this exact treatment to this exact table for this exact
/// reason). This is a deliberate IMPROVEMENT over the reference source, not
/// a faithful port of an inefficiency - see this port's final report.
///
/// [checklistApprovalFullColumns] IS the verbatim `SUBMISSION_COLS`, used
/// only by the review screen's single-row read, where every jsonb column is
/// genuinely needed.
///
/// Both column sets decode through the SAME [ChecklistApprovalItem.fromRow]
/// - a column a given row never selected simply reads back at its default
/// (`null` for a scalar, an empty map for a jsonb column), mirroring
/// `InspectionApprovalItem`'s own documented contract for the identical
/// two-column-sets-one-decoder shape.
library;

import 'package:tyre_pulse/features/approvals/domain/checklist_approval.dart'
    show ApprovalSubmissionLike;

/// Every column [ChecklistApprovalItem.fromRow] can read for the QUEUE
/// list. See the library comment for why this is narrower than the full
/// row the reference source reads for its own equivalent list.
const String checklistApprovalListColumns =
    'id,template_id,template_name,title,site,asset_no,status,submitted_by,'
    'submitted_at,score_pct,score_passed,approval_status,document_no,'
    'approver_name,approved_at,supervisor_name,supervisor_at,review_note,'
    'locked';

/// Every column [ChecklistApprovalItem.fromRow] can read for the REVIEW
/// screen. Verbatim against `mobile/lib/checklists.ts`'s own
/// `SUBMISSION_COLS` constant.
const String checklistApprovalFullColumns =
    'id,template_id,template_name,template_version,title,site,asset_no,'
    'status,answers,photos,notes,signatures,signature_data,printed_name,'
    'submitted_by,submitted_at,score_pct,score_passed,approval_status,'
    'document_no,approver_name,approver_signature,approved_at,'
    'supervisor_name,supervisor_signature,supervisor_at,review_note,locked';

String? _asString(Object? raw) {
  if (raw is! String) return null;
  final String trimmed = raw.trim();
  return trimmed.isEmpty ? null : trimmed;
}

int? _asInt(Object? raw) {
  if (raw is int) return raw;
  if (raw is num) return raw.toInt();
  return null;
}

Map<String, Object?> _asJsonMap(Object? raw) {
  if (raw is! Map) return const <String, Object?>{};
  return <String, Object?>{
    for (final MapEntry<Object?, Object?> entry in raw.entries)
      if (entry.key is String) entry.key! as String: entry.value,
  };
}

Map<String, List<String>> _asPhotoMap(Object? raw) {
  if (raw is! Map) return const <String, List<String>>{};
  final Map<String, List<String>> out = <String, List<String>>{};
  raw.forEach((Object? key, Object? value) {
    if (key is String && value is List) {
      out[key] = <String>[
        for (final Object? path in value)
          if (path is String) path,
      ];
    }
  });
  return out;
}

Map<String, String> _asStringMap(Object? raw) {
  if (raw is! Map) return const <String, String>{};
  final Map<String, String> out = <String, String>{};
  raw.forEach((Object? key, Object? value) {
    if (key is String && value is String) out[key] = value;
  });
  return out;
}

/// One `checklist_submissions` row.
final class ChecklistApprovalItem {
  const ChecklistApprovalItem({
    required this.id,
    this.templateId,
    this.templateName,
    this.templateVersion,
    this.title,
    this.site,
    this.assetNo,
    this.status,
    this.answers = const <String, Object?>{},
    this.photos = const <String, List<String>>{},
    this.notes = const <String, Object?>{},
    this.signatures = const <String, String>{},
    this.signatureData,
    this.printedName,
    this.submittedBy,
    this.submittedAt,
    this.scorePct,
    this.scorePassed,
    this.approvalStatus,
    this.documentNo,
    this.approverName,
    this.approverSignature,
    this.approvedAt,
    this.supervisorName,
    this.supervisorSignature,
    this.supervisorAt,
    this.reviewNote,
    this.locked = false,
  });

  /// The server row id. `checklist_submissions.id` is the primary key, so a
  /// row this cannot be read from is a genuinely broken invariant -
  /// mirrors `InspectionApprovalItem.fromRow`'s own throwing convention
  /// over the analogous table.
  final String id;

  final String? templateId;
  final String? templateName;
  final int? templateVersion;
  final String? title;
  final String? site;
  final String? assetNo;

  /// The submission's OWN status (`'submitted'` on a well-formed row) -
  /// distinct from [approvalStatus], which is the ladder's status.
  final String? status;

  /// Raw `answers` jsonb, keyed by field id. Only populated when this row
  /// was read via [checklistApprovalFullColumns].
  final Map<String, Object?> answers;

  /// Raw `photos` jsonb: field id -> the list of paths/refs captured for
  /// that field. Only populated via [checklistApprovalFullColumns].
  final Map<String, List<String>> photos;

  /// Raw `notes` jsonb: field id -> the fitter's remark for that field.
  /// Only populated via [checklistApprovalFullColumns].
  final Map<String, Object?> notes;

  /// EVERY captured signature, keyed by field id (V212) - a workshop sheet
  /// signed by three trades carries three of these. Only populated via
  /// [checklistApprovalFullColumns].
  final Map<String, String> signatures;

  /// The PRIMARY sign-off: the template-level pad when there is one, else
  /// the first captured field signature - mirrors
  /// `checklist_submission_repository.dart`'s own `signatureData`
  /// resolution at submit time. Only populated via
  /// [checklistApprovalFullColumns].
  final String? signatureData;

  final String? printedName;
  final String? submittedBy;
  final String? submittedAt;
  final int? scorePct;
  final bool? scorePassed;

  /// `'not_required' | 'pending' | 'pending_area_manager' | 'approved' |
  /// 'rejected'` on a well-formed row - the SAME vocabulary
  /// [checklist_approval.dart]'s functions expect via [asSubmissionLike].
  /// Kept as a plain string here too, matching that file's own tolerance
  /// for an unrecognised or blank value.
  final String? approvalStatus;

  /// Minted server-side at INSERT, e.g. `WDC-TM514-2026-0001`. `null` for a
  /// sheet that predates that trigger.
  final String? documentNo;

  /// The FINAL approver. On a two-stage sheet this is the AREA MANAGER.
  final String? approverName;
  final String? approverSignature;
  final String? approvedAt;

  /// The first rung: the supervisor who signed it off (V594).
  final String? supervisorName;
  final String? supervisorSignature;
  final String? supervisorAt;

  final String? reviewNote;
  final bool locked;

  /// Whether the queue's own decision on this row is still outstanding.
  /// Both waiting states count - see `listPending`'s own doc comment on
  /// why `'pending_area_manager'` must never be treated as "not mine to
  /// worry about any more".
  bool get isWaiting =>
      approvalStatus == 'pending' || approvalStatus == 'pending_area_manager';

  /// The facts [checklist_approval.dart]'s pure ladder engine needs from
  /// this row. Built fresh on every read rather than cached, so a
  /// re-fetched item always reflects this row's CURRENT state - see
  /// `checklist_approval_sync_engine.dart`'s conflict check, which depends
  /// on exactly that.
  ApprovalSubmissionLike get asSubmissionLike => ApprovalSubmissionLike(
        approvalStatus: approvalStatus,
        approverName: approverName,
        approverSignature: approverSignature,
        approvedAt: approvedAt,
        supervisorName: supervisorName,
        supervisorSignature: supervisorSignature,
        supervisorAt: supervisorAt,
      );

  /// Decodes [row] as read via [checklistApprovalListColumns] or
  /// [checklistApprovalFullColumns]. Never throws for a missing OPTIONAL
  /// column - it simply reads back at its default.
  factory ChecklistApprovalItem.fromRow(Map<String, Object?> row) {
    final Object? rawId = row['id'];
    if (rawId is! String || rawId.isEmpty) {
      throw const FormatException(
        'Checklist submission row has no usable "id".',
      );
    }

    return ChecklistApprovalItem(
      id: rawId,
      templateId: _asString(row['template_id']),
      templateName: _asString(row['template_name']),
      templateVersion: _asInt(row['template_version']),
      title: _asString(row['title']),
      site: _asString(row['site']),
      assetNo: _asString(row['asset_no']),
      status: _asString(row['status']),
      answers: _asJsonMap(row['answers']),
      photos: _asPhotoMap(row['photos']),
      notes: _asJsonMap(row['notes']),
      signatures: _asStringMap(row['signatures']),
      signatureData: _asString(row['signature_data']),
      printedName: _asString(row['printed_name']),
      submittedBy: _asString(row['submitted_by']),
      submittedAt: _asString(row['submitted_at']),
      scorePct: _asInt(row['score_pct']),
      scorePassed:
          row['score_passed'] is bool ? row['score_passed'] as bool : null,
      approvalStatus: _asString(row['approval_status']),
      documentNo: _asString(row['document_no']),
      approverName: _asString(row['approver_name']),
      approverSignature: _asString(row['approver_signature']),
      approvedAt: _asString(row['approved_at']),
      supervisorName: _asString(row['supervisor_name']),
      supervisorSignature: _asString(row['supervisor_signature']),
      supervisorAt: _asString(row['supervisor_at']),
      reviewNote: _asString(row['review_note']),
      locked: row['locked'] == true,
    );
  }

  @override
  String toString() =>
      'ChecklistApprovalItem(id: $id, approvalStatus: $approvalStatus)';
}
