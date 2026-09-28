/// Reads behind the Vehicle 360 timeline, cost snapshot and the single-asset
/// financial report.
///
/// Every call is PostgREST on a real table (AGENTS.md rule 3). Columns were
/// verified live against `information_schema.columns` on 2026-09-28:
///
/// - `parts_consumption`: event_date (date), asset_code, country, currency,
///   spare_cost / oil_cost / tyre_cost (numeric), work_order_no,
///   item_description. Not yet listed in `SupabaseTables` (that file is owned
///   elsewhere), so its name is declared once here as [partsConsumptionTable].
/// - `work_orders`: id, work_order_no, asset_no, opened_at, completed_at,
///   labour_cost, breakdown_hours, work_type, status, description,
///   technician_name, country.
/// - `odometer_logs` / `engine_hours_logs`: asset_no, country, reading_date,
///   odometer_km / engine_hours.
/// - `inspections`, `wash_records`, `tyre_records`, `accidents`: the columns
///   listed in each select below.
///
/// No RPC fits: `get_tyre_cost_by_asset` is fleet-wide and tyre-only,
/// `get_maintenance_snapshot` / `get_cost_per_m3` are fleet aggregates. The
/// per-asset reads here are small (one asset's rows), paged with an `id`
/// tiebreak so a page boundary can never drop or repeat a row.
///
/// Country scope: money is read with a STRICT country filter when a country
/// is known, because the same asset code in two countries is a different
/// machine (V376) and its lines carry a different currency. With no country
/// the lines are read unscoped and the summary refuses to add currencies.
library;

import 'package:flutter/foundation.dart' show immutable;
import 'package:supabase_flutter/supabase_flutter.dart';
import 'package:tyre_pulse/core/errors/app_error.dart';
import 'package:tyre_pulse/core/network/supabase_error_mapper.dart';
import 'package:tyre_pulse/core/network/supabase_gateway.dart';
import 'package:tyre_pulse/core/network/supabase_tables.dart';
import 'package:tyre_pulse/features/assets/data/vehicle_fleet_repository.dart'
    show PagedRows, fetchAllPages;
import 'package:tyre_pulse/features/assets/domain/asset_financials.dart';
import 'package:tyre_pulse/features/assets/domain/asset_timeline.dart';

/// Verified live 2026-09-28. See the library comment.
const String partsConsumptionTable = 'parts_consumption';

/// Which asset, in which country. A record so Riverpod families compare it
/// by value.
typedef AssetScope = ({String assetNo, String? country});

/// The raw reads, behind an interface so the orchestration is testable with
/// a plain fake.
abstract interface class AssetInsightsSource {
  Future<List<Map<String, dynamic>>> costLines(
    AssetScope scope, {
    required String fromIso,
    required String toIso,
  });

  Future<List<Map<String, dynamic>>> jobCards(
    AssetScope scope, {
    required String fromIso,
    required String toIso,
  });

  Future<List<Map<String, dynamic>>> meterReadings(
    AssetScope scope, {
    required bool engineHours,
    required String fromIso,
    required String toIso,
  });

  Future<List<Map<String, dynamic>>> timelineRows(
    AssetScope scope,
    AssetTimelineFilter source, {
    required String fromIso,
  });
}

