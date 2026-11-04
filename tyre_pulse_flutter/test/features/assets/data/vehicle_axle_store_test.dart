/// The axle counts survive an offline restart.
library;

import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/features/assets/data/vehicle_axle_store.dart';
import 'package:tyre_pulse/features/tyre_diagram/domain/tyre_diagram_layouts.dart';
import 'package:tyre_pulse/features/tyre_diagram/domain/vehicle_axle_registry.dart';

final class _MemoryKv implements AxleKeyValueStore {
  final Map<String, String> values = <String, String>{};
  bool failReads = false;

  @override
  Future<String?> read(String key) async {
    if (failReads) throw StateError('unreadable');
    return values[key];
  }

  @override
  Future<void> write(String key, String value) async => values[key] = value;
}

Map<String, dynamic> _row(String asset, String country, int? axles) =>
    <String, dynamic>{
      'asset_no': asset,
      'country': country,
      'axle_count': axles,
    };

void main() {
  setUp(resetAxleRegistryForTest);

  test('a saved 4-axle pump still draws 12 tyres after a restart', () async {
    final _MemoryKv kv = _MemoryKv();
    final List<Map<String, dynamic>> rows = <Map<String, dynamic>>[
      _row('MP049', 'KSA', 4),
    ];
    registerFleetAxleRows(rows, country: 'KSA');
    await VehicleAxleStore(kv).save();

    resetAxleRegistryForTest(); // the app restarts, offline
    expect(diagramPositions('PUMPS', 'MP049').length, 14);

    await VehicleAxleStore(kv).restore();
    expect(diagramPositions('PUMPS', 'MP049').length, 12);
  });

  test('a corrupt or unreadable value draws the default build', () async {
    final _MemoryKv kv = _MemoryKv()
      ..values[VehicleAxleStore.storageKey] = 'not json';
    await VehicleAxleStore(kv).restore();
    expect(diagramPositions('PUMPS', 'MP049').length, 14);

    final _MemoryKv failing = _MemoryKv()..failReads = true;
    await VehicleAxleStore(failing).restore();
    expect(diagramPositions('PUMPS', 'MP049').length, 14);
  });

  test('a live value is never overwritten by a saved one', () async {
    final _MemoryKv kv = _MemoryKv();
    registerFleetAxleRows(<Map<String, dynamic>>[_row('MP049', 'KSA', 4)]);
    await VehicleAxleStore(kv).save();
    resetAxleRegistryForTest();
    registerFleetAxleRows(<Map<String, dynamic>>[_row('MP049', 'KSA', 5)]);
    await VehicleAxleStore(kv).restore();
    expect(axleCountFor('MP049', 'KSA'), 5);
  });
}
