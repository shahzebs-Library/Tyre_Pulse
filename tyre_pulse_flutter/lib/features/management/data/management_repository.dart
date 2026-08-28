library;

import 'package:supabase_flutter/supabase_flutter.dart';
import 'package:tyre_pulse/core/network/supabase_gateway.dart';
import 'package:tyre_pulse/core/network/supabase_tables.dart';
import 'package:tyre_pulse/features/management/domain/management_models.dart';

abstract interface class ManagementRepository {
  Future<FleetAnalytics> analytics({
    String? country,
    String? site,
    DateTime? from,
    DateTime? to,
  });

  Future<ExecutiveSnapshot> report({
    String? country,
    String? site,
    required DateTime from,
    required DateTime to,
  });

  Future<List<TeamMember>> team();
}

final class SupabaseManagementRepository
    with SupabaseGateway
    implements ManagementRepository {
  SupabaseManagementRepository(this._client);
  final SupabaseClient _client;

  @override
  Future<FleetAnalytics> analytics({
    String? country,
    String? site,
    DateTime? from,
    DateTime? to,
  }) {
    return guard<FleetAnalytics>(() async {
      final Object? raw = await _client.rpc<Object?>(
        SupabaseRpcs.getMobileAnalytics,
        params: <String, Object?>{
          'p_country': _scope(country),
          'p_from': from == null ? null : _date(from),
          'p_to': to == null ? null : _date(to),
          'p_site': _scope(site),
        },
      );
      return _analytics(raw);
    });
  }

  @override
  Future<ExecutiveSnapshot> report({
    String? country,
    String? site,
    required DateTime from,
    required DateTime to,
  }) {
    return guard<ExecutiveSnapshot>(() async {
      final Object? raw = await _client.rpc<Object?>(
        SupabaseRpcs.getReportSnapshotAuthed,
        params: <String, Object?>{
          'p_from': _date(from),
          'p_to': _date(to),
          'p_site': _scope(site),
          'p_country': _scope(country),
        },
      );
      return _snapshot(raw);
    });
  }

  @override
  Future<List<TeamMember>> team() {
    return guard<List<TeamMember>>(() async {
      final List<Map<String, dynamic>> rows = await _client
          .from(SupabaseTables.profiles)
          .select(
            'id,full_name,username,role,site,country,phone,email,approved,'
            'last_login_at',
          )
          .order('full_name')
          .limit(1000);
      return rows
          .map(_member)
          .where((TeamMember member) => member.id.isNotEmpty)
          .toList(growable: false);
    });
  }
}

FleetAnalytics _analytics(Object? raw) {
  final Map<String, dynamic> row = _map(raw);
  return FleetAnalytics(
    country: _text(row['country']),
    site: _text(row['site']),
    tyresTotal: _number(row['tyres_total']),
    tyresCritical: _number(row['tyres_critical']),
    tyresHigh: _number(row['tyres_high']),
    tyreSpend: row['tyre_spend'] == null ? null : _number(row['tyre_spend']),
    vehiclesTotal: _number(row['vehicles_total']),
    inspections30d: _number(row['inspections_30d']),
    openActions: _number(row['open_actions']),
    byRisk: _slices(row['by_risk'], 'risk'),
    bySite: _slices(row['by_site'], 'site'),
    byBrand: _slices(row['by_brand'], 'brand'),
    sites: _list(row['sites'])
        .map(_text)
        .whereType<String>()
        .toList(growable: false),
    generatedAt: DateTime.tryParse(_text(row['generated_at']) ?? ''),
  );
}

ExecutiveSnapshot _snapshot(Object? raw) {
  final Map<String, dynamic> row = _map(raw);
  if (row['ok'] != true) {
    return ExecutiveSnapshot(
      available: false,
      company: 'TyrePulse',
      kpis: const <String, num>{},
      cost: const <String, num?>{},
      breakdowns: const <String, List<MetricSlice>>{},
      reason: _text(row['reason']) ?? 'unavailable',
    );
  }
  final Map<String, dynamic> kpis = _map(row['kpis']);
  final Map<String, dynamic> cost = _map(row['cost']);
  final Map<String, dynamic> breakdowns = _map(row['breakdowns']);
  return ExecutiveSnapshot(
    available: true,
    company: _text(row['company']) ?? 'TyrePulse',
    generatedAt: DateTime.tryParse(_text(row['generated_at']) ?? ''),
    kpis: <String, num>{
      for (final String key in <String>[
        'fleet',
        'tyres',
        'tyre_spend',
        'accidents',
        'open_accidents',
        'claims_claimed',
        'claims_recovered',
        'inspections',
        'work_orders_open',
      ])
        key: _number(kpis[key]),
    },
    cost: <String, num?>{
      for (final String key in <String>[
        'tyre_cost',
        'maintenance_cost',
        'total_cost',
        'km',
        'engine_hours',
        'm3',
        'cost_per_km',
        'cost_per_hour',
        'cost_per_m3',
        'tyre_cpk',
      ])
        key: cost[key] == null ? null : _number(cost[key]),
    },
    breakdowns: <String, List<MetricSlice>>{
      for (final String key in <String>[
        'severity',
        'accidents_by_site',
        'tyres_by_site',
        'claim_status',
      ])
        key: _slices(breakdowns[key], 'label', valueKey: 'value'),
    },
  );
}

TeamMember _member(Map<String, dynamic> row) => TeamMember(
      id: _text(row['id']) ?? '',
      fullName: _text(row['full_name']),
      username: _text(row['username']),
      role: _text(row['role']),
      site: _text(row['site']),
      country: _text(row['country']),
      phone: _text(row['phone']),
      email: _text(row['email']),
      approved: row['approved'] is bool ? row['approved'] as bool : null,
      lastLoginAt: DateTime.tryParse(_text(row['last_login_at']) ?? ''),
    );

List<MetricSlice> _slices(
  Object? raw,
  String labelKey, {
  String valueKey = 'count',
}) =>
    _list(raw).map((Object? value) {
      final Map<String, dynamic> row = _map(value);
      return MetricSlice(
        label: _text(row[labelKey]) ?? 'Unknown',
        count: _number(row[valueKey]),
        cost: row['cost'] == null ? null : _number(row['cost']),
      );
    }).toList(growable: false);

Map<String, dynamic> _map(Object? raw) {
  if (raw is Map<String, dynamic>) return raw;
  if (raw is Map) {
    return <String, dynamic>{
      for (final MapEntry<Object?, Object?> entry in raw.entries)
        entry.key.toString(): entry.value,
    };
  }
  return <String, dynamic>{};
}

List<Object?> _list(Object? raw) =>
    raw is List ? raw.cast<Object?>() : const [];

String? _text(Object? value) {
  final String text = value?.toString().trim() ?? '';
  return text.isEmpty ? null : text;
}

num _number(Object? value) =>
    value is num ? value : num.tryParse(_text(value) ?? '') ?? 0;

String? _scope(String? value) {
  final String text = value?.trim() ?? '';
  return text.isEmpty || text == 'All' ? null : text;
}

String _date(DateTime value) => '${value.year.toString().padLeft(4, '0')}-'
    '${value.month.toString().padLeft(2, '0')}-'
    '${value.day.toString().padLeft(2, '0')}';
