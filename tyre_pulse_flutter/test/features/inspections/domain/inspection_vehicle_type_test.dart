/// P0-2: the raw register type is recorded; only an identified pickup
/// make/model changes the LAYOUT type. Tyreless and unknown types are never
/// forced into a four-tyre Pickup.
library;

import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/features/inspections/domain/inspection_vehicle_type.dart';
import 'package:tyre_pulse/features/tyre_diagram/domain/tyre_diagram_layouts.dart';

void main() {
  for (final String type in <String>[
    'GENERATOR',
    'PLACING BOOM',
    'STATIONARY PUMP',
    'BT-PLANT',
  ]) {
    test('$type stays tyreless: no positions to inspect', () {
      final String layout = inspectionLayoutVehicleType(
        vehicleType: type,
        assetNo: 'GN103',
      );
      expect(layout, type);
      expect(diagramPositions(layout, 'GN103'), isEmpty);
    });
  }

  test('an unknown type stays as recorded, not rewritten to Pickup', () {
    expect(
      inspectionLayoutVehicleType(vehicleType: 'HEAVY EQP', assetNo: 'ZZ9'),
      'HEAVY EQP',
    );
    expect(inspectionLayoutVehicleType(assetNo: 'ZZ9'), '');
  });

  test('a known type is laid out by itself', () {
    expect(
      inspectionLayoutVehicleType(vehicleType: 'TR-MIXER', assetNo: 'TM514'),
      'TR-MIXER',
    );
  });

  test('an identified pickup make/model lays out as a Pickup', () {
    expect(
      inspectionLayoutVehicleType(
        vehicleType: 'TRUCK',
        assetNo: 'LV12',
        make: 'Mitsubishi',
        model: 'Triton',
      ),
      'Pickup',
    );
  });
}
