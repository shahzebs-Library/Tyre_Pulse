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
}

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
      return rows
          .map(TyreAlertDto.fromRow)
          .map((TyreAlertDto dto) => dto.toDomain())
          .toList(growable: false);
    });
  }
}
