library;

import 'package:supabase_flutter/supabase_flutter.dart';
import 'package:tyre_pulse/core/network/supabase_gateway.dart';
import 'package:tyre_pulse/core/network/supabase_tables.dart';
import 'package:tyre_pulse/features/calendar/domain/schedule_item.dart';

abstract interface class CalendarRepository {
  Future<List<ScheduleItem>> list({String? country, DateTime? now});
}

final class SupabaseCalendarRepository
    with SupabaseGateway
    implements CalendarRepository {
  SupabaseCalendarRepository(this._client);
  final SupabaseClient _client;

  @override
  Future<List<ScheduleItem>> list({String? country, DateTime? now}) async {
    final DateTime clock = now ?? DateTime.now();
    final DateTime start = clock.subtract(const Duration(days: 30));
    final String startDate = _date(start);
    final List<ScheduleItem> result = <ScheduleItem>[];
    Object? lastError;
    int successfulSources = 0;

    try {
      var query = _client.from(SupabaseTables.inspections).select(
            'id,title,site,asset_no,scheduled_date,locked',
          );
      query = query.not('scheduled_date', 'is', null).gte(
            'scheduled_date',
            startDate,
          );
      final String scope = country?.trim() ?? '';
      if (scope.isNotEmpty && scope != 'All') {
        query = query.or('country.eq.$scope,country.is.null');
      }
      final List<Map<String, dynamic>> rows =
          await query.order('scheduled_date').limit(200);
      successfulSources++;
      for (final Map<String, dynamic> row in rows) {
        if (row['locked'] == true) continue;
        final DateTime? due = _dateTime(row['scheduled_date']);
        final String id = _text(row['id']) ?? '';
        if (due == null || id.isEmpty) continue;
        final String? asset = _text(row['asset_no']);
        result.add(
          ScheduleItem(
            id: 'inspection-$id',
            kind: ScheduleKind.inspection,
            title: _text(row['title']) ??
                (asset == null ? 'Inspection' : 'Inspection $asset'),
            subtitle: _join(asset, _text(row['site'])),
            date: due,
            sourceId: id,
          ),
        );
      }
    } on Object catch (error) {
      lastError = error;
    }

    try {
      var query = _client.from(SupabaseTables.pmPrograms).select(
            'id,name,asset_no,site,next_due,status',
          );
      query = query.eq('status', 'active').not('next_due', 'is', null);
      final String scope = country?.trim() ?? '';
      if (scope.isNotEmpty && scope != 'All') {
        query = query.or('country.eq.$scope,country.is.null');
      }
      final List<Map<String, dynamic>> rows =
          await query.order('next_due').limit(200);
      successfulSources++;
      for (final Map<String, dynamic> row in rows) {
        final DateTime? due = _dateTime(row['next_due']);
        final String id = _text(row['id']) ?? '';
        if (due == null || id.isEmpty) continue;
        result.add(
          ScheduleItem(
            id: 'maintenance-$id',
            kind: ScheduleKind.maintenance,
            title: _text(row['name']) ?? 'Preventive maintenance',
            subtitle: _join(_text(row['asset_no']), _text(row['site'])),
            date: due,
            sourceId: id,
          ),
        );
      }
    } on Object catch (error) {
      lastError = error;
    }

    try {
      var query = _client.from(SupabaseTables.correctiveActions).select(
            'id,title,site,asset_no,due_date,status,priority',
          );
      query = query.not('due_date', 'is', null);
      final String scope = country?.trim() ?? '';
      if (scope.isNotEmpty && scope != 'All') {
        query = query.or('country.eq.$scope,country.is.null');
      }
      final List<Map<String, dynamic>> rows =
          await query.order('due_date').limit(200);
      successfulSources++;
      for (final Map<String, dynamic> row in rows) {
        if (_closed(_text(row['status']))) continue;
        final DateTime? due = _dateTime(row['due_date']);
        final String id = _text(row['id']) ?? '';
        if (due == null || id.isEmpty) continue;
        result.add(
          ScheduleItem(
            id: 'task-$id',
            kind: ScheduleKind.task,
            title: _text(row['title']) ?? 'Corrective task',
            subtitle: _join(_text(row['asset_no']), _text(row['site'])),
            date: due,
            sourceId: id,
            priority: _text(row['priority']),
          ),
        );
      }
    } on Object catch (error) {
      lastError = error;
    }

    if (successfulSources == 0) {
      return guard<List<ScheduleItem>>(
        () async => switch (lastError) {
          final Exception exception => throw exception,
          final Error error => throw error,
          _ => throw StateError('calendar sources unavailable'),
        },
      );
    }
    result.sort((ScheduleItem a, ScheduleItem b) => a.date.compareTo(b.date));
    return result;
  }
}

bool _closed(String? raw) => <String>{
      'closed',
      'completed',
      'cancelled',
      'done',
    }.contains(raw?.toLowerCase());

String? _text(Object? value) {
  final String text = value?.toString().trim() ?? '';
  return text.isEmpty ? null : text;
}

DateTime? _dateTime(Object? value) => DateTime.tryParse(_text(value) ?? '');

String? _join(String? first, String? second) {
  final List<String> values = <String>[
    if (first != null) first,
    if (second != null) second,
  ];
  return values.isEmpty ? null : values.join(' / ');
}

String _date(DateTime value) => '${value.year.toString().padLeft(4, '0')}-'
    '${value.month.toString().padLeft(2, '0')}-'
    '${value.day.toString().padLeft(2, '0')}';
