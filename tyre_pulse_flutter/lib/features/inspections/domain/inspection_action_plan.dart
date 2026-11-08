/// Raising corrective actions from ONE recorded inspection - the pure half.
///
/// A port of the web engine in `src/lib/inspectionTyreFlags.js`
/// (`defectsForAction`, `generalDefectFor`, `actionCaseFile`,
/// `defaultPlanFor`, `applyPlanToRow`, `actionRowsForInspection`) so the
/// action a field user raises on the phone carries exactly the same title,
/// priority, due date, case file and `source_detail` key as one raised from
/// the web register. The key is what the V496 partial unique index
/// (`ux_corrective_actions_open_source_defect` on
/// `(source_id, asset_no, source_detail)`) dedupes on, so it must stay
/// byte-identical to the web's: `damage:<stored position>` or `general`.
///
/// # Deliberately NOT ported
///
/// The web also raises `overdue:` / `duesoon:` defects from the running-life
/// flag map (`get_tyre_running_life`). The Flutter app does not load that
/// feed on this screen, so those two kinds are not offered here rather than
/// guessed. Damaged tyres and the whole-inspection remark are.
library;

import 'package:flutter/foundation.dart';
import 'package:tyre_pulse/features/inspections/domain/tyre_position_reading.dart';
import 'package:tyre_pulse/features/tyre_diagram/domain/tyre_position_display.dart';

/// Same text the web uses for a fault with no recorded position.
const String unknownActionPosition = 'unknown position';

/// Any recorded fault (web `FAULT_RE`).
final RegExp _faultRe = RegExp(
  r'damage|puncture|worn|wear|flat|burst|blast|\bcut\b|bulge|separat',
  caseSensitive: false,
);

/// The stop-the-vehicle subset (web `SEVERE_RE`).
final RegExp _severeRe = RegExp(
  r'damage|puncture|flat|burst|blast|\bcut\b|bulge|separat',
  caseSensitive: false,
);

bool isActionFaultCondition(String condition) => _faultRe.hasMatch(condition);
bool isActionSevereCondition(String condition) => _severeRe.hasMatch(condition);

/// Response time by urgency, in days (web `ACTION_SLA_DAYS`).
const Map<String, int> actionSlaDays = <String, int>{
  'severe': 1,
  'high': 3,
  'medium': 14,
};

/// Plain containment step by urgency (web `CONTAINMENT`). Stored text, so it
/// stays English exactly like the web writes it.
const Map<String, String> actionContainment = <String, String>{
  'severe':
      'Do not release the vehicle until the tyre is inspected, repaired or replaced.',
  'high':
      'Schedule replacement at the next workshop slot and keep the vehicle under close watch.',
  'medium':
      'Plan replacement and confirm the tyre is available before the due date.',
};

/// The facts of one inspection the engine needs - independent of whether it
/// came from the queue or the server.
@immutable
class ActionInspectionFacts {
  const ActionInspectionFacts({
    required this.id,
    required this.assetNo,
    required this.vehicleType,
    required this.site,
    required this.inspector,
    required this.inspectionDate,
    required this.tyreConditions,
    this.country,
    this.findings,
    this.notes,
    this.odometerKm,
    this.hourMeter,
  });

  /// The SERVER row id - `corrective_actions.source_id` is a uuid FK-style
  /// pointer to it, so an inspection still in the device queue cannot raise.
  final String id;
  final String assetNo;
  final String vehicleType;
  final String site;
  final String inspector;
  final DateTime inspectionDate;
  final Map<String, TyrePositionReading> tyreConditions;
  final String? country;
  final String? findings;
  final String? notes;
  final num? odometerKm;
  final double? hourMeter;
}

/// One defect that can become one corrective action.
@immutable
class ActionDefect {
  const ActionDefect({
    required this.key,
    required this.kind,
    required this.title,
    required this.priority,
    required this.description,
    this.position,
    this.positionLabel,
    this.condition,
    this.serial = '',
  });

  /// Stored as `corrective_actions.source_detail`. Never relabelled.
  final String key;

  /// `damage` or `finding`.
  final String kind;
  final String? position;
  final String? positionLabel;
  final String? condition;
  final String serial;
  final String title;
  final String priority;
  final String description;

  String get urgency {
    if (kind == 'damage' && isActionSevereCondition(condition ?? '')) {
      return 'severe';
    }
    return priority == 'High' ? 'high' : 'medium';
  }
}

/// What the raiser decided for one defect in the sheet.
@immutable
class ActionPlan {
  const ActionPlan({
    this.include = true,
    this.instruction = '',
    this.comment = '',
    this.dueDate,
    this.assigneeName,
  });

