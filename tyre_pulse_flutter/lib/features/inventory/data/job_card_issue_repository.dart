/// Issue to / return from a job card: reads the job card through RLS, writes
/// only through the ledger RPCs (`inv_issue`, `inv_post_movement`).
///
/// Online only (see `domain/job_card_issue.dart`). Every capability, scope
/// and balance check is the server's; this file never decides one.
library;

import 'package:supabase_flutter/supabase_flutter.dart';
import 'package:tyre_pulse/core/network/supabase_gateway.dart';
import 'package:tyre_pulse/features/inventory/domain/job_card_issue.dart';

abstract interface class JobCardIssueRepository {
  /// The job card with this number, or null when the person cannot see it
  /// or it does not exist. Matches case-insensitively and exactly.
  Future<JobCardRef?> findJobCard(String number);

  Future<JobCardMoveOutcome> post(
    JobCardMoveDraft draft, {
    required String idempotencyKey,
  });
}

final class SupabaseJobCardIssueRepository
    with SupabaseGateway
    implements JobCardIssueRepository {
  SupabaseJobCardIssueRepository(this._client);

  final SupabaseClient _client;

  @override
  Future<JobCardRef?> findJobCard(String number) =>
      guard<JobCardRef?>(() async {
        final String? jc = normalizeJobCard(number);
        if (jc == null) return null;
        final List<Map<String, dynamic>> rows = await _client
            .from('work_orders')
            .select('id, work_order_no, asset_no, site, country, status')
            .ilike('work_order_no', escapeLikeExact(jc))
            .order('id')
            .limit(1);
        // work_order_no is globally unique, so one row is the job card.
        return rows.isEmpty ? null : JobCardRef.fromJson(rows.first);
      });

  @override
  Future<JobCardMoveOutcome> post(
    JobCardMoveDraft draft, {
    required String idempotencyKey,
  }) =>
      guard<JobCardMoveOutcome>(() async {
        final Object? r = await _client.rpc<Object?>(
          draft.rpc,
          params: <String, Object?>{
            'p_payload': draft.toPayload(idempotencyKey),
          },
        );
        return parseJobCardMoveResponse(r);
      });
}
