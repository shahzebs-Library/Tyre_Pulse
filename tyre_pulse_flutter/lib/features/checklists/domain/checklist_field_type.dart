/// The checklist field-type registry: the 14 known field types, the
/// predicates that classify them, and the two small builder-style helpers
/// (`newField`/`newFieldId`) the artifact's group A pins.
///
/// Ported per `docs/flutter-migration/08-checklist-engine-parity-tests.md`
/// section 1 and section 10 group A. The registry entries (label/hasOptions/
/// group/desc/source) are transcribed verbatim from the WEB catalogue,
/// `src/lib/checklist/fieldTypes.js:29-45` (`FIELD_TYPES`) - mobile's own
/// `checklistFields.ts` deliberately carries no such catalogue of its own
/// (it only re-declares the 14-member type union plus the three loose
/// `REFERENCE_TYPES` helpers), so the web source is the only place this
/// data exists at all. The web test `src/test/checklistFieldTypes.test.js`
/// is what the artifact's group A cases are drawn from.
///
/// A THIRD category exists beside "layout" and "value": [isValueField]
/// excludes `section`, `photo` AND `signature` - so the real split is
/// section (renders nothing, stores nothing) / photo+signature (renders a
/// capture control, stores OUTSIDE `answers`) / everything else (stores in
/// `answers`). [isRecordableField] is a mobile-only fourth predicate (every
/// type except `section`) that drives the fill screen's tappable-tile list
/// and progress counter - photo and signature ARE recordable even though
/// they are not value fields.
///
/// `type` is modelled as a plain [String] token everywhere in this domain
/// library, not as a Dart enum, because that is what it actually is at
/// runtime on both the web and mobile stacks: the TypeScript `FieldType`
/// union is a compile-time-only annotation, and a `ChecklistField` decoded
/// from a real template row carries whatever string the database has,
/// recognised or not (artifact A10 - `fieldTypeDef('nonsense')` must return
/// `null` rather than throw, and every predicate below must keep working on
/// an unrecognised token rather than crash the field it is asked about).
/// Modelling `type` as a closed enum would force a decode-time decision
/// ("coerce an unknown type to what?") that the source deliberately never
/// makes - predicates just answer `false`/`null` for anything they do not
/// recognise, and validation and visibility keep working regardless.
library;

import 'dart:math';

import 'package:tyre_pulse/features/checklists/domain/checklist_field.dart';

/// One catalogue entry, mirroring one element of the web `FIELD_TYPES`
/// array.
final class ChecklistFieldTypeDef {
  const ChecklistFieldTypeDef({
    required this.type,
    required this.label,
    required this.hasOptions,
    required this.group,
    required this.desc,
    this.source,
  });

  /// The raw type token, e.g. `'select'`.
  final String type;

  /// The builder's display name for this type, e.g. `'Single choice'`.
  final String label;

  /// Whether the builder shows an options editor for this type. True only
  /// for `select`/`multiselect` (artifact A2) - a reference type resolves
  /// its choices live and is never hand-listed (A6).
  final bool hasOptions;

  /// `'layout'` / `'input'` / `'choice'` / `'reference'` / `'media'`.
  final String group;

  final String desc;

  /// Set only on the 3 reference types (`asset` / `site` / `user`): which
  /// live data source the field resolves against. `null` for every other
  /// type.
  final String? source;

  @override
  String toString() => 'ChecklistFieldTypeDef($type)';
}

