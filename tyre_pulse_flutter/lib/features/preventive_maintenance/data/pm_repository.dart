library;

import 'package:supabase_flutter/supabase_flutter.dart';
import 'package:tyre_pulse/core/network/supabase_gateway.dart';
import 'package:tyre_pulse/core/network/supabase_tables.dart';
import 'package:tyre_pulse/features/preventive_maintenance/domain/pm_plan.dart';

abstract interface class PmRepository {
  Future<List<PmPlan>> listActive({String? country});

  Future<void> recordService(RecordPmServiceInput input);
}

final class SupabasePmRepository with SupabaseGateway implements PmRepository {
  SupabasePmRepository(this._client);

  final SupabaseClient _client;

  @override
  Future<List<PmPlan>> listActive({String? country}) {
    return guard<List<PmPlan>>(() async {
      var query = _client
          .from(SupabaseTables.pmPrograms)
          .select(
            'id,name,asset_no,asset_category,site,status,interval_type,'
            'interval_value,meter_source,meter_interval,next_due,'
            'next_due_meter,priority,estimated_cost',
          )
          .eq('status', 'active');
      final String scope = country?.trim() ?? '';
      if (scope.isNotEmpty && scope != 'All') {
        query = query.or('country.eq.$scope,country.is.null');
      }
      final List<Map<String, dynamic>> rows = await query
          .order('next_due', ascending: true, nullsFirst: false)
          .limit(300);
      return rows.map(_planFromRow).toList(growable: false);
    });
  }

  @override
  Future<void> recordService(RecordPmServiceInput input) {
    return guard<void>(() async {
      await _client.rpc<void>(
        SupabaseRpcs.recordPmService,
        params: <String, dynamic>{
          'p_program_id': input.programId,
          'p_service_date': _date(input.serviceDate),
          'p_meter_reading': input.meterReading,
          'p_performed_by': _text(input.performedBy),
          'p_workshop': _text(input.workshop),
          'p_site': _text(input.site),
          'p_tasks_done': const <Object?>[],
          'p_parts_used': const <Object?>[],
          'p_parts_cost': input.partsCost,
          'p_labour_cost': input.labourCost,
          'p_findings': _text(input.findings),
          'p_outcome': input.outcome.name,
          'p_work_order_no': null,
          'p_notes': null,
        },
      );
    });
  }
}

PmPlan _planFromRow(Map<String, dynamic> row) => PmPlan(
      id: _text(row['id']) ?? '',
      name: _text(row['name']),
      assetNo: _text(row['asset_no']),
      assetCategory: _text(row['asset_category']),
      site: _text(row['site']),
      status: _text(row['status']),
      intervalType: _text(row['interval_type']),
      intervalValue: _number(row['interval_value']),
      meterSource: _text(row['meter_source']),
      meterInterval: _number(row['meter_interval']),
      nextDue: DateTime.tryParse(_text(row['next_due']) ?? ''),
      nextDueMeter: _number(row['next_due_meter']),
      priority: _text(row['priority']),
      estimatedCost: _number(row['estimated_cost']),
    );

String? _text(Object? value) {
  final String text = value?.toString().trim() ?? '';
  return text.isEmpty ? null : text;
}

num? _number(Object? value) =>
    value is num ? value : num.tryParse(_text(value) ?? '');

String _date(DateTime value) => '${value.year.toString().padLeft(4, '0')}-'
    '${value.month.toString().padLeft(2, '0')}-'
    '${value.day.toString().padLeft(2, '0')}';
