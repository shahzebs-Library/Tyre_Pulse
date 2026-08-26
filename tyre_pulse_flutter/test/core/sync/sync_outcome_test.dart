import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/core/database/database_constants.dart';
import 'package:tyre_pulse/core/network/supabase_error_mapper.dart';
import 'package:tyre_pulse/core/sync/sync_outcome.dart';

void main() {
  group('syncErrorClassFor', () {
    // The whole point of this table is that it is exhaustive. Every
    // SupabaseFailureCause value must appear here exactly once; the
    // "covers every value" test below fails loudly if a new cause is added
    // to the enum without a decision being made about it here too.
    const Map<SupabaseFailureCause, String> expected = <SupabaseFailureCause, String>{
      SupabaseFailureCause.offline: SyncErrorClass.network,
      SupabaseFailureCause.timeout: SyncErrorClass.network,
      SupabaseFailureCause.jwtExpired: SyncErrorClass.auth,
      SupabaseFailureCause.unauthenticated: SyncErrorClass.auth,
      SupabaseFailureCause.forbidden: SyncErrorClass.permission,
      SupabaseFailureCause.rowLevelSecurity: SyncErrorClass.permission,
      SupabaseFailureCause.notNullViolation: SyncErrorClass.validation,
      SupabaseFailureCause.checkViolation: SyncErrorClass.validation,
      SupabaseFailureCause.invalidInput: SyncErrorClass.validation,
      SupabaseFailureCause.onConflictInferenceFailed: SyncErrorClass.validation,
      SupabaseFailureCause.foreignKeyViolation: SyncErrorClass.validation,
      SupabaseFailureCause.uniqueViolation: SyncErrorClass.conflict,
      SupabaseFailureCause.noRowsFound: SyncErrorClass.unknown,
      SupabaseFailureCause.rangeNotSatisfiable: SyncErrorClass.unknown,
      SupabaseFailureCause.schemaMismatch: SyncErrorClass.unknown,
      SupabaseFailureCause.serverRaise: SyncErrorClass.unknown,
      SupabaseFailureCause.serverError: SyncErrorClass.unknown,
      SupabaseFailureCause.rateLimited: SyncErrorClass.unknown,
      SupabaseFailureCause.storageNotFound: SyncErrorClass.unknown,
      SupabaseFailureCause.unknown: SyncErrorClass.unknown,
    };

    test('the fixture covers every SupabaseFailureCause value', () {
      expect(
        expected.keys.toSet(),
        SupabaseFailureCause.values.toSet(),
        reason: 'a cause missing from this table would silently fall '
            'through the switch in syncErrorClassFor with no compile-time '
            'warning if that switch were ever made non-exhaustive by '
            'accident - keeping the fixture exhaustive here is the check.',
      );
    });

    for (final MapEntry<SupabaseFailureCause, String> entry
        in expected.entries) {
      test(
        '${entry.key.name} maps to ${entry.value}',
        () => expect(syncErrorClassFor(entry.key), entry.value),
      );
    }

    test('every mapped class is one SyncErrorClass actually declares', () {
      for (final String value in expected.values) {
        expect(SyncErrorClass.all, contains(value));
      }
    });

    test(
      'uniqueViolation always maps to conflict regardless of the caller - '
      'this function classifies the mechanical cause only',
      () {
        // The idempotent-replay judgement (does a retried duplicate key mean
        // success?) needs the claimed command's own retry count, which this
        // function is never given. It always reports conflict for a
        // uniqueViolation; SyncEngine is what decides whether to call it at
        // all for a given occurrence, or to treat that occurrence as a
        // success instead. See sync_engine_test.dart for that decision.
        expect(
          syncErrorClassFor(SupabaseFailureCause.uniqueViolation),
          SyncErrorClass.conflict,
        );
      },
    );
  });
}
