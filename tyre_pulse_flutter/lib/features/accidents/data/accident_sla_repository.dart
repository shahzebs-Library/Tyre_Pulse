/// SLA clocks per workstream (`accident_sla_instances`, live since V417).
///
/// Read-only from the app: the SLA engine (docs/accident-module/12) starts,
/// pauses and closes clocks server-side. A missing table degrades to
/// [AccidentSlaLoad.provisioned] false so the header can say "not provisioned"
/// rather than "no SLA".
library;

import 'package:flutter/foundation.dart' show immutable;
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:supabase_flutter/supabase_flutter.dart';
import 'package:tyre_pulse/core/network/supabase_client_provider.dart';
import 'package:tyre_pulse/core/network/supabase_error_mapper.dart';
import 'package:tyre_pulse/core/network/supabase_gateway.dart';
import 'package:tyre_pulse/features/accidents/data/accident_case_schema.dart';

typedef AccidentSlaRead = Future<List<Map<String, dynamic>>> Function(
  String accidentId,
);

final Provider<AccidentSlaRepository> accidentSlaRepositoryProvider =
    Provider<AccidentSlaRepository>((Ref ref) {
  final SupabaseClient client = ref.watch(supabaseClientProvider);
  return AccidentSlaRepository(
    (String accidentId) => client
        .from(AccidentCaseTables.slaInstances)
        .select(AccidentSlaRepository.columns)
        .eq('accident_id', accidentId),
  );
});

/// Every SLA clock on one case. Auto-disposed so a header that leaves the
/// tree does not keep a stale clock in memory.
final accidentSlaLoadProvider =
    FutureProvider.autoDispose.family<AccidentSlaLoad, String>(
  (ref, accidentId) =>
      ref.watch(accidentSlaRepositoryProvider).list(accidentId),
  retry: (int retryCount, Object error) => null,
);

const List<String> accidentSlaStates = <String>[
  'running',
  'paused',
  'met',
  'breached',
  'cancelled',
];

@immutable
final class AccidentSlaInstance {
  const AccidentSlaInstance({
    required this.state,
    this.workstreamKey,
    this.name,
    this.team,
    this.startAt,
    this.dueAt,
  });

  factory AccidentSlaInstance.fromRow(Map<String, dynamic> row) {
    final String state = accidentRowText(row['state'])?.toLowerCase() ?? '';
    return AccidentSlaInstance(
      workstreamKey: accidentRowText(row['workstream_key']),
      name: accidentRowText(row['name']),
      team: accidentRowText(row['team']),
      startAt: accidentRowDate(row['start_at']),
      dueAt: accidentRowDate(row['due_at']),
      state: accidentSlaStates.contains(state) ? state : 'running',
    );
  }

  final String? workstreamKey;
  final String? name;
  final String? team;
  final DateTime? startAt;
  final DateTime? dueAt;

  /// One of [accidentSlaStates].
  final String state;

  bool get isOpen => state == 'running' || state == 'paused';
}

@immutable
final class AccidentSlaLoad {
  const AccidentSlaLoad({
    required this.provisioned,
    this.instances = const <AccidentSlaInstance>[],
  });

  final bool provisioned;
  final List<AccidentSlaInstance> instances;

  /// The clock that speaks for [workstreamKey]: a running one first, then a
  /// paused one, then the most recently started closed one.
  AccidentSlaInstance? forWorkstream(String workstreamKey) {
    AccidentSlaInstance? best;
    int bestRank = -1;
    for (final AccidentSlaInstance row in instances) {
      if (row.workstreamKey != workstreamKey) continue;
      final int rank = switch (row.state) {
        'running' => 3,
        'paused' => 2,
        _ => 1,
      };
      if (rank > bestRank ||
          (rank == bestRank &&
              row.startAt != null &&
              (best?.startAt == null ||
                  row.startAt!.isAfter(best!.startAt!)))) {
        best = row;
        bestRank = rank;
      }
    }
    return best;
  }
}

class AccidentSlaRepository with SupabaseGateway {
  AccidentSlaRepository(this._read);

  final AccidentSlaRead _read;

  static const String columns =
      'id,accident_id,workstream_key,name,team,start_at,due_at,state';

  Future<AccidentSlaLoad> list(String accidentId) async {
    final String id = accidentId.trim();
    if (id.isEmpty) throw ArgumentError('An accident id is required');
    try {
      final List<Map<String, dynamic>> rows = await guard(() => _read(id));
      return AccidentSlaLoad(
        provisioned: true,
        instances: <AccidentSlaInstance>[
          for (final Map<String, dynamic> row in rows)
            AccidentSlaInstance.fromRow(row),
        ],
      );
    } on SupabaseFailure catch (failure) {
      if (isMissingSchema(failure)) {
        return const AccidentSlaLoad(provisioned: false);
      }
      rethrow;
    }
  }
}
