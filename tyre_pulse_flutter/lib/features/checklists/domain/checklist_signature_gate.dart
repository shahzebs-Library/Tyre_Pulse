/// The signature half of "can this sheet be submitted" - required signature
/// FIELDS, and the template-level `require_signature` flag.
///
/// This is a NEW file, not a port of an existing ported module, added on top
/// of the already-locked engine in this directory. It exists because
/// `checklist_validation.dart`'s own library comment says so directly:
/// [validateSubmission] there "is deliberately built to sections 1-3 of its
/// TypeScript original ONLY... it does NOT implement the optional 4th step
/// (merging in `validateSignatures`)... Nothing here prevents a later phase
/// adding that merge on top of this function's result." This file is that
/// later phase.
///
/// Mirrors, verbatim in behaviour, `signatureFields` / `validateSignatures` /
/// `requiresPrimarySignature` / `primarySignatureSatisfied` at
/// `mobile/lib/checklistFields.ts:271-364` (`mobile/` is read-only reference
/// material). The real live app depends on all four - `require_signature` is
/// a genuine column selected by `TEMPLATE_COLS` in `mobile/lib/checklists.ts`
/// and the fill screen renders a template-level pad exactly when it is set
/// (`mobile/app/(app)/checklists/[templateId].tsx:352` onward) - so this is
/// not a speculative addition; it is real, evidence-backed behaviour this
/// port would otherwise silently drop.
///
/// # The bug this file exists to prevent, quoted from the TS source
///
/// "`require_signature` is a flag on the template, but the only way to
/// capture a signature is a `signature` FIELD. A template with the flag set
/// and no such field was therefore impossible to submit on mobile: the
/// operator filled every line, pressed Submit, was told a signature was
/// required, and had no control anywhere on the screen that could produce
/// one. Work was lost on back-out." [primarySignatureSatisfied] is therefore
/// satisfied by the template-level pad OR any signed `signature` field -
/// never by the pad alone.
///
/// Pure Dart only - no Flutter, no I/O. Imports only the sibling field/
/// template domain files in this directory, exactly like every other file
/// here.
library;

import 'package:tyre_pulse/features/checklists/domain/checklist_field.dart';
import 'package:tyre_pulse/features/checklists/domain/checklist_visibility.dart';

/// The signature-type fields of [fields], in template order. Mirrors
/// `signatureFields` (`checklistFields.ts:272-274`).
List<ChecklistField> signatureFields(List<ChecklistField>? fields) {
  return <ChecklistField>[
    for (final ChecklistField f in fields ?? const <ChecklistField>[])
      if (f.type == 'signature' && f.id.isNotEmpty) f,
  ];
}

/// Required signature fields that have not been signed.
///
/// A sheet signed off by three trades has three separate required
/// signatures, so each is validated like any other required answer and a
/// missing one names WHICH signature it is. Hidden fields are exempt,
/// exactly as for value fields. Mirrors `validateSignatures`
/// (`checklistFields.ts:282-299`).
///
/// [signatures] is keyed by field id, e.g. an SVG string or a `data:` URL -
/// this function does not inspect the VALUE's shape, only whether one is
/// present at all (a non-empty string).
Map<String, String> validateSignatureFields(
  List<ChecklistField>? fields,
  Map<String, Object?> signatures, [
  Map<String, Object?> answers = const <String, Object?>{},
  String Function(ChecklistField field)? labelFor,
]) {
  final Map<String, String> errors = <String, String>{};
  for (final ChecklistField f in signatureFields(fields)) {
    if (!f.required) continue;
    if (!isFieldVisible(f, answers)) continue;
    final Object? signed = signatures[f.id];
    if (signed is String && signed.isNotEmpty) continue;
    final String name = (labelFor?.call(f) ?? f.label ?? '').trim();
    errors[f.id] = '${name.isEmpty ? 'Signature' : name} is required';
  }
  return errors;
}

/// Is [template]'s TEMPLATE-LEVEL signature requirement in force at all?
///
/// Tests the property directly, not derived from anything else on the
/// template - `require_signature` is a real, independently-set column.
/// Mirrors `requiresPrimarySignature` (`checklistFields.ts:352-354`).
bool requiresPrimarySignature(bool? templateRequiresSignature) =>
    templateRequiresSignature ?? false;

/// Is the template-level signature requirement SATISFIED?
///
/// `false` only when [templateRequiresSignature] is true AND neither [primary]
/// nor any [signatures] entry for one of [fields]'s signature fields is a
/// non-empty string. Mirrors `primarySignatureSatisfied`
/// (`checklistFields.ts:356-364`).
bool primarySignatureSatisfied({
  required bool? templateRequiresSignature,
  required List<ChecklistField>? fields,
  Map<String, Object?> signatures = const <String, Object?>{},
  String? primary,
}) {
  if (!(templateRequiresSignature ?? false)) return true;
  if (primary != null && primary.isNotEmpty) return true;
  for (final ChecklistField f in signatureFields(fields)) {
    final Object? v = signatures[f.id];
    if (v is String && v.isNotEmpty) return true;
  }
  return false;
}
