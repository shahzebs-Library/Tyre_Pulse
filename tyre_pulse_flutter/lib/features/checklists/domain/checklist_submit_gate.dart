/// Whether a filled-in sheet may be SUBMITTED. One function, composing the
/// four independent checks that together decide it, so the fill screen calls
/// exactly one thing rather than remembering to run all four in the right
/// combination itself.
///
/// # This is the single most important file in this port, and it is a NEW
/// # composition, not a ported function
///
/// `checklist_marks.dart`'s own library comment states the rule this file
/// exists to enforce structurally rather than by discipline: "a blocking mark
/// stops a sheet being CLOSED, never being SUBMITTED. A mechanic who finds a
/// fault on the last item of the day must still be able to record it and go
/// home." [evaluateChecklistSubmitGate] therefore NEVER calls `canClose`,
/// `serverBlockingMatches` or `blockingAnswers` - it has no import of
/// `checklist_marks.dart`'s close-gate machinery at all, only the pieces that
/// genuinely gate a SUBMIT:
///
///   1. [validateSubmission] (`checklist_validation.dart`) - required fields,
///      type/range checks, visibility-aware.
///   2. [missingNotes] (`checklist_marks.dart`) - a mark that demands a
///      remark and has none.
///   3. [unsatisfiedGroups] (`checklist_marks.dart`) - a `group_require_one`
///      set with no member answered.
///   4. [validateSignatureFields] + [primarySignatureSatisfied]
///      (`checklist_signature_gate.dart`) - required signature fields and
///      the template-level `require_signature` pad.
///
/// Approval/close-gate logic belongs to a SEPARATE, already-built feature
/// (`lib/features/approvals/`) and is never imported here or anywhere else
/// in `lib/features/checklists/`.
///
/// Pure Dart only - no Flutter, no I/O.
library;

import 'package:tyre_pulse/features/checklists/domain/checklist_field.dart';
import 'package:tyre_pulse/features/checklists/domain/checklist_marks.dart';
import 'package:tyre_pulse/features/checklists/domain/checklist_signature_gate.dart';
import 'package:tyre_pulse/features/checklists/domain/checklist_template.dart';
import 'package:tyre_pulse/features/checklists/domain/checklist_validation.dart';
import 'package:tyre_pulse/features/checklists/domain/checklist_visibility.dart';

/// Everything that is wrong with a sheet right now, and whether that adds up
/// to "may not submit yet".
final class ChecklistSubmitGate {
  const ChecklistSubmitGate({
    required this.fieldErrors,
    required this.signatureFieldErrors,
    required this.missingNotes,
    required this.unsatisfiedGroups,
    required this.primarySignatureOk,
  });

  /// Field id -> message, from [validateSubmission].
  final Map<String, String> fieldErrors;

  /// Field id -> message, from required `signature`-type fields.
  final Map<String, String> signatureFieldErrors;

  /// Fields whose mark demands a remark and has none.
  final List<ChecklistFieldRef> missingNotes;

  /// `group_require_one` groups with no member answered.
  final List<UnsatisfiedGroup> unsatisfiedGroups;

  /// Whether the template-level `require_signature` pad requirement (if any)
  /// is satisfied.
  final bool primarySignatureOk;

  /// May this sheet be submitted right now?
  bool get canSubmit =>
      fieldErrors.isEmpty &&
      signatureFieldErrors.isEmpty &&
      missingNotes.isEmpty &&
      unsatisfiedGroups.isEmpty &&
      primarySignatureOk;

  /// A short, ordered list of English reasons submission is blocked, one per
  /// distinct problem class. Empty when [canSubmit].
  ///
  /// NOT FOR DISPLAY TO A USER - this domain library has no `BuildContext`
  /// to translate with (see `vehicle_asset.dart`'s library comment on this
  /// codebase's standing rule), and none of these sentences is a pinned
  /// parity string the way `checklist_approval.dart`'s English exceptions
  /// are. It exists for logging/telemetry and for tests that want a single
  /// human-readable summary; the fill screen builds its OWN localised
  /// summary from the structured counts on this class
  /// ([fieldErrors.length], [signatureFieldErrors.length],
  /// [missingNotes.length], [unsatisfiedGroups.length],
  /// [primarySignatureOk]) rather than ever rendering this getter.
  List<String> get blockingReasons {
    final List<String> out = <String>[];
    if (fieldErrors.isNotEmpty) {
      out.add('${fieldErrors.length} field(s) need attention.');
    }
    if (signatureFieldErrors.isNotEmpty) {
      out.add('${signatureFieldErrors.length} signature(s) are required.');
    }
    if (missingNotes.isNotEmpty) {
      out.add(
        '${missingNotes.length} item(s) need a remark explaining the mark.',
      );
    }
    if (unsatisfiedGroups.isNotEmpty) {
      out.add(
        '${unsatisfiedGroups.length} reading group(s) need at least one '
        'value.',
      );
    }
    if (!primarySignatureOk) {
      out.add('A signature is required to submit this sheet.');
    }
    return out;
  }

  @override
  String toString() => 'ChecklistSubmitGate(canSubmit: $canSubmit)';
}

/// Evaluates every submit-time rule against [answers]/[notes]/[signatures].
///
/// [labelFor]/[optionsFor] are optional hooks so a caller can supply the
/// TRANSLATED label (`checklist_i18n.dart`'s `fieldLabel`) and the resolved
/// shared option set (`fieldOptionValues`) - see [validateSubmission]'s own
/// doc comment for why that matters.
ChecklistSubmitGate evaluateChecklistSubmitGate({
  required ChecklistTemplate? template,
  required Map<String, Object?> answers,
  required Map<String, Object?> notes,
  required Map<String, Object?> signatures,
  Map<String, int> photoCounts = const <String, int>{},
  bool? templateRequiresSignature,
  String? primarySignature,
  String Function(ChecklistField field)? labelFor,
  List<String> Function(ChecklistField field)? optionsFor,
}) {
  final ChecklistValidationResult fieldResult = validateSubmission(
    template?.fields,
    answers,
    labelFor: labelFor,
    optionsFor: optionsFor,
  );
  final Map<String, String> fieldErrors = <String, String>{
    ...fieldResult.errors,
  };
  for (final ChecklistField field in visibleChecklistFields(
    template?.fields,
    answers,
  )) {
    final int minimum = _minimumPhotoCount(field);
    if (minimum > 0 && (photoCounts[field.id] ?? 0) < minimum) {
      fieldErrors[field.id] = minimum == 1
          ? 'A photo is required.'
          : '$minimum photos are required.';
    }
  }

  return ChecklistSubmitGate(
    fieldErrors: fieldErrors,
    signatureFieldErrors: validateSignatureFields(
      template?.fields,
      signatures,
      answers,
      labelFor,
    ),
    missingNotes: missingNotes(template, answers, notes),
    unsatisfiedGroups: unsatisfiedGroups(template, answers),
    primarySignatureOk: primarySignatureSatisfied(
      templateRequiresSignature: templateRequiresSignature,
      fields: template?.fields,
      signatures: signatures,
      primary: primarySignature,
    ),
  );
}

int _minimumPhotoCount(ChecklistField field) {
  for (final String key in const <String>['min_photos', 'photo_min']) {
    final Object? raw = field.extra[key];
    final int? parsed = switch (raw) {
      final int value => value,
      final num value => value.toInt(),
      final String value => int.tryParse(value.trim()),
      _ => null,
    };
    if (parsed != null && parsed > 0) return parsed;
  }
  return field.type == 'photo' && field.required ? 1 : 0;
}
