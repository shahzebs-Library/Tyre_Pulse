/// What a mark MEANS, and what it stops - blocking marks, required notes,
/// meter groups, and the close-gate.
///
/// Ported per `docs/flutter-migration/08-checklist-engine-parity-tests.md`
/// section 3 ("the hidden-field asymmetry"), section 5 ("group_require_one",
/// "require_note"), section 10 groups D, G (G10-G12) and H, and section 11
/// ("THE DIVERGENCE THAT MATTERS MOST"). Mirrors
/// `mobile/lib/checklistMarks.ts` - pinned identical to the web
/// `src/lib/checklist/checklistMarks.js` by that repo's own drift test, so
/// there is no mobile/web choice to make here.
///
/// THE ONE RULE WORTH REMEMBERING, carried over verbatim: a blocking mark
/// stops a sheet being CLOSED, never being SUBMITTED. A mechanic who finds a
/// fault on the last item of the day must still be able to record it and go
/// home; what must not happen is that fault being signed off as done. The
/// database enforces the identical split in `guard_checklist_approval_stages`.
///
/// # THE MOST IMPORTANT CORRECTION IN THIS WHOLE PORT
///
/// The artifact devotes its entire closing section to a real divergence
/// between the client engine this file is ported from and the live
/// database trigger, in BOTH directions, none of it theoretical:
///
///   - a `text`/`textarea` field where someone typed the literal string
///     `'Not OK'` BLOCKS on the server (a flat scan of every answer VALUE)
///     but would NOT block a naive field-aware port (that field's own
///     option set declares no `blocking` list at all) - "the screen says
///     closable; the approver signs; the server refuses with a raw 22023.
///     Exactly the failure the client mirror exists to prevent."
///   - a field pointing at an option set keyed by something other than
///     `'legend'` blocks a naive field-aware port but NOT the server (the
///     trigger's path is hard-coded to `option_sets #> '{legend,blocking}'`)
///   - a multiselect answer `['Not OK']` blocks a naive field-aware port
///     (it walks array members) but NOT the server, because
///     `jsonb_each_text` yields the ARRAY'S text form (`'["Not OK"]'`), not
///     its member's
///
/// The artifact's own instruction, quoted verbatim: "mirror the SERVER's
/// algorithm for the blocking gate - scan the flat answer values against
/// the template's `{legend,blocking}` array - and keep the field-aware
/// version ONLY for naming which line is at fault. Do not 'improve' on the
/// server here."
///
/// [canClose] therefore computes [ChecklistCloseCheck.ok] from
/// [serverBlockingMatches] (the flat, template-blind mirror of the SQL
/// trigger body at `MIGRATIONS_V595_WORKSHOP_DAILY_CHECKLIST.sql:278-286`),
/// NEVER from [blockingAnswers] (the friendlier, field-aware walk kept only
/// to populate [ChecklistCloseCheck.blocking] for display). A future caller
/// must not "simplify" this by deciding [ok] from the field-aware list -
/// that is precisely the class of bug this file exists to prevent.
library;

import 'package:tyre_pulse/features/checklists/domain/checklist_field.dart';
import 'package:tyre_pulse/features/checklists/domain/checklist_option_set.dart';
import 'package:tyre_pulse/features/checklists/domain/checklist_template.dart';

/// The four mark colour tones. NOT an icon library mapping - see the note
/// on [kMarkIcons].
enum MarkTone { good, bad, fixed, muted }

/// Icon TOKEN (e.g. `'fault'`) to its DEFAULT tone, mirroring the `tone`
/// half of `MARK_ICONS` in `checklistMarks.ts:30-39`.
///
/// Deliberately does NOT carry the actual glyph name (`ionicon`/`lucide` in
/// the source). Both source stacks map the SAME token to a DIFFERENT glyph
/// name per platform - "a name that is valid in lucide means nothing to
/// Ionicons" (`checklistMarks.js:24-27`) - which is exactly why a Flutter
/// equivalent (a `Map<String, IconData>`) is a presentation-layer decision
/// for whichever later phase builds the fill screen, not a domain-layer
/// one. This map exists only so [markMeta] can validate a stored icon
/// token and fall back to its tone.
const Map<String, MarkTone> kMarkIcons = <String, MarkTone>{
  'ok': MarkTone.good,
  'fault': MarkTone.bad,
  'na': MarkTone.muted,
  'swap': MarkTone.fixed,
  'repair': MarkTone.fixed,
  'topup': MarkTone.fixed,
  'adjust': MarkTone.fixed,
  'lubricant': MarkTone.fixed,
};

const String _kDefaultIcon = 'na';

