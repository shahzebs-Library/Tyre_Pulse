/// Checklist content language resolution - "what does this line say in the
/// reader's language", and the invariant that makes a translated checklist
/// safe to score, export and compare across submissions.
///
/// Ported per `docs/flutter-migration/08-checklist-engine-parity-tests.md`
/// section 2 and section 10 group B, mirroring the RUNTIME subset of
/// `mobile/lib/checklistI18n.ts` (this file deliberately does NOT port the
/// web-only builder helpers `hasTranslations`/`translatedLangs`/
/// `missingTranslations`/`translationCoverage`/`optionSetNames` from
/// `src/lib/checklist/checklistI18n.js` - those support a template-authoring
/// screen, which this phase does not build, per the "prefer the MOBILE
/// shape" instruction where the two stacks diverge).
///
/// THE INVARIANT THAT MATTERS MOST, carried over verbatim from
/// `checklistI18n.ts:19-24`: the stored ANSWER is ALWAYS the English option
/// value, whatever language it was displayed in. An answer whose meaning
/// changes with the reader's language cannot be compared across
/// submissions, scored, exported or reported on. It is enforced
/// STRUCTURALLY here, not by discipline: every resolver returns
/// [ChecklistFieldOption] `{value, label}` pairs, so a caller cannot
/// accidentally store the translation - `value` is always the untranslated
/// English option, `label` is what to SHOW.
///
/// DELIBERATE DIVERGENCE FROM THE WEB STACK, noted per this port's brief:
/// mobile's `fieldLabel` falls back to `''` for a field with neither a
/// translation nor an English `label` at all, while the WEB test suite
/// (`src/test/checklistI18n.test.js:85-90`) shows the web resolver falling
/// back further, to the field's own `id`. This Dart port follows MOBILE
/// (empty string), because this is a mobile-app rewrite and
/// `mobile/lib/checklistI18n.ts:81-89` is unambiguous about it - see this
/// port's final report for the full reasoning.
library;

import 'package:tyre_pulse/features/checklists/domain/checklist_field.dart';
import 'package:tyre_pulse/features/checklists/domain/checklist_option_set.dart';
import 'package:tyre_pulse/features/checklists/domain/checklist_template.dart';

/// One language a checklist's CONTENT (not the app's own UI chrome) may be
/// written in. A different axis from the app's UI language - a paper
/// checklist has to be readable by mechanics who read Hindi or Urdu even
/// though the app itself ships only English and Arabic UI locales (artifact
/// section 11, known gap 3 - carried forward, not solved here).
final class ChecklistLang {
  const ChecklistLang({
    required this.code,
    required this.label,
    required this.native,
    required this.isRtl,
  });

  final String code;
  final String label;
  final String native;
  final bool isRtl;

  @override
  String toString() => 'ChecklistLang($code)';
}

const List<ChecklistLang> kChecklistLangs = <ChecklistLang>[
  ChecklistLang(code: 'en', label: 'English', native: 'English', isRtl: false),
  ChecklistLang(code: 'ar', label: 'Arabic', native: 'العربية', isRtl: true),
  ChecklistLang(code: 'hi', label: 'Hindi', native: 'हिन्दी', isRtl: false),
  ChecklistLang(code: 'ur', label: 'Urdu', native: 'اردو', isRtl: true),
];

/// English is the source language: always present, always the fallback.
const String kChecklistDefaultLang = 'en';

final Map<String, ChecklistLang> _kLangByCode = <String, ChecklistLang>{
  for (final ChecklistLang l in kChecklistLangs) l.code: l,
};

bool isChecklistLang(Object? code) =>
    code is String && _kLangByCode.containsKey(code);

/// Coerces anything to a supported language code; an unknown or non-string
/// value falls back to English.
String normalizeLang(Object? code) =>
    isChecklistLang(code) ? code! as String : kChecklistDefaultLang;

bool isRtlLang(Object? code) => _kLangByCode[normalizeLang(code)]!.isRtl;

ChecklistLang langMeta(Object? code) => _kLangByCode[normalizeLang(code)]!;

/// A usable translated string: non-null, non-blank once trimmed. A value
/// stored as `''` (or anything not a string at all) counts as "not
/// translated" so the caller falls back rather than rendering an empty
/// line or a stringified number.
String? _usable(Object? v) {
  if (v is! String) return null;
  return v.trim().isEmpty ? null : v;
}

