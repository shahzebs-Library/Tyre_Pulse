import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:supabase_flutter/supabase_flutter.dart';
import 'package:tyre_pulse/core/network/supabase_client_provider.dart';
import 'package:tyre_pulse/core/network/supabase_gateway.dart';

typedef ApprovalPolicy = Map<String, dynamic>;

final approvalPolicyRepositoryProvider = Provider(
  (ref) => ApprovalPolicyRepository(ref.watch(supabaseClientProvider)),
);

/// Online-only governance. Server RPCs own tenant, publisher and overlap checks.
class ApprovalPolicyRepository with SupabaseGateway {
  ApprovalPolicyRepository(this.client);
  final SupabaseClient client;

  Future<List<ApprovalPolicy>> list() => guard(
        () async => client
            .from('approval_policies')
            .select()
            .order('updated_at', ascending: false)
            .limit(200),
      );

  Future<List<ApprovalPolicy>> people() => guard(() async {
        final rows = await client.rpc<List<dynamic>>('approval_policy_people');
        return rows
            .map((row) => Map<String, dynamic>.from(row as Map))
            .toList();
      });

  Future<List<ApprovalPolicy>> sites() => guard(
        () async => client
            .from('sites')
            .select('id,name,country')
            .eq('active', true)
            .order('name')
            .limit(1000),
      );

  Future<ApprovalPolicy> save(ApprovalPolicy policy) => guard(
        () async => client.rpc<Map<String, dynamic>>(
          'approval_policy_save',
          params: {
            'p_policy': policy,
            'p_expected_updated_at': policy['updated_at'],
          },
        ),
      );

  Future<ApprovalPolicy> transition(
    ApprovalPolicy policy,
    String action,
    String reason, {
    DateTime? effectiveAt,
  }) {
    if (action != 'publish' && action != 'retire') {
      throw ArgumentError.value(action, 'action');
    }
    return guard(
      () async => client.rpc<Map<String, dynamic>>(
        'approval_policy_$action',
        params: {
          'p_policy_id': policy['id'],
          'p_expected_updated_at': policy['updated_at'],
          'p_reason': reason,
            if (action == 'publish') 'p_effective_at': effectiveAt?.toUtc().toIso8601String(),
        },
      ),
    );
  }

  Future<ApprovalPolicy> simulate(ApprovalPolicy policy) => guard(
        () async => client.rpc<Map<String, dynamic>>(
          'approval_policy_simulate',
          params: {
            'p_entity_type': policy['entity_type'],
            'p_country': policy['match_country'],
            'p_site': policy['match_site'],
            'p_role': policy['match_role'],
            'p_user_id': policy['match_user_id'],
            'p_draft_id': policy['state'] == 'draft' ? policy['id'] : null,
          },
        ),
      );

  Future<List<ApprovalPolicy>> history(String policyId) => guard(
        () async => client
            .from('approval_policy_events')
            .select()
            .eq('policy_id', policyId)
            .order('created_at', ascending: false)
            .limit(100),
      );
}
