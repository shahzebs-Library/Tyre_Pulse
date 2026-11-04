/// 4- vs 5-axle concrete pumps: each machine draws the build the fleet
/// register records for it (vehicle_fleet.axle_count).
library;

import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/features/tyre_diagram/domain/tyre_diagram_layouts.dart';
import 'package:tyre_pulse/features/tyre_diagram/domain/vehicle_axle_registry.dart';

void main() {
  setUp(resetAxleRegistryForTest);

  test('a pump with no recorded count keeps the 14-tyre build', () {
    expect(resolveVehicleType('PUMPS', 'MP099'), 'Concrete pump');
    expect(diagramPositions('PUMPS', 'MP099').length, 14);
  });

  test('a 4-axle pump draws 12 tyres, no third steer axle', () {
    registerFleetAxleRows(<Map<String, dynamic>>[
      <String, dynamic>{'asset_no': 'MP049', 'country': 'KSA', 'axle_count': 4},
      <String, dynamic>{'asset_no': 'MP099', 'country': 'KSA', 'axle_count': 5},
    ], country: 'KSA');
    expect(resolveVehicleType('PUMPS', 'MP049'), 'Concrete pump 4-axle');
    final List<String> ids = diagramPositions('PUMPS', 'mp049');
    expect(ids.length, 12);
    expect(ids, isNot(contains('F3L')));
    expect(diagramPositions('PUMPS', 'MP099').length, 14);
  });

  test('the same code abroad is another machine and is not borrowed', () {
    registerFleetAxleRows(<Map<String, dynamic>>[
      <String, dynamic>{'asset_no': 'MP049', 'country': 'KSA', 'axle_count': 4},
      <String, dynamic>{
        'asset_no': 'MP049',
        'country': 'UAE',
        'axle_count': null,
      },
    ]);
    expect(axleCountFor('MP049'), isNull);
    expect(axleCountFor('MP049', 'UAE'), isNull);
    expect(axleCountFor('MP049', 'KSA'), 4);
    expect(
      layoutForAsset('Concrete pump', 'MP049', 'KSA'),
      'Concrete pump 4-axle',
    );
    registerFleetAxleRows(const <Map<String, dynamic>>[], country: 'UAE');
    expect(resolveVehicleType('PUMPS', 'MP049'), 'Concrete pump');
  });

  test('other types are never changed by an axle count', () {
    registerFleetAxleRows(<Map<String, dynamic>>[
      <String, dynamic>{'asset_no': 'TM514', 'country': 'KSA', 'axle_count': 4},
    ]);
    expect(resolveVehicleType('TR-MIXER', 'TM514'), 'Tri-mixer');
  });
}