  final bool include;
  final String instruction;
  final String comment;

  /// `YYYY-MM-DD`.
  final String? dueDate;
  final String? assigneeName;

  ActionPlan copyWith({
    bool? include,
    String? instruction,
    String? comment,
    String? dueDate,
    String? assigneeName,
    bool clearAssignee = false,
  }) {
    return ActionPlan(
      include: include ?? this.include,
      instruction: instruction ?? this.instruction,
      comment: comment ?? this.comment,
      dueDate: dueDate ?? this.dueDate,
      assigneeName: clearAssignee ? null : (assigneeName ?? this.assigneeName),
    );
  }
}

String _label(ActionInspectionFacts i, String pos) {
  if (pos == unknownActionPosition) return pos;
  final String shown =
      tyrePositionDisplayCode(i.vehicleType, pos, assetNo: i.assetNo);
  return shown.trim().isEmpty ? pos : shown;
}

/// Damaged tyres + (when there is anything to say) the whole-inspection item.
/// Damage first, in position order, so the list is stable.
List<ActionDefect> defectsForInspection(ActionInspectionFacts i) {
  final List<ActionDefect> out = <ActionDefect>[];
  final Set<String> seen = <String>{};
  final String asset = i.assetNo;
  final List<String> positions = i.tyreConditions.keys.toList()..sort();
  for (final String key in positions) {
    final TyrePositionReading r = i.tyreConditions[key]!;
    final String condition = r.condition;
    if (!isActionFaultCondition(condition)) continue;
    final String pos = key.trim().isEmpty ? unknownActionPosition : key;
    final String k = 'damage:$pos';
    if (!seen.add(k)) continue;
    final String shown = _label(i, pos);
    final bool severe = isActionSevereCondition(condition);
    out.add(
      ActionDefect(
        key: k,
        kind: 'damage',
        position: pos,
        positionLabel: shown,
        condition: condition,
        serial: (r.serialNumber ?? '').trim(),
        title:
            'Tyre $condition at $shown on ${asset.isEmpty ? 'asset' : asset}',
        priority: severe ? 'High' : 'Medium',
        description: severe
            ? 'Inspection recorded "$condition" at position $shown. Inspect '
                'and replace or repair the tyre before the vehicle returns to '
                'service.'
            : 'Inspection recorded "$condition" at position $shown. Plan a '
                'replacement for this tyre.',
      ),
    );
  }
  out.add(generalDefectFor(i));
  return out;
}

/// The whole-inspection item (web `generalDefectFor`). The phone app has no
/// inspection severity field, so priority is Medium - never invented High.
ActionDefect generalDefectFor(ActionInspectionFacts i) {
  final String asset = i.assetNo;
  final String text = (i.findings ?? i.notes ?? '').trim();
  const String what = 'Inspection';
  final String title = '$what${asset.isEmpty ? '' : ' on $asset'}';
  return ActionDefect(
    key: 'general',
    kind: 'finding',
    condition: text.isEmpty ? null : _cap(text, 200),
    title: _cap(title, 300),
    priority: 'Medium',
    description: text.isEmpty
        ? 'Follow up on the ${what.toLowerCase()} recorded for '
            '${asset.isEmpty ? 'this vehicle' : asset}.'
        : 'Inspection remark: $text',
  );
}

String _isoDay(DateTime d) {
  String p(int n) => n.toString().padLeft(2, '0');
  return '${d.year.toString().padLeft(4, '0')}-${p(d.month)}-${p(d.day)}';
}

String addActionDays(DateTime base, int days) =>
    _isoDay(DateTime(base.year, base.month, base.day + days));

/// Suggested instruction + due date before the person edits them.
ActionPlan defaultPlanFor(ActionDefect d, {DateTime? now}) {
  final String u = d.urgency;
  return ActionPlan(
    instruction: actionContainment[u]!,
    dueDate: addActionDays(now ?? DateTime.now(), actionSlaDays[u]!),
  );
}

String _num(num v) {
  final String whole =
      v == v.roundToDouble() ? v.toInt().toString() : v.toString();
  final List<String> parts = whole.split('.');
  final String digits = parts.first;
  final StringBuffer b = StringBuffer();
  for (int i = 0; i < digits.length; i++) {
    final int fromEnd = digits.length - i;
    b.write(digits[i]);
    if (fromEnd > 1 && fromEnd % 3 == 1 && digits[i] != '-') b.write(',');
  }
  return parts.length > 1 ? '$b.${parts[1]}' : b.toString();
}

