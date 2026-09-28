import 'package:flutter/foundation.dart' show immutable;
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:tyre_pulse/core/errors/app_error.dart';
import 'package:tyre_pulse/core/network/supabase_client_provider.dart';
import 'package:tyre_pulse/core/network/supabase_gateway.dart';
import 'package:tyre_pulse/features/accidents/data/accident_case_schema.dart';
import 'package:tyre_pulse/features/accidents/domain/accident_models.dart';

typedef AccidentWorkstreamRpc = Future<dynamic> Function(
  String name,
  Map<String, dynamic> params,
);

final accidentWorkstreamRepositoryProvider =
    Provider<AccidentWorkstreamRepository>(
  (ref) => AccidentWorkstreamRepository(
    (name, params) =>
        ref.read(supabaseClientProvider).rpc(name, params: params),
    authenticatedUserId: () =>
        ref.read(supabaseClientProvider).auth.currentUser?.id,
  ),
);

/// Online-only: workflow decisions require current server scope and permissions.
/// Verified against live accident_ws_set_status, V568 enum guards and V429 audit.
/// The RPC enforces tenant/country/site scope and workstream capability atomically.
class AccidentWorkstreamRepository with SupabaseGateway {
  AccidentWorkstreamRepository(
    this._rpc, {
    String? Function()? authenticatedUserId,
  }) : _authenticatedUserId = authenticatedUserId;
  final AccidentWorkstreamRpc _rpc;
  final String? Function()? _authenticatedUserId;

  /// Server's non-waivable keys, verified in accident_ws_mark_na (V568).
  static bool canWaive(String key) =>
      accidentWorkstreamOrder.contains(key) &&
      !const <String>['incident_evidence', 'liability', 'finance']
          .contains(key);

  /// Explicitly approves a waiver as the signed-in actor. An approver ID is
  /// never accepted from a form or another caller.
  Future<void> waive({
    required String accidentId,
    required String workstreamKey,
    required String reason,
  }) async {
    if (accidentId.trim().isEmpty ||
        !canWaive(workstreamKey) ||
        reason.trim().isEmpty) {
      throw ArgumentError('A waivable workstream and reason are required');
    }
    await guard(() async {
      final String? actorId = _authenticatedUserId?.call();
      if (actorId == null || actorId.isEmpty) {
        throw const AppError.authentication();
      }
      final dynamic result =
          await _rpc('accident_ws_mark_na', <String, dynamic>{
        'p_accident_id': accidentId,
        'p_workstream_key': workstreamKey,
        'p_reason': reason.trim(),
        'p_approved_by': actorId,
      });
      if (result is! Map || result['ok'] != true) {
        throw StateError('The server did not confirm the waiver');
      }
    });
  }

  // Do not expose N/A here: it needs a reason and the dedicated mark-NA workflow.
  static const statuses = <String>[
    'in_progress',
    'waiting_info',
    'waiting_external',
    'on_hold',
    'completed',
    'reopened',
  ];

  Future<void> update({
    required String accidentId,
    required String workstreamKey,
    required String status,
    String? note,
  }) async {
    if (accidentId.trim().isEmpty ||
        !accidentWorkstreamOrder.contains(workstreamKey) ||
        !statuses.contains(status)) {
      throw ArgumentError('Invalid accident workstream update');
    }
    await guard(() async {
      final dynamic result =
          await _rpc('accident_ws_set_status', <String, dynamic>{
        'p_accident_id': accidentId,
        'p_workstream_key': workstreamKey,
        'p_status': status,
        'p_note': note == null || note.trim().isEmpty ? null : note.trim(),
      });
      if (result is! Map || result['ok'] != true) {
        throw StateError('The server did not confirm the workstream update');
      }
    });
  }
}

// --- Named people on a case --------------------------------------------------

typedef AccidentOwnerRowsRead = Future<List<Map<String, dynamic>>> Function(
  String accidentId,
);

typedef AccidentProfileNamesRead = Future<List<Map<String, dynamic>>> Function(
  List<String> ids,
);

