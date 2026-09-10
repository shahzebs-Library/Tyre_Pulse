import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/features/assets/presentation/vehicle_photo_resolver.dart';
import 'package:tyre_pulse/features/tyre_diagram/domain/tyre_diagram_layouts.dart';

void main() {
  test(
      'separate model fields override broad imported types, make alone does not',
      () {
    expect(
      resolveVehicleTypeFor(vehicleType: 'Truck', make: 'Tata', model: 'Xenon'),
      'Pickup',
    );
    expect(
      resolveVehicleTypeFor(
        vehicleType: 'HEAVY EQP',
        make: 'SANY',
        assetNo: 'CP045',
      ),
      'Concrete pump',
    );
    expect(
      resolveVehicleTypeFor(vehicleType: 'Bus', make: 'Toyota'),
      'Bus',
    );
  });
  test('Toyota make alone cannot identify a Hiace body', () {
    for (final String model in <String>['Coaster', '']) {
      expect(
        vehiclePhotoAssetFor(vehicleType: 'Bus', make: 'Toyota', model: model),
        isNull,
      );
      expect(
        vehicleMultiViewAssetFor(
          vehicleType: 'Bus',
          make: 'Toyota',
          model: model,
        ),
        isNull,
      );
    }
  });

  test(
      'identified pickups retain four positions instead of truck or mixer axles',
      () {
    for (final String description in <String>[
      'Mitsubishi Triton',
      'Tata Xenon',
      'Mitsubishi L200',
      'Maxus T60',
      'Tata double cabin',
    ]) {
      final String key = resolveVehicleType(description, 'TM001');
      expect(key, 'Pickup', reason: description);
      expect(
        kTyreDiagramLayouts[key]!.tyres.map((slot) => slot.id),
        <String>['FL', 'FR', 'RL', 'RR'],
      );
    }
  });

  test('boom pump photo uses the same pump family as its canonical layout', () {
    expect(resolveVehicleType('Boom Pump'), 'Concrete pump');
    expect(
      vehiclePhotoAssetFor(vehicleType: 'Boom Pump'),
      'assets/vehicle_photos/concrete_pump.png',
    );
    expect(resolveVehicleType('Line Pump'), 'Line pump');
    expect(
      vehiclePhotoAssetFor(vehicleType: 'Line Pump'),
      'assets/vehicle_photos/truck_mounted_pump.png',
    );
  });

  test('existing heavy fleet layout counts and identities remain canonical',
      () {
    for (final MapEntry<String, int> expected in <String, int>{
      'Concrete pump': 14,
      'Line pump': 12,
      'Tri-mixer': 12,
      'Wheel loader': 4,
      'Bus': 6,
      'Pickup': 4,
    }.entries) {
      expect(resolveVehicleType(expected.key), expected.key);
      expect(
        kTyreDiagramLayouts[expected.key]!.tyres,
        hasLength(expected.value),
      );
    }
  });
}
