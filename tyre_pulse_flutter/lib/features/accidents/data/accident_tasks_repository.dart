/// "My accident tasks": the open case steps owned by me, or by my role in my
/// country and site. Read from the `accident_my_tasks()` RPC
/// (supabase/migrations/20261127190400), which the web inbox uses too, so the
/// phone and the web always list the same tasks.
library;

import 'package:flutter/foundation.dart';
import 'package:supabase_flutter/supabase_flutter.dart';
import 'package:tyre_pulse/core/network/supabase_error_mapper.dart';
import 'package:tyre_pulse/core/network/supabase_gateway.dart';

@immutable
final class AccidentTask {
  const AccidentTask({
    required this.workstreamId,
    required this.accidentId,
    required this.workstreamKey,
    required this.assignedToMe,
    required this.overdue,
    this.referenceNo,
    this.assetNo,
    this.site,
    this.country,
    this.severity,
    this.workstreamName,
    this.status,
    this.ownerRole,
    this.daysInStep,
    this.dueAt,
    this.slaState = 'none',
  });

  factory AccidentTask.fromRow(Map<String, dynamic> row) {
    String? s(String k) {
      final Object? v = row[k];
      if (v == null) return null;
      final String t = v.toString().trim();
      return t.isEmpty ? null : t;
    }

    return AccidentTask(
      workstreamId: s('workstream_id') ?? '',
      accidentId: s('accident_id') ?? '',
      workstreamKey: s('workstream_key') ?? '',
      assignedToMe: row['assigned_to_me'] == true,
      overdue: row['overdue'] == true,
      referenceNo: s('reference_no'),
      assetNo: s('asset_no'),
      site: s('site'),
      country: s('country'),
      severity: s('severity'),
      workstreamName: s('workstream_name'),
      status: s('status'),
      ownerRole: s('owner_role'),
      daysInStep: num.tryParse(s('days_in_step') ?? ''),
      dueAt: DateTime.tryParse(s('due_at') ?? '')?.toLocal(),
      slaState: s('sla_state') ?? 'none',
    );
  }

  final String workstreamId;
  final String accidentId;
  final String workstreamKey;
  final bool assignedToMe;
  final bool overdue;
  final String? referenceNo;
  final String? assetNo;
  final String? site;
  final String? country;
  final String? severity;
  final String? workstreamName;
  final String? status;
  final String? ownerRole;
  final num? daysInStep;
  final DateTime? dueAt;

  /// running / warning / breached / paused / met / cancelled / none.
  final String slaState;
}

/// Overdue first, then due soonest, then longest in the step - the same order
/// the web inbox uses (src/lib/accidentOwnership.js sortTasks).
List<AccidentTask> sortAccidentTasks(Iterable<AccidentTask> tasks) {
  const Map<String, int> rank = <String, int>{
    'breached': 0,
    'warning': 1,
    'running': 2,
    'paused': 3,
    'none': 4,
    'met': 5,
    'cancelled': 6,
  };
  final List<AccidentTask> out = List<AccidentTask>.of(tasks);
  out.sort((AccidentTask a, AccidentTask b) {
    if (a.overdue != b.overdue) return a.overdue ? -1 : 1;
    final int ra = rank[a.slaState] ?? 4;
    final int rb = rank[b.slaState] ?? 4;
    if (ra != rb) return ra.compareTo(rb);
    final DateTime? da = a.dueAt;
    final DateTime? db = b.dueAt;
    if (da != null && db != null && da != db) return da.compareTo(db);
    if (da != null && db == null) return -1;
    if (da == null && db != null) return 1;
    return (b.daysInStep ?? 0).compareTo(a.daysInStep ?? 0);
  });
  return out;
}

/// The result of one read: `available` is false when the server does not
/// have the task RPC yet, so the screen can say so instead of an error.
@immutable
final class AccidentTasksResult {
  const AccidentTasksResult({required this.tasks, required this.available});
  final List<AccidentTask> tasks;
  final bool available;

  int get overdueCount => tasks.where((AccidentTask t) => t.overdue).length;
  Set<String> get accidentIds =>
      tasks.map((AccidentTask t) => t.accidentId).toSet();
}

abstract interface class AccidentTasksRepository {
  Future<AccidentTasksResult> myTasks();
}

final class SupabaseAccidentTasksRepository
    with SupabaseGateway
    implements AccidentTasksRepository {
  SupabaseAccidentTasksRepository(this._client);
  final SupabaseClient _client;

  @override
  Future<AccidentTasksResult> myTasks() async {
    try {
      final List<Map<String, dynamic>> rows = await guard(() async {
        final Object? data = await _client.rpc<Object?>('accident_my_tasks');
        if (data is! List) return const <Map<String, dynamic>>[];
        return <Map<String, dynamic>>[
          for (final Object? r in data)
            if (r is Map) Map<String, dynamic>.from(r),
        ];
      });
      return AccidentTasksResult(
        tasks: List<AccidentTask>.unmodifiable(
          sortAccidentTasks(
            rows.map(AccidentTask.fromRow).where(
                  (AccidentTask t) => t.accidentId.isNotEmpty,
                ),
          ),
        ),
        available: true,
      );
    } on SupabaseFailure catch (error) {
      final String code = (error.code ?? '').toUpperCase();
      if (code == 'PGRST202' || code == '42883') {
        return const AccidentTasksResult(
          tasks: <AccidentTask>[],
          available: false,
        );
      }
      rethrow;
    }
  }
}
