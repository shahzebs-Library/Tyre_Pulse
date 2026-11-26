/// Read-only Alerts repository over verified `tyre_records` columns.
library;

import 'package:supabase_flutter/supabase_flutter.dart';
import 'package:tyre_pulse/core/network/supabase_gateway.dart';
import 'package:tyre_pulse/core/network/supabase_tables.dart';
import 'package:tyre_pulse/features/alerts/data/tyre_alert_dto.dart';
import 'package:tyre_pulse/features/alerts/domain/inspection_alerts.dart';
import 'package:tyre_pulse/features/alerts/domain/tyre_alert.dart';

const String _alertColumns = 'id,asset_no,site,brand,position,tyre_position,'
    'risk_level,serial_no,tread_depth,issue_date';

abstract interface class AlertsRepository {
  Future<List<TyreAlert>> listActiveRiskAlerts({String? country});

  /// Records that [alert] has been seen and handled, exactly as the Expo
  /// Alerts screen does (`mobile/app/(app)/alerts.tsx` acknowledge): one
  /// resolved `alerts` row of type `tyre_risk` whose `message` carries the
  /// tyre record id as `rec:<id>`. The feed then drops that tyre, on this
  /// phone and on every other device reading the same ledger.
  ///
  /// Online only: whether an alert is already acknowledged is server state,
  /// and the Expo client did not queue it either.
  Future<void> acknowledge({
    required TyreAlert alert,
    required String? userId,
    required String? country,
  });
}

/// The `alerts.message` marker the Expo client writes for an acknowledged
/// tyre risk alert, and reads back to hide it.
String alertAckMessage(String tyreRecordId) => 'rec:$tyreRecordId';

/// Tyre record ids already acknowledged, read out of the `message` markers.
Set<String> acknowledgedTyreIds(Iterable<Object?> messages) => <String>{
      for (final Object? message in messages)
        if (message is String &&
            message.startsWith('rec:') &&
            message.length > 4)
          message.substring(4),
    };

/// Null-inclusive scope used by the verified mobile read.
///
/// An empty country and the workspace sentinel `All` both mean that the
/// client must not narrow the query. Server RLS remains authoritative.
String? alertsCountryFilter(String? country) {
  final String trimmed = country?.trim() ?? '';
  if (trimmed.isEmpty || trimmed == 'All') return null;
  return 'country.eq.$trimmed,country.is.null';
}

final class SupabaseAlertsRepository
    with SupabaseGateway
    implements AlertsRepository {
  SupabaseAlertsRepository(this._client);

  final SupabaseClient _client;

  @override
  Future<List<TyreAlert>> listActiveRiskAlerts({String? country}) {
    return guard<List<TyreAlert>>(() async {
      var builder = _client
          .from(SupabaseTables.tyreRecords)
          .select(_alertColumns)
          .inFilter('risk_level', const <String>['Critical', 'High']);
      final String? countryFilter = alertsCountryFilter(country);
      if (countryFilter != null) {
        builder = builder.or(countryFilter);
      }
      final List<Map<String, dynamic>> rows = await builder
          .order('issue_date', ascending: false)
          .order('id', ascending: false)
          .limit(300);
      // Already-acknowledged risk alerts (Expo parity): each ack stores the
      // tyre record id in `message` as `rec:<id>`.
      // Read every ack page: PostgREST caps one response at 1,000 rows, and a
      // missed ack would bring a dismissed alert back.
      final List<Object?> ackMessages = <Object?>[];
      for (int page = 0; page < 20; page++) {
        final List<Map<String, dynamic>> acks = await _client
            .from(SupabaseTables.alerts)
            .select('message')
            .eq('alert_type', 'tyre_risk')
            .eq('resolved', true)
            .order('id')
            .range(page * 1000, page * 1000 + 999);
        ackMessages.addAll(acks.map((Map<String, dynamic> r) => r['message']));
        if (acks.length < 1000) break;
      }
      final Set<String> acked = acknowledgedTyreIds(ackMessages);
      // What inspectors recorded in the last 30 days, latest per vehicle.
      final String since = DateTime.now()
          .subtract(const Duration(days: 30))
          .toIso8601String()
          .substring(0, 10);
      var inspections = _client
          .from(SupabaseTables.inspections)
          .select(
            'id,organisation_id,country,asset_no,site,inspection_date,'
            'status,approval_status,tyre_conditions',
          )
          .gte('inspection_date', since);
      if (countryFilter != null) {
        inspections = inspections.or(countryFilter);
      }
      final List<Map<String, dynamic>> inspectionRows = await inspections
          .order('inspection_date', ascending: false)
          .order('created_at', ascending: false)
          .limit(1000);
      return mergeTyreAlerts(
        register: rows
            .map(TyreAlertDto.fromRow)
            .map((TyreAlertDto dto) => dto.toDomain()),
        inspection: alertsFromInspections(inspectionRows),
        acknowledged: acked,
      );
    });
  }

  @override
  Future<void> acknowledge({
    required TyreAlert alert,
    required String? userId,
    required String? country,
  }) {
    final String scope = country?.trim() ?? '';
    return guard<void>(() async {
      await _client.from(SupabaseTables.alerts).insert(<String, Object?>{
        'asset_no': alert.assetNo,
        'alert_type': 'tyre_risk',
        'severity': alert.riskLevel,
        'message': alertAckMessage(alert.id),
        'site': alert.site,
        'country': scope.isEmpty || scope == 'All' ? null : scope,
        'resolved': true,
        'is_active': false,
        'created_by': userId,
      });
    });
  }
}
