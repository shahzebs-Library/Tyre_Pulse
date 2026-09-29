import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/features/assets/data/fleet_signals_repository.dart';
import 'package:tyre_pulse/features/assets/domain/asset_360_facts.dart';
import 'package:tyre_pulse/features/assets/domain/fleet_signals.dart';
import 'package:tyre_pulse/features/assets/domain/vehicle_asset.dart';

final class _FakeSource implements FleetSignalsSource {
  _FakeSource({this.actions = const [], this.fail = false}) : pm = const [];

  final List<Map<String, dynamic>> pm;
  final List<Map<String, dynamic>> actions;
  final bool fail;
  final List<String?> countries = <String?>[];

  List<Map<String, dynamic>> _page(
    List<Map<String, dynamic>> rows,
    int from,
    int to,
  ) {
    if (fail) throw StateError('network');
    if (from >= rows.length) return const <Map<String, dynamic>>[];
    return rows.sublist(from, to + 1 > rows.length ? rows.length : to + 1);
  }

  @override
  Future<List<Map<String, dynamic>>> pmPage(
    String? country,
    int from,
    int to,
  ) async {
    countries.add(country);
    return _page(pm, from, to);
  }

  @override
  Future<List<Map<String, dynamic>>> actionPage(
    String? country,
    int from,
    int to,
  ) async =>
      _page(actions, from, to);
}

void main() {
  final DateTime now = DateTime(2026, 9, 29);

  group('isFleetServiceDueSoon', () {
    AssetServiceDue due(AssetServiceDueUnit unit, int remaining) =>
        AssetServiceDue(unit: unit, remaining: remaining, planName: null);

    test('overdue in any unit is due soon', () {
      expect(isFleetServiceDueSoon(due(AssetServiceDueUnit.days, -1)), isTrue);
    });
    test('km window is $fleetDueSoonKm km inclusive', () {
      expect(isFleetServiceDueSoon(due(AssetServiceDueUnit.km, 1000)), isTrue);
      expect(isFleetServiceDueSoon(due(AssetServiceDueUnit.km, 1001)), isFalse);
    });
    test('days window is $fleetDueSoonDays days inclusive', () {
      expect(isFleetServiceDueSoon(due(AssetServiceDueUnit.days, 14)), isTrue);
      expect(isFleetServiceDueSoon(due(AssetServiceDueUnit.days, 15)), isFalse);
    });
    test('nothing measured is never due soon', () {
      expect(isFleetServiceDueSoon(null), isFalse);
    });
  });

  group('FleetSignals.signalFor', () {
    test('matches asset numbers case-insensitively and trims them', () {
      final FleetSignals s = FleetSignals.fromRows(
        pmRows: const <Map<String, dynamic>>[
          <String, dynamic>{
            'id': 'p',
            'asset_no': ' tm514 ',
            'status': 'active',
            'next_due': '2026-10-05',
          },
        ],
        actionRows: const <Map<String, dynamic>>[],
      );
      final FleetAssetSignal sig =
          s.signalFor(const VehicleAsset(id: 'v', assetNo: 'TM514'), now);
      expect(sig.serviceDue?.unit, AssetServiceDueUnit.days);
      expect(sig.serviceDue?.remaining, 6);
      expect(sig.isDueSoon, isTrue);
    });

    test('a row in another country is another machine and is not matched', () {
      final FleetSignals s = FleetSignals.fromRows(
        pmRows: const <Map<String, dynamic>>[],
        actionRows: const <Map<String, dynamic>>[
          <String, dynamic>{
            'id': 'a',
            'asset_no': 'GN103',
            'country': 'UAE',
            'status': 'open',
          },
          <String, dynamic>{'id': 'b', 'asset_no': 'GN103', 'status': 'open'},
        ],
      );
      expect(
        s
            .signalFor(
              const VehicleAsset(id: 'v', assetNo: 'GN103', country: 'KSA'),
              now,
            )
            .tyreActions,
        1,
      );
    });

    test('an asset with no asset number gets an empty signal', () {
      final FleetSignals s = FleetSignals.fromRows(
        pmRows: const <Map<String, dynamic>>[],
        actionRows: const <Map<String, dynamic>>[],
      );
      final FleetAssetSignal sig =
          s.signalFor(const VehicleAsset(id: 'v'), now);
      expect(sig.serviceDue, isNull);
      expect(sig.tyreActions, 0);
    });
  });

  group('compareFleetServiceDue', () {
    test('overdue first, nothing measured last', () {
      const AssetServiceDue overdue = AssetServiceDue(
        unit: AssetServiceDueUnit.days,
        remaining: -2,
        planName: null,
      );
      const AssetServiceDue km = AssetServiceDue(
        unit: AssetServiceDueUnit.km,
        remaining: 300,
        planName: null,
      );
      expect(compareFleetServiceDue(overdue, km), lessThan(0));
      expect(compareFleetServiceDue(null, km), greaterThan(0));
      expect(compareFleetServiceDue(null, null), 0);
    });
  });

  group('loadFleetSignals', () {
    test('passes the active country and a blank country as null', () async {
      final _FakeSource source = _FakeSource();
      await loadFleetSignals(source, country: ' KSA ');
      await loadFleetSignals(source, country: '  ');
      expect(source.countries, <String?>['KSA', null]);
    });

    test('a failed read is Unavailable, never an empty Loaded', () async {
      expect(
        await loadFleetSignals(_FakeSource(fail: true)),
        isA<FleetSignalsUnavailable>(),
      );
    });

    test('a read that fills its cap is Unavailable, not a partial answer',
        () async {
      final List<Map<String, dynamic>> many = <Map<String, dynamic>>[
        for (int i = 0; i < fleetSignalsRowCap; i++)
          <String, dynamic>{'id': '$i', 'asset_no': 'A$i', 'status': 'open'},
      ];
      expect(
        await loadFleetSignals(_FakeSource(actions: many)),
        isA<FleetSignalsUnavailable>(),
      );
    });
  });
}
