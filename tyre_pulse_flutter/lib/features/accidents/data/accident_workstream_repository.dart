import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:tyre_pulse/core/errors/app_error.dart';
import 'package:tyre_pulse/core/network/supabase_client_provider.dart';
import 'package:tyre_pulse/core/network/supabase_gateway.dart';
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
