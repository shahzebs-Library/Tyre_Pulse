/// The checklist template model, and the ONE split this whole engine is
/// built to preserve.
///
/// Ported per `docs/flutter-migration/08-checklist-engine-parity-tests.md`
/// sections 3 and 9. Deliberately carries NO `fromJson` - see the library
/// comment on `checklist_option_set.dart` for why (the live shape of
/// `option_sets`/`name_i18n`/`description_i18n` is flagged UNVERIFIED in
/// artifact section 11; both source stacks build template fixtures by hand
/// in their own tests rather than decoding a real row, and this port does
/// the same).
///
/// [answerableFields]/[visibleAnswerableFields] are the two functions the
/// artifact's own text singles out as "the single most important comment
/// in the engine" (`checklistMarks.ts:139-155`), quoted here in full
/// because getting this backwards produces two different, both-bad
/// failures:
///
///   REQUIREMENTS use [visibleAnswerableFields]. Demanding a remark, or a
///   meter reading, on a line the operator cannot see is a demand they can
///   never satisfy - the sheet simply refuses to submit and nothing on
///   screen explains why.
///
///   THE BLOCKING CHECK in `checklist_marks.dart` deliberately does NOT.
///   `guard_checklist_approval_stages` scans the whole `answers` object and
///   knows nothing about visibility, so if that side skipped a hidden field
///   carrying a stale "Not OK" the screen would say the sheet is closable
///   and the server would then refuse it with a raw 22023 the approver
///   cannot act on. Agreeing with the database matters more here than being
///   clever.
///
/// Both live in THIS file (rather than one each in the modules that
/// consume them) because both `checklist_marks.dart` (blocking/notes/meter
/// groups) and `checklist_auto_fill.dart` (register prefill) need them, and
/// putting them in either module would make the other import it for an
/// unrelated reason.
library;

import 'package:tyre_pulse/features/checklists/domain/checklist_field.dart';
import 'package:tyre_pulse/features/checklists/domain/checklist_option_set.dart';
import 'package:tyre_pulse/features/checklists/domain/checklist_visibility.dart';

/// A checklist template - the fields that make it up, its shared option
/// sets, and who it targets.
final class ChecklistTemplate {
  const ChecklistTemplate({
    this.id,
    this.name,
    this.fields = const <ChecklistField>[],
    this.optionSets = const <String, ChecklistOptionSet>{},
    this.assigneeRoles,
  });

  final String? id;
  final String? name;
  final List<ChecklistField> fields;

  /// `checklist_templates.option_sets`, keyed by set name (`'legend'` is
  /// the ONLY key any live template is known to use today, and the
  /// database's own blocking-close trigger hard-codes that exact key - see
  /// `checklist_marks.dart`'s `serverBlockingMatches`).
  final Map<String, ChecklistOptionSet> optionSets;

  /// `checklist_templates.assignee_roles`. `null` OR an empty list BOTH
  /// mean "every role" - see `checklist_targeting.dart`. Deliberately kept
  /// as the raw, un-normalised names a template author typed (Title Case,
  /// e.g. `'Tyre Man'`); normalisation happens at the COMPARISON point in
  /// `checklist_targeting.dart`, never here.
  final List<String>? assigneeRoles;

  @override
  String toString() => 'ChecklistTemplate(id: $id, name: $name)';
}

/// Every non-section field of [template], REGARDLESS of `visibleWhen`.
/// The base list both [visibleAnswerableFields] and the blocking check in
/// `checklist_marks.dart` build from.
List<ChecklistField> answerableFields(ChecklistTemplate? template) {
  return <ChecklistField>[
    for (final ChecklistField f in template?.fields ?? const <ChecklistField>[])
      if (f.type != 'section') f,
  ];
}

/// The same list, minus fields a `visibleWhen` rule is currently hiding.
/// See the library comment above for which callers must use this instead
/// of [answerableFields].
List<ChecklistField> visibleAnswerableFields(
  ChecklistTemplate? template,
  Map<String, Object?> answers,
) {
  return <ChecklistField>[
    for (final ChecklistField f in answerableFields(template))
      if (isFieldVisible(f, answers)) f,
  ];
}
