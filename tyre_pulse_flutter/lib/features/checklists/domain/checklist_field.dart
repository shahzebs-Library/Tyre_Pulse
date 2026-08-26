/// The checklist field model - one entry of a template's `fields` jsonb
/// array, decoded once.
///
/// Ported per `docs/flutter-migration/08-checklist-engine-parity-tests.md`
/// section 1 ("The full field object") and section 2 ("Answer storage
/// contract"). The property set mirrors the TypeScript interface at
/// `mobile/lib/checklistFields.ts:46-100` field for field: the "core" set
/// present since the V123 migration (id, type, label, help, section,
/// required, allow_photo, options, min, max, default), the properties added
/// since (allow_note, options_ref, labels, options_i18n, visibleWhen,
/// weight, passValues, autoValue), and the V595 workshop-sheet properties
/// declared "specifically so a typo cannot ship silently" (autoFrom,
/// readOnly, locked, group_require_one, compareTo, unit, require_note_when,
/// allow_gallery).
///
/// [type] is a plain [String], not a Dart enum - see the library comment on
/// `checklist_field_type.dart` for why.
///
/// [ChecklistField.fromJson]/[toJson] round-trip EVERY key, including ones
/// this model does not otherwise interpret (captured in [extra]), because
/// "a template is patched field-by-field by migration and an unknown key
/// dropped on read would be lost on any write" (artifact section 1). This
/// is safe to build now because the field shape is VERIFIED against real
/// migrations and the live TypeScript interface - unlike the five
/// template/submission-level columns artifact section 11 flags as
/// UNVERIFIED (`option_sets`, `name_i18n`, `description_i18n`, `signatures`,
/// `notes`), which is why [ChecklistTemplate] deliberately carries no
/// `fromJson` of its own yet. See `checklist_template.dart`.
library;

/// One `{ field, op, value }` visibility condition, or a deliberately
/// malformed one (artifact C5 constructs `{op:'='}` with no `field` at all,
/// so [field] and [op] must both be nullable to represent that case).
final class ChecklistVisibleCondition {
  const ChecklistVisibleCondition({this.field, this.op, this.value});

  factory ChecklistVisibleCondition.fromJson(Map<String, dynamic> json) {
    final Object? field = json['field'];
    final Object? op = json['op'];
    return ChecklistVisibleCondition(
      field: field is String ? field : null,
      op: op is String ? op : null,
      value: json['value'],
    );
  }

  /// The OTHER field's id this condition reads. `null` is what makes a
  /// condition malformed (C5).
  final String? field;

  /// One of the ten operators in `checklist_visibility.dart`'s
  /// `kChecklistConditionOps`, or an unrecognised string (C4) - both are
  /// legal input, and both are handled by failing open, never by throwing.
  final String? op;

  final Object? value;

  Map<String, dynamic> toJson() => <String, dynamic>{
    if (field != null) 'field': field,
    if (op != null) 'op': op,
    if (value != null) 'value': value,
  };

  @override
  String toString() =>
      'ChecklistVisibleCondition(field: $field, op: $op, value: $value)';
}

/// One field of a checklist template.
final class ChecklistField {
  const ChecklistField({
    required this.id,
    required this.type,
    this.label,
    this.help,
    this.required = false,
    this.allowPhoto = false,
    this.allowNote,
    this.options = const <String>[],
    this.optionsRef,
    this.labels = const <String, String>{},
    this.optionsI18n = const <String, List<String>>{},
    this.min,
    this.max,
    this.defaultValue,
    this.visibleWhen = const <ChecklistVisibleCondition>[],
    this.weight,
    this.passValues = const <Object?>[],
    this.autoFrom,
    this.readOnly = false,
    this.locked = false,
    this.autoValue,
    this.groupRequireOne,
    this.compareTo,
    this.unit,
    this.requireNoteWhen = const <String>[],
    this.allowGallery = false,
    this.extra = const <String, dynamic>{},
  });

