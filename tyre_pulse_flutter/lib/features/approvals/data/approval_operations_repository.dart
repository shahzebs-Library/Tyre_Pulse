import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:supabase_flutter/supabase_flutter.dart';
import 'package:tyre_pulse/core/network/supabase_client_provider.dart';
import 'package:tyre_pulse/core/network/supabase_gateway.dart';

final approvalOperationsRepositoryProvider = Provider(
  (ref) => ApprovalOperationsRepository(ref.watch(supabaseClientProvider)),
);

/// These state-dependent administration actions require a live connection.
class ApprovalOperationsRepository with SupabaseGateway {
  ApprovalOperationsRepository(this.client);
  final SupabaseClient client;

  Future<List<Map<String, dynamic>>> people(String type, String id) =>
      guard(() async {
        final rows = await client.rpc<List<dynamic>>(
          'approval_review_people',
          params: {'p_entity_type': type, 'p_entity_id': id},
        );
        return rows
            .map((row) => Map<String, dynamic>.from(row as Map))
            .toList();
      });

  Future<void> act({
    required String type,
    required String id,
    required String token,
    required String action,
    required String reason,
    String? person,
    DateTime? end,
  }) =>
      guard(() async {
        final params = <String, Object?>{
          'p_entity_type': type,
          'p_entity_id': id,
          'p_expected_stage': token,
          'p_reason': reason,
        };
        switch (action) {
          case 'recover':
            await client.rpc<Object?>('approval_recover_route', params: params);
          case 'reassign':
            await client.rpc<Object?>(
              'approval_reassign_stage',
              params: {...params, 'p_approver_id': person},
            );
          case 'delegate':
            await client.rpc<Object?>(
              'approval_delegate_stage',
              params: {
                ...params,
                'p_delegate_id': person,
                'p_starts_at': DateTime.now().toUtc().toIso8601String(),
                'p_ends_at': end?.toUtc().toIso8601String(),
              },
            );
          default:
            throw ArgumentError.value(action, 'action');
        }
      });

  Future<void> revoke(String id, String reason) => guard(() async {
        await client.rpc<Object?>(
          'approval_revoke_delegation',
          params: {'p_delegation_id': id, 'p_reason': reason},
        );
      });
}