final class SupabaseAssetInsightsSource
    with SupabaseGateway
    implements AssetInsightsSource {
  SupabaseAssetInsightsSource(this._client);

  final SupabaseClient _client;

  static const int _maxRows = 5000;
  static const int _timelineLimit = 60;

  @override
  Future<List<Map<String, dynamic>>> costLines(
    AssetScope scope, {
    required String fromIso,
    required String toIso,
  }) async {
    final PagedRows<Map<String, dynamic>> paged = await fetchAllPages(
      (int from, int to) => guard(() async {
        var q = _client
            .from(partsConsumptionTable)
            .select(
              'id, event_date, work_order_no, item_description, currency, '
              'spare_cost, oil_cost, tyre_cost',
            )
            .eq('asset_code', scope.assetNo)
            .gte('event_date', fromIso)
            .lte('event_date', toIso);
        if (scope.country != null) q = q.eq('country', scope.country!);
        return q.order('event_date').order('id').range(from, to);
      }),
      maxRows: _maxRows,
    );
    return paged.rows;
  }

  @override
  Future<List<Map<String, dynamic>>> jobCards(
    AssetScope scope, {
    required String fromIso,
    required String toIso,
  }) async {
    final PagedRows<Map<String, dynamic>> paged = await fetchAllPages(
      (int from, int to) => guard(() async {
        var q = _client
            .from(SupabaseTables.workOrders)
            .select(
              'id, work_order_no, opened_at, completed_at, labour_cost, '
              'breakdown_hours, work_type, status, description',
            )
            .eq('asset_no', scope.assetNo)
            .gte('opened_at', fromIso)
            .lte('opened_at', '${toIso}T23:59:59');
        if (scope.country != null) q = q.eq('country', scope.country!);
        return q.order('opened_at').order('id').range(from, to);
      }),
      maxRows: _maxRows,
    );
    return paged.rows;
  }

  @override
  Future<List<Map<String, dynamic>>> meterReadings(
    AssetScope scope, {
    required bool engineHours,
    required String fromIso,
    required String toIso,
  }) {
    final String table = engineHours
        ? SupabaseTables.engineHoursLogs
        : SupabaseTables.odometerLogs;
    final String column = engineHours ? 'engine_hours' : 'odometer_km';
    return guard(() async {
      var q = _client
          .from(table)
          .select('id, reading_date, $column')
          .eq('asset_no', scope.assetNo)
          .gte('reading_date', fromIso)
          .lte('reading_date', toIso);
      if (scope.country != null) q = q.eq('country', scope.country!);
      return q.order('reading_date').order('id').limit(1000);
    });
  }

  @override
  Future<List<Map<String, dynamic>>> timelineRows(
    AssetScope scope,
    AssetTimelineFilter source, {
    required String fromIso,
  }) {
    final (String table, String columns, String dateColumn) = switch (source) {
      AssetTimelineFilter.workOrders => (
          SupabaseTables.workOrders,
          'id, work_order_no, opened_at, created_at, status, work_type, '
              'description, technician_name',
          'opened_at',
        ),
      AssetTimelineFilter.inspections => (
          SupabaseTables.inspections,
          'id, inspection_date, created_at, status, approval_status, '
              'inspector, document_no',
          'inspection_date',
        ),
      AssetTimelineFilter.washes => (
          SupabaseTables.washRecords,
          'id, wash_date, wash_type, washed_by, status, photos',
          'wash_date',
        ),
      AssetTimelineFilter.tyres => (
          SupabaseTables.tyreRecords,
          'id, issue_date, removal_date, serial_no, tyre_position, position, '
              'brand, removal_reason',
          'issue_date',
        ),
      AssetTimelineFilter.accidents => (
          SupabaseTables.accidents,
          'id, incident_date, reference_no, status, workflow_stage, '
              'accident_type',
          'incident_date',
        ),
      AssetTimelineFilter.all => throw ArgumentError.value(source),
    };
    return guard(() async {
      var q = _client.from(table).select(columns).eq('asset_no', scope.assetNo);
      // Tyres: a tyre fitted before the window may be REMOVED inside it, so
      // the tyre read is bounded on either date.
      q = source == AssetTimelineFilter.tyres
          ? q.or('issue_date.gte.$fromIso,removal_date.gte.$fromIso')
          : q.gte(dateColumn, fromIso);
      if (scope.country != null) {
        q = q.or('country.eq.${scope.country},country.is.null');
      }
      return q
          .order(dateColumn, ascending: false)
          .order('id')
          .limit(_timelineLimit);
    });
  }
}

/// The financial read, assembled.
@immutable
class AssetFinancialData {
  const AssetFinancialData({
    required this.summary,
    required this.labourIncluded,
  });

  final AssetFinancialSummary summary;

  /// False when the job cards could not be read: the totals then carry the
  /// grid only, and the screen says so.
  final bool labourIncluded;
}

/// The timeline read, assembled.
@immutable
class AssetTimelineData {
  const AssetTimelineData({required this.events, required this.failedSources});

  final List<AssetTimelineEvent> events;

  /// Sources whose read failed. When some but not all fail, the loaded events
  /// are still shown with a notice, never a silently short history.
  final List<AssetTimelineFilter> failedSources;
}

final class AssetInsightsRepository {
  AssetInsightsRepository(this._source);

  final AssetInsightsSource _source;

  static const List<AssetTimelineFilter> timelineSources =
      <AssetTimelineFilter>[
    AssetTimelineFilter.workOrders,
    AssetTimelineFilter.inspections,
    AssetTimelineFilter.washes,
    AssetTimelineFilter.tyres,
    AssetTimelineFilter.accidents,
  ];

