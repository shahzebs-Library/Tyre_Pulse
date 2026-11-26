/// Inputs of the Vehicle Handover Authorization paper that come from the
/// handover feature's own types (the damage table), in the web's English
/// wording (`vehicleHandoverMarks.viewName / damageTypeName / levelName`), so
/// the phone paper matches the web paper word for word.
library;

import 'package:tyre_pulse/features/handover/domain/handover_damage_marker.dart';

String _viewName(HandoverDamageView view) => switch (view) {
      HandoverDamageView.front => 'Front',
      HandoverDamageView.rear => 'Rear',
      HandoverDamageView.left => 'Left',
      HandoverDamageView.right => 'Right',
      HandoverDamageView.top => 'Top',
    };

/// The web vocabulary has no chip or rust; it prints those as Other.
String _typeName(HandoverDamageType type) => switch (type) {
      HandoverDamageType.dent => 'Dent',
      HandoverDamageType.scratch => 'Scratch',
      HandoverDamageType.crack => 'Cracked',
      HandoverDamageType.broken => 'Broken',
      HandoverDamageType.missing => 'Missing',
      HandoverDamageType.chip ||
      HandoverDamageType.rust ||
      HandoverDamageType.other =>
        'Other',
    };

String _levelName(HandoverDamageLevel level) => switch (level) {
      HandoverDamageLevel.minor => 'Minor',
      HandoverDamageLevel.moderate => 'Moderate',
      HandoverDamageLevel.severe => 'Major',
    };

/// One row per numbered mark: No, Side, Damage, Level, Note, Photo.
List<List<String>> handoverPaperDamageRows(List<HandoverDamageMarker> marks) =>
    <List<String>>[
      for (int i = 0; i < marks.length; i++)
        <String>[
          '${i + 1}',
          '${_viewName(marks[i].view)}'
              '${marks[i].x == null ? ' (position not recorded)' : ''}',
          _typeName(marks[i].type),
          _levelName(marks[i].level),
          marks[i].note ?? '',
          (marks[i].photoUrl ?? '').isNotEmpty ? 'Attached' : '',
        ],
    ];