/// The 14 known field-type tokens, in the SAME order the source declares
/// them - `FIELD_TYPES` in `src/lib/checklist/fieldTypes.js:29-45`, mirrored
/// as a union type at `mobile/lib/checklistFields.ts:20-22`. Both stacks
/// agree exactly (artifact A1).
const List<ChecklistFieldTypeDef> kChecklistFieldTypes = <ChecklistFieldTypeDef>[
  ChecklistFieldTypeDef(
    type: 'section',
    label: 'Section heading',
    hasOptions: false,
    group: 'layout',
    desc: 'A titled divider to group fields.',
  ),
  ChecklistFieldTypeDef(
    type: 'text',
    label: 'Short text',
    hasOptions: false,
    group: 'input',
    desc: 'A single line of free text.',
  ),
  ChecklistFieldTypeDef(
    type: 'textarea',
    label: 'Long text',
    hasOptions: false,
    group: 'input',
    desc: 'A multi-line note.',
  ),
  ChecklistFieldTypeDef(
    type: 'number',
    label: 'Number',
    hasOptions: false,
    group: 'input',
    desc: 'A numeric value with optional min/max.',
  ),
  ChecklistFieldTypeDef(
    type: 'select',
    label: 'Single choice',
    hasOptions: true,
    group: 'choice',
    desc: 'Pick one from a list.',
  ),
  ChecklistFieldTypeDef(
    type: 'multiselect',
    label: 'Multiple choice',
    hasOptions: true,
    group: 'choice',
    desc: 'Pick any number from a list.',
  ),
  ChecklistFieldTypeDef(
    type: 'boolean',
    label: 'Yes / No',
    hasOptions: false,
    group: 'choice',
    desc: 'A pass/fail or yes/no toggle.',
  ),
  ChecklistFieldTypeDef(
    type: 'date',
    label: 'Date',
    hasOptions: false,
    group: 'input',
    desc: 'A calendar date.',
  ),
  ChecklistFieldTypeDef(
    type: 'rating',
    label: 'Rating (1-5)',
    hasOptions: false,
    group: 'choice',
    desc: 'A 1 to 5 star/score rating.',
  ),
  // Reference fields resolve real data at fill time (no manual options).
  ChecklistFieldTypeDef(
    type: 'asset',
    label: 'Asset / Vehicle',
    hasOptions: false,
    group: 'reference',
    source: 'asset',
    desc: 'Pick a real asset from the fleet.',
  ),
  ChecklistFieldTypeDef(
    type: 'site',
    label: 'Site',
    hasOptions: false,
    group: 'reference',
    source: 'site',
    desc: 'Pick a real site from your live fleet data.',
  ),
  ChecklistFieldTypeDef(
    type: 'user',
    label: 'User / Person',
    hasOptions: false,
    group: 'reference',
    source: 'user',
    desc: 'Pick a real user from your organisation.',
  ),
  ChecklistFieldTypeDef(
    type: 'photo',
    label: 'Photo capture',
    hasOptions: false,
    group: 'media',
    desc: 'One or more photos.',
  ),
  ChecklistFieldTypeDef(
    type: 'signature',
    label: 'Signature',
    hasOptions: false,
    group: 'media',
    desc: 'A captured signature.',
  ),
];

final Map<String, ChecklistFieldTypeDef> _kByType = <String, ChecklistFieldTypeDef>{
  for (final ChecklistFieldTypeDef d in kChecklistFieldTypes) d.type: d,
};

final ChecklistFieldTypeDef _kTextTypeDef = _kByType['text']!;

/// The catalogue entry for [type], or `null` when [type] is not one of the
/// 14 known tokens. Never throws (artifact A10).
ChecklistFieldTypeDef? fieldTypeDef(String? type) =>
    type == null ? null : _kByType[type];

/// Whether the builder should show an options editor for [type]. True only
/// for `select` and `multiselect` (A2); `false` for every other known type
/// AND for an unrecognised one, including the three reference types (A6 -
/// `typeHasOptions('asset') == false`, since their choices resolve live).
bool typeHasOptions(String? type) => fieldTypeDef(type)?.hasOptions ?? false;

/// `section` is the ONLY layout type (A3). This is the single home for that
/// test - `src/lib/checklistView.js:27-29`'s own comment is why: a second,
/// hand-rolled `type == 'section'` check elsewhere "would silently start
/// disagreeing with the builder the day a type is added". Every other file
/// in this domain library that needs to know whether a type is layout-only
/// calls this function rather than repeating the comparison.
bool isLayoutField(String? type) => type == 'section';