/// The field's label in [lang], falling back to English, falling back to
/// `''` when there is no label at all. See the library comment for why
/// this does NOT fall back to the field id, unlike the web stack.
String fieldLabel(
  ChecklistField? field, [
  Object? lang = kChecklistDefaultLang,
]) {
  if (field == null) return '';
  final String code = normalizeLang(lang);
  if (code != kChecklistDefaultLang) {
    final String? t = _usable(field.labels[code]);
    if (t != null) return t;
  }
  return _usable(field.label) ?? '';
}

/// The template's shared option set named by [ref], or `null` when there is
/// none USABLE - covers a missing ref, a ref naming nothing, AND a set
/// whose [ChecklistOptionSet.options] is empty (artifact B3). The caller
/// then falls back to the field's own options, which is exactly why a field
/// keeps a copy even when it points at a shared set.
ChecklistOptionSet? _usableOptionSet(ChecklistTemplate? template, String? ref) {
  if (template == null || ref == null || ref.isEmpty) return null;
  final ChecklistOptionSet? set = template.optionSets[ref];
  if (set == null || set.options.isEmpty) return null;
  return set;
}

/// One resolved choice: [value] is ALWAYS the English option to store,
/// [label] is what to show. See the library comment on the English-value
/// invariant.
final class ChecklistFieldOption {
  const ChecklistFieldOption({required this.value, required this.label});

  final String value;
  final String label;

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      (other is ChecklistFieldOption &&
          other.value == value &&
          other.label == label);

  @override
  int get hashCode => Object.hash(value, label);

  @override
  String toString() => 'ChecklistFieldOption(value: $value, label: $label)';
}

/// The choices for [field], resolved in this order (artifact section 2):
///   1. `field.optionsRef` against `template.optionSets` - THE LIVE SOURCE,
///      and the shared list WINS even when it differs from the field's own
///      stale copy (B2) - the field's own copy is EXPECTED to drift once an
///      admin edits the shared legend.
///   2. the field's own `options` + `optionsI18n` - a FALLBACK, reached
///      when there is no ref, or the ref names nothing usable (B3).
///
/// [ChecklistFieldOption.value] is always the untranslated English option.
/// A translation array shorter than the option list falls back to English
/// PER INDEX (B4), never blank; a language with no translation array at all
/// falls back to English wholesale (B5); a translation that is blank or not
/// a string is treated the same as absent (B6).
List<ChecklistFieldOption> fieldOptions(
  ChecklistField? field, [
  ChecklistTemplate? template,
  Object? lang = kChecklistDefaultLang,
]) {
  if (field == null) return const <ChecklistFieldOption>[];
  final String code = normalizeLang(lang);
  final ChecklistOptionSet? shared = _usableOptionSet(
    template,
    field.optionsRef,
  );
  final List<String> values = shared?.options ?? field.options;
  final List<String>? translated = code == kChecklistDefaultLang
      ? null
      : (shared != null ? shared.i18n[code] : field.optionsI18n[code]);

  return <ChecklistFieldOption>[
    for (int i = 0; i < values.length; i++)
      ChecklistFieldOption(
        value: values[i],
        label:
            _usable(
              translated != null && i < translated.length
                  ? translated[i]
                  : null,
            ) ??
            values[i],
      ),
  ];
}

/// Just the storable English values, in display order. Use THIS to
/// validate a select/multiselect answer - never the field's raw `options`
/// list directly, which may be stale relative to a shared set (B8).
List<String> fieldOptionValues(
  ChecklistField? field, [
  ChecklistTemplate? template,
]) => <String>[
  for (final ChecklistFieldOption o in fieldOptions(field, template)) o.value,
];

/// The display label for an already-stored (English) [value]. An unknown
/// value renders AS ITSELF rather than blank (B7) - a retired option must
/// still be legible on a historical submission.
String optionLabel(
  ChecklistField? field,
  ChecklistTemplate? template,
  Object? value, [
  Object? lang = kChecklistDefaultLang,
]) {
  final String v = value?.toString() ?? '';
  if (v.isEmpty) return '';
  for (final ChecklistFieldOption o in fieldOptions(field, template, lang)) {
    if (o.value == v) return o.label;
  }
  return v;
}
