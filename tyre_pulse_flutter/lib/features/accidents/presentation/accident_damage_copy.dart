/// Copy-catalog keys for the damage map - kept separate from
/// `accident_damage_map.dart` (which stays pure/no-localisation) and reused
/// by both the diagram section and its zone-editor sheet so the two can
/// never drift on what a zone or view is called.
library;

import 'package:tyre_pulse/features/accidents/domain/accident_damage_map.dart';
import 'package:tyre_pulse/features/accidents/presentation/accident_copy.dart';

/// The [AccidentCopy] key for [zoneId]'s display label.
///
/// Several zone ids intentionally share one key - e.g. `left_front_door` and
/// `right_front_door` both read `zoneFrontDoor` - because the active
/// [AccidentDamageView] already states which side is being looked at; a
/// second "left"/"right" word on every zone label would repeat that fact
/// rather than add to it.
String accidentDamageZoneLabelKey(String zoneId) => switch (zoneId) {
      'front_bumper' => 'zoneFrontBumper',
      'front_hood' || 'top_hood' => 'zoneHood',
      'front_windshield' || 'top_windshield' => 'zoneWindshield',
      'front_left_light' => 'zoneLeftHeadlight',
      'front_right_light' => 'zoneRightHeadlight',
      'rear_bumper' => 'zoneRearBumper',
      'rear_tailgate' || 'top_tailgate' => 'zoneTailgate',
      'rear_windshield' => 'zoneRearWindshield',
      'rear_left_light' => 'zoneLeftTailLight',
      'rear_right_light' => 'zoneRightTailLight',
      'left_front_fender' || 'right_front_fender' => 'zoneFrontFender',
      'left_front_door' || 'right_front_door' => 'zoneFrontDoor',
      'left_rear_door' || 'right_rear_door' => 'zoneRearDoor',
      'left_rear_fender' || 'right_rear_fender' => 'zoneRearFender',
      'left_mirror' || 'right_mirror' => 'zoneMirror',
      'left_roof' || 'right_roof' || 'top_roof' => 'zoneRoof',
      'front_cab_panel' => 'zoneCabPanel',
      'left_cab' || 'right_cab' || 'top_cab' || 'front_cab' => 'zoneCab',
      'rear_body_panel' => 'zoneBodyPanel',
      'left_driver_door' || 'right_driver_door' => 'zoneDriverDoor',
      'left_passenger_door' || 'right_passenger_door' => 'zonePassengerDoor',
      'left_side_panel' || 'right_side_panel' => 'zoneSidePanel',
      'left_body_panel' || 'right_body_panel' => 'zoneBodyPanel',
      'left_equipment_body' ||
      'right_equipment_body' ||
      'top_equipment_body' ||
      'rear_equipment' ||
      'top_rear_equipment' =>
        'zoneEquipmentBody',
      'left_boom' || 'right_boom' || 'top_boom' || 'front_boom' => 'zoneBoom',
      'left_outrigger' || 'right_outrigger' => 'zoneOutrigger',
      'front_bucket' ||
      'left_bucket' ||
      'right_bucket' ||
      'top_bucket' =>
        'zoneBucket',
      'left_lift_arm' || 'right_lift_arm' || 'top_lift_arm' => 'zoneLiftArm',
      'left_front_wheel' || 'right_front_wheel' => 'zoneFrontWheel',
      'left_rear_wheel' || 'right_rear_wheel' => 'zoneRearWheel',
      'left_engine_cover' ||
      'right_engine_cover' ||
      'top_engine_cover' =>
        'zoneEngineCover',
      'rear_counterweight' => 'zoneCounterweight',
      'front_equipment_panel' ||
      'rear_equipment_panel' ||
      'left_equipment_panel' ||
      'right_equipment_panel' =>
        'zoneEquipmentPanel',
      'left_control_panel' || 'right_control_panel' => 'zoneControlPanel',
      'front_pipework' || 'rear_pipework' || 'top_pipework' => 'zonePipework',
      'front_base_frame' ||
      'rear_base_frame' ||
      'left_base_frame' ||
      'right_base_frame' =>
        'zoneBaseFrame',
      'top_front_cab' => 'zoneCab',
      'top_passenger_body' => 'zonePassengerBody',
      _ => zoneId,
    };

String accidentDamageViewLabelKey(AccidentDamageView view) => switch (view) {
      AccidentDamageView.front => 'damageViewFront',
      AccidentDamageView.rear => 'damageViewRear',
      AccidentDamageView.left => 'damageViewLeft',
      AccidentDamageView.right => 'damageViewRight',
      AccidentDamageView.top => 'damageViewTop',
    };

/// Reuses `accidents.severity`'s own three-word vocabulary (already in the
/// catalog for the report form's severity dropdown) rather than declaring a
/// second copy of the same three words for one mark's severity.
String accidentDamageSeverityLabelKey(AccidentDamageSeverity severity) =>
    switch (severity) {
      AccidentDamageSeverity.minor => 'minor',
      AccidentDamageSeverity.moderate => 'moderate',
      AccidentDamageSeverity.severe => 'severe',
    };

String accidentDamageZoneLabel(AccidentCopy copy, String zoneId) =>
    copy(accidentDamageZoneLabelKey(zoneId));

String accidentDamageViewLabel(AccidentCopy copy, AccidentDamageView view) =>
    copy(accidentDamageViewLabelKey(view));

String accidentDamageSeverityLabel(
  AccidentCopy copy,
  AccidentDamageSeverity severity,
) =>
    copy(accidentDamageSeverityLabelKey(severity));

String accidentDamageTypeCopyLabel(
  AccidentCopy copy,
  AccidentDamageType type,
) =>
    copy(
      switch (type) {
        AccidentDamageType.dent => 'damageDent',
        AccidentDamageType.scratch => 'damageScratch',
        AccidentDamageType.cracked => 'damageCracked',
        AccidentDamageType.broken => 'damageBroken',
        AccidentDamageType.missing => 'damageMissing',
        AccidentDamageType.other => 'damageOther',
      },
    );
