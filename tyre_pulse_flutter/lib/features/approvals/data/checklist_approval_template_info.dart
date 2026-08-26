/// The template facts the checklist approvals feature needs, decoded from a
/// `checklist_templates` row - and nothing else from that row.
///
/// # Why this is NOT `ChecklistTemplateRecord`
///
/// `lib/features/checklists/data/checklist_remote_models.dart` already
/// decodes a `checklist_templates` row into `ChecklistTemplateRecord`
/// (`ChecklistTemplate` plus every column the checklist FIELD/fill engine
/// needs: `require_signature`, `doc_prefix`, `min_interval_days`, `scored`,
/// `pass_threshold`, `assignee_roles`, and more). This feature is
/// deliberately NOT built on top of it, for the same reason
/// `inspection_approval_item.dart`'s own library comment gives for not
/// importing `features/inspections/domain/tyre_position_reading.dart`:
/// "that type belongs to a SIBLING top-level feature's own domain layer,
/// and ... sibling top-level features keep their own domain layers
/// separate even when a decode looks similar." The approval ladder
/// (`checklist_approval.dart`) needs exactly one boolean from a template -
/// `require_area_manager` - and the review screen needs the field list to
/// render answers through the shared [ChecklistFieldAnswerTile] widget;
/// nothing else on that row is this feature's concern.
///
/// # Why [fields] is a `List<ChecklistField>`, imported from
/// # `lib/features/checklists/domain/checklist_field.dart`, and not
/// # anything wider
///
/// `ChecklistField` (the type) and `ChecklistField.fromJson` (the factory
/// that decodes one entry of the `fields` jsonb array) are the exact,
/// unavoidable type this feature's review screen needs to construct a
/// [ChecklistFieldAnswerTile] at all - that widget's own `field` parameter
/// is typed `ChecklistField`. Importing this one domain type to reuse the
/// widget it belongs to is not the same thing as depending on the
/// checklists feature's data/repository/presentation layers, which this
/// file and every other file in this feature deliberately does not do. See
/// this port's final report for the exact reasoning behind where that line
/// is drawn.
///
/// This file deliberately does NOT resolve `visibleWhen` (no
/// `checklist_visibility.dart` import) or shared `option_sets`/`optionsRef`
/// resolution (no `checklist_template.dart`/`checklist_option_set.dart`/
/// `checklist_i18n.dart`-with-a-template-argument) - a completed
/// submission's review renders every non-section field the template
/// declares, in declared order, with its OWN `options`/`optionsI18n` (never
/// a shared legend a later edit may have replaced). See
/// `checklist_approval_review_screen.dart`'s own library comment for the
/// disclosed, considered trade-off this represents.
library;

import 'package:tyre_pulse/features/approvals/domain/checklist_approval.dart'
    show ApprovalTemplateLike;
import 'package:tyre_pulse/features/checklists/domain/checklist_field.dart'
    show ChecklistField;

List<ChecklistField> _decodeFields(Object? raw) {
  if (raw is! List) return const <ChecklistField>[];
  return <ChecklistField>[
    for (final Object? entry in raw)
      if (entry is Map)
        ChecklistField.fromJson(Map<String, dynamic>.from(entry)),
  ];
}

/// The narrow `checklist_templates` read this feature needs. `require_
/// signature` is included alongside `require_area_manager` so the review
/// screen can tell a template-level primary signature
/// (`checklist_submissions.signature_data`) apart from a plain sheet with
/// none - the same distinction `checklist_fill_screen.dart` draws via
/// `ChecklistTemplateRecord.requireSignature`.
const String checklistApprovalTemplateColumns =
    'id,require_area_manager,require_signature,fields';

/// The template facts the ladder engine and the answer-rendering section of
/// the review screen need.
final class ChecklistApprovalTemplateInfo {
  const ChecklistApprovalTemplateInfo({
    required this.id,
    this.requireAreaManager,
    this.requireSignature = false,
    this.fields = const <ChecklistField>[],
  });

  final String id;

  /// `checklist_templates.require_area_manager`. `null` or `false` both
  /// mean single-stage - see [asTemplateLike] and
  /// `checklist_approval.dart`'s `isTwoStage`.
  final bool? requireAreaManager;

  /// `checklist_templates.require_signature` - whether this template has a
  /// TEMPLATE-LEVEL primary signature pad, separate from any `signature`
  /// -type field. See the review screen's own handling of
  /// `checklist_submissions.signature_data`.
  final bool requireSignature;

  /// The template's fields, in declared order, INCLUDING `type: 'section'`
  /// entries - [ChecklistFieldAnswerTile] renders those as a section
  /// header, so keeping them in the list gives the review screen the same
  /// visual structure the fill screen has, for free.
  final List<ChecklistField> fields;

  /// The narrow view [checklist_approval.dart]'s functions need.
  ApprovalTemplateLike get asTemplateLike =>
      ApprovalTemplateLike(requireAreaManager: requireAreaManager);

  /// Decodes one row selected with [checklistApprovalTemplateColumns].
  /// Returns `null` when the row has no usable `id` - mirroring
  /// `ChecklistAssignmentRecord.fromRow`'s own "not actionable, do not
  /// invent one" convention, matching this feature's own use of a missing
  /// template as "labels degrade to field ids" rather than a fatal error.
  static ChecklistApprovalTemplateInfo? fromRow(Map<String, Object?> row) {
    final Object? rawId = row['id'];
    if (rawId is! String || rawId.isEmpty) return null;
    return ChecklistApprovalTemplateInfo(
      id: rawId,
      requireAreaManager: row['require_area_manager'] is bool
          ? row['require_area_manager'] as bool
          : null,
      requireSignature: row['require_signature'] == true,
      fields: _decodeFields(row['fields']),
    );
  }

  @override
  String toString() => 'ChecklistApprovalTemplateInfo(id: $id, '
      'requireAreaManager: $requireAreaManager, fields: ${fields.length})';
}
