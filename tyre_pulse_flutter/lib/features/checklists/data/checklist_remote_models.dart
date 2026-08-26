/// Tolerant decoders for the two remote rows this feature reads:
/// `checklist_templates` and `checklist_assignments`.
///
/// # Why these decoders live HERE, and not on the domain model itself
///
/// `checklist_template.dart` deliberately carries no `fromJson` - its own
/// library comment says why: "the live shape of `option_sets`/`name_i18n`/
/// `description_i18n` is flagged UNVERIFIED in artifact section 11; both
/// source stacks build template fixtures by hand in their own tests rather
/// than decoding a real row, and this port does the same." This file is
/// where that decode genuinely has to happen (a real screen needs a real
/// template from a real row), so it is written HERE, in the data layer,
/// tolerantly: a malformed `option_sets` or `assignee_roles` degrades to an
/// empty map/list rather than throwing, and never blocks the rest of the row
/// from being usable.
///
/// The COLUMN LIST selected against `checklist_templates` /
/// `checklist_assignments` is transcribed verbatim from
/// `mobile/lib/checklists.ts:69-71` (`TEMPLATE_COLS` / `ASSIGN_COLS`) -
/// `mobile/` is read-only reference material for this port, not something
/// this feature imports.
library;

import 'package:tyre_pulse/features/checklists/domain/checklist_field.dart';
import 'package:tyre_pulse/features/checklists/domain/checklist_option_set.dart';
import 'package:tyre_pulse/features/checklists/domain/checklist_template.dart';

/// Every column this feature reads from `checklist_templates`. Verbatim
/// against `mobile/lib/checklists.ts`'s own `TEMPLATE_COLS` constant, whose
/// comment there explains why it must be ONE string literal rather than a
/// join: supabase-js infers a row shape from the literal text and a `+`
/// concatenation degrades that inference. This port's own Supabase client
/// has no such constraint, but the single-literal column list is kept
/// anyway so the two sources stay comparable at a glance.
const String checklistTemplateColumns =
    'id,name,description,category,icon,status,version,require_signature,'
    'require_approval,require_area_manager,doc_prefix,min_interval_days,'
    'scored,pass_threshold,fields,country,assignee_roles,name_i18n,'
    'description_i18n,option_sets';

/// Every column this feature reads from `checklist_assignments`.
const String checklistAssignmentColumns =
    'id,template_id,template_name,site,asset_no,assignee_role,due_date,'
    'status,submission_id';

String? _asString(Object? raw) {
  if (raw is! String) return null;
  final String trimmed = raw.trim();
  return trimmed.isEmpty ? null : trimmed;
}

bool _asBool(Object? raw) => raw == true;

int? _asInt(Object? raw) {
  if (raw is int) return raw;
  if (raw is num) return raw.toInt();
  if (raw is String) return int.tryParse(raw.trim());
  return null;
}

num? _asNum(Object? raw) {
  if (raw is num) return raw;
  if (raw is String) return num.tryParse(raw.trim());
  return null;
}

List<String>? _asStringListOrNull(Object? raw) {
  if (raw is! List) return null;
  return <String>[
    for (final Object? v in raw)
      if (v is String) v,
  ];
}

