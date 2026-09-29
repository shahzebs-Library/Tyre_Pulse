/// Riverpod wiring for push notifications.
///
/// [pushMessagingClientProvider] defaults to [UnsupportedPushMessagingClient]
/// so tests and any unwired build never touch Firebase. `main.dart` overrides
/// it with `FirebasePushMessagingClient`.
library;

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:tyre_pulse/core/auth/auth_dependency_providers.dart';
import 'package:tyre_pulse/core/network/supabase_client_provider.dart';
import 'package:tyre_pulse/core/push/push_coordinator.dart';
import 'package:tyre_pulse/core/push/push_device_repository.dart';
import 'package:tyre_pulse/core/push/push_messaging_client.dart';
import 'package:tyre_pulse/core/telemetry/telemetry_providers.dart';

final Provider<PushMessagingClient> pushMessagingClientProvider =
    Provider<PushMessagingClient>(
  (Ref ref) => const UnsupportedPushMessagingClient(),
);

final Provider<PushDeviceRepository> pushDeviceRepositoryProvider =
    Provider<PushDeviceRepository>(
  (Ref ref) =>
      SupabasePushDeviceRepository(() => ref.read(supabaseClientProvider)),
);

/// One coordinator for the life of the app.
final Provider<PushCoordinator> pushCoordinatorProvider =
    Provider<PushCoordinator>((Ref ref) {
  final PushCoordinator coordinator = PushCoordinator(
    client: ref.watch(pushMessagingClientProvider),
    devices: ref.watch(pushDeviceRepositoryProvider),
    telemetry: ref.watch(telemetryReporterProvider),
    appVersion: _appVersionOrNull(ref),
  );
  ref.onDispose(coordinator.dispose);
  return coordinator;
});

/// `currentAppVersionProvider` throws until the composition root overrides
/// it. The version is only metadata on the device row, so a missing one is
/// stored as null rather than breaking push.
String? _appVersionOrNull(Ref ref) {
  try {
    return ref.read(currentAppVersionProvider);
  } on Object {
    return null;
  }
}
