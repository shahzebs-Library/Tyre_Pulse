/// Riverpod wiring for "Verify on site".
library;

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_riverpod/misc.dart' show FutureProviderFamily;
import 'package:shared_preferences/shared_preferences.dart';
import 'package:tyre_pulse/core/network/supabase_client_provider.dart';
import 'package:tyre_pulse/core/workspace/workspace_context.dart';
import 'package:tyre_pulse/core/workspace/workspace_providers.dart';
import 'package:tyre_pulse/features/fleet_verification/data/fleet_verification_repository.dart';
import 'package:tyre_pulse/features/fleet_verification/domain/fleet_verification_rules.dart';
import 'package:tyre_pulse/features/handover/data/handover_location.dart';
import 'package:tyre_pulse/features/handover/data/handover_photo_capture.dart';

final Provider<FleetVerificationRemote> fleetVerificationRemoteProvider =
    Provider<FleetVerificationRemote>(
  (Ref ref) =>
      SupabaseFleetVerificationRemote(ref.watch(supabaseClientProvider)),
);

/// Null until a user is signed in (the outbox is per user).
final FutureProvider<FleetVerificationService?>
    fleetVerificationServiceProvider =
    FutureProvider<FleetVerificationService?>((Ref ref) async {
  final WorkspaceContext? ws = ref.watch(workspaceContextProvider);
  if (ws == null) return null;
  final SharedPreferences prefs = await SharedPreferences.getInstance();
  return FleetVerificationService(
    FleetVerificationOutbox(prefs, ws.userId),
    ref.watch(fleetVerificationRemoteProvider),
  );
});

/// Only Fleet Supervisor, Fleet Incharge, Admin and super admin see the
/// "Verify on site" action. The server re-checks.
final Provider<bool> canVerifyOnSiteProvider = Provider<bool>((Ref ref) {
  final WorkspaceContext? ws = ref.watch(workspaceContextProvider);
  if (ws == null) return false;
  return canVerifyOnSite(ws.role, isSuperAdmin: ws.isSuperAdmin);
});

/// Reuses the handover capture: resizes to 1600 px, keeps the file until upload.
typedef VerificationPhotoPicker = Future<String?> Function({
  required bool camera,
});

final Provider<VerificationPhotoPicker> verificationPhotoPickerProvider =
    Provider<VerificationPhotoPicker>((Ref ref) {
  final HandoverPhotoCapture capture = HandoverPhotoCapture();
  return ({required bool camera}) => capture.capture(
        sessionKey: 'fleet-verify',
        source:
            camera ? HandoverPhotoSource.camera : HandoverPhotoSource.gallery,
      );
});

/// Best-effort GPS (reuses the handover reader; never blocks saving).
final Provider<HandoverLocationReader> verificationLocationProvider =
    Provider<HandoverLocationReader>(
  (Ref ref) => ref.watch(handoverLocationReaderProvider),
);

/// The machine's own uploaded photo path (`vehicle_fleet.image_path`), or null.
final FutureProviderFamily<String?, String> vehicleImagePathProvider =
    FutureProvider.autoDispose
        .family<String?, String>((Ref ref, String id) async {
  try {
    return await ref.watch(fleetVerificationRemoteProvider).imagePath(id);
  } on Object {
    return null;
  }
});

/// Signed URL (1 hour) for a stored photo path, or null.
final FutureProviderFamily<String?, String> verificationSignedUrlProvider =
    FutureProvider.autoDispose.family<String?, String>(
  (Ref ref, String path) =>
      ref.watch(fleetVerificationRemoteProvider).signedUrl(path),
);