/// One `checklist_templates.option_sets` entry, decoded tolerantly. Any
/// shape other than a real map for a given key is simply skipped for that
/// key, never thrown - a genuinely malformed `option_sets` therefore yields
/// an empty map rather than taking the whole template decode down with it.
ChecklistOptionSet _decodeOptionSet(Map<Object?, Object?> raw) {
  final List<String> options = <String>[
    for (final Object? v in (raw['options'] is List)
        ? raw['options']! as List<Object?>
        : const <Object?>[])
      if (v is String) v,
  ];

  final Map<String, List<String>> i18n = <String, List<String>>{};
  final Object? i18nRaw = raw['i18n'];
  if (i18nRaw is Map) {
    i18nRaw.forEach((Object? key, Object? value) {
      if (key is String && value is List) {
        i18n[key] = <String>[
          for (final Object? v in value)
            if (v is String) v,
        ];
      }
    });
  }

  final List<ChecklistOptionMeta> meta = <ChecklistOptionMeta>[];
  final Object? metaRaw = raw['meta'];
  if (metaRaw is List) {
    for (final Object? entry in metaRaw) {
      if (entry is! Map) continue;
      meta.add(
        ChecklistOptionMeta(
          value: _asString(entry['value']),
          icon: _asString(entry['icon']),
          tone: _asString(entry['tone']),
          meaning: _asString(entry['meaning']),
        ),
      );
    }
  }

  return ChecklistOptionSet(
    options: options,
    i18n: i18n,
    meta: meta,
    blocking: _asStringListOrNull(raw['blocking']) ?? const <String>[],
    // The stored key is snake_case `require_note` - verified against
    // `mobile/lib/checklistMarks.ts`'s `OptionSet` interface.
    requireNote: _asStringListOrNull(raw['require_note']) ?? const <String>[],
  );
}

Map<String, ChecklistOptionSet> _decodeOptionSets(Object? raw) {
  if (raw is! Map) return const <String, ChecklistOptionSet>{};
  final Map<String, ChecklistOptionSet> out = <String, ChecklistOptionSet>{};
  raw.forEach((Object? key, Object? value) {
    if (key is String && value is Map) {
      out[key] = _decodeOptionSet(value);
    }
  });
  return out;
}

List<ChecklistField> _decodeFields(Object? raw) {
  if (raw is! List) return const <ChecklistField>[];
  return <ChecklistField>[
    for (final Object? entry in raw)
      if (entry is Map)
        ChecklistField.fromJson(Map<String, dynamic>.from(entry)),
  ];
}

/// A `checklist_templates` row, in full: the domain [template] the field
/// engine consumes, plus the remote-only columns that engine deliberately
/// does not carry (a locked `final class` this feature must not edit - see
/// `checklist_template.dart`'s own library comment).
final class ChecklistTemplateRecord {
  const ChecklistTemplateRecord({
    required this.template,
    this.description,
    this.category,
    this.icon,
    this.status,
    this.version = 1,
    this.requireSignature = false,
    this.requireApproval = false,
    this.requireAreaManager,
    this.docPrefix,
    this.minIntervalDays,
    this.scored = false,
    this.passThreshold,
    this.country,
  });

  final ChecklistTemplate template;
  final String? description;
  final String? category;
  final String? icon;
  final String? status;

  /// The version pin a resumed draft is compared against - a template that
  /// changed shape underneath an in-progress draft must warn, not silently
  /// remap answers to different questions.
  final int version;

  /// `require_signature`. Drives the template-level signature pad - see
  /// `checklist_signature_gate.dart`.
  final bool requireSignature;

  /// `require_approval`. Decides the FRESH submission's initial
  /// `approval_status`: `'pending'` when true, `'not_required'` otherwise.
  /// Verbatim against `mobile/lib/checklists.ts:332-333`. Never used for
  /// anything beyond that one decision - the approval LADDER (which rung is
  /// next, who may sign it) belongs entirely to `lib/features/approvals/`
  /// and this feature never re-derives any part of it.
  final bool requireApproval;

  /// `require_area_manager`. Carried for display only (e.g. a "two-stage"
  /// badge) - NEVER consulted to decide a fresh submission's initial status,
  /// and never consulted to decide who may act on an existing one. That
  /// entire decision belongs to the separate `lib/features/approvals/`
  /// feature.
  final bool? requireAreaManager;

  /// Document-number prefix. Informational only - the number itself is
  /// minted server-side on INSERT (`stamp_checklist_document_no`); this
  /// feature never mints or guesses one.
  final String? docPrefix;

