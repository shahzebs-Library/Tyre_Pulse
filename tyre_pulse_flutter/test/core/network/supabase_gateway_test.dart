import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:supabase_flutter/supabase_flutter.dart';
import 'package:tyre_pulse/core/network/supabase_error_mapper.dart';
import 'package:tyre_pulse/core/network/supabase_gateway.dart';

/// Mixes in the gateway under test. No state of its own - `guard` is a pure
/// wrapper around whatever `Future` its argument produces, so one instance is
/// shared by every test in this file.
class TestGateway with SupabaseGateway {
  Future<T> run<T>(Future<T> Function() call) => guard<T>(call);
}

final TestGateway gateway = TestGateway();

/// Runs [body] and returns the [SupabaseFailure] it threw, or null if it
/// completed without throwing one at all.
///
/// Deliberately catches ONLY `SupabaseFailure`. If `guard()` ever let a raw,
/// unclassified exception escape instead, it would not land here - it would
/// propagate out of this helper and fail the calling test with that raw
/// exception, which is itself a correct (if less precise) failure signal.
Future<SupabaseFailure?> capturedFailure(Future<void> Function() body) async {
  try {
    await body();
  } on SupabaseFailure catch (failure) {
    return failure;
  }
  return null;
}

/// Proves `guard()` does not lose or alter what `classifySupabaseError`
/// decided for [rawError].
///
/// This is not a claim that the mapper decided CORRECTLY - that is
/// `supabase_error_mapper.dart`'s own claim to defend, and its test file (if
/// one exists) is where that belongs. This only asserts that running the same
/// error through `guard()` produces the identical decision as calling
/// `classifySupabaseError` on it directly, field for field.
Future<void> expectGuardPropagates(Object rawError) async {
  final SupabaseFailure expected = classifySupabaseError(rawError);

  final SupabaseFailure? actual = await capturedFailure(
    () => gateway.run<void>(() async => throw rawError),
  );

  expect(actual, isNotNull);
  final SupabaseFailure result = actual!;
  expect(result.cause, expected.cause);
  expect(result.code, expected.code);
  expect(result.rawMessage, expected.rawMessage);
  expect(result.error.kind, expected.error.kind);
  expect(result.error.message, expected.error.message);
  expect(result.error.technical, expected.error.technical);
  expect(result.error.isRetryable, expected.error.isRetryable);
}

void main() {
  test('a successful call returns its value, unchanged', () async {
    final int result = await gateway.run<int>(() async => 42);
    expect(result, 42);
  });

  group('guard() propagates exactly what classifySupabaseError decided', () {
    // The `PostgrestException`/`AuthException` constructor shapes below are
    // UNVERIFIED: no Flutter SDK or pub cache exists in this environment to
    // check them against the installed `supabase_flutter: ^2.17.2` source.
    // They are transcribed from best-confidence knowledge of the SDK,
    // deliberately without `const` so a wrong guess about const-ability does
    // not add a second failure mode on top of a wrong guess about the
    // parameter shape. `SocketException` is `dart:io` core and not in doubt.

    test('a unique-violation PostgrestException (23505)', () async {
      await expectGuardPropagates(
        PostgrestException(
          message:
              'duplicate key value violates unique constraint '
              '"tyre_records_client_uuid_key"',
          code: '23505',
        ),
      );
    });

    test('a schema-mismatch PostgrestException (42P01)', () async {
      await expectGuardPropagates(
        PostgrestException(
          message: 'relation "public.does_not_exist" does not exist',
          code: '42P01',
        ),
      );
    });

    test('a permission-denied PostgrestException (42501)', () async {
      await expectGuardPropagates(
        PostgrestException(
          message: 'permission denied for table tyre_records',
          code: '42501',
        ),
      );
    });

    test('an expired-session AuthException', () async {
      await expectGuardPropagates(
        AuthException('JWT expired', statusCode: '401'),
      );
    });

    test('a plain SocketException-shaped connectivity failure', () async {
      await expectGuardPropagates(
        SocketException("Failed host lookup: 'example.com'"),
      );
    });
  });

  group('what guard() does not do', () {
    test('never throws the raw error itself - the original is kept only as '
        'AppError.cause, for telemetry', () async {
      final SupabaseFailure? actual = await capturedFailure(
        () =>
            gateway.run<void>(() async => throw StateError('anything at all')),
      );

      expect(actual, isNotNull);
      expect(actual!.error.cause, isA<StateError>());
    });

    test('never re-wraps an already-classified SupabaseFailure, so a '
        'nested guard() call cannot double-classify one error', () async {
      final SupabaseFailure original = classifySupabaseError(
        PostgrestException(message: 'duplicate key', code: '23505'),
      );

      final SupabaseFailure? actual = await capturedFailure(
        () => gateway.run<void>(() async => throw original),
      );

      expect(identical(actual, original), isTrue);
    });
  });
}
