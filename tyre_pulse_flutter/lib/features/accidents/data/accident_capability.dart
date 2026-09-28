/// Accident workstream write rights, answered by the server.
///
/// The case register is reachable by roles (for example Fleet Supervisor)
/// that may only fill some workstreams. Each write is refused server-side
/// unless the caller is elevated or `app_user_can('accidents', <cap>)` is
/// true, so the controls ask the same two functions before they are offered.
/// A control nobody can use is hidden instead of failing on press.
///
/// Fails closed: an unanswered check hides the control. The server remains
/// the real boundary either way.
library;

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:supabase_flutter/supabase_flutter.dart';
import 'package:tyre_pulse/core/network/supabase_client_provider.dart';

/// Capabilities the accident workstreams check. Each maps to the server rule
/// guarding the write:
/// - `edit_insurance`: `accident_claim_register` / decision / settlement.
/// - `post_cost`: `accident_recovery_record` (payment and recovery).
/// - `approve_liability`: `accident_liability_assessments` writes.
abstract final class AccidentCapability {
  static const String editInsurance = 'edit_insurance';
  static const String postCost = 'post_cost';
  static const String approveLiability = 'approve_liability';
}

/// Answers one accident capability for the signed-in user.
abstract interface class AccidentCapabilityChecker {
  Future<bool> can(String capability);
}

final class SupabaseAccidentCapabilityChecker
    implements AccidentCapabilityChecker {
  const SupabaseAccidentCapabilityChecker(this._client);

  final SupabaseClient _client;

  @override
  Future<bool> can(String capability) async {
    final Object? elevated = await _client.rpc<Object?>('app_is_elevated');
    if (elevated == true) return true;
    final Object? allowed = await _client.rpc<Object?>(
      'app_user_can',
      params: <String, Object?>{'p_key': 'accidents', 'p_cap': capability},
    );
    return allowed == true;
  }
}

final accidentCapabilityCheckerProvider = Provider<AccidentCapabilityChecker>(
  (ref) => SupabaseAccidentCapabilityChecker(ref.watch(supabaseClientProvider)),
);

/// Whether the signed-in user may perform [capability] on accidents.
/// Loading and errors read as false (the control stays hidden).
final accidentCapabilityProvider =
    FutureProvider.autoDispose.family<bool, String>(
  (ref, capability) =>
      ref.watch(accidentCapabilityCheckerProvider).can(capability),
  retry: (int retryCount, Object error) => null,
);