  /// Expected days between visits for the same machine. Advisory - drives
  /// the "not due yet" warning via [SupabaseRpcs.checklistLastSubmission],
  /// never a block.
  final int? minIntervalDays;

  final bool scored;
  final num? passThreshold;
  final String? country;

  /// Decodes one row selected with [checklistTemplateColumns]. Never
  /// throws - a malformed `fields`/`option_sets`/`assignee_roles` degrades
  /// to an empty list/map rather than taking the whole row down, matching
  /// [ChecklistField.fromJson]'s own tolerance.
  factory ChecklistTemplateRecord.fromRow(Map<String, dynamic> row) {
    final String? id = _asString(row['id']);
    return ChecklistTemplateRecord(
      template: ChecklistTemplate(
        id: id,
        name: _asString(row['name']),
        fields: _decodeFields(row['fields']),
        optionSets: _decodeOptionSets(row['option_sets']),
        assigneeRoles: _asStringListOrNull(row['assignee_roles']),
      ),
      description: _asString(row['description']),
      category: _asString(row['category']),
      icon: _asString(row['icon']),
      status: _asString(row['status']),
      version: _asInt(row['version']) ?? 1,
      requireSignature: _asBool(row['require_signature']),
      requireApproval: _asBool(row['require_approval']),
      requireAreaManager: row['require_area_manager'] is bool
          ? row['require_area_manager'] as bool
          : null,
      docPrefix: _asString(row['doc_prefix']),
      minIntervalDays: _asInt(row['min_interval_days']),
      scored: _asBool(row['scored']),
      passThreshold: _asNum(row['pass_threshold']),
      country: _asString(row['country']),
    );
  }

  /// `checklist_submissions.approval_status` a FRESH submission of this
  /// template should carry. See [requireApproval]'s own doc comment for why
  /// this is the only place that decision is made, and why it never
  /// consults [requireAreaManager].
  String get freshApprovalStatus =>
      requireApproval ? 'pending' : 'not_required';

  @override
  String toString() =>
      'ChecklistTemplateRecord(id: ${template.id}, name: ${template.name})';
}

/// A `checklist_assignments` row.
final class ChecklistAssignmentRecord {
  const ChecklistAssignmentRecord({
    required this.id,
    this.templateId,
    this.templateName,
    this.site,
    this.assetNo,
    this.assigneeRole,
    this.dueDate,
    this.status,
    this.submissionId,
  });

  final String id;
  final String? templateId;
  final String? templateName;
  final String? site;
  final String? assetNo;

  /// A single nullable role inherited from the schedule that generated this
  /// row. `null` means anyone may pick it up.
  final String? assigneeRole;

  final String? dueDate;

  /// `'pending' | 'completed' | 'overdue' | 'skipped'` on a well-formed row,
  /// kept as a plain string so an unrecognised value never throws.
  final String? status;

  final String? submissionId;

  /// Decodes one row selected with [checklistAssignmentColumns]. Returns
  /// `null` when the row has no usable `id` - an assignment with no
  /// identity is not actionable and inventing one would let two decoded
  /// rows silently collide.
  static ChecklistAssignmentRecord? fromRow(Map<String, dynamic> row) {
    final String? id = _asString(row['id']);
    if (id == null) return null;
    return ChecklistAssignmentRecord(
      id: id,
      templateId: _asString(row['template_id']),
      templateName: _asString(row['template_name']),
      site: _asString(row['site']),
      assetNo: _asString(row['asset_no']),
      assigneeRole: _asString(row['assignee_role']),
      dueDate: _asString(row['due_date']),
      status: _asString(row['status']),
      submissionId: _asString(row['submission_id']),
    );
  }

  bool get isOpen =>
      status == null || status == 'pending' || status == 'overdue';

  @override
  String toString() => 'ChecklistAssignmentRecord(id: $id, '
      'templateId: $templateId, assetNo: $assetNo)';
}
