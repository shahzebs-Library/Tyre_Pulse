import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/core/permissions/module_registry.dart';
import 'package:tyre_pulse/features/assets/data/asset_insights_repository.dart';
import 'package:tyre_pulse/features/assets/data/vehicle_fleet_repository.dart'
    show PagedRows;
import 'package:tyre_pulse/features/assets/domain/asset_financials.dart';
import 'package:tyre_pulse/features/assets/domain/asset_timeline.dart';
import 'package:tyre_pulse/features/assets/presentation/asset_insights_providers.dart';

class _Source implements AssetInsightsSource {
  _Source({this.linesTruncated = false, this.cardsTruncated = false});

  final bool linesTruncated;
  final bool cardsTruncated;
  final List<AssetTimelineFilter> queried = <AssetTimelineFilter>[];

  @override
  Future<PagedRows<Map<String, dynamic>>> costLines(
    AssetScope scope, {
    required String fromIso,
    required String toIso,
  }) async =>
      PagedRows<Map<String, dynamic>>(
        truncated: linesTruncated,
        rows: const <Map<String, dynamic>>[
          <String, dynamic>{
            'id': 'a',
            'event_date': '2026-08-15',
            'currency': 'SAR',
            'spare_cost': 300,
            'oil_cost': 0,
            'tyre_cost': 0,
          },
        ],
      );

  @override
  Future<PagedRows<Map<String, dynamic>>> jobCards(
    AssetScope scope, {
    required String fromIso,
    required String toIso,
  }) async =>
      PagedRows<Map<String, dynamic>>(
        rows: const <Map<String, dynamic>>[],
        truncated: cardsTruncated,
      );

  @override
  Future<List<Map<String, dynamic>>> meterReadings(
    AssetScope scope, {
    required bool engineHours,
    required String fromIso,
    required String toIso,
  }) async =>
      const <Map<String, dynamic>>[];

  @override
  Future<List<Map<String, dynamic>>> timelineRows(
    AssetScope scope,
    AssetTimelineFilter source, {
    required String fromIso,
  }) async {
    queried.add(source);
    return source == AssetTimelineFilter.accidents
        ? <Map<String, dynamic>>[
            <String, dynamic>{'id': 'acc1', 'incident_date': '2026-08-20'},
          ]
        : const <Map<String, dynamic>>[];
  }
}

const AssetScope _scope = (assetNo: 'MP045', country: 'KSA');
final AssetCostPeriod _period =
    AssetCostPeriod(from: DateTime(2026), to: DateTime(2026, 8, 28));

void main() {
  group('AssetInsightsRepository.loadTimeline', () {
    test('never queries a source outside the permitted set', () async {
      final _Source source = _Source();
      final AssetTimelineData data =
          await AssetInsightsRepository(source).loadTimeline(
        _scope,
        DateTime(2026),
        sources: <AssetTimelineFilter>{
          AssetTimelineFilter.inspections,
          AssetTimelineFilter.tyres,
        },
      );
      expect(source.queried, <AssetTimelineFilter>[
        AssetTimelineFilter.inspections,
        AssetTimelineFilter.tyres,
      ]);
      expect(
        data.events.where(
          (AssetTimelineEvent e) => e.kind == AssetTimelineKind.accident,
        ),
        isEmpty,
      );
    });

    test('reads the accident source only when permitted', () async {
      final _Source source = _Source();
      final AssetTimelineData data =
          await AssetInsightsRepository(source).loadTimeline(
        _scope,
        DateTime(2026),
        sources: AssetInsightsRepository.timelineSources.toSet(),
      );
      expect(source.queried, contains(AssetTimelineFilter.accidents));
      expect(data.events, hasLength(1));
    });

    test('no permitted source reads nothing and is not an error', () async {
      final _Source source = _Source();
      final AssetTimelineData data =
          await AssetInsightsRepository(source).loadTimeline(
        _scope,
        DateTime(2026),
        sources: const <AssetTimelineFilter>{},
      );
      expect(source.queried, isEmpty);
      expect(data.events, isEmpty);
      expect(data.failedSources, isEmpty);
    });
  });

  group('assetTimelineSourceModule', () {
    test('uses the same module keys as the tap-through gate', () {
      expect(
        assetTimelineSourceModule(AssetTimelineFilter.accidents),
        ModuleKey.accidents,
      );
      expect(
        assetTimelineSourceModule(AssetTimelineFilter.workOrders),
        ModuleKey.workorders,
      );
      expect(
        assetTimelineSourceModule(AssetTimelineFilter.inspections),
        ModuleKey.inspect,
      );
    });
  });

  group('AssetInsightsRepository.loadFinancials truncation', () {
    test('a complete read is not marked incomplete', () async {
      final AssetFinancialData d =
          await AssetInsightsRepository(_Source()).loadFinancials(
        _scope,
        _period,
      );
      expect(d.isIncomplete, isFalse);
      expect(d.truncatedAt, isNull);
    });

    test('a capped grid read carries the cap', () async {
      final AssetFinancialData d = await AssetInsightsRepository(
        _Source(linesTruncated: true),
      ).loadFinancials(_scope, _period);
      expect(d.isIncomplete, isTrue);
      expect(d.truncatedAt, SupabaseAssetInsightsSource.maxRows);
    });

    test('capped job cards also make the figures incomplete', () async {
      final AssetFinancialData d = await AssetInsightsRepository(
        _Source(cardsTruncated: true),
      ).loadFinancials(_scope, _period);
      expect(d.isIncomplete, isTrue);
    });
  });
}
