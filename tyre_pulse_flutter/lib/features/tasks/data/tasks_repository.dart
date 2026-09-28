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

/// The bounded page size for [TasksRepository.listAssignedTo].
const int kTasksAssignedPage = 200;

abstract interface class TasksRepository {
  Future<List<TaskItem>> listRecent({String? country, int limit = 200});

  /// Corrective actions assigned to [assignee], newest first.
  ///
  /// `corrective_actions.assigned_to` is free TEXT holding a person's name
  /// (MASTER_MIGRATION.sql / SUPABASE_SCHEMA.sql), not a profile id. The
  /// production phone's "Mine" view compares it for exact equality with the
  /// signed-in profile's name (`mobile/app/(app)/tasks.tsx`), and "Report an
  /// issue" writes that same name into it. This read applies that comparison
  /// ON THE SERVER, so the page cap cannot drop the person's own older
  /// actions behind colleagues' newer ones. A blank [assignee] reads nothing:
  /// without a name every colleague's action would pass.
  Future<List<TaskItem>> listAssignedTo({
    required String assignee,
    String? country,
    int limit = kTasksAssignedPage,
  });
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

  @override
  Future<List<TaskItem>> listAssignedTo({
    required String assignee,
    String? country,
    int limit = kTasksAssignedPage,
  }) async {
    final String name = assignee.trim();
    if (name.isEmpty) return const <TaskItem>[];
    final List<Map<String, dynamic>> rows =
        await guard<List<Map<String, dynamic>>>(() async {
      var query = _client
          .from(SupabaseTables.correctiveActions)
          .select(taskListColumns)
          .eq('assigned_to', name);
      final String? filter = taskCountryFilter(country);
      if (filter != null) query = query.or(filter);
      return await query.order('created_at', ascending: false).limit(limit);
    });
    return tasksAssignedTo(
      <TaskItem>[
        for (final Map<String, dynamic> row in rows) TaskItem.fromRow(row),
      ],
      name,
    );
  }
}

/// Keeps only the actions assigned to exactly [assignee]. The server already
/// filters; this is the second guard so another person's action can never be
/// shown as "assigned to me", whatever a future query change does.
List<TaskItem> tasksAssignedTo(List<TaskItem> items, String assignee) {
  final String name = assignee.trim();
  if (name.isEmpty) return const <TaskItem>[];
  return <TaskItem>[
    for (final TaskItem item in items)
      if (item.assignedTo == name) item,
  ];
}
