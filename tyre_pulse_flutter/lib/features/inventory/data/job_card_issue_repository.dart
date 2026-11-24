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

  /// Open reservations of [jobCard] on [stockId] (status active), oldest
  /// first. The issue consumes the oldest ([pickReservation]).
  Future<List<JobCardReservation>> openReservations({
    required String jobCard,
    required String stockId,
  });

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
  Future<List<JobCardReservation>> openReservations({
    required String jobCard,
    required String stockId,
  }) =>
      guard<List<JobCardReservation>>(() async {
        final String? jc = normalizeJobCard(jobCard);
        if (jc == null || stockId.trim().isEmpty) {
          return const <JobCardReservation>[];
        }
        final List<Map<String, dynamic>> rows = await _client
            .from('stock_reservations')
            .select('id, qty, qty_released, qty_consumed, created_at')
            .eq('source_doc_type', 'job_card')
            .ilike('source_doc_id', escapeLikeExact(jc))
            .eq('stock_id', stockId)
            .eq('status', 'active')
            .order('created_at')
            .order('id')
            .limit(50);
        return <JobCardReservation>[
          for (final Map<String, dynamic> r in rows)
            JobCardReservation.fromJson(r),
        ];
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
