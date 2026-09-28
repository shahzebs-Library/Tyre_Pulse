/// What a reviewer reads before signing a checklist: pass / fail / N/A per
/// check, per section, and the evidence behind it.
///
/// Pure and read-only. It never decides anything about the approval ladder
/// (that stays in `checklist_approval.dart`) and it is NOT the close gate:
/// the server's `guard_checklist_approval_stages` trigger and
/// [ChecklistApprovalTemplateInfo.blockingAnswers] remain the only things
/// that refuse a close. This file only explains a submission.
///
/// # What counts as a "check"
///
/// Only a field whose answer has a defined meaning of good or bad:
///
/// - a field with `passValues` (the scoring engine's own pass list),
/// - a field whose shared option set (`options_ref` into
///   `option_sets`) carries mark `meta` tones or a `blocking` list,
/// - a `boolean` field (false is a fault).
///
/// Free text, numbers, dates and reference pickers are answered or not,
/// never "passed" - counting a typed operator name as a pass would inflate
/// the outcome the reviewer signs against.
///
/// # Hidden fields
///
/// A field a `visibleWhen` rule hides (judged by the checklists domain's own
/// [isFieldVisible] against the submitted answers) was never asked, so it is
/// never counted as a required field, never reported as unanswered and never
/// scored. The ONE exception is a mark in `option_sets.legend.blocking`: the
/// close guard scans every answer regardless of visibility, so a leftover
/// blocking mark on a hidden field is still shown as a finding.
library;

import 'package:tyre_pulse/features/checklists/domain/checklist_field.dart';
import 'package:tyre_pulse/features/checklists/domain/checklist_field_type.dart';
import 'package:tyre_pulse/features/checklists/domain/checklist_visibility.dart';

/// One decoded `option_sets` entry, reduced to what classification needs.
final class ReviewOptionSet {
  const ReviewOptionSet({
    this.toneByValue = const <String, String>{},
    this.blocking = const <String>[],
  });

  /// `good` / `bad` / `fixed` / `muted`, per mark value.
  final Map<String, String> toneByValue;
  final List<String> blocking;

  bool get isMarkSet => toneByValue.isNotEmpty || blocking.isNotEmpty;
}

/// The icon-token default tones - mirrors `kMarkIcons` in
/// `checklist_marks.dart` (kept as a small copy so this feature keeps its
/// one-widget dependency on the checklists feature's presentation layer).
const Map<String, String> _iconTone = <String, String>{
  'ok': 'good',
  'fault': 'bad',
  'na': 'muted',
  'swap': 'fixed',
  'repair': 'fixed',
  'topup': 'fixed',
  'adjust': 'fixed',
  'lubricant': 'fixed',
};

/// Decodes `checklist_templates.option_sets` tolerantly. Anything malformed
/// is skipped, never thrown.
Map<String, ReviewOptionSet> decodeReviewOptionSets(Object? raw) {
  if (raw is! Map) return const <String, ReviewOptionSet>{};
  final Map<String, ReviewOptionSet> out = <String, ReviewOptionSet>{};
  raw.forEach((Object? key, Object? value) {
    if (key is! String || value is! Map) return;
    final Map<String, String> tones = <String, String>{};
    final Object? meta = value['meta'];
    if (meta is List) {
      for (final Object? entry in meta) {
        if (entry is! Map) continue;
        final Object? v = entry['value'];
        if (v is! String || v.isEmpty) continue;
        final Object? tone = entry['tone'];
        final Object? icon = entry['icon'];
        if (tone is String &&
            const <String>{'good', 'bad', 'fixed', 'muted'}.contains(tone)) {
          tones[v] = tone;
        } else if (icon is String && _iconTone.containsKey(icon)) {
          tones[v] = _iconTone[icon]!;
        }
      }
    }
    final Object? blocking = value['blocking'];
    out[key] = ReviewOptionSet(
      toneByValue: tones,
      blocking: <String>[
        if (blocking is List)
          for (final Object? b in blocking)
            if (b is String && b.isNotEmpty) b,
      ],
    );
  });
  return out;
}

enum ReviewVerdict { pass, fail, notApplicable, unanswered, notACheck }

/// One field's reading.
final class ReviewItem {
  const ReviewItem({
    required this.field,
    required this.verdict,
    required this.value,
    this.note,
    this.photoCount = 0,
  });

