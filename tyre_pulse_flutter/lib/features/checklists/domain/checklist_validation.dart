/// Answer validation and whole-submission validation.
///
/// Ported per `docs/flutter-migration/08-checklist-engine-parity-tests.md`
/// section 5 and section 10 groups C (C11/C12) and G, mirroring
/// `validateAnswer`/`validateSubmission` in
/// `src/lib/checklist/fieldTypes.js:300-336`
/// (`mobile/lib/checklistFields.ts:239-269`, `:317-336` - identical logic
/// on both stacks).
///
/// [validateAnswer]'s check ORDER is load-bearing (artifact section 5):
///   1. a layout field is always valid
///   2. required + empty -> named error
///   3. empty (and not required) -> valid, and this SHORT-CIRCUITS every
///      later check - a blank OPTIONAL number field never reports a `min`
///      violation, even with a `min` set (G2)
///   4. type-specific checks: number NaN/min/max, select/multiselect
///      membership, rating 0..5
///
/// Membership (select/multiselect) is SKIPPED, never rejecting, when
/// NEITHER a resolved option set nor the field's own raw list is known
/// (G7) - "refusing a valid answer because we could not resolve the legend
/// is worse than accepting an unrecognised one" (`fieldTypes.js:318-320`).
///
/// [validateSubmission] is deliberately built to sections 1-3 of its
/// TypeScript original ONLY - it skips `section`/`photo`/`signature` fields
/// and honours [isFieldVisible], but does NOT implement the optional 4th
/// step (merging in `validateSignatures` when an `opts.signatures` map is
/// supplied). That step is entirely section 6's concern (the signature
/// engine), which this phase's brief places out of scope alongside
/// approvals and drafts - see this port's final report. Nothing here
/// prevents a later phase adding that merge on top of this function's
/// result.
library;

import 'package:tyre_pulse/features/checklists/domain/checklist_field.dart';
import 'package:tyre_pulse/features/checklists/domain/checklist_visibility.dart';

bool _isEmptyAnswer(Object? value) =>
    value == null || value == '' || (value is List && value.isEmpty);

double? _numberOrNull(Object? value) {
  if (value is num) return value.toDouble();
  if (value is String) return double.tryParse(value.trim());
  return null;
}

/// Validates one [value] against [field]. Returns an error message, or
/// `null` when valid.
///
/// [label] names the field in the message when supplied (pass the
/// TRANSLATED label - `checklist_i18n.dart`'s `fieldLabel` - so the message
/// reads in the same language as the line it points at); otherwise falls
/// back to [ChecklistField.label], then to a generic noun.
///
/// [options] is the RESOLVED English option set (`checklist_i18n.dart`'s
/// `fieldOptionValues`) for a `select`/`multiselect` field; when omitted,
/// falls back to [ChecklistField.options] (B8, G7).
String? validateAnswer(
  ChecklistField? field,
  Object? value, {
  String? label,
  List<String>? options,
}) {
  if (field == null || field.type == 'section') return null;
  final String name = (label ?? field.label ?? '').trim();
  final bool empty = _isEmptyAnswer(value);

  if (field.required && empty) {
    return '${name.isEmpty ? 'This field' : name} is required';
  }
  if (empty) return null;

  if (field.type == 'number') {
    final double? n = _numberOrNull(value);
    if (n == null) return '${name.isEmpty ? 'Value' : name} must be a number';
    if (field.min != null && n < field.min!.toDouble()) {
      return '${name.isEmpty ? 'Value' : name} must be at least ${field.min}';
    }
    if (field.max != null && n > field.max!.toDouble()) {
      return '${name.isEmpty ? 'Value' : name} must be at most ${field.max}';
    }
  }

  final List<String> allowed =
      (options != null && options.isNotEmpty) ? options : field.options;
  if (field.type == 'select' &&
      allowed.isNotEmpty &&
      !allowed.contains(value)) {
    return 'Choose a valid option for ${name.isEmpty ? 'this field' : name}';
  }
  if (field.type == 'multiselect' && allowed.isNotEmpty) {
    final List<Object?> values = value is List ? value : const <Object?>[];
    final bool hasBad = values.any((Object? v) => !allowed.contains(v));
    if (hasBad)
      return 'Invalid option(s) for ${name.isEmpty ? 'this field' : name}';
  }

  if (field.type == 'rating') {
    final double? n = _numberOrNull(value);
    if (n == null || n < 0 || n > 5) {
      return '${name.isEmpty ? 'Rating' : name} must be 0-5';
    }
  }
  return null;
}

/// The result of [validateSubmission]: whether every visible, validatable
/// field is valid, and one error message per invalid field id.
final class ChecklistValidationResult {
  const ChecklistValidationResult({required this.valid, required this.errors});

  final bool valid;
  final Map<String, String> errors;

  @override
  String toString() =>
      'ChecklistValidationResult(valid: $valid, errors: $errors)';
}

/// Validates a whole template's [answers].
///
/// 1. skips `section`, `photo` and `signature` fields entirely
/// 2. skips any field [isFieldVisible] says is hidden - so a hidden
///    required field does NOT block submission (C11), and the SAME field
///    blocks once visible (C12)
/// 3. runs [validateAnswer] with the translated label and resolved options,
///    via the optional [labelFor]/[optionsFor] hooks a caller supplies
ChecklistValidationResult validateSubmission(
  List<ChecklistField>? fields,
  Map<String, Object?> answers, {
  String Function(ChecklistField field)? labelFor,
  List<String> Function(ChecklistField field)? optionsFor,
}) {
  final Map<String, String> errors = <String, String>{};
  for (final ChecklistField f in fields ?? const <ChecklistField>[]) {
    if (f.type == 'section' || f.type == 'photo' || f.type == 'signature') {
      continue;
    }
    if (!isFieldVisible(f, answers)) continue;
    final String? err = validateAnswer(
      f,
      answers[f.id],
      label: labelFor?.call(f),
      options: optionsFor?.call(f),
    );
    if (err != null) errors[f.id] = err;
  }
  return ChecklistValidationResult(valid: errors.isEmpty, errors: errors);
}
