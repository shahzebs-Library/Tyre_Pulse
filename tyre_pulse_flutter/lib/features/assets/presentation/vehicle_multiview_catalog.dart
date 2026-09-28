/// Generated five-view fleet artwork available to asset, inspection and
/// accident-report screens.
///
/// Each image is a single reference board containing front, rear, true-top,
/// left and right views of one consistent asset. The catalog is intentionally
/// explicit: a new make or axle arrangement must receive its own artwork
/// rather than silently borrowing a materially different vehicle.
library;

import 'package:tyre_pulse/app/localization/tp_localizations.dart';

/// The vehicle class a catalog board depicts. The display name is NOT stored
/// here: it is resolved through [vehicleClassLabel] at render time so it
/// follows the user's language (spec section 51).
enum VehicleClass {
  transitMixer,
  concretePump,
  linePump,
  staffBus,
  staffVan,
  doubleCabPickup,
  wheelLoader,
  skidSteerLoader,
  towablePump,
  stationaryPump,
  generator,
  chiller,
  waterChiller,
  batchingPlant,
  placingBoom,
}

final class VehicleMultiViewCatalogEntry {
  const VehicleMultiViewCatalogEntry({
    required this.id,
    required this.vehicleClass,
    required this.make,
    required this.assetPath,
    required this.tyreBearing,
    this.axleCount,
  });

  final String id;
  final VehicleClass vehicleClass;
  final String make;
  final String assetPath;
  final bool tyreBearing;
  final int? axleCount;
}

const List<VehicleMultiViewCatalogEntry> kVehicleMultiViewCatalog =
    <VehicleMultiViewCatalogEntry>[
  VehicleMultiViewCatalogEntry(
    id: 'transit-mixer-3axle',
    vehicleClass: VehicleClass.transitMixer,
    make: 'Fleet reference',
    assetPath: 'assets/vehicle_multiview/transit_mixer_3axle_five_view_v1.png',
    tyreBearing: true,
    axleCount: 3,
  ),
  VehicleMultiViewCatalogEntry(
    id: 'sany-concrete-pump-5axle',
    vehicleClass: VehicleClass.concretePump,
    make: 'SANY',
    assetPath:
        'assets/vehicle_multiview/sany_concrete_pump_5axle_five_view_v1.png',
    tyreBearing: true,
    axleCount: 5,
  ),
  VehicleMultiViewCatalogEntry(
    id: 'white-concrete-pump-4axle',
    vehicleClass: VehicleClass.concretePump,
    make: 'Fleet reference',
    assetPath:
        'assets/vehicle_multiview/white_concrete_pump_4axle_five_view_v1.png',
    tyreBearing: true,
    axleCount: 4,
  ),
  VehicleMultiViewCatalogEntry(
    id: 'line-pump-4axle',
    vehicleClass: VehicleClass.linePump,
    make: 'Fleet reference',
    assetPath: 'assets/vehicle_multiview/line_pump_4axle_five_view_v1.png',
    tyreBearing: true,
    axleCount: 4,
  ),
  VehicleMultiViewCatalogEntry(
    id: 'ashok-leyland-bus',
    vehicleClass: VehicleClass.staffBus,
    make: 'Ashok Leyland',
    assetPath: 'assets/vehicle_multiview/ashok_leyland_bus_five_view_v1.png',
    tyreBearing: true,
    axleCount: 2,
  ),
  VehicleMultiViewCatalogEntry(
    id: 'tata-staff-bus',
    vehicleClass: VehicleClass.staffBus,
    make: 'Tata',
    assetPath: 'assets/vehicle_multiview/tata_staff_bus_five_view_v1.png',
    tyreBearing: true,
    axleCount: 2,
  ),
  VehicleMultiViewCatalogEntry(
    id: 'toyota-hiace',
    vehicleClass: VehicleClass.staffVan,
    make: 'Toyota',
    assetPath: 'assets/vehicle_multiview/toyota_hiace_five_view_v1.png',
    tyreBearing: true,
    axleCount: 2,
  ),
  VehicleMultiViewCatalogEntry(
    id: 'generic-staff-bus',
    vehicleClass: VehicleClass.staffBus,
    make: 'Unspecified',
    assetPath: 'assets/vehicle_multiview/generic_staff_bus_five_view_v1.png',
    tyreBearing: true,
    axleCount: 2,
  ),
  VehicleMultiViewCatalogEntry(
    id: 'mitsubishi-double-cab',
    vehicleClass: VehicleClass.doubleCabPickup,
    make: 'Mitsubishi',
    assetPath:
        'assets/vehicle_multiview/mitsubishi_double_cab_five_view_v1.png',
    tyreBearing: true,
    axleCount: 2,
  ),
  VehicleMultiViewCatalogEntry(
    id: 'tata-xenon-double-cab',
    vehicleClass: VehicleClass.doubleCabPickup,
    make: 'Tata Xenon',
    assetPath:
        'assets/vehicle_multiview/tata_xenon_double_cab_five_view_v1.png',
    tyreBearing: true,
    axleCount: 2,
  ),
  VehicleMultiViewCatalogEntry(
    id: 'generic-double-cab',
    vehicleClass: VehicleClass.doubleCabPickup,
    make: 'Unspecified',
    assetPath: 'assets/vehicle_multiview/generic_double_cab_five_view_v1.png',
    tyreBearing: true,
    axleCount: 2,
  ),
  VehicleMultiViewCatalogEntry(
    id: 'sany-wheel-loader',
    vehicleClass: VehicleClass.wheelLoader,
    make: 'SANY',
    assetPath: 'assets/vehicle_multiview/sany_wheel_loader_five_view_v1.png',
    tyreBearing: true,
    axleCount: 2,
  ),
  VehicleMultiViewCatalogEntry(
    id: 'cat-skid-loader',
    vehicleClass: VehicleClass.skidSteerLoader,
    make: 'CAT',
    assetPath: 'assets/vehicle_multiview/cat_skid_loader_five_view_v1.png',
    tyreBearing: true,
    axleCount: 2,
  ),
  VehicleMultiViewCatalogEntry(
    id: 'sany-towable-pump',
    vehicleClass: VehicleClass.towablePump,
    make: 'SANY',
    assetPath: 'assets/vehicle_multiview/sany_towable_pump_five_view_v1.png',
    tyreBearing: true,
    axleCount: 1,
  ),
  VehicleMultiViewCatalogEntry(
    id: 'sany-stationary-pump',
    vehicleClass: VehicleClass.stationaryPump,
    make: 'SANY',
    assetPath: 'assets/vehicle_multiview/sany_stationary_pump_five_view_v1.png',
    tyreBearing: true,
    axleCount: 1,
  ),
  VehicleMultiViewCatalogEntry(
    id: 'sany-generator',
    vehicleClass: VehicleClass.generator,
    make: 'SANY',
    assetPath: 'assets/vehicle_multiview/sany_generator_five_view_v1.png',
    tyreBearing: false,
  ),
  VehicleMultiViewCatalogEntry(
    id: 'snowkey-chiller',
    vehicleClass: VehicleClass.chiller,
    make: 'Snowkey',
    assetPath: 'assets/vehicle_multiview/snowkey_chiller_five_view_v1.png',
    tyreBearing: false,
  ),
  VehicleMultiViewCatalogEntry(
    id: 'industrial-chiller',
    vehicleClass: VehicleClass.waterChiller,
    make: 'LG reference',
    assetPath: 'assets/vehicle_multiview/industrial_chiller_five_view_v1.png',
    tyreBearing: false,
  ),
  VehicleMultiViewCatalogEntry(
    id: 'sany-batching-plant',
    vehicleClass: VehicleClass.batchingPlant,
    make: 'SANY',
    assetPath: 'assets/vehicle_multiview/sany_batching_plant_five_view_v1.png',
    tyreBearing: false,
  ),
  VehicleMultiViewCatalogEntry(
    id: 'placing-boom',
    vehicleClass: VehicleClass.placingBoom,
    make: 'HAMAC reference',
    assetPath: 'assets/vehicle_multiview/placing_boom_five_view_v1.png',
    tyreBearing: false,
  ),
];

