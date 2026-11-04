/// 4- vs 5-axle concrete pumps: each machine draws the build the fleet
/// register records for it (vehicle_fleet.axle_count).
library;

import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/features/tyre_diagram/domain/tyre_diagram_layouts.dart';
import 'package:tyre_pulse/features/tyre_diagram/domain/vehicle_axle_registry.dart';

Map<String, dynamic> _row(String asset, String country, int? axles) =>
    <String, dynamic>{
      'asset_no': asset,
      'country': country,
      'axle_count': axles,
    };

void main() {
  setUp(resetAxleRegistryForTest);

  test('a pump with no recorded count keeps the 14-tyre build', () {
    expect(resolveVehicleType('PUMPS', 'MP099'), 'Concrete pump');
    expect(diagramPositions('PUMPS', 'MP099').length, 14);
  });

  test('a 4-axle pump draws 12 tyres, no third steer axle', () {
    final List<Map<String, dynamic>> rows = <Map<String, dynamic>>[
      _row('MP049', 'KSA', 4),
      _row('MP099', 'KSA', 5),
    ];
    registerFleetAxleRows(rows, country: 'KSA');
    expect(resolveVehicleType('PUMPS', 'MP049'), 'Concrete pump 4-axle');
    final List<String> ids = diagramPositions('PUMPS', 'mp049');
    expect(ids.length, 12);
    expect(ids, isNot(contains('F3L')));
    expect(diagramPositions('PUMPS', 'MP099').length, 14);
  });

  test('the same code abroad is another machine and is not borrowed', () {
    final List<Map<String, dynamic>> rows = <Map<String, dynamic>>[
      _row('MP049', 'KSA', 4),
      _row('MP049', 'UAE', null),
    ];
    registerFleetAxleRows(rows);
    expect(axleCountFor('MP049'), isNull);
    expect(axleCountFor('MP049', 'UAE'), isNull);
    expect(axleCountFor('MP049', 'KSA'), 4);
    final String ksa = layoutForAsset('Concrete pump', 'MP049', 'KSA');
    expect(ksa, 'Concrete pump 4-axle');
    registerFleetAxleRows(const <Map<String, dynamic>>[], country: 'UAE');
    expect(resolveVehicleType('PUMPS', 'MP049'), 'Concrete pump');
  });

  test('other types are never changed by an axle count', () {
    registerFleetAxleRows(<Map<String, dynamic>>[_row('TM514', 'KSA', 4)]);
    expect(resolveVehicleType('TR-MIXER', 'TM514'), 'Tri-mixer');
  });
}
