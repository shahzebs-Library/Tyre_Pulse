/// Sends a "Report a problem" through `submit_user_issue`.
///
/// The RPC is SECURITY DEFINER and stamps reporter, company, country, site and
/// time itself, and attaches the reporter's own recent error logs
/// (`supabase/migrations/20260930150000_user_issues.sql`; live signature and
/// `authenticated` grant verified 2026-09-30, anon has no EXECUTE).
///
/// ONLINE ONLY, deliberately. A report is a one-off message, the server's
/// "recent error logs" attachment only makes sense at send time, and the RPC
/// has no client id to make a queued replay idempotent - a queued resend could
/// file the same report twice. A failure is reported so the person can send it
/// again once they have signal.
library;

import 'package:supabase_flutter/supabase_flutter.dart';
import 'package:tyre_pulse/core/errors/app_error.dart';
import 'package:tyre_pulse/core/network/supabase_error_mapper.dart';
import 'package:tyre_pulse/core/network/supabase_gateway.dart';
import 'package:tyre_pulse/core/network/supabase_tables.dart';
import 'package:tyre_pulse/features/problem_report/domain/problem_report.dart';

abstract interface class ProblemReportRepository {
  /// Never throws: every failure comes back as [ProblemNotSubmitted].
  Future<ProblemSubmitOutcome> submit(ProblemReportDraft draft);
}

/// How one RPC call is made. Injectable so tests need no live client.
typedef ProblemReportRpc = Future<Object?> Function(
  String name,
  Map<String, Object?> params,
);

/// Maps a classified failure to what the person is told.
///
/// Reads the SQLSTATE the RPC raises (42501 refused, 22023 invalid content,
/// 54000 rate limit) and the mapper's own cause - never the message text.
ProblemSubmitFailure problemFailureFor(SupabaseFailure failure) {
  if (failure.isConnectivity || failure.error.kind == AppErrorKind.network) {
    return ProblemSubmitFailure.needsSignal;
  }
  if (failure.isSchemaMismatch) return ProblemSubmitFailure.unavailable;
  switch (failure.code) {
    case '42501':
      return ProblemSubmitFailure.notAllowed;
    case '22023':
      return ProblemSubmitFailure.invalid;
    case '54000':
      return ProblemSubmitFailure.tooMany;
  }
  if (failure.error.kind == AppErrorKind.authentication) {
    return ProblemSubmitFailure.signedOut;
  }
  if (failure.isPermissionDenied) return ProblemSubmitFailure.notAllowed;
  return ProblemSubmitFailure.failed;
}

/// Reads the RPC's `{ok, id, linked_logs}` reply.
ProblemSubmitOutcome problemOutcomeFromReply(Object? reply) {
  if (reply is Map && reply['ok'] == true) {
    final Object? id = reply['id'];
    final Object? logs = reply['linked_logs'];
    return ProblemSubmitted(
      id: id?.toString(),
      linkedLogs: logs is num ? logs.toInt() : int.tryParse('$logs') ?? 0,
    );
  }
  return const ProblemNotSubmitted(ProblemSubmitFailure.failed);
}

final class SupabaseProblemReportRepository
    with SupabaseGateway
    implements ProblemReportRepository {
  SupabaseProblemReportRepository({
    required ProblemReportRpc rpc,
    required bool Function() hasSession,
  })  : _rpc = rpc,
        _hasSession = hasSession;

  factory SupabaseProblemReportRepository.fromClient(SupabaseClient client) {
    return SupabaseProblemReportRepository(
      rpc: (String name, Map<String, Object?> params) =>
          client.rpc<Object?>(name, params: params),
      hasSession: () => client.auth.currentUser != null,
    );
  }

  final ProblemReportRpc _rpc;
  final bool Function() _hasSession;

  @override
  Future<ProblemSubmitOutcome> submit(ProblemReportDraft draft) async {
    if (validateProblemDescription(draft.description) != null) {
      return const ProblemNotSubmitted(ProblemSubmitFailure.invalid);
    }
    if (!_hasSession()) {
      return const ProblemNotSubmitted(ProblemSubmitFailure.signedOut);
    }
    try {
      final Object? reply = await guard<Object?>(
        () => _rpc(SupabaseRpcs.submitUserIssue, submitUserIssueParams(draft)),
      );
      return problemOutcomeFromReply(reply);
    } on SupabaseFailure catch (failure) {
      return ProblemNotSubmitted(problemFailureFor(failure));
    } on Object {
      return const ProblemNotSubmitted(ProblemSubmitFailure.failed);
    }
  }
}