  final ChecklistField field;
  final ReviewVerdict verdict;
  final Object? value;
  final String? note;
  final int photoCount;

  bool get isCheck =>
      verdict == ReviewVerdict.pass ||
      verdict == ReviewVerdict.fail ||
      verdict == ReviewVerdict.notApplicable;
}

/// A run of fields under one `section` heading. [heading] is null for the
/// fields that come before the first heading.
final class ReviewSection {
  const ReviewSection({required this.heading, required this.items});

  final ChecklistField? heading;
  final List<ReviewItem> items;

  int get checks => items.where((ReviewItem i) => i.isCheck).length;
  int get passes =>
      items.where((ReviewItem i) => i.verdict == ReviewVerdict.pass).length;
  int get fails =>
      items.where((ReviewItem i) => i.verdict == ReviewVerdict.fail).length;
  int get notApplicable => items
      .where((ReviewItem i) => i.verdict == ReviewVerdict.notApplicable)
      .length;
  int get answerable => items.length;
  int get answered => items
      .where((ReviewItem i) => i.verdict != ReviewVerdict.unanswered)
      .length;
}

final class ChecklistReviewOutcome {
  const ChecklistReviewOutcome({
    required this.sections,
    required this.requiredTotal,
    required this.requiredAnswered,
    required this.signatureFieldsTotal,
    required this.signatureFieldsSigned,
    required this.photoCount,
  });

  final List<ReviewSection> sections;
  final int requiredTotal;
  final int requiredAnswered;
  final int signatureFieldsTotal;
  final int signatureFieldsSigned;
  final int photoCount;

  Iterable<ReviewItem> get _items =>
      sections.expand((ReviewSection s) => s.items);

  int get passes => _items.where((i) => i.verdict == ReviewVerdict.pass).length;
  int get fails => _items.where((i) => i.verdict == ReviewVerdict.fail).length;
  int get notApplicable =>
      _items.where((i) => i.verdict == ReviewVerdict.notApplicable).length;
  int get checks => passes + fails + notApplicable;

  /// The failing checks, in template order - what the reviewer must read.
  List<ReviewItem> get findings => _items
      .where((ReviewItem i) => i.verdict == ReviewVerdict.fail)
      .toList(growable: false);
}

bool _isBlank(Object? v) =>
    v == null ||
    (v is String && v.trim().isEmpty) ||
    (v is List && v.isEmpty) ||
    (v is Map && v.isEmpty);

const Set<String> _naWords = <String>{'n/a', 'na', 'not applicable'};

bool _hasLegendBlockingMark(Object? value, List<String> legendBlocking) {
  if (legendBlocking.isEmpty || _isBlank(value)) return false;
  final List<Object?> values = value is List ? value : <Object?>[value];
  return values.any(
    (Object? v) => v != null && legendBlocking.contains(v.toString()),
  );
}

/// Classifies one answer. [legendBlocking] is the template-level
/// `option_sets.legend.blocking` list the close guard reads.
ReviewVerdict classifyReviewAnswer(
  ChecklistField field,
  Object? value, {
  Map<String, ReviewOptionSet> optionSets = const <String, ReviewOptionSet>{},
  List<String> legendBlocking = const <String>[],
}) {
  if (isLayoutField(field.type) || !isValueField(field.type)) {
    return ReviewVerdict.notACheck;
  }
  final String? ref = field.optionsRef;
  final ReviewOptionSet? set =
      (ref != null && ref.isNotEmpty) ? optionSets[ref] : null;
  final bool isBoolean = field.type == 'boolean';
  final bool isCheck =
      field.passValues.isNotEmpty || (set?.isMarkSet ?? false) || isBoolean;
  if (_isBlank(value)) return ReviewVerdict.unanswered;

  final List<Object?> values = value is List ? value : <Object?>[value];
  final List<String> texts = <String>[
    for (final Object? v in values)
      if (v != null) v.toString(),
  ];
  final List<String> blocking = <String>[
    ...?set?.blocking,
    ...legendBlocking,
  ];
  // A mark the close guard itself refuses is a finding on any field.
  if (texts.any(legendBlocking.contains)) return ReviewVerdict.fail;
  if (!isCheck) return ReviewVerdict.notACheck;
  if (isBoolean && (value == false || texts.contains('false'))) {
    return ReviewVerdict.fail;
  }
  if (texts.any(blocking.contains)) return ReviewVerdict.fail;
  final List<String?> tones = <String?>[
    for (final String t in texts) set?.toneByValue[t],
  ];
  if (tones.contains('bad')) return ReviewVerdict.fail;
  if (field.passValues.isNotEmpty &&
      !values.any((Object? v) => field.passValues.contains(v))) {
    // Before N/A: a mark the template does not list as a pass is a fault
    // unless it is explicitly an N/A mark.
    final bool allNa = texts.isNotEmpty &&
        texts.every(
          (String t) =>
              set?.toneByValue[t] == 'muted' ||
              _naWords.contains(t.trim().toLowerCase()),
        );
    return allNa ? ReviewVerdict.notApplicable : ReviewVerdict.fail;
  }
  final bool allNa = texts.isNotEmpty &&
      texts.every(
        (String t) =>
            set?.toneByValue[t] == 'muted' ||
            _naWords.contains(t.trim().toLowerCase()),
      );
  if (allNa) return ReviewVerdict.notApplicable;
  return ReviewVerdict.pass;
}

