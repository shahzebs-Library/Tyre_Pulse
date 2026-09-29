/// Records an in-app account and data deletion REQUEST.
///
/// Mirror of the Expo helper `mobile/lib/accountDeletion.ts`. Google Play
/// requires an in-app path for a person to ask for their account and data to
/// be deleted. This inserts one row into `account_deletion_requests` (V317):
/// the signed-in user may insert their own row, `status` defaults to
/// `pending`, and an administrator actions it (about 30 days).
///
/// It records INTENT only. Nothing here deletes any account or data on the
/// client. Online only: a request is a one-off decision, the Expo client did
/// not queue it either, and a failure is reported so the person can retry or
/// email instead.
library;

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:supabase_flutter/supabase_flutter.dart';
import 'package:tyre_pulse/core/network/supabase_client_provider.dart';
import 'package:tyre_pulse/core/network/supabase_error_mapper.dart';
import 'package:tyre_pulse/core/network/supabase_gateway.dart';
import 'package:tyre_pulse/core/network/supabase_tables.dart';

/// What happened to a deletion request.
enum AccountDeletionOutcome {
  /// The row was recorded.
  submitted,

  /// No signed-in user to attribute the request to.
  signedOut,

  /// The table is not provisioned on this database (42P01 / PGRST205).
  unavailable,

  /// Any other failure; safe to retry.
  failed,
}

abstract interface class AccountDeletionRepository {
  Future<AccountDeletionOutcome> request({String? reason});
}

/// The trimmed reason, or null when blank (Expo `cleanReason`).
String? accountDeletionReason(String? reason) {
  final String text = reason?.trim() ?? '';
  return text.isEmpty ? null : text;
}

final class SupabaseAccountDeletionRepository
    with SupabaseGateway
    implements AccountDeletionRepository {
  SupabaseAccountDeletionRepository(this._client);

  final SupabaseClient _client;

  @override
  Future<AccountDeletionOutcome> request({String? reason}) async {
    final User? user = _client.auth.currentUser;
    if (user == null) return AccountDeletionOutcome.signedOut;
    try {
      await guard<void>(() async {
        await _client.from(SupabaseTables.accountDeletionRequests).insert(
          <String, Object?>{
            'user_id': user.id,
            'email': user.email,
            'reason': accountDeletionReason(reason),
          },
        );
      });
      return AccountDeletionOutcome.submitted;
    } on SupabaseFailure catch (failure) {
      final String code = failure.code ?? '';
      if (code == '42P01' || code == 'PGRST205') {
        return AccountDeletionOutcome.unavailable;
      }
      return AccountDeletionOutcome.failed;
    } on Object {
      return AccountDeletionOutcome.failed;
    }
  }
}

final Provider<AccountDeletionRepository> accountDeletionRepositoryProvider =
    Provider<AccountDeletionRepository>(
  (ref) => SupabaseAccountDeletionRepository(ref.watch(supabaseClientProvider)),
);
