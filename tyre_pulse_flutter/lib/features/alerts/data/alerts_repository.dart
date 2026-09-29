/// Read-only Alerts repository over verified `tyre_records` columns.
library;

import 'package:supabase_flutter/supabase_flutter.dart';
import 'package:tyre_pulse/core/network/supabase_gateway.dart';
import 'package:tyre_pulse/core/network/supabase_tables.dart';
import 'package:tyre_pulse/features/alerts/data/tyre_alert_dto.dart';
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
      final List<Map<String, dynamic>> acks = await _client
          .from(SupabaseTables.alerts)
          .select('message')
          .eq('alert_type', 'tyre_risk')
          .eq('resolved', true);
      final Set<String> acked = acknowledgedTyreIds(
        acks.map((Map<String, dynamic> row) => row['message']),
      );
      return rows
          .map(TyreAlertDto.fromRow)
          .map((TyreAlertDto dto) => dto.toDomain())
          .where((TyreAlert alert) => !acked.contains(alert.id))
          .toList(growable: false);
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
