/// Pure rules behind mock M5 "Repair assessment report".
///
/// Merges the two places damage marks live (web `damage_areas` on the
/// assessment row, phone `accidents.damage_description` v2 JSON), scores the
/// attachments, recommends a repair route and gates submission. No I/O.
library;

import 'dart:convert';

import 'package:flutter/foundation.dart' show immutable;
import 'package:tyre_pulse/features/accidents/domain/accident_case_vocab.dart';
import 'package:tyre_pulse/features/accidents/domain/accident_claim_package.dart';

enum DamageRowSource { assessment, phone }

/// One damage row on M5 section 2.
@immutable
final class AssessmentDamageRow {
  const AssessmentDamageRow({
    required this.source,
    required this.component,
    required this.damageType,
    required this.severity,
    this.action,
    this.note,
    this.view,
    this.photoRefs = const <String>[],
  });

  final DamageRowSource source;
  final String component;

  /// Canonical token from [damageTypes] ('' when not recorded).
  final String damageType;

  /// minor | moderate | severe ('' when not recorded).
  final String severity;

  /// Token from [damageActions], null when the assessor has not chosen.
  final String? action;
  final String? note;
  final String? view;
  final List<String> photoRefs;

  String? get firstPhoto => photoRefs.isEmpty ? null : photoRefs.first;

  bool get isSevere => severity == 'severe';

  String get damageTypeLabel {
    for (final VocabItem d in damageTypes) {
      if (d.key == damageType) return d.label;
    }
    return '';
  }

  String get severityLabel {
    for (final VocabItem l in damageLevels) {
      if (l.key == severity) return l.label;
    }
    return '';
  }

  String get actionLabel {
    for (final VocabItem a in damageActions) {
      if (a.key == action) return a.label;
    }
    return '';
  }
}

String _str(Object? v) => v?.toString().trim() ?? '';

String _canonSeverity(Object? raw) {
  final String k = _str(raw).toLowerCase();
  if (k == 'major' || k == 'severe' || k == 'high' || k == 'critical') {
    return 'severe';
  }
  if (k == 'moderate' || k == 'medium') return 'moderate';
  if (k == 'minor' || k == 'low') return 'minor';
  return '';
}

List<String> _refs(Object? raw) => <String>[
      if (raw is Iterable<Object?>)
        for (final Object? v in raw)
          if (_str(v).isNotEmpty) _str(v),
    ];

/// Web-authored marks from `accident_damage_assessments.damage_areas`.
List<AssessmentDamageRow> damageRowsFromAreas(Object? damageAreas) {
  if (damageAreas is! Iterable<Object?>) return const <AssessmentDamageRow>[];
  final List<AssessmentDamageRow> rows = <AssessmentDamageRow>[];
  for (final Object? raw in damageAreas) {
    if (raw is! Map) continue;
    final Map<String, Object?> m = Map<String, Object?>.from(raw);
    final String component = _str(m['region_label']).isNotEmpty
        ? _str(m['region_label'])
        : _str(m['region_key']);
    if (component.isEmpty && _str(m['damage_type']).isEmpty) continue;
    final String action = _str(m['action']);
    rows.add(
      AssessmentDamageRow(
        source: DamageRowSource.assessment,
        component: component.isEmpty ? 'Not set' : component,
        damageType: canonDamageType(_str(m['damage_type'])),
        severity: _canonSeverity(m['severity']),
        action: action.isEmpty ? null : action,
        note: _str(m['note']).isEmpty ? null : _str(m['note']),
        view: _str(m['view']).isEmpty ? null : _str(m['view']),
        photoRefs: _refs(m['photo_refs'] ?? m['photos']),
      ),
    );
  }
  return rows;
}

/// Phone-authored marks from `accidents.damage_description` v2 JSON. A
/// legacy free-text description yields no rows: prose is not a mark.
List<AssessmentDamageRow> damageRowsFromDescription(String? description) {
  final String text = description?.trim() ?? '';
  if (text.isEmpty || !text.startsWith('{')) {
    return const <AssessmentDamageRow>[];
  }
  Object? decoded;
  try {
    decoded = jsonDecode(text);
  } on FormatException {
    return const <AssessmentDamageRow>[];
  }
  if (decoded is! Map) return const <AssessmentDamageRow>[];
  final Object? marks = decoded['marks'] ?? decoded['damage_marks'];
  if (marks is! Iterable<Object?>) return const <AssessmentDamageRow>[];
  final List<AssessmentDamageRow> rows = <AssessmentDamageRow>[];
  for (final Object? raw in marks) {
    if (raw is! Map) continue;
    final Map<String, Object?> m = Map<String, Object?>.from(raw);
    final String area = _str(m['area']).isNotEmpty
        ? _str(m['area'])
        : _str(m['area_label']).isNotEmpty
            ? _str(m['area_label'])
            : _str(m['zone_id']);
    if (area.isEmpty) continue;
    rows.add(
      AssessmentDamageRow(
        source: DamageRowSource.phone,
        component: area,
        damageType: canonDamageType(_str(m['damage_type'])),
        severity: _canonSeverity(m['severity']),
        note: _str(m['note']).isEmpty ? null : _str(m['note']),
        view: _str(m['view']).isEmpty ? null : _str(m['view']),
        photoRefs: _refs(m['photo_references'] ?? m['photos']),
      ),
    );
  }
  return rows;
}