/// Plain-text case file (web `actionCaseFile`).
String actionCaseFile(ActionInspectionFacts i, ActionDefect d) {
  final TyrePositionReading? e =
      d.position == null ? null : i.tyreConditions[d.position];
  final List<String> found = <String>[];
  void line(String k, Object? v) {
    if (v == null) return;
    final String s = v.toString();
    if (s.isEmpty) return;
    found.add('$k: $s');
  }

  line('Asset', i.assetNo);
  line('Site', i.site);
  line('Position', d.positionLabel);
  line('Finding', d.condition);
  line('Tyre serial', d.serial.isNotEmpty ? d.serial : e?.serialNumber);
  line('Tread depth', e?.treadDepthMm == null ? null : '${e!.treadDepthMm} mm');
  line('Pressure', e?.pressurePsi == null ? null : '${e!.pressurePsi} psi');
  line('Odometer', i.odometerKm == null ? null : '${_num(i.odometerKm!)} km');
  line('Hour meter', i.hourMeter == null ? null : '${_num(i.hourMeter!)} hrs');
  line('Inspector', i.inspector);
  line('Inspection date', _isoDay(i.inspectionDate.toLocal()));
  line('Inspector notes', e?.notes);
  final bool hasPhoto = e?.hasPhoto ?? false;
  line('Photo evidence', hasPhoto ? 'recorded on the inspection' : null);
  final int days = actionSlaDays[d.urgency]!;
  return <String>[
    d.description,
    '',
    'WHAT WAS FOUND',
    ...found,
    '',
    'WHAT TO DO',
    actionContainment[d.urgency]!,
    'Respond within $days day${days == 1 ? '' : 's'} of this action being '
        'raised.',
    'Record the cause on this action when the tyre is examined, then close '
        'it with the work order or tyre record that fixed it.',
  ].join('\n');
}

/// One `corrective_actions` row per defect not already raised
/// (web `actionRowsForInspection` + `applyPlanToRow`). Columns verified in
/// MIGRATIONS_V496_ACTION_CHAIN.sql (source_*) and the base table.
List<Map<String, Object?>> actionRowsForInspection(
  ActionInspectionFacts i,
  List<ActionDefect> defects, {
  Set<String> existingKeys = const <String>{},
  Map<String, ActionPlan> plans = const <String, ActionPlan>{},
  DateTime? now,
}) {
  final DateTime at = now ?? DateTime.now();
  return <Map<String, Object?>>[
    for (final ActionDefect d in defects)
      if (!existingKeys.contains(d.key))
        applyPlanToRow(
          <String, Object?>{
            'title': _cap(d.title, 300),
            'description': actionCaseFile(i, d),
            'priority': d.priority,
            'status': 'Open',
            'asset_no': i.assetNo.isEmpty ? null : i.assetNo,
            'tyre_serial': d.serial.isNotEmpty
                ? d.serial
                : _blankToNull(
                    d.position == null
                        ? null
                        : i.tyreConditions[d.position]?.serialNumber,
                  ),
            'site': i.site.isEmpty ? null : i.site,
            'country': _blankToNull(i.country),
            'due_date': addActionDays(at, actionSlaDays[d.urgency]!),
            'source_type': 'inspection',
            'source_id': i.id,
            'source_detail': d.key,
          },
          plans[d.key],
        ),
  ];
}

/// Folds the raiser's instruction, comment, due date and assignee into a row.
/// Blank fields change nothing.
Map<String, Object?> applyPlanToRow(
  Map<String, Object?> row,
  ActionPlan? plan,
) {
  if (plan == null) return row;
  final Map<String, Object?> out = Map<String, Object?>.of(row);
  final List<String> extra = <String>[];
  final String instruction = plan.instruction.trim();
  final String comment = plan.comment.trim();
  if (instruction.isNotEmpty) {
    extra.addAll(<String>['', 'INSTRUCTION FROM THE RAISER', instruction]);
  }
  if (comment.isNotEmpty) {
    extra.addAll(<String>['', 'COMMENT OR CORRECTION', comment]);
  }
  if (extra.isNotEmpty) {
    out['description'] = '${row['description']}\n${extra.join('\n')}';
  }
  final String? due = plan.dueDate;
  if (due != null && due.isNotEmpty) out['due_date'] = due;
  final String name = (plan.assigneeName ?? '').trim();
  if (name.isNotEmpty) out['assigned_to'] = _cap(name, 200);
  return out;
}

String _cap(String s, int max) => s.length <= max ? s : s.substring(0, max);

String? _blankToNull(String? s) {
  final String t = s?.trim() ?? '';
  return t.isEmpty ? null : t;
}
