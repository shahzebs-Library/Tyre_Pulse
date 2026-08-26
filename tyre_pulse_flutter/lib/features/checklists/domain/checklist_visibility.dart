/// Conditional visibility - `field.visibleWhen`.
///
/// Ported per `docs/flutter-migration/08-checklist-engine-parity-tests.md`
/// section 3, mirroring `evalCondition`/`isFieldVisible`/`visibleFields` in
/// `src/lib/checklist/fieldTypes.js:187-247` (identical on both stacks -
/// `mobile/lib/checklistFields.ts:172-224`).
///
/// THREE independent guards fail OPEN, all deliberately, all quoted from
/// `fieldTypes.js:221-223`: "A malformed/incomplete rule fails open so a
/// misconfigured template never hides everything."
///   1. no condition, no `field`, or no `op` on it -> visible
///   2. an operator not in [kChecklistConditionOps] -> visible
///   3. [evalChecklistCondition]'s fallback branch -> `true`
///
/// `includes` and `in` are easy to swap and ask OPPOSITE questions:
/// `includes` asks "does the ANSWER contain this value" (array membership,
/// or a substring test when the answer is not an array); `in` asks "is the
/// ANSWER one of these values" (the answer tested against an expected
/// array). The web comment names the `in` use case directly: "this check
/// applies to vehicle types X/Y/Z".
library;

import 'package:tyre_pulse/features/checklists/domain/checklist_field.dart';

/// The ten recognised `visibleWhen` operators, in source order.
const List<String> kChecklistConditionOps = <String>[
  '=',
  '!=',
  '>',
  '>=',
  '<',
  '<=',
  'includes',
  'in',
  'empty',
  'not_empty',
];

/// The value's TEXT form for the `=`/`!=` string comparison, mirroring JS
/// `String(x ?? '')`. `null` becomes `''`; a `List` becomes its elements
/// comma-joined (JS `Array.prototype.toString`), never Dart's bracketed
/// `[a, b]` form - a divergence that would silently break any `=`/`!=`
/// condition tested against a multiselect answer.
String _stringForm(Object? x) {
  if (x == null) return '';
  if (x is List) {
    return x.map((Object? e) => e == null ? '' : e.toString()).join(',');
  }
  return x.toString();
}

/// Coerces [x] to a number for the numeric operators, mirroring JS
/// `Number(x)`: `null` and `''` become NaN (so every comparison against
/// them is false - `double.nan`'s comparison operators already give this
/// for free); a `bool` becomes `1`/`0`; a numeric [String] is parsed after
/// trimming (JS `Number()` ignores surrounding whitespace); anything else
/// that cannot be parsed becomes NaN.
double _numberForm(Object? x) {
  if (x == null) return double.nan;
  if (x is num) return x.toDouble();
  if (x is bool) return x ? 1 : 0;
  if (x is String) {
    final String t = x.trim();
    if (t.isEmpty) return double.nan;
    return double.tryParse(t) ?? double.nan;
  }
  return double.nan;
}

bool _isEmptyValue(Object? x) =>
    x == null || x == '' || (x is List && x.isEmpty);

/// Compares [actual] (an answer) against [expected] (the condition's own
/// value) under [op]. Pure, null-safe; an unrecognised [op] returns `true`
/// (fails open) rather than throwing.
bool evalChecklistCondition(String op, Object? actual, Object? expected) {
  switch (op) {
    case '=':
      return _stringForm(actual) == _stringForm(expected);
    case '!=':
      return _stringForm(actual) != _stringForm(expected);
    case '>':
      return _numberForm(actual) > _numberForm(expected);
    case '>=':
      return _numberForm(actual) >= _numberForm(expected);
    case '<':
      return _numberForm(actual) < _numberForm(expected);
    case '<=':
      return _numberForm(actual) <= _numberForm(expected);
    case 'includes':
      if (actual is List) return actual.contains(expected);
      return _stringForm(actual).contains(_stringForm(expected));
    case 'in':
      if (expected is List) {
        final List<String> set = <String>[
          for (final Object? e in expected) _stringForm(e),
        ];
        return set.contains(_stringForm(actual));
      }
      return _stringForm(actual) == _stringForm(expected);
    case 'empty':
      return _isEmptyValue(actual);
    case 'not_empty':
      return !_isEmptyValue(actual);
    default:
      return true;
  }
}

/// A single condition against [answers]. `null`/missing `field`/missing
/// `op` fails open (visible); an `op` not in [kChecklistConditionOps]
/// likewise fails open. Only `field == null || field == ''` counts as
/// "missing" - matching JS `!cond.field`, which a whitespace-only string
/// does NOT satisfy (it is truthy in JS, so a whitespace `field` proceeds
/// to a normal - almost certainly non-matching - lookup rather than
/// failing open).
bool _conditionMet(
  ChecklistVisibleCondition? cond,
  Map<String, Object?> answers,
) {
  if (cond == null) return true;
  final String? field = cond.field;
  final String? op = cond.op;
  if (field == null || field.isEmpty || op == null || op.isEmpty) {
    return true;
  }
  if (!kChecklistConditionOps.contains(op)) return true;
  return evalChecklistCondition(op, answers[field], cond.value);
}

/// Is [field] currently visible given [answers]? `visibleWhen` is empty
/// (no rule) -> always visible. Otherwise EVERY condition must hold - AND
/// only, there is no OR (`List.every` is vacuously true on an empty list
/// too, so this single expression already covers both cases correctly).
bool isFieldVisible(
  ChecklistField? field, [
  Map<String, Object?> answers = const <String, Object?>{},
]) {
  final List<ChecklistVisibleCondition> conditions =
      field?.visibleWhen ?? const <ChecklistVisibleCondition>[];
  if (conditions.isEmpty) return true;
  return conditions.every(
    (ChecklistVisibleCondition c) => _conditionMet(c, answers),
  );
}

/// Visible fields, WITH section pruning: a `section` header is dropped when
/// its next surviving entry (after the visibility filter, not in the
/// template's own declared order) is another `section` or nothing at all -
/// so an interval-scoped sheet never renders an empty category header.
///
/// The pruning is POSITIONAL and runs on the ALREADY-filtered list - a
/// section is judged by what survives after it, not by what the template
/// declares under it (artifact section 3, "Section pruning"; C13/C14).
List<ChecklistField> visibleChecklistFields(
  List<ChecklistField>? fields, [
  Map<String, Object?> answers = const <String, Object?>{},
]) {
  final List<ChecklistField> list = <ChecklistField>[
    for (final ChecklistField f in fields ?? const <ChecklistField>[])
      if (isFieldVisible(f, answers)) f,
  ];
  final List<ChecklistField> out = <ChecklistField>[];
  for (int i = 0; i < list.length; i++) {
    final ChecklistField f = list[i];
    if (f.type != 'section') {
      out.add(f);
      continue;
    }
    final bool nextIsContent = i + 1 < list.length && list[i + 1].type != 'section';
    if (nextIsContent) out.add(f);
  }
  return out;
}
