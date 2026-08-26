/// One row of "my checklist history" - a COMPLETED, already-synced
/// submission, read lean.
///
/// Deliberately without `answers`/`photos`/`notes`/`signatures`: those are
/// per-sheet jsonb blobs, and pulling a whole page of them onto a low-end
/// handset to render a date and a status is the mistake
/// `mobile/lib/checklists.ts`'s own `HISTORY_COLS` comment names directly -
/// "the same mistake that made mobile Analytics an out-of-memory crash". A
/// detail view reads the one row someone actually opened separately.
///
/// Column list transcribed verbatim from `mobile/lib/checklists.ts:530-533`
/// (`HISTORY_COLS`) - `mobile/` is read-only reference material.
library;

/// Every column the history list reads from `checklist_submissions`.
const String checklistHistoryColumns =
    'id,template_id,template_name,title,site,asset_no,status,submitted_by,'
    'submitted_at,score_pct,score_passed,approval_status,document_no,'
    'approver_name,approved_at,supervisor_name,supervisor_at,review_note,'
    'locked';

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

class ChecklistHistoryRow {
  const ChecklistHistoryRow({
    required this.id,
    this.templateId,
    this.templateName,
    this.title,
    this.site,
    this.assetNo,
    this.status,
    this.submittedBy,
    this.submittedAt,
    this.scorePct,
    this.scorePassed,
    this.approvalStatus,
    this.documentNo,
    this.approverName,
    this.approvedAt,
    this.supervisorName,
    this.supervisorAt,
    this.reviewNote,
    this.locked = false,
  });

  final String id;
  final String? templateId;
  final String? templateName;
  final String? title;
  final String? site;
  final String? assetNo;
  final String? status;
  final String? submittedBy;
  final String? submittedAt;
  final int? scorePct;
  final bool? scorePassed;

  /// `'not_required' | 'pending' | 'pending_area_manager' | 'approved' |
  /// 'rejected'` on a well-formed row, kept as a plain string.
  final String? approvalStatus;

  /// Minted server-side at INSERT. `null` for a sheet that predates that
  /// trigger.
  final String? documentNo;

  final String? approverName;
  final String? approvedAt;
  final String? supervisorName;
  final String? supervisorAt;
  final String? reviewNote;
  final bool locked;

  static ChecklistHistoryRow? fromRow(Map<String, dynamic> row) {
    final String? id = _asString(row['id']);
    if (id == null) return null;
    return ChecklistHistoryRow(
      id: id,
      templateId: _asString(row['template_id']),
      templateName: _asString(row['template_name']),
      title: _asString(row['title']),
      site: _asString(row['site']),
      assetNo: _asString(row['asset_no']),
      status: _asString(row['status']),
      submittedBy: _asString(row['submitted_by']),
      submittedAt: _asString(row['submitted_at']),
      scorePct: _asInt(row['score_pct']),
      scorePassed:
          row['score_passed'] is bool ? row['score_passed'] as bool : null,
      approvalStatus: _asString(row['approval_status']),
      documentNo: _asString(row['document_no']),
      approverName: _asString(row['approver_name']),
      approvedAt: _asString(row['approved_at']),
      supervisorName: _asString(row['supervisor_name']),
      supervisorAt: _asString(row['supervisor_at']),
      reviewNote: _asString(row['review_note']),
      locked: row['locked'] == true,
    );
  }
}
