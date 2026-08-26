/// The narrow surface the rest of the app is allowed to know about
/// telemetry.
///
/// A repository, the sync engine, a router observer - none of them import
/// `package:sentry_flutter` directly, and none of them construct an
/// [AppError] specially "for telemetry". They depend on this interface, and
/// on the SAME [AppError] and `SupabaseFailure` types they already build for
/// every other purpose. That is what keeps every capture call testable with a
/// fake, and it is what makes the vendor swappable: only `telemetry_service.dart`
/// would need to change if it ever were.
library;

import 'package:tyre_pulse/core/errors/app_error.dart';
import 'package:tyre_pulse/core/network/supabase_error_mapper.dart';
import 'package:tyre_pulse/core/telemetry/telemetry_sync_failure.dart';

/// Reports failures to telemetry, using only fields already declared safe to
/// log.
///
/// Every implementation - including a test fake standing in for this
/// interface - must be safe to call with no telemetry backend active: a build
/// with no DSN, or a screen rendered before [initialize] has been awaited,
/// both hit every method here and neither may throw.
abstract class TelemetryReporter {
  /// Whether events sent to the capture methods below are actually being
  /// forwarded anywhere. False for the whole life of a build with no DSN.
  bool get isActive;

  /// Sends [error] to telemetry using ONLY [AppError.message] and
  /// [AppError.technical] - never [AppError.cause], which may hold the
  /// original, unredacted driver exception.
  ///
  /// [category] additionally tags the event as a sync failure of a given
  /// kind, so it can be trended on a dashboard distinct from a raw stack
  /// trace. Pass it when this failure came from a queued write; omit it for
  /// anything else.
  Future<void> captureAppError(
    AppError error, {
    TelemetrySyncFailureCategory? category,
  });

  /// Convenience over [captureAppError] for a caller that already classified
  /// the failure with `supabase_error_mapper.dart`. Adds [SupabaseFailure]'s
  /// own cause name and server code as extra tags - both are declared safe to
  /// log by that file - without ever reading [SupabaseFailure.rawMessage].
  Future<void> captureSupabaseFailure(
    SupabaseFailure failure, {
    TelemetrySyncFailureCategory? category,
  });

  /// Records the route currently on screen, so the NEXT captured event is
  /// tagged with where the user was.
  ///
  /// Called by the navigator observer defined in
  /// `telemetry_navigator_observer.dart` on every navigation. Also usable
  /// directly by a caller with no navigator in scope - a background sync
  /// task reporting the last screen the user was actually looking at.
  void setCurrentRoute(String? routeName);

  /// Records the active workspace, so a later captured event can be
  /// attributed to it.
  ///
  /// Pass null on sign-out or before a workspace has been adopted. Spec
  /// section 59 asks for "workspace ID where privacy-safe" - the absence of
  /// this tag, before a workspace exists, is itself the privacy-safe choice,
  /// not an omission to fix.
  void setWorkspaceId(String? workspaceId);
}
