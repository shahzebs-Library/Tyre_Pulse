/// ONE submitted checklist, read in full for the read-only details screen
/// opened from "My checklist history".
///
/// # Why a second shape beside [ChecklistHistoryRow]
///
/// The history list deliberately reads a LEAN column set (see
/// `checklist_history_row.dart`'s library comment: a page of `answers`/
/// `photos`/`notes`/`signatures` jsonb blobs on a low-end handset is the
/// out-of-memory mistake). That comment already names the remedy - "a
/// detail view reads the one row someone actually opened separately" - and
/// this is that read: one row, by id, with every column the details screen
/// shows.
///
/// # The template the sheet was filled against
///
/// `checklist_submissions.template_snapshot` (migration
/// `20260921082100_checklist_enterprise_evidence_and_compliance.sql`,
/// `checklist_template_snapshot()`) stores the template AS IT WAS when the
/// sheet was filled: `name`, `fields`, `option_sets`, `assignee_roles`, ...
/// - the same keys a `checklist_templates` row carries. [snapshotTemplate]
/// decodes it through [ChecklistTemplateRecord.fromRow], so labels and
/// options come from the version the operator actually answered, not a
/// later edit. A sheet that predates the snapshot column has an empty map
/// here and the screen falls back to the live template.
library;

import 'package:tyre_pulse/features/checklists/data/checklist_remote_models.dart';

/// Every column [ChecklistSubmissionDetail.fromRow] reads.
const String checklistSubmissionDetailColumns =
    'id,template_id,template_name,template_snapshot,title,site,asset_no,'
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
          if (path is String && path.trim().isNotEmpty) path,
      ];
    }
  });
  return out;
}

Map<String, String> _asStringMap(Object? raw) {
  if (raw is! Map) return const <String, String>{};
  final Map<String, String> out = <String, String>{};
  raw.forEach((Object? key, Object? value) {
    if (key is String && value is String && value.trim().isNotEmpty) {
      out[key] = value;
    }
  });
  return out;
}

final class ChecklistSubmissionDetail {
  const ChecklistSubmissionDetail({
    required this.id,
    this.templateId,
    this.templateName,
    this.templateSnapshot = const <String, Object?>{},
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

  /// Decodes one row selected with [checklistSubmissionDetailColumns].
  /// Returns `null` for a row with no usable id; never throws for a missing
  /// or malformed optional column - it reads back at its default.
  static ChecklistSubmissionDetail? fromRow(Map<String, dynamic> row) {
    final String? id = _asString(row['id']);
    if (id == null) return null;
    return ChecklistSubmissionDetail(
      id: id,
      templateId: _asString(row['template_id']),
      templateName: _asString(row['template_name']),
      templateSnapshot: _asJsonMap(row['template_snapshot']),
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

  final String id;
  final String? templateId;
  final String? templateName;
  final Map<String, Object?> templateSnapshot;
  final String? title;
  final String? site;
  final String? assetNo;
  final String? status;

  /// Field id -> recorded answer, in the shape the fill screen stores it.
  final Map<String, Object?> answers;

  /// Field id -> photo paths/refs captured for that field.
  final Map<String, List<String>> photos;

  /// Field id -> the remark recorded beside that field.
  final Map<String, Object?> notes;

  /// Field id -> signature (SVG markup or a base64 data URL) for each
  /// `signature`-type field.
  final Map<String, String> signatures;

  /// The sheet's PRIMARY (template-level) signature.
  final String? signatureData;
  final String? printedName;
  final String? submittedBy;
  final String? submittedAt;
  final int? scorePct;
  final bool? scorePassed;
  final String? approvalStatus;
  final String? documentNo;
  final String? approverName;
  final String? approverSignature;
  final String? approvedAt;
  final String? supervisorName;
  final String? supervisorSignature;
  final String? supervisorAt;
  final String? reviewNote;
  final bool locked;

  /// The template as captured when the sheet was filled, or `null` when
  /// this row carries no usable snapshot (an older sheet, or a snapshot with
  /// no fields) - the caller then falls back to the live template.
  ChecklistTemplateRecord? get snapshotTemplate {
    if (templateSnapshot.isEmpty) return null;
    final ChecklistTemplateRecord record = ChecklistTemplateRecord.fromRow(
      <String, dynamic>{
        ...templateSnapshot,
        'id': templateSnapshot['template_id'] ?? templateId,
      },
    );
    if (record.template.fields.isEmpty) return null;
    return record;
  }

  /// The signature to show for one `signature`-type field: its own mark,
  /// falling back to the sheet's primary signature only when no field
  /// recorded a signature of its own (the same rule the approval review
  /// screen applies).
  String? signatureForField(String fieldId) =>
      signatures[fieldId] ?? (signatures.isEmpty ? signatureData : null);
}
