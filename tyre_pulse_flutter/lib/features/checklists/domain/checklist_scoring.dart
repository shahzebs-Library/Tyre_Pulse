/// Weighted scoring - the last piece of section 5 ("Validation and
/// completeness") that section 10's group tables do not number a case
/// for, but which section 5 itself documents in full
/// (`docs/flutter-migration/08-checklist-engine-parity-tests.md`,
/// "Scoring"). Mirrors `computeScore` in
/// `src/lib/checklist/fieldTypes.js:256-276`
/// (`mobile/lib/checklistFields.ts:368-388` - identical on both stacks).
///
/// Included for completeness of section 5's scope even though no numbered
/// artifact test case exercises it; see this port's final report for the
/// judgement call. Only computed at all when a template's `scored` flag is
/// true - a decision that belongs to whatever screen consumes this
/// engine, not to this pure function.
library;

import 'package:tyre_pulse/features/checklists/domain/checklist_field.dart';
import 'package:tyre_pulse/features/checklists/domain/checklist_visibility.dart';

/// The result of [computeScore].
final class ChecklistScore {
  const ChecklistScore({
    required this.scored,
    required this.earned,
    required this.possible,
    required this.pct,
    required this.passed,
  });

  /// How many fields counted at all (had a finite, positive weight and
  /// were visible).
  final int scored;
  final num earned;
  final num possible;

  /// `Math.round(earned / possible * 100)`, or `null` when [possible] is 0
  /// - never a fabricated 0% or 100%.
  final int? pct;

  /// `pct >= passThreshold`, or `null` when either [pct] or the caller's
  /// threshold is unavailable.
  final bool? passed;

  @override
  String toString() =>
      'ChecklistScore(pct: $pct, passed: $passed, earned: $earned/$possible)';
}

/// Computes a weighted score for [answers] against [fields].
///
/// Only fields with a FINITE, POSITIVE [ChecklistField.weight] count; a
/// layout field never counts. HIDDEN fields are excluded. A field passes
/// when its answer is in [ChecklistField.passValues], or - when that list
/// is empty - when the answer is merely non-empty. An ARRAY answer passes
/// when ANY element is in `passValues`.
ChecklistScore computeScore(
  List<ChecklistField>? fields,
  Map<String, Object?> answers, [
  num? passThreshold,
]) {
  num earned = 0;
  num possible = 0;
  int scored = 0;
  for (final ChecklistField f in fields ?? const <ChecklistField>[]) {
    final num? w = f.weight;
    if (f.type == 'section' || w == null || !w.isFinite || w <= 0) continue;
    if (!isFieldVisible(f, answers)) continue;
    scored += 1;
    possible += w;
    final Object? val = answers[f.id];
    final bool pass;
    if (f.passValues.isNotEmpty) {
      pass = val is List
          ? val.any((Object? v) => f.passValues.contains(v))
          : f.passValues.contains(val);
    } else {
      pass = !(val == null || val == '' || (val is List && val.isEmpty));
    }
    if (pass) earned += w;
  }
  final int? pct = possible > 0 ? (earned / possible * 100).round() : null;
  final bool? passed =
      (pct != null && passThreshold != null) ? pct >= passThreshold : null;
  return ChecklistScore(
    scored: scored,
    earned: earned,
    possible: possible,
    pct: pct,
    passed: passed,
  );
}