/// Everything known about one mark VALUE, resolved against an option set's
/// `meta` list. Always a real object, never `null`: an answer recorded
/// before the meta existed, or a value somebody typed by hand, must still
/// render rather than crashing the row it sits on (H6).
final class MarkInfo {
  const MarkInfo({
    required this.value,
    required this.icon,
    required this.tone,
    required this.meaning,
    required this.known,
  });

  final String value;

  /// A key of [kMarkIcons]. Falls back to `'na'` when the meta names an
  /// icon token this map does not recognise (H7).
  final String icon;
  final MarkTone tone;

  /// `''` when the meta carries no meaning, or none was found at all.
  final String meaning;

  /// Whether [value] matched a real `meta` entry at all.
  final bool known;

  @override
  String toString() => 'MarkInfo(value: $value, icon: $icon, known: $known)';
}

bool _isMarkTone(Object? v) {
  if (v is! String) return false;
  switch (v) {
    case 'good':
    case 'bad':
    case 'fixed':
    case 'muted':
      return true;
    default:
      return false;
  }
}

MarkTone _markToneOf(String v) => MarkTone.values.byName(v);

/// Everything known about [value] under [optionSet].
MarkInfo markMeta(ChecklistOptionSet? optionSet, Object? value) {
  final String v = value?.toString() ?? '';
  ChecklistOptionMeta? hit;
  for (final ChecklistOptionMeta m in optionSet?.meta ?? const <ChecklistOptionMeta>[]) {
    if ((m.value ?? '') == v) {
      hit = m;
      break;
    }
  }
  final String icon = (hit?.icon != null && kMarkIcons.containsKey(hit!.icon))
      ? hit.icon!
      : _kDefaultIcon;
  final MarkTone tone = _isMarkTone(hit?.tone)
      ? _markToneOf(hit!.tone!)
      : kMarkIcons[icon]!;
  return MarkInfo(
    value: v,
    icon: icon,
    tone: tone,
    meaning: (hit?.meaning != null && hit!.meaning!.isNotEmpty) ? hit.meaning! : '',
    known: hit != null,
  );
}

/// Marks that stop a sheet being CLOSED. Empty when [optionSet] declares
/// none (H4).
List<String> blockingMarks(ChecklistOptionSet? optionSet) =>
    optionSet?.blocking ?? const <String>[];

/// Marks that must carry a remark, or the mark says nothing useful.
List<String> noteRequiredMarks(ChecklistOptionSet? optionSet) =>
    optionSet?.requireNote ?? const <String>[];

/// The option set [field] answers against, for the MARKS engine: its shared
/// ref (`field.optionsRef` against `template.optionSets`), else its own
/// `options` copy wrapped bare (no `blocking`/`meta`/`requireNote` of its
/// own - a field with only a raw `options` list has none of those).
///
/// A DIFFERENT resolver from `checklist_i18n.dart`'s `fieldOptions` - see
/// `checklist_option_set.dart`'s library comment for the deliberate
/// divergence: this one returns the shared set AS-IS whenever the
/// reference resolves to anything at all, with NO "empty options falls
/// back" check of its own.
ChecklistOptionSet? fieldOptionSet(
  ChecklistTemplate? template,
  ChecklistField? field,
) {
  if (field == null) return null;
  final String? ref = field.optionsRef;
  final ChecklistOptionSet? shared =
      (ref != null && ref.isNotEmpty) ? template?.optionSets[ref] : null;
  if (shared != null) return shared;
  if (field.options.isNotEmpty) return ChecklistOptionSet(options: field.options);
  return null;
}

/// One answer that blocks a close: which field, its label, and the
/// matching value.
final class BlockingAnswer {
  const BlockingAnswer({required this.id, required this.label, required this.value});

  final String id;
  final String label;
  final String value;

  @override
  String toString() => 'BlockingAnswer(id: $id, value: $value)';
}

/// The FRIENDLY, field-aware walk: for every answerable field (regardless
/// of visibility - see `checklist_template.dart`'s library comment), read
/// its own resolved option set and check whether its answer is in that
/// set's `blocking` list.
///
/// USED ONLY TO NAME which line is probably at fault - see the library
/// comment for why this must never be read to decide whether a sheet can
/// close. An array answer blocks on ANY member but is reported once per
/// field (H5), matching the source's own `break`.
List<BlockingAnswer> blockingAnswers(
  ChecklistTemplate? template,
  Map<String, Object?> answers,
) {
  final List<BlockingAnswer> out = <BlockingAnswer>[];
  for (final ChecklistField field in answerableFields(template)) {
    final ChecklistOptionSet? set = fieldOptionSet(template, field);
    final List<String> blocking = blockingMarks(set);
    if (blocking.isEmpty) continue;
    final Object? v = answers[field.id];
    final List<Object?> values = v is List ? v : <Object?>[v];
    for (final Object? one in values) {
      if (one != null && blocking.contains(one.toString())) {
        out.add(
          BlockingAnswer(
            id: field.id,
            label: field.label ?? field.id,
            value: one.toString(),
          ),
        );
        break;
      }
    }
  }
  return out;
}