  /// Reads [period] AND the same window a year earlier in one pass, so the
  /// comparison needs no second round trip.
  ///
  /// Throws an [AppError] when the expense grid itself cannot be read -
  /// without it there is no honest total to show. Job cards and meters are
  /// supplementary: their failure degrades to "not included" / "not
  /// measurable", which the screen states.
  Future<AssetFinancialData> loadFinancials(
    AssetScope scope,
    AssetCostPeriod period,
  ) async {
    final String fromIso = AssetCostPeriod.isoDay(period.previousYear.from);
    final String toIso = AssetCostPeriod.isoDay(period.to);
    final String periodFrom = AssetCostPeriod.isoDay(period.from);

    final List<Map<String, dynamic>> lineRows;
    try {
      lineRows = await _source.costLines(
        scope,
        fromIso: fromIso,
        toIso: toIso,
      );
    } on SupabaseFailure catch (failure) {
      throw failure.error;
    }

    List<Map<String, dynamic>> cardRows = const <Map<String, dynamic>>[];
    bool labourIncluded = scope.country != null;
    if (labourIncluded) {
      try {
        cardRows = await _source.jobCards(
          scope,
          fromIso: fromIso,
          toIso: toIso,
        );
      } on Object {
        labourIncluded = false;
      }
    }

    Future<List<AssetMeterReading>> meters({required bool hours}) async {
      try {
        final List<Map<String, dynamic>> rows = await _source.meterReadings(
          scope,
          engineHours: hours,
          fromIso: periodFrom,
          toIso: toIso,
        );
        return rows
            .map(
              (Map<String, dynamic> r) => AssetMeterReading.fromRow(
                r,
                hours ? 'engine_hours' : 'odometer_km',
              ),
            )
            .whereType<AssetMeterReading>()
            .toList();
      } on Object {
        return const <AssetMeterReading>[];
      }
    }

    final List<AssetMeterReading> odometer = await meters(hours: false);
    final List<AssetMeterReading> hours = await meters(hours: true);

    return AssetFinancialData(
      labourIncluded: labourIncluded,
      summary: computeAssetFinancials(
        period: period,
        lines: lineRows
            .map(AssetCostLine.fromRow)
            .whereType<AssetCostLine>()
            .toList(),
        jobCards: labourIncluded
            ? cardRows
                .map(AssetJobCard.fromRow)
                .whereType<AssetJobCard>()
                .toList()
            : const <AssetJobCard>[],
        odometer: odometer,
        engineHours: hours,
      ),
    );
  }

  /// Reads every timeline source since [from]. Throws the first [AppError]
  /// only when EVERY source failed.
  Future<AssetTimelineData> loadTimeline(
    AssetScope scope,
    DateTime from,
  ) async {
    final String fromIso = AssetCostPeriod.isoDay(from);
    final List<AssetTimelineEvent> events = <AssetTimelineEvent>[];
    final List<AssetTimelineFilter> failed = <AssetTimelineFilter>[];
    AppError? firstError;
    for (final AssetTimelineFilter source in timelineSources) {
      try {
        final List<Map<String, dynamic>> rows =
            await _source.timelineRows(scope, source, fromIso: fromIso);
        for (final Map<String, dynamic> row in rows) {
          switch (source) {
            case AssetTimelineFilter.workOrders:
              events.addAll(_one(AssetTimelineEvent.workOrder(row)));
            case AssetTimelineFilter.inspections:
              events.addAll(_one(AssetTimelineEvent.inspection(row)));
            case AssetTimelineFilter.washes:
              events.addAll(_one(AssetTimelineEvent.wash(row)));
            case AssetTimelineFilter.tyres:
              events.addAll(AssetTimelineEvent.tyre(row));
            case AssetTimelineFilter.accidents:
              events.addAll(_one(AssetTimelineEvent.accident(row)));
            case AssetTimelineFilter.all:
              break;
          }
        }
      } on SupabaseFailure catch (failure) {
        failed.add(source);
        firstError ??= failure.error;
      }
    }
    if (failed.length == timelineSources.length && firstError != null) {
      throw firstError;
    }
    final DateTime fromDay = DateTime(from.year, from.month, from.day);
    return AssetTimelineData(
      events: sortTimeline(
        events.where((AssetTimelineEvent e) => !e.date.isBefore(fromDay)),
      ),
      failedSources: failed,
    );
  }

  static Iterable<AssetTimelineEvent> _one(AssetTimelineEvent? e) =>
      e == null ? const <AssetTimelineEvent>[] : <AssetTimelineEvent>[e];
}