/// Everything except `section`, `photo` and `signature` stores an answer
/// value in `answers[fieldId]` (A4). Photo and signature capture OUTSIDE
/// `answers` (section 2 - `photos[fieldId]` and `signatures[fieldId]`);
/// section renders nothing and stores nothing.
bool isValueField(String? type) =>
    type != 'section' && type != 'photo' && type != 'signature';

/// A field the run screen renders as a tappable tile: everything except the
/// layout-only `section` heading (A5). Photo and signature ARE recordable
/// even though [isValueField] says they are not - a mobile-only fourth
/// predicate (`checklistFields.ts:115-117`) that drives the tile list and
/// progress counter, kept here for parity even though this phase builds no
/// screen that consumes it yet.
bool isRecordableField(String? type) => type != 'section';

/// The 3 field types whose choices resolve against LIVE data at fill time
/// rather than a hand-listed `options` array.
const List<String> kReferenceTypes = <String>['asset', 'site', 'user'];

bool isReferenceField(String? type) =>
    type != null && kReferenceTypes.contains(type);

/// What live data source a reference field resolves against, or `null` for
/// a non-reference type.
///
/// Mirrors the MOBILE shape (`checklistFields.ts:29-31`), which returns the
/// type token itself rather than looking up the web registry's `.source`
/// column - correct because, for the 3 reference types, the source token
/// and the type token are identical by construction (`'asset'` resolves
/// against the `'asset'` source, and so on). The web registry's `.source`
/// field is still carried on [ChecklistFieldTypeDef] above for structural
/// fidelity with the source catalogue, but this function does not read it.
String? referenceSource(String? type) => isReferenceField(type) ? type : null;

/// The empty/initial answer for [field], per its type (A7). `default` is a
/// reserved word in Dart, so the field's own default lives on
/// [ChecklistField.defaultValue].
Object? blankAnswer(ChecklistField? field) {
  switch (field?.type) {
    case 'multiselect':
      return <Object?>[];
    case 'boolean':
      return null;
    case 'rating':
      return 0;
    case 'number':
      return '';
    default:
      return field?.defaultValue ?? '';
  }
}

/// A fresh field of type [type] with sensible defaults, mirroring the web
/// builder's `newField()` (`fieldTypes.js:151-185`). An unrecognised [type]
/// falls back to `text` (A10) rather than throwing or producing a field
/// nothing can render.
ChecklistField newField([String type = 'text']) {
  final ChecklistFieldTypeDef def = fieldTypeDef(type) ?? _kTextTypeDef;
  return ChecklistField(
    id: newFieldId(),
    type: def.type,
    label: def.type == 'section' ? 'New section' : '',
    help: '',
    options: def.hasOptions
        ? const <String>['Option 1', 'Option 2']
        : const <String>[],
    defaultValue: def.type == 'multiselect' ? const <Object?>[] : '',
  );
}

/// A non-cryptographic id for a freshly built field, `f_` followed by the
/// base-36 form of the current timestamp XORed with a random value.
///
/// Deliberately NOT the `uuid` package: this is the same five-line-problem
/// judgement call `vehicle_asset.dart`'s `formatVehicleOdometer` comment
/// makes for number grouping - a scratch id for a field the user is about
/// to label and configure has no uniqueness contract beyond "does not
/// collide with the other fields on THIS template", which a timestamp
/// already guarantees for any two calls a human could make close enough in
/// time to matter. Mirrors the web's own `crypto.randomUUID` FALLBACK path
/// (`fieldTypes.js:17-21`) rather than its primary path, for the same
/// reason: no browser crypto API exists to call here.
String newFieldId() {
  final int stamp = DateTime.now().millisecondsSinceEpoch;
  final int rand = Random().nextInt(1 << 31);
  return 'f_${(stamp ^ rand).toRadixString(36)}';
}