/// A field reference by id and label - what [missingNotes] and
/// [UnsatisfiedGroup.fields] report.
final class ChecklistFieldRef {
  const ChecklistFieldRef({required this.id, required this.label});

  final String id;
  final String label;

  @override
  String toString() => 'ChecklistFieldRef(id: $id)';
}

/// Fields whose mark demands a remark and has none.
///
/// Iterates [visibleAnswerableFields] DELIBERATELY (unlike [blockingAnswers]
/// above) - demanding a remark on a line the operator cannot see is a
/// demand they can never satisfy (D1/D2, section 3's asymmetry).
///
/// 1. skip a field with `allowNote == false` EXACTLY - `null`/unset does
///    NOT skip (see [ChecklistField.allowNote]'s own doc comment)
/// 2. the demand set is the UNION of the option set's own `requireNote`
///    and the field's own `requireNoteWhen`
/// 3. skip when that union is empty
/// 4. skip unless the answer (or any element of an array answer) is a
///    member of the union
/// 5. report when the recorded note is blank once trimmed - whitespace is
///    not a remark
List<ChecklistFieldRef> missingNotes(
  ChecklistTemplate? template,
  Map<String, Object?> answers,
  Map<String, Object?> notes,
) {
  final List<ChecklistFieldRef> out = <ChecklistFieldRef>[];
  for (final ChecklistField field in visibleAnswerableFields(template, answers)) {
    if (field.allowNote == false) continue;
    final ChecklistOptionSet? set = fieldOptionSet(template, field);
    final Set<String> needs = <String>{
      ...noteRequiredMarks(set),
      ...field.requireNoteWhen,
    };
    if (needs.isEmpty) continue;
    final Object? v = answers[field.id];
    final List<Object?> values = v is List ? v : <Object?>[v];
    final bool applies = values.any(
      (Object? one) => one != null && needs.contains(one.toString()),
    );
    if (!applies) continue;
    final String note = notes[field.id]?.toString() ?? '';
    if (note.trim().isEmpty) {
      out.add(ChecklistFieldRef(id: field.id, label: field.label ?? field.id));
    }
  }
  return out;
}

/// Fields sharing a `groupRequireOne` name, keyed by that name, built from
/// VISIBLE answerable fields only (a hidden group cannot be demanded -
/// D3).
Map<String, List<ChecklistField>> meterGroups(
  ChecklistTemplate? template,
  Map<String, Object?> answers,
) {
  final Map<String, List<ChecklistField>> groups = <String, List<ChecklistField>>{};
  for (final ChecklistField field in visibleAnswerableFields(template, answers)) {
    final String? g = field.groupRequireOne;
    if (g == null || g.isEmpty) continue;
    groups.putIfAbsent(g, () => <ChecklistField>[]).add(field);
  }
  return groups;
}

/// One `groupRequireOne` group that has no answered member yet.
final class UnsatisfiedGroup {
  const UnsatisfiedGroup({required this.group, required this.fields});

  final String group;
  final List<ChecklistFieldRef> fields;

  @override
  String toString() => 'UnsatisfiedGroup($group)';
}

/// Groups where NO member has a non-blank answer.
///
/// The satisfaction test is `v != null && v.toString().trim().isNotEmpty`.
/// ZERO IS A READING (G11) - `0.toString().trim()` is `'0'`, non-empty. A
/// whitespace-only string is NOT a reading (G12).
List<UnsatisfiedGroup> unsatisfiedGroups(
  ChecklistTemplate? template,
  Map<String, Object?> answers,
) {
  final List<UnsatisfiedGroup> out = <UnsatisfiedGroup>[];
  meterGroups(template, answers).forEach((String name, List<ChecklistField> fields) {
    final bool any = fields.any((ChecklistField f) {
      final Object? v = answers[f.id];
      return v != null && v.toString().trim().isNotEmpty;
    });
    if (!any) {
      out.add(
        UnsatisfiedGroup(
          group: name,
          fields: <ChecklistFieldRef>[
            for (final ChecklistField f in fields)
              ChecklistFieldRef(id: f.id, label: f.label ?? f.id),
          ],
        ),
      );
    }
  });
  return out;
}