  /// Decodes one element of `checklist_templates.fields`.
  ///
  /// Never throws on a missing/blank `type` - the field is decoded as-is
  /// (`type` becomes `''`) and every predicate in `checklist_field_type.dart`
  /// answers `false`/`null` for that just as it does for any other
  /// unrecognised token (A10). A missing `id` is likewise kept as `''`
  /// rather than rejected - unlike `VehicleAsset.fromRow`, a field with no
  /// id is not actionable on its own but is still a real element of the
  /// array a caller needs to be able to render and round-trip.
  factory ChecklistField.fromJson(Map<String, dynamic> json) {
    return ChecklistField(
      id: _asString(json['id']) ?? '',
      type: _asString(json['type']) ?? '',
      label: _asString(json['label']),
      help: _asString(json['help']),
      required: json['required'] == true,
      allowPhoto: json['allow_photo'] == true,
      allowNote: json['allow_note'] is bool
          ? json['allow_note'] as bool
          : null,
      options: _stringList(json['options']),
      optionsRef: _asString(json['options_ref']),
      labels: _stringMap(json['labels']),
      optionsI18n: _stringListMap(json['options_i18n']),
      min: _asNumOrNull(json['min']),
      max: _asNumOrNull(json['max']),
      defaultValue: json['default'],
      visibleWhen: _parseVisibleWhen(json['visibleWhen']),
      weight: _asNumOrNull(json['weight']),
      passValues: json['passValues'] is List
          ? List<Object?>.of(json['passValues'] as List<dynamic>)
          : const <Object?>[],
      autoFrom: _asString(json['autoFrom']),
      readOnly: json['readOnly'] == true,
      locked: json['locked'] == true,
      autoValue: _asString(json['autoValue']),
      groupRequireOne: _asString(json['group_require_one']),
      compareTo: _asString(json['compareTo']),
      unit: _asString(json['unit']),
      requireNoteWhen: _stringList(json['require_note_when']),
      allowGallery: json['allow_gallery'] == true,
      extra: <String, dynamic>{
        for (final MapEntry<String, dynamic> e in json.entries)
          if (!_kKnownKeys.contains(e.key)) e.key: e.value,
      },
    );
  }

  final String id;
  final String type;
  final String? label;
  final String? help;
  final bool required;
  final bool allowPhoto;

  /// Tri-state on purpose: `null` (unset) and `false` (explicitly disabled)
  /// are DIFFERENT states that `checklist_marks.dart`'s `missingNotes`
  /// distinguishes - "note: `undefined` does NOT skip" (artifact section
  /// 5). `field.allowNote == false` must be checked by identity, never by
  /// `!(field.allowNote ?? true)`, which would collapse the distinction.
  final bool? allowNote;

  final List<String> options;
  final String? optionsRef;
  final Map<String, String> labels;
  final Map<String, List<String>> optionsI18n;
  final num? min;
  final num? max;

  /// `default` in the JSON - renamed because `default` is reserved in Dart.
  final Object? defaultValue;

  /// Empty means "no rule, always visible" - the single representation for
  /// both the TypeScript `null` case AND an explicit empty array, since
  /// both behave identically under `List.every` (vacuously true). A single
  /// `{field,op,value}` condition normalises to a one-element list.
  final List<ChecklistVisibleCondition> visibleWhen;

  final num? weight;
  final List<Object?> passValues;

  /// Auto-fill source token, e.g. `'asset.site'`. Resolved by
  /// `checklist_auto_fill.dart`'s `resolveAutoFill`.
  final String? autoFrom;

  /// Read-only ONCE the register supplied a value - see
  /// `checklist_auto_fill.dart`'s `isFieldLocked`.
  final bool readOnly;

  /// Never editable at all, whatever the value.
  final bool locked;

  /// Prefill token handled by `checklist_auto_value.dart`'s
  /// `resolveAutoValue` (`'today'` / `'current_user'`).
  final String? autoValue;

  /// At least one field carrying the same group name must be answered.
  final String? groupRequireOne;

  /// Register field this reading is sanity-checked against, e.g.
  /// `'asset.current_km'`. A mismatch WARNS, it never blocks - the warning
  /// UI itself is out of this phase's scope (artifact section 11, known gap
  /// 5: no live template is known to use this yet).
  final String? compareTo;

  /// Unit shown beside a number reading (km / hours).
  final String? unit;

  /// Marks that oblige a remark, beside the option set's own
  /// `require_note`. Union of the two, per `checklist_marks.dart`'s
  /// `missingNotes`.
  final List<String> requireNoteWhen;

