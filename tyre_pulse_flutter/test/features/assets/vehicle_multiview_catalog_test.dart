import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/features/assets/domain/vehicle_asset.dart';
import 'package:tyre_pulse/features/assets/presentation/vehicle_multiview_catalog.dart';
import 'package:tyre_pulse/features/assets/presentation/vehicle_photo_resolver.dart';

void main() {
  test('every five-view catalog entry has a unique bundled image', () {
    final Set<String> ids = <String>{};
    final Set<String> paths = <String>{};

    for (final VehicleMultiViewCatalogEntry entry in kVehicleMultiViewCatalog) {
      expect(ids.add(entry.id), isTrue, reason: 'duplicate id ${entry.id}');
      expect(
        paths.add(entry.assetPath),
        isTrue,
        reason: 'duplicate path ${entry.assetPath}',
      );
      expect(
        File(entry.assetPath).existsSync(),
        isTrue,
        reason: 'missing generated board ${entry.assetPath}',
      );
      expect(vehicleMultiViewCatalogEntry(entry.id), same(entry));
    }

    expect(kVehicleMultiViewCatalog, hasLength(20));
  });

  test('all 20 catalog boards are reachable by a truthful fleet fixture', () {
    const Map<String, VehicleAsset> fixtures = <String, VehicleAsset>{
      'transit-mixer-3axle':
          VehicleAsset(id: 'mixer', vehicleType: 'Transit Mixer'),
      'sany-concrete-pump-5axle': VehicleAsset(
        id: 'pump-5',
        make: 'SANY',
        vehicleType: 'Concrete Pump 5 axle',
      ),
      'white-concrete-pump-4axle': VehicleAsset(
        id: 'pump-4',
        vehicleType: 'White Concrete Pump 4 axle',
      ),
      'line-pump-4axle':
          VehicleAsset(id: 'line', vehicleType: 'Truck Mounted Line Pump'),
      'ashok-leyland-bus': VehicleAsset(
        id: 'ashok',
        make: 'Ashok Leyland',
        vehicleType: '62 seater bus',
      ),
      'tata-staff-bus': VehicleAsset(
        id: 'tata-bus',
        make: 'Tata',
        vehicleType: '32 seater bus',
      ),
      'toyota-hiace': VehicleAsset(
        id: 'hiace',
        make: 'Toyota',
        model: 'Hiace',
        vehicleType: 'Staff van',
      ),
      'generic-staff-bus': VehicleAsset(id: 'bus', vehicleType: 'Staff bus'),
      'mitsubishi-double-cab': VehicleAsset(
        id: 'mitsubishi',
        make: 'Mitsubishi',
        model: 'L200',
        vehicleType: 'Light vehicle',
      ),
      'tata-xenon-double-cab': VehicleAsset(
        id: 'xenon',
        make: 'Tata',
        model: 'Xenon',
        vehicleType: 'Light vehicle',
      ),
      'generic-double-cab':
          VehicleAsset(id: 'pickup', vehicleType: 'Double cab pickup'),
      'sany-wheel-loader': VehicleAsset(
        id: 'loader',
        make: 'SANY',
        vehicleType: 'Wheel loader',
      ),
      'cat-skid-loader': VehicleAsset(
        id: 'skid',
        make: 'CAT',
        vehicleType: 'Skid-steer loader',
      ),
      'sany-towable-pump': VehicleAsset(
        id: 'towable',
        make: 'SANY',
        vehicleType: 'Towable pump',
      ),
      'sany-stationary-pump': VehicleAsset(
        id: 'stationary',
        make: 'SANY',
        vehicleType: 'Stationary pump',
      ),
      'sany-generator': VehicleAsset(
        id: 'generator',
        make: 'SANY',
        vehicleType: 'Generator',
      ),
      'snowkey-chiller': VehicleAsset(
        id: 'snowkey',
        make: 'Snowkey',
        vehicleType: 'Chiller',
      ),
      'industrial-chiller': VehicleAsset(
        id: 'lg',
        make: 'LG',
        vehicleType: 'Industrial water chiller',
      ),
      'sany-batching-plant': VehicleAsset(
        id: 'batch',
        make: 'SANY',
        vehicleType: 'Batching plant',
      ),
      'placing-boom': VehicleAsset(
        id: 'placing',
        make: 'HAMAC',
        vehicleType: 'Placing boom',
      ),
    };

    expect(fixtures.keys.toSet(), <String>{
      for (final VehicleMultiViewCatalogEntry entry in kVehicleMultiViewCatalog)
        entry.id,
    });
    for (final MapEntry<String, VehicleAsset> fixture in fixtures.entries) {
      final VehicleMultiViewCatalogEntry entry =
          vehicleMultiViewCatalogEntry(fixture.key)!;
      expect(
        vehicleMultiViewAsset(fixture.value),
        entry.assetPath,
        reason: '${fixture.key} is catalogued but not resolvable',
      );
    }
  });

  group('unknown geometry or conflicting make stays honest', () {
    const List<VehicleAsset> unknowns = <VehicleAsset>[
      VehicleAsset(id: 'road', vehicleType: 'Unregistered crane carrier'),
      VehicleAsset(id: 'pump', vehicleType: 'Concrete Pump'),
      VehicleAsset(id: 'brand-only', vehicleType: 'Tata'),
      VehicleAsset(
        id: 'cummins',
        assetNo: 'GN101',
        make: 'Cummins',
        vehicleType: 'Generator',
      ),
      VehicleAsset(
        id: 'cat-loader',
        make: 'CAT',
        vehicleType: 'Wheel loader',
      ),
      VehicleAsset(
        id: 'carrier',
        make: 'Carrier',
        vehicleType: 'Chiller',
      ),
    ];

    for (final VehicleAsset asset in unknowns) {
      test(asset.id, () {
        expect(vehicleMultiViewAsset(asset), isNull);
      });
    }
  });
}