/// Who is actually assigned to each workstream on a case
/// (`accident_case_workstreams.owner_id`, resolved to `profiles.full_name`).
///
/// [loaded] is false when the lookup could not run (offline, no session,
/// RLS refusal). Only a loaded result may say "Unassigned"; an unloaded one
/// says nothing about a person, so the screen falls back to the team.
@immutable
final class AccidentCasePeople {
  const AccidentCasePeople({
    required this.loaded,
    this.ownerNames = const <String, String?>{},
  });

  static const AccidentCasePeople unknown = AccidentCasePeople(loaded: false);

  final bool loaded;

  /// workstream_key -> owner's full name (null = no owner_id recorded).
  final Map<String, String?> ownerNames;

  /// The named owner of [workstreamKey], null when none is known.
  String? ownerName(String workstreamKey) => ownerNames[workstreamKey];

  /// True only when the lookup ran and the workstream has no owner.
  bool isUnassigned(String workstreamKey) =>
      loaded &&
      ownerNames.containsKey(workstreamKey) &&
      (ownerNames[workstreamKey]?.trim().isEmpty ?? true);
}

final Provider<AccidentCasePeopleRepository>
    accidentCasePeopleRepositoryProvider =
    Provider<AccidentCasePeopleRepository>(
  (Ref ref) => AccidentCasePeopleRepository(
    readOwners: (String accidentId) => ref
        .read(supabaseClientProvider)
        .from('accident_case_workstreams')
        .select('workstream_key,owner_id')
        .eq('accident_id', accidentId),
    readNames: (List<String> ids) => ref
        .read(supabaseClientProvider)
        .from('profiles')
        .select('id,full_name')
        .inFilter('id', ids),
  ),
);

/// The named owners of a case. Never throws: a failed lookup is
/// [AccidentCasePeople.unknown], so the header keeps showing the team.
final accidentCasePeopleProvider =
    FutureProvider.autoDispose.family<AccidentCasePeople, String>(
  (ref, accidentId) async {
    try {
      return await ref
          .watch(accidentCasePeopleRepositoryProvider)
          .owners(accidentId);
    } on Object {
      return AccidentCasePeople.unknown;
    }
  },
  retry: (int retryCount, Object error) => null,
);

class AccidentCasePeopleRepository with SupabaseGateway {
  AccidentCasePeopleRepository({
    required AccidentOwnerRowsRead readOwners,
    required AccidentProfileNamesRead readNames,
  })  : _readOwners = readOwners,
        _readNames = readNames;

  final AccidentOwnerRowsRead _readOwners;
  final AccidentProfileNamesRead _readNames;

  Future<AccidentCasePeople> owners(String accidentId) async {
    final String id = accidentId.trim();
    if (id.isEmpty) return AccidentCasePeople.unknown;
    final List<Map<String, dynamic>> rows = await guard(() => _readOwners(id));
    final Map<String, String> ownerIds = <String, String>{
      for (final Map<String, dynamic> row in rows)
        if (accidentRowText(row['workstream_key']) != null &&
            accidentRowText(row['owner_id']) != null)
          accidentRowText(row['workstream_key'])!:
              accidentRowText(row['owner_id'])!,
    };
    final Map<String, String> names = await namesFor(ownerIds.values);
    return AccidentCasePeople(
      loaded: true,
      ownerNames: <String, String?>{
        for (final Map<String, dynamic> row in rows)
          if (accidentRowText(row['workstream_key']) != null)
            accidentRowText(row['workstream_key'])!:
                names[accidentRowText(row['owner_id'])],
      },
    );
  }

  /// `profiles.id -> full_name` for [ids]; unknown ids are simply absent.
  Future<Map<String, String>> namesFor(Iterable<String?> ids) async {
    final List<String> wanted = <String>{
      for (final String? id in ids)
        if (id != null && id.trim().isNotEmpty) id.trim(),
    }.toList(growable: false)
      ..sort();
    if (wanted.isEmpty) return const <String, String>{};
    final List<Map<String, dynamic>> rows =
        await guard(() => _readNames(wanted));
    return <String, String>{
      for (final Map<String, dynamic> row in rows)
        if (accidentRowText(row['id']) != null &&
            accidentRowText(row['full_name']) != null)
          accidentRowText(row['id'])!: accidentRowText(row['full_name'])!,
    };
  }
}