VehicleMultiViewCatalogEntry? vehicleMultiViewCatalogEntry(String id) {
  for (final VehicleMultiViewCatalogEntry entry in kVehicleMultiViewCatalog) {
    if (entry.id == id) return entry;
  }
  return null;
}

/// The localized display name of a catalog board, e.g. "Concrete pump, 5
/// axle". Axle-specific classes carry the axle count as an ICU placeholder.
String vehicleClassLabel(
  AppLocalizations l10n,
  VehicleMultiViewCatalogEntry entry,
) {
  final int? axles = entry.axleCount;
  return switch (entry.vehicleClass) {
    VehicleClass.transitMixer => l10n.vehicleClassTransitMixer,
    VehicleClass.concretePump => axles == null
        ? l10n.vehicleClassConcretePump
        : l10n.vehicleClassConcretePumpAxles(axles),
    VehicleClass.linePump => axles == null
        ? l10n.vehicleClassLinePump
        : l10n.vehicleClassLinePumpAxles(axles),
    VehicleClass.staffBus => l10n.vehicleClassStaffBus,
    VehicleClass.staffVan => l10n.vehicleClassStaffVan,
    VehicleClass.doubleCabPickup => l10n.vehicleClassDoubleCabPickup,
    VehicleClass.wheelLoader => l10n.vehicleClassWheelLoader,
    VehicleClass.skidSteerLoader => l10n.vehicleClassSkidSteerLoader,
    VehicleClass.towablePump => l10n.vehicleClassTowablePump,
    VehicleClass.stationaryPump => l10n.vehicleClassStationaryPump,
    VehicleClass.generator => l10n.vehicleClassGenerator,
    VehicleClass.chiller => l10n.vehicleClassChiller,
    VehicleClass.waterChiller => l10n.vehicleClassWaterChiller,
    VehicleClass.batchingPlant => l10n.vehicleClassBatchingPlant,
    VehicleClass.placingBoom => l10n.vehicleClassPlacingBoom,
  };
}
