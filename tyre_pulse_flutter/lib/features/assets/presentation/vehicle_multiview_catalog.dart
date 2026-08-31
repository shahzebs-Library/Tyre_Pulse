/// Generated five-view fleet artwork available to asset, inspection and
/// accident-report screens.
///
/// Each image is a single reference board containing front, rear, true-top,
/// left and right views of one consistent asset. The catalog is intentionally
/// explicit: a new make or axle arrangement must receive its own artwork
/// rather than silently borrowing a materially different vehicle.
library;

final class VehicleMultiViewCatalogEntry {
  const VehicleMultiViewCatalogEntry({
    required this.id,
    required this.label,
    required this.make,
    required this.assetPath,
    required this.tyreBearing,
    this.axleCount,
  });

  final String id;
  final String label;
  final String make;
  final String assetPath;
  final bool tyreBearing;
  final int? axleCount;
}

const List<VehicleMultiViewCatalogEntry> kVehicleMultiViewCatalog =
    <VehicleMultiViewCatalogEntry>[
  VehicleMultiViewCatalogEntry(
    id: 'transit-mixer-3axle',
    label: 'Transit mixer',
    make: 'Fleet reference',
    assetPath: 'assets/vehicle_multiview/transit_mixer_3axle_five_view_v1.png',
    tyreBearing: true,
    axleCount: 3,
  ),
  VehicleMultiViewCatalogEntry(
    id: 'sany-concrete-pump-5axle',
    label: 'Concrete pump · 5 axle',
    make: 'SANY',
    assetPath:
        'assets/vehicle_multiview/sany_concrete_pump_5axle_five_view_v1.png',
    tyreBearing: true,
    axleCount: 5,
  ),
  VehicleMultiViewCatalogEntry(
    id: 'white-concrete-pump-4axle',
    label: 'Concrete pump · 4 axle',
    make: 'Fleet reference',
    assetPath:
        'assets/vehicle_multiview/white_concrete_pump_4axle_five_view_v1.png',
    tyreBearing: true,
    axleCount: 4,
  ),
  VehicleMultiViewCatalogEntry(
    id: 'line-pump-4axle',
    label: 'Truck-mounted line pump · 4 axle',
    make: 'Fleet reference',
    assetPath: 'assets/vehicle_multiview/line_pump_4axle_five_view_v1.png',
    tyreBearing: true,
    axleCount: 4,
  ),
  VehicleMultiViewCatalogEntry(
    id: 'ashok-leyland-bus',
    label: 'Staff bus',
    make: 'Ashok Leyland',
    assetPath: 'assets/vehicle_multiview/ashok_leyland_bus_five_view_v1.png',
    tyreBearing: true,
    axleCount: 2,
  ),
  VehicleMultiViewCatalogEntry(
    id: 'tata-staff-bus',
    label: 'Staff bus',
    make: 'Tata',
    assetPath: 'assets/vehicle_multiview/tata_staff_bus_five_view_v1.png',
    tyreBearing: true,
    axleCount: 2,
  ),
  VehicleMultiViewCatalogEntry(
    id: 'toyota-hiace',
    label: 'Hiace staff van',
    make: 'Toyota',
    assetPath: 'assets/vehicle_multiview/toyota_hiace_five_view_v1.png',
    tyreBearing: true,
    axleCount: 2,
  ),
  VehicleMultiViewCatalogEntry(
    id: 'generic-staff-bus',
    label: 'Staff bus',
    make: 'Unspecified',
    assetPath: 'assets/vehicle_multiview/generic_staff_bus_five_view_v1.png',
    tyreBearing: true,
    axleCount: 2,
  ),
  VehicleMultiViewCatalogEntry(
    id: 'mitsubishi-double-cab',
    label: 'Double-cab pickup',
    make: 'Mitsubishi',
    assetPath:
        'assets/vehicle_multiview/mitsubishi_double_cab_five_view_v1.png',
    tyreBearing: true,
    axleCount: 2,
  ),
  VehicleMultiViewCatalogEntry(
    id: 'tata-xenon-double-cab',
    label: 'Double-cab pickup',
    make: 'Tata Xenon',
    assetPath:
        'assets/vehicle_multiview/tata_xenon_double_cab_five_view_v1.png',
    tyreBearing: true,
    axleCount: 2,
  ),
  VehicleMultiViewCatalogEntry(
    id: 'generic-double-cab',
    label: 'Double-cab pickup',
    make: 'Unspecified',
    assetPath: 'assets/vehicle_multiview/generic_double_cab_five_view_v1.png',
    tyreBearing: true,
    axleCount: 2,
  ),
  VehicleMultiViewCatalogEntry(
    id: 'sany-wheel-loader',
    label: 'Wheel loader',
    make: 'SANY',
    assetPath: 'assets/vehicle_multiview/sany_wheel_loader_five_view_v1.png',
    tyreBearing: true,
    axleCount: 2,
  ),
  VehicleMultiViewCatalogEntry(
    id: 'cat-skid-loader',
    label: 'Skid-steer loader',
    make: 'CAT',
    assetPath: 'assets/vehicle_multiview/cat_skid_loader_five_view_v1.png',
    tyreBearing: true,
    axleCount: 2,
  ),
  VehicleMultiViewCatalogEntry(
    id: 'sany-towable-pump',
    label: 'Towable concrete pump',
    make: 'SANY',
    assetPath: 'assets/vehicle_multiview/sany_towable_pump_five_view_v1.png',
    tyreBearing: true,
    axleCount: 1,
  ),
  VehicleMultiViewCatalogEntry(
    id: 'sany-stationary-pump',
    label: 'Stationary concrete pump',
    make: 'SANY',
    assetPath: 'assets/vehicle_multiview/sany_stationary_pump_five_view_v1.png',
    tyreBearing: true,
    axleCount: 1,
  ),
  VehicleMultiViewCatalogEntry(
    id: 'sany-generator',
    label: 'Enclosed generator',
    make: 'SANY',
    assetPath: 'assets/vehicle_multiview/sany_generator_five_view_v1.png',
    tyreBearing: false,
  ),
  VehicleMultiViewCatalogEntry(
    id: 'snowkey-chiller',
    label: 'Industrial chiller',
    make: 'Snowkey',
    assetPath: 'assets/vehicle_multiview/snowkey_chiller_five_view_v1.png',
    tyreBearing: false,
  ),
  VehicleMultiViewCatalogEntry(
    id: 'industrial-chiller',
    label: 'Industrial water chiller',
    make: 'LG reference',
    assetPath: 'assets/vehicle_multiview/industrial_chiller_five_view_v1.png',
    tyreBearing: false,
  ),
  VehicleMultiViewCatalogEntry(
    id: 'sany-batching-plant',
    label: 'Concrete batching plant',
    make: 'SANY',
    assetPath: 'assets/vehicle_multiview/sany_batching_plant_five_view_v1.png',
    tyreBearing: false,
  ),
  VehicleMultiViewCatalogEntry(
    id: 'placing-boom',
    label: 'Freestanding placing boom',
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
