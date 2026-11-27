/// The composition root's entry point into this lane: the two overrides
/// `session.dart` and `shell_gates.dart` ask the auth layer to supply.
///
/// # What the composition root must do
///
/// Both `sessionProvider` (`lib/app/router/session.dart`) and
/// `shellGateActionsProvider` (`lib/app/router/shell_gates.dart`) are declared
/// with a placeholder default and a doc comment reading "Override this from
/// the authentication layer." [authLayerOverrides] IS that override, ready to
/// splice into the root `ProviderScope`:
///
/// ```dart
/// runApp(ProviderScope(
///   overrides: [
///     ...authLayerOverrides,
///     ...networkLayerOverrides,   // supabaseClientProvider
///     ...storageLayerOverrides,   // secureStoreProvider
///     currentAppVersionProvider.overrideWithValue(packageInfo.version),
///   ],
///   child: const TyrePulseApp(),
/// ));
/// ```
///
/// # Riverpod overrides are a GRAPH, not a SEQUENCE - what "order" really
/// means here
///
/// A `List<Override>` passed to `ProviderScope` has no execution order of its
/// own; Riverpod resolves each provider lazily, on first read, wherever it
/// sits in the dependency graph. So the real requirement is not "run these
/// first" - it is COMPLETENESS: every provider [authLayerOverrides]
/// transitively reads must resolve to a working value by the time
/// `sessionProvider` is first watched (which happens as soon as the router
/// renders anything, i.e. immediately). Concretely, that means ALL of the
/// following must ALSO be supplied, from outside this lane, or the app will
/// throw [UnimplementedError] the moment it tries to boot:
///
/// | Provider | Declared in | Owned by |
/// |---|---|---|
/// | `supabaseClientProvider` | `core/network/supabase_client_provider.dart` | network lane - not yet on disk at the time this was written |
/// | `secureStoreProvider` | `core/storage/storage_providers.dart` | storage lane - not yet on disk at the time this was written |
/// | [currentAppVersionProvider] | `core/auth/auth_dependency_providers.dart` | THIS lane declares it, but throws by default - the composition root must supply the real build version. See that file's own doc comment for why this lane did not add `package_info_plus` itself. |
///
/// [workspaceControllerProvider] (`core/workspace/workspace_providers.dart`)
/// does NOT need a separate override for this lane to function: `adopt()` and
/// `clear()` are plain in-memory mutations on an already-complete Notifier,
/// called directly by [AuthController]. Its OWN dependency,
/// `workspaceDependenciesProvider`, is used only by `switchTo()` (changing
/// country/site after sign-in), which this lane does not call - see
/// `auth_controller.dart`'s `_adoptWorkspace` for exactly why, and the
/// accompanying report for what remains open there.
///
/// # What is deliberately partial
///
/// `onOpenStore` is platform-aware (see `store_listing.dart`): Play on Android,
/// the App Store on iOS when the `APP_STORE_ID` dart-define is set, and no
/// store button at all otherwise. An iPhone is never sent to Google Play.
library;

import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:tyre_pulse/app/router/session.dart';
import 'package:tyre_pulse/app/router/shell_gates.dart';
import 'package:tyre_pulse/core/auth/auth_controller.dart';
import 'package:tyre_pulse/core/auth/auth_state.dart';
import 'package:tyre_pulse/core/auth/mfa_repository.dart';
import 'package:tyre_pulse/core/auth/store_listing.dart';
import 'package:url_launcher/url_launcher.dart';

/// Builds the actions the shell gates may offer, wired to [AuthController].
///
/// Every callback wraps an async controller method in [unawaited]: the shell
/// gate screens declare their actions as [VoidCallback] (plain synchronous
/// `void Function()`), and each of these methods reports its outcome through
/// [AuthController.state] rather than through a returned value a button press
/// could inspect.
///
/// [onOpenStore] defaults to opening this platform's own store listing (Play
/// on Android, the App Store on iOS when its id is configured), so the
/// update-required screen offers a real "Open the store" button. Where there
/// is no listing to open the action is null and the button is not rendered.
/// A caller may pass its own (tests do).
TpShellGateActions buildAuthShellGateActions(
  Ref ref, {
  VoidCallback? onOpenStore,
}) {
  AuthController notifier() => ref.read(authControllerProvider.notifier);

  return TpShellGateActions(
    onSignOut: () => unawaited(notifier().signOut()),
    onRetryProfile: () => unawaited(notifier().retryProfile()),
    onRecheckAccess: () => notifier().recheckProfile(),
    onRetrySession: () => unawaited(notifier().retrySession()),
    onOpenStore: onOpenStore ?? defaultOpenStoreAction(),
    onVerifyMfa: (String code) async =>
        switch (await notifier().verifyMfa(code)) {
      MfaVerified() => TpMfaVerifyResult.verified,
      MfaCodeRejected() => TpMfaVerifyResult.rejected,
      MfaVerifyUnavailable() => TpMfaVerifyResult.unavailable,
    },
  );
}

/// The store action for the platform this build runs on, or null when there
/// is no listing to open (see `store_listing.dart`): on an iPhone without a
/// configured App Store id the update-required screen then shows no store
/// button and tells the user to update from the App Store instead.
VoidCallback? defaultOpenStoreAction({
  TargetPlatform? platform,
  String appStoreId = kAppStoreId,
}) {
  final StoreListing? listing = storeListingFor(
    platform ?? defaultTargetPlatform,
    appStoreId: appStoreId,
  );
  if (listing == null) return null;
  return () => _openListing(listing);
}

void _openListing(StoreListing listing) {
  unawaited(() async {
    try {
      if (await launchUrl(
        listing.primary,
        mode: LaunchMode.externalApplication,
      )) {
        return;
      }
    } on Object {
      // No store app: fall through to the browser.
    }
    try {
      await launchUrl(listing.fallback, mode: LaunchMode.externalApplication);
    } on Object {
      // Nothing can open a link. The screen still offers sign-out.
    }
  }());
}

/// The auth layer's contribution to the root `ProviderScope`. See the library
/// comment for what else the composition root must supply alongside this.
/// True when the grants and role matrix read failed this sign-in and nothing
/// trustworthy was kept (see [PermissionsStatus.failed]).
///
/// Defaults to false so a screen test that never wires the auth layer is not
/// forced to build the real controller. [authLayerOverrides] points it at
/// the live [AuthController] state.
final Provider<bool> accessLoadFailedProvider =
    Provider<bool>((Ref ref) => false);

/// Re-reads the grants and role matrix. Null when nothing can retry (no auth
/// layer wired), in which case the retry control is not offered.
final Provider<VoidCallback?> retryAccessLoadProvider =
    Provider<VoidCallback?>((Ref ref) => null);

final authLayerOverrides = [
  sessionProvider.overrideWith(
    (Ref ref) => deriveSession(ref.watch(authControllerProvider)),
  ),
  shellGateActionsProvider.overrideWith(
    (Ref ref) => buildAuthShellGateActions(ref),
  ),
  accessLoadFailedProvider.overrideWith(
    (Ref ref) => ref.watch(
      authControllerProvider.select(
        (AuthState state) =>
            state.permissionsStatus == PermissionsStatus.failed,
      ),
    ),
  ),
  retryAccessLoadProvider.overrideWith(
    (Ref ref) => () => unawaited(
          ref.read(authControllerProvider.notifier).retryPermissions(),
        ),
  ),
];