/// Builds the whole outcome for one submission.
ChecklistReviewOutcome buildChecklistReviewOutcome({
  required List<ChecklistField> fields,
  required Map<String, Object?> answers,
  Map<String, Object?> notes = const <String, Object?>{},
  Map<String, List<String>> photos = const <String, List<String>>{},
  Map<String, String> signatures = const <String, String>{},
  Map<String, ReviewOptionSet> optionSets = const <String, ReviewOptionSet>{},
  List<String> legendBlocking = const <String>[],
}) {
  final List<ReviewSection> sections = <ReviewSection>[];
  ChecklistField? heading;
  List<ReviewItem> current = <ReviewItem>[];
  int requiredTotal = 0;
  int requiredAnswered = 0;
  int signatureTotal = 0;
  int signatureSigned = 0;

  void flush() {
    if (current.isNotEmpty || heading != null) {
      sections.add(ReviewSection(heading: heading, items: current));
    }
  }

  for (final ChecklistField f in fields) {
    if (isLayoutField(f.type)) {
      flush();
      heading = f;
      current = <ReviewItem>[];
      continue;
    }
    if (!isFieldVisible(f, answers)) {
      // Never asked: only a close-guard blocking mark keeps it on screen.
      final Object? hiddenValue = answers[f.id];
      if (_hasLegendBlockingMark(hiddenValue, legendBlocking)) {
        current.add(
          ReviewItem(
            field: f,
            verdict: ReviewVerdict.fail,
            value: hiddenValue,
            photoCount: (photos[f.id] ?? const <String>[]).length,
          ),
        );
      }
      continue;
    }
    final List<String> fieldPhotos = photos[f.id] ?? const <String>[];
    final Object? rawNote = notes[f.id];
    final String? note = rawNote?.toString().trim().isNotEmpty ?? false
        ? rawNote.toString().trim()
        : null;
    final Object? value = answers[f.id];
    ReviewVerdict verdict;
    bool answered;
    if (f.type == 'signature') {
      signatureTotal += 1;
      answered = signatures[f.id]?.trim().isNotEmpty ?? false;
      if (answered) signatureSigned += 1;
      verdict = answered ? ReviewVerdict.notACheck : ReviewVerdict.unanswered;
    } else if (f.type == 'photo') {
      answered = fieldPhotos.isNotEmpty;
      verdict = answered ? ReviewVerdict.notACheck : ReviewVerdict.unanswered;
    } else {
      verdict = classifyReviewAnswer(
        f,
        value,
        optionSets: optionSets,
        legendBlocking: legendBlocking,
      );
      answered = verdict != ReviewVerdict.unanswered;
    }
    if (f.required) {
      requiredTotal += 1;
      if (answered) requiredAnswered += 1;
    }
    current.add(
      ReviewItem(
        field: f,
        verdict: verdict,
        value: value,
        note: note,
        photoCount: fieldPhotos.length,
      ),
    );
  }
  flush();

  final int photoCount = photos.values.fold<int>(
    0,
    (int sum, List<String> list) => sum + list.length,
  );
  return ChecklistReviewOutcome(
    sections: sections,
    requiredTotal: requiredTotal,
    requiredAnswered: requiredAnswered,
    signatureFieldsTotal: signatureTotal,
    signatureFieldsSigned: signatureSigned,
    photoCount: photoCount,
  );
}
