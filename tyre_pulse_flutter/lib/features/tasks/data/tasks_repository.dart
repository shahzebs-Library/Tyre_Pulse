library;

import 'package:supabase_flutter/supabase_flutter.dart';
import 'package:tyre_pulse/core/network/supabase_gateway.dart';
import 'package:tyre_pulse/core/network/supabase_tables.dart';
import 'package:tyre_pulse/features/tasks/data/task_item.dart';

String? taskCountryFilter(String? country) {
  final String value = country?.trim() ?? '';
  if (value.isEmpty || value == 'All') return null;
  return 'country.eq.$value,country.is.null';
}

abstract interface class TasksRepository {
  Future<List<TaskItem>> listRecent({String? country, int limit = 200});
}

final class SupabaseTasksRepository
    with SupabaseGateway
    implements TasksRepository {
  SupabaseTasksRepository(this._client);

  final SupabaseClient _client;

  @override
  Future<List<TaskItem>> listRecent({
    String? country,
    int limit = 200,
  }) async {
    final List<Map<String, dynamic>> rows =
        await guard<List<Map<String, dynamic>>>(() async {
      var query = _client
          .from(SupabaseTables.correctiveActions)
          .select(taskListColumns);
      final String? filter = taskCountryFilter(country);
      if (filter != null) query = query.or(filter);
      return await query.order('created_at', ascending: false).limit(limit);
    });
    return <TaskItem>[
      for (final Map<String, dynamic> row in rows) TaskItem.fromRow(row),
    ];
  }
}
