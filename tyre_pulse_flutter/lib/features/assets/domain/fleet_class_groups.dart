/// The three browse groups on the Fleet & assets screen: road vehicles,
/// mobile plant and equipment, and stationary equipment.
///
/// Decided by the asset-number CLASS prefix ([assetClassOf]), the same
/// signal the register already uses for tyre classes. The mapping lists
/// every prefix present in `vehicle_fleet` as measured on 2026-09-28 whose
/// kind is unambiguous from its `vehicle_type` values:
///
/// - vehicles: TM transit mixer, MP mobile pump, PL pickup, BH / MB / BM bus,
///   TR trailer, MT tanker, DT, HD distributor
/// - plant and equipment: WL wheel loader, SL skid loader, EXR excavator,
///   FL forklift, REC reclaimer, LP line pump
/// - stationary: GN generator, BP batching plant, IP ice plant / chiller,
///   PB placing boom, SP stationary pump, WTP water treatment plant,
///   DP buildings
///
/// A prefix not listed here (BN, PH, PV, LH, WB, CR, ...) belongs to NO group
/// and is only reachable under All - a group is a claim about what kind of
/// machine it is, and it is never guessed.
library;

import 'package:tyre_pulse/features/assets/domain/asset_classes.dart';

enum FleetClassGroup { vehicles, plant, stationary }

const Map<FleetClassGroup, Set<String>> fleetClassGroupPrefixes =
    <FleetClassGroup, Set<String>>{
  FleetClassGroup.vehicles: <String>{
    'TM', 'MP', 'PL', 'BH', 'MB', 'BM', 'TR', 'MT', 'DT', 'HD', //
  },
  FleetClassGroup.plant: <String>{'WL', 'SL', 'EXR', 'FL', 'REC', 'LP'},
  FleetClassGroup.stationary: <String>{
    'GN', 'BP', 'IP', 'PB', 'SP', 'WTP', 'DP', //
  },
};

/// The group [assetNo] belongs to, or null when its class is not mapped.
FleetClassGroup? fleetClassGroupOf(String? assetNo) {
  final String? cls = assetClassOf(assetNo);
  if (cls == null) return null;
  for (final MapEntry<FleetClassGroup, Set<String>> e
      in fleetClassGroupPrefixes.entries) {
    if (e.value.contains(cls)) return e.key;
  }
  return null;
}
