/// A shared option set - one entry of `checklist_templates.option_sets`.
///
/// Ported per `docs/flutter-migration/08-checklist-engine-parity-tests.md`
/// section 2 ("Shared option sets") and section 10 groups B and H, mirroring
/// the TypeScript `OptionSet` interface at
/// `mobile/lib/checklistMarks.ts:54-60`.
///
/// ONE model serves TWO different resolvers with two different return
/// shapes, exactly as the artifact directs ("Flutter needs both, because the
/// marks engine needs `blocking` and `require_note` which the i18n resolver
/// does not carry"):
///   - `checklist_i18n.dart`'s `optionSet()` reads only [options]/[i18n], and
///     treats an EMPTY [options] list as "no usable set" (returns `null` so
///     the caller falls back to the field's own copy - artifact B3).
///   - `checklist_marks.dart`'s `fieldOptionSet()` reads the WHOLE object
///     (including [meta], [blocking], [requireNote]) and returns it as-is
///     whenever the shared reference resolves to anything at all, with NO
///     "empty options" fallback check of its own - a genuine, deliberate
///     divergence between the two source functions, preserved here rather
///     than "fixed" into one behaviour.
///
/// `checklist_template.dart`'s [ChecklistTemplate] deliberately has no
/// `fromJson` yet, and by extension neither does this type: the exact live
/// shape of `option_sets` is flagged UNVERIFIED in artifact section 11 (no
/// committed migration was found that adds the column). Both stacks build
/// their fixtures by hand in tests rather than by decoding a real row, and
/// this port does the same - see the plain constructor below.
library;

/// One entry of an option set's `meta` array: what one mark VALUE means.
/// Every field is optional, mirroring
/// `Array<{ value?: string; icon?: string; tone?: string; meaning?: string }>`.
final class ChecklistOptionMeta {
  const ChecklistOptionMeta({this.value, this.icon, this.tone, this.meaning});

  final String? value;

  /// The icon TOKEN (e.g. `'fault'`), looked up against
  /// `checklist_marks.dart`'s `kMarkIcons`. NOT a platform glyph name - see
  /// that file's library comment for why the actual icon mapping is left to
  /// a later, presentation-layer phase.
  final String? icon;

  /// A raw tone string, validated against the 4 known [MarkTone] names by
  /// `checklist_marks.dart`'s `markMeta` (an unrecognised value here is
  /// ignored, not coerced).
  final String? tone;

  final String? meaning;

  @override
  String toString() => 'ChecklistOptionMeta(value: $value, icon: $icon)';
}

/// A shared (or field-local) option set.
final class ChecklistOptionSet {
  const ChecklistOptionSet({
    this.options = const <String>[],
    this.i18n = const <String, List<String>>{},
    this.meta = const <ChecklistOptionMeta>[],
    this.blocking = const <String>[],
    this.requireNote = const <String>[],
  });

  /// The English option values, in display order.
  final List<String> options;

  /// Per-language translated option arrays, parallel to [options].
  final Map<String, List<String>> i18n;

  /// What each option VALUE means - looked up by [ChecklistOptionMeta.value].
  final List<ChecklistOptionMeta> meta;

  /// Values that stop a sheet being CLOSED (never SUBMITTED). Empty when the
  /// set declares no blocking marks at all.
  final List<String> blocking;

  /// Values that oblige a remark on the field carrying them, beside that
  /// field's own `require_note_when`.
  final List<String> requireNote;

  @override
  String toString() => 'ChecklistOptionSet(options: $options)';
}