  /// Gallery picking is offered as well as the camera. Presentation-only;
  /// carried for round-trip fidelity.
  final bool allowGallery;

  /// Any JSON key this model does not otherwise interpret, preserved so
  /// [toJson] never drops a property a future migration added.
  final Map<String, dynamic> extra;

  Map<String, dynamic> toJson() => <String, dynamic>{
    ...extra,
    'id': id,
    'type': type,
    if (label != null) 'label': label,
    if (help != null) 'help': help,
    'required': required,
    'allow_photo': allowPhoto,
    if (allowNote != null) 'allow_note': allowNote,
    'options': options,
    if (optionsRef != null) 'options_ref': optionsRef,
    if (labels.isNotEmpty) 'labels': labels,
    if (optionsI18n.isNotEmpty) 'options_i18n': optionsI18n,
    if (min != null) 'min': min,
    if (max != null) 'max': max,
    if (defaultValue != null) 'default': defaultValue,
    if (visibleWhen.length == 1)
      'visibleWhen': visibleWhen.first.toJson()
    else if (visibleWhen.isNotEmpty)
      'visibleWhen': <Map<String, dynamic>>[
        for (final ChecklistVisibleCondition c in visibleWhen) c.toJson(),
      ],
    if (weight != null) 'weight': weight,
    if (passValues.isNotEmpty) 'passValues': passValues,
    if (autoFrom != null) 'autoFrom': autoFrom,
    'readOnly': readOnly,
    'locked': locked,
    if (autoValue != null) 'autoValue': autoValue,
    if (groupRequireOne != null) 'group_require_one': groupRequireOne,
    if (compareTo != null) 'compareTo': compareTo,
    if (unit != null) 'unit': unit,
    if (requireNoteWhen.isNotEmpty) 'require_note_when': requireNoteWhen,
    'allow_gallery': allowGallery,
  };

  @override
  String toString() => 'ChecklistField(id: $id, type: $type, label: $label)';
}

const List<String> _kKnownKeys = <String>[
  'id',
  'type',
  'label',
  'help',
  'required',
  'allow_photo',
  'allow_note',
  'options',
  'options_ref',
  'labels',
  'options_i18n',
  'min',
  'max',
  'default',
  'visibleWhen',
  'weight',
  'passValues',
  'autoFrom',
  'readOnly',
  'locked',
  'autoValue',
  'group_require_one',
  'compareTo',
  'unit',
  'require_note_when',
  'allow_gallery',
];

String? _asString(Object? raw) => raw is String ? raw : null;

num? _asNumOrNull(Object? raw) => raw is num ? raw : null;

List<String> _stringList(Object? raw) {
  if (raw is! List) return const <String>[];
  return <String>[for (final Object? v in raw) v?.toString() ?? ''];
}

Map<String, String> _stringMap(Object? raw) {
  if (raw is! Map) return const <String, String>{};
  final Map<String, String> out = <String, String>{};
  raw.forEach((Object? k, Object? v) {
    if (k is String && v is String) out[k] = v;
  });
  return out;
}

Map<String, List<String>> _stringListMap(Object? raw) {
  if (raw is! Map) return const <String, List<String>>{};
  final Map<String, List<String>> out = <String, List<String>>{};
  raw.forEach((Object? k, Object? v) {
    if (k is String) out[k] = _stringList(v);
  });
  return out;
}

/// `visibleWhen` may be `null`/absent, a single `{field,op,value}` object,
/// or an array of them (section 3). Normalises all three shapes onto one
/// list - see [ChecklistField.visibleWhen].
List<ChecklistVisibleCondition> _parseVisibleWhen(Object? raw) {
  if (raw == null) return const <ChecklistVisibleCondition>[];
  if (raw is List) {
    return <ChecklistVisibleCondition>[
      for (final Object? item in raw)
        if (item is Map<String, dynamic>)
          ChecklistVisibleCondition.fromJson(item),
    ];
  }
  if (raw is Map<String, dynamic>) {
    return <ChecklistVisibleCondition>[ChecklistVisibleCondition.fromJson(raw)];
  }
  return const <ChecklistVisibleCondition>[];
}