/// Both sources, assessment rows first (the assessor's own list leads), then
/// the phone's marks that no assessment row already covers by component.
List<AssessmentDamageRow> mergeDamageRows({
  required Object? damageAreas,
  required String? damageDescription,
}) {
  final List<AssessmentDamageRow> web = damageRowsFromAreas(damageAreas);
  final Set<String> seen = <String>{
    for (final AssessmentDamageRow r in web) r.component.toLowerCase(),
  };
  final List<AssessmentDamageRow> merged = <AssessmentDamageRow>[...web];
  for (final AssessmentDamageRow r in damageRowsFromDescription(
    damageDescription,
  )) {
    if (seen.add(r.component.toLowerCase())) merged.add(r);
  }
  return List<AssessmentDamageRow>.unmodifiable(merged);
}

enum AttachmentState { attached, missing }

/// One row of "Required attachments (4)".
@immutable
final class AssessmentAttachmentStatus {
  const AssessmentAttachmentStatus({required this.doc, required this.count});

  final VocabItem doc;
  final int count;

  AttachmentState get state =>
      count > 0 ? AttachmentState.attached : AttachmentState.missing;

  String get label => switch (state) {
        AttachmentState.missing => 'Missing',
        AttachmentState.attached when doc.countable => '$count',
        AttachmentState.attached => 'Attached',
      };
}

List<AssessmentAttachmentStatus> assessmentAttachmentStatuses(
  Iterable<AccidentEvidenceItem> evidence,
) {
  final Map<String, int> counts = <String, int>{};
  for (final AccidentEvidenceItem item in evidence) {
    if (item.workstreamKey != 'assessment') continue;
    counts[item.requirementKey] = (counts[item.requirementKey] ?? 0) + 1;
  }
  return List<AssessmentAttachmentStatus>.unmodifiable(
    <AssessmentAttachmentStatus>[
      for (final VocabItem doc in assessmentAttachments)
        AssessmentAttachmentStatus(doc: doc, count: counts[doc.key] ?? 0),
    ],
  );
}

bool hasAttachment(
  Iterable<AssessmentAttachmentStatus> statuses,
  String key,
) =>
    statuses.any(
      (AssessmentAttachmentStatus s) =>
          s.doc.key == key && s.state == AttachmentState.attached,
    );

/// External when any mark is severe or a total loss is possible, else the
/// internal workshop. The assessor may still pick another tile.
String recommendedRepairRoute({
  required Iterable<AssessmentDamageRow> rows,
  required bool totalLossPossible,
}) =>
    totalLossPossible || rows.any((AssessmentDamageRow r) => r.isSevere)
        ? 'external'
        : 'internal';

/// The reason text under the recommended tile, derived from the same facts.
String recommendedRouteReason({
  required Iterable<AssessmentDamageRow> rows,
  required bool totalLossPossible,
}) {
  if (totalLossPossible) {
    return 'Total loss is possible: an external assessment is required '
        'before any repair is approved.';
  }
  final int severe = rows.where((AssessmentDamageRow r) => r.isSevere).length;
  if (severe > 0) {
    return '$severe major damage ${severe == 1 ? 'area needs' : 'areas need'} '
        'structural work beyond the internal workshop.';
  }
  return 'Recorded damage is within the internal workshop capability.';
}

/// Submission needs the vendor quotation when the route is external. The
/// internal and on-site routes have no vendor to quote.
bool canSubmitAssessment({
  required String route,
  required Iterable<AssessmentAttachmentStatus> attachments,
}) =>
    route != 'external' || hasAttachment(attachments, submitGatingAttachment);

/// Labour + parts. Null when neither side has a figure, never a fabricated 0.
num? preliminaryTotal({required num? labourCost, required num? partsCost}) {
  if (labourCost == null && partsCost == null) return null;
  return (labourCost ?? 0) + (partsCost ?? 0);
}

/// "2 available · 1 special order"; "Not set" when nothing was counted.
String partsAvailabilityLabel({int? available, int? specialOrder}) {
  if (available == null && specialOrder == null) return 'Not set';
  return '${available ?? 0} available · ${specialOrder ?? 0} special order';
}

String repairRouteLabel(String? key) {
  for (final VocabItem t in repairRouteTiles) {
    if (t.key == key) return t.label;
  }
  return '';
}

String quotationStatusLabel(String? key) {
  for (final VocabItem q in quotationStates) {
    if (q.key == key) return q.label;
  }
  return 'Not set';
}
