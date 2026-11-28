/// What a wash covered: the parts of the vehicle (areas) and the sides
/// (views) the washer marked on the vehicle picture.
///
/// # Where this is stored
///
/// `wash_records` has no column for areas or sides. Both go inside the
/// existing `wash_details` jsonb as two extra keys, `areas` and `views`,
/// each a list of the short English keys below. The live CHECK
/// `valid_wash_details` validates only `version`, `chemical_status`,
/// `chemicals` and (optionally) `checklist`, and does not refuse unknown
/// keys, so the save is accepted with no migration (verified against the
/// live database on 2026-11-27: the function returns true for a payload
/// carrying `areas` and `views`).
///
/// # `wash_type` is derived, never asked for
///
/// `wash_records.wash_type` keeps its CHECK vocabulary ([kWashTypes]) so the
/// history page, its filters and the web keep working. The driver no longer
/// picks it: [washTypeForAreas] chooses the closest stored value from what
/// they marked, and the full detail stays in `wash_details.areas`.
library;

import 'package:tyre_pulse/features/washing/data/wash_record.dart';

/// A part of the vehicle that can be washed, in tile order.
enum WashArea {
  exterior('exterior'),
  engineBay('engine_bay'),
  undercarriage('undercarriage'),
  cabin('cabin'),
  tyresRims('tyres_rims'),
  drumHopper('drum_hopper'),
  steam('steam');

  const WashArea(this.key);

  /// Stored verbatim in `wash_details.areas`. Never translate.
  final String key;

  /// The drawn illustration for this tile (1x + 2.0x variants exist).
  String get assetPath => 'assets/wash_types/$key.png';

  static WashArea? fromKey(String? key) {
    for (final WashArea area in values) {
      if (area.key == key) return area;
    }
    return null;
  }
}

/// A side of the vehicle picture. The names match the per-view image
/// suffixes in `assets/vehicle_multiview_views/`.
enum WashView {
  front,
  left,
  rear,
  right,
  top;

  static WashView? fromKey(String? key) {
    for (final WashView view in values) {
      if (view.name == key) return view;
    }
    return null;
  }
}

/// True for vehicle types that carry a mixer drum and hopper (transit
/// mixers) or a concrete hopper (pumps). Only these show that tile.
bool vehicleHasDrumOrHopper(String? vehicleType) {
  final String type = (vehicleType ?? '').toLowerCase();
  return type.contains('mix') || type.contains('pump');
}

/// The tiles offered for a vehicle, in display order.
List<WashArea> washAreasForVehicle(String? vehicleType) => <WashArea>[
      for (final WashArea area in WashArea.values)
        if (area != WashArea.drumHopper || vehicleHasDrumOrHopper(vehicleType))
          area,
    ];

/// The `wash_records.wash_type` value recorded for what was washed.
///
/// Rules, first match wins:
/// - waterless method -> `Waterless`
/// - body outside AND cabin inside -> `Full`
/// - steam degrease -> `Steam`
/// - otherwise the first marked area by priority: exterior -> `Exterior`,
///   engine bay -> `Engine Bay`, undercarriage -> `Undercarriage`, cabin ->
///   `Interior`, tyres and rims or drum and hopper -> `Exterior` (both are
///   outside surfaces).
///
/// Returns null when nothing was marked, which the screen treats as not
/// ready to save.
String? washTypeForAreas(Set<WashArea> areas, {bool waterless = false}) {
  if (areas.isEmpty) return null;
  final String type;
  if (waterless) {
    type = 'Waterless';
  } else if (areas.contains(WashArea.exterior) &&
      areas.contains(WashArea.cabin)) {
    type = 'Full';
  } else if (areas.contains(WashArea.steam)) {
    type = 'Steam';
  } else if (areas.contains(WashArea.exterior)) {
    type = 'Exterior';
  } else if (areas.contains(WashArea.engineBay)) {
    type = 'Engine Bay';
  } else if (areas.contains(WashArea.undercarriage)) {
    type = 'Undercarriage';
  } else if (areas.contains(WashArea.cabin)) {
    type = 'Interior';
  } else {
    type = 'Exterior';
  }
  assert(kWashTypes.contains(type), 'wash_type must stay in the CHECK list');
  return type;
}

/// [details] with the marked areas and sides written in, in a stable order
/// so the same wash always produces the same payload.
Map<String, dynamic> withWashScope(
  Map<String, dynamic> details, {
  required Set<WashArea> areas,
  required Set<WashView> views,
}) =>
    <String, dynamic>{
      ...details,
      'areas': <String>[
        for (final WashArea a in WashArea.values)
          if (areas.contains(a)) a.key,
      ],
      'views': <String>[
        for (final WashView v in WashView.values)
          if (views.contains(v)) v.name,
      ],
    };

/// The areas stored on a saved record, unknown keys ignored.
List<WashArea> washAreasFromDetails(Map<String, dynamic>? details) {
  final Object? raw = details?['areas'];
  if (raw is! List) return const <WashArea>[];
  return <WashArea>[
    for (final Object? key in raw)
      if (WashArea.fromKey(key is String ? key : null) case final WashArea a) a,
  ];
}

/// The sides stored on a saved record, unknown keys ignored.
List<WashView> washViewsFromDetails(Map<String, dynamic>? details) {
  final Object? raw = details?['views'];
  if (raw is! List) return const <WashView>[];
  return <WashView>[
    for (final Object? key in raw)
      if (WashView.fromKey(key is String ? key : null) case final WashView v) v,
  ];
}
