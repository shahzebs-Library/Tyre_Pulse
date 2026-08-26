import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/core/errors/app_error.dart';
import 'package:tyre_pulse/core/telemetry/telemetry_sync_failure.dart';

void main() {
  group('TelemetrySyncFailureCategory.fromAppErrorKind', () {
    const expected = <AppErrorKind, TelemetrySyncFailureCategory>{
      AppErrorKind.network: TelemetrySyncFailureCategory.connectivity,
      AppErrorKind.authorization: TelemetrySyncFailureCategory.rejected,
      AppErrorKind.validation: TelemetrySyncFailureCategory.rejected,
      AppErrorKind.server: TelemetrySyncFailureCategory.rejected,
      AppErrorKind.conflict: TelemetrySyncFailureCategory.conflict,
      AppErrorKind.storage: TelemetrySyncFailureCategory.localPersistence,
      AppErrorKind.authentication: TelemetrySyncFailureCategory.sessionExpired,
      AppErrorKind.sync: TelemetrySyncFailureCategory.unknown,
      AppErrorKind.unknown: TelemetrySyncFailureCategory.unknown,
    };

    for (final entry in expected.entries) {
      test('${entry.key.name} maps to ${entry.value.name}', () {
        expect(
          TelemetrySyncFailureCategory.fromAppErrorKind(entry.key),
          entry.value,
        );
      });
    }

    test('every AppErrorKind value is covered', () {
      expect(expected.keys.toSet(), AppErrorKind.values.toSet());
    });
  });
}