/// The value's TEXT form the way Postgres `jsonb_each_text` produces it,
/// for [serverBlockingMatches]: a scalar JSON string as-is (unquoted); a
/// number or boolean stringified; an array or object re-encoded as compact
/// JSON (mirroring the `::text` cast of a jsonb container value, which
/// preserves JSON syntax rather than unwrapping it - this is precisely why
/// a multiselect answer `['Not OK']` does NOT match a blocking list
/// containing the bare string `'Not OK'`). `null` has no text form under
/// `jsonb_each_text` and is excluded by the caller.
String? _postgresJsonbText(Object? value) {
  if (value == null) return null;
  if (value is String) return value;
  if (value is num || value is bool) return value.toString();
  if (value is List || value is Map) {
    return _compactJson(value);
  }
  return value.toString();
}

/// A minimal, dependency-free compact-JSON encoder covering exactly the
/// shapes an `answers` value can hold (nested strings/numbers/bools/
/// nulls/lists/maps) - avoids pulling `dart:convert`'s `jsonEncode` into a
/// file whose only other need for it would be this one call, and gives
/// full control over matching Postgres's own no-whitespace jsonb text
/// form.
String _compactJson(Object? v) {
  if (v == null) return 'null';
  if (v is String) return _jsonStringLiteral(v);
  if (v is bool) return v.toString();
  if (v is num) return v.toString();
  if (v is List) {
    return '[${v.map(_compactJson).join(',')}]';
  }
  if (v is Map) {
    final StringBuffer buf = StringBuffer('{');
    bool first = true;
    v.forEach((Object? k, Object? val) {
      if (!first) buf.write(',');
      first = false;
      buf
        ..write(_jsonStringLiteral(k.toString()))
        ..write(':')
        ..write(_compactJson(val));
    });
    buf.write('}');
    return buf.toString();
  }
  return _jsonStringLiteral(v.toString());
}

String _jsonStringLiteral(String s) {
  final StringBuffer buf = StringBuffer('"');
  for (final int code in s.runes) {
    switch (code) {
      case 0x22:
        buf.write(r'\"');
      case 0x5c:
        buf.write(r'\\');
      case 0x0a:
        buf.write(r'\n');
      case 0x0d:
        buf.write(r'\r');
      case 0x09:
        buf.write(r'\t');
      default:
        buf.writeCharCode(code);
    }
  }
  buf.write('"');
  return buf.toString();
}

/// THE SERVER'S OWN ANSWER to "does this sheet have a blocking mark on it
/// anywhere" - a flat, template-blind, FIELD-BLIND scan of every value in
/// [answers] against `template.optionSets['legend'].blocking` (the
/// database trigger's hard-coded path, `option_sets #> '{legend,blocking}'`
/// - see the library comment). Returns the DISTINCT matching text values,
/// mirroring the trigger's own `string_agg(distinct a.value, ', ')`.
///
/// This is deliberately NOT field-aware: a completely unrelated `text`
/// field whose answer happens to equal a blocking mark's exact string
/// counts, exactly as it does in the live database. THIS is the function
/// [canClose] uses to decide whether a sheet can close - never
/// [blockingAnswers].
List<String> serverBlockingMatches(
  ChecklistTemplate? template,
  Map<String, Object?> answers,
) {
  final List<String> blocking = template?.optionSets['legend']?.blocking ?? const <String>[];
  if (blocking.isEmpty) return const <String>[];
  final Set<String> matched = <String>{};
  for (final Object? raw in answers.values) {
    final String? text = _postgresJsonbText(raw);
    if (text != null && blocking.contains(text)) matched.add(text);
  }
  return matched.toList(growable: false);
}

/// Can this sheet be CLOSED?
///
/// [ok] mirrors the database trigger EXACTLY via [serverBlockingMatches] -
/// see this file's library comment for why. [blocking] is the friendly,
/// field-aware [blockingAnswers] list, kept ONLY so a screen can name which
/// lines are probably at fault; it must never be consulted to decide [ok].
final class ChecklistCloseCheck {
  const ChecklistCloseCheck({required this.ok, required this.blocking});

  final bool ok;
  final List<BlockingAnswer> blocking;

  @override
  String toString() => 'ChecklistCloseCheck(ok: $ok, blocking: $blocking)';
}

ChecklistCloseCheck canClose(
  ChecklistTemplate? template,
  Map<String, Object?> answers,
) {
  final bool blocked = serverBlockingMatches(template, answers).isNotEmpty;
  return ChecklistCloseCheck(
    ok: !blocked,
    blocking: blockingAnswers(template, answers),
  );
}
