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
/// [buildAuthShellGateActions] never supplies `onOpenStore`: `url_launcher` is
/// not a declared dependency of this package, and spec section 64 forbids
/// adding one "to shorten five lines". [authLayerOverrides] uses the
/// no-`onOpenStore` form; the composition root may instead call
/// [buildAuthShellGateActions] directly with a real callback once a
/// store-launch dependency exists, in place of the `shellGateActionsProvider`
/// entry in [authLayerOverrides].
library;

import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:tyre_pulse/app/router/session.dart';
import 'package:tyre_pulse/app/router/shell_gates.dart';
import 'package:tyre_pulse/core/auth/auth_controller.dart';
import 'package:tyre_pulse/core/auth/auth_state.dart';

/// Builds the actions the shell gates may offer, wired to [AuthController].
///
/// Every callback wraps an async controller method in [unawaited]: the shell
/// gate screens declare their actions as [VoidCallback] (plain synchronous
/// `void Function()`), and each of these methods reports its outcome through
/// [AuthController.state] rather than through a returned value a button press
/// could inspect.
///
/// [onOpenStore] is passed straight through and defaults to null, which
/// `TpUpdateRequiredScreen` already treats correctly - see rule 7 in
/// `shell_gates.dart`'s library comment: "EVERY ACTION IS OPTIONAL AND EVERY
/// BUTTON IS REAL... When one is not supplied, its button is NOT RENDERED."
TpShellGateActions buildAuthShellGateActions(
  Ref ref, {
  VoidCallback? onOpenStore,
}) {
  AuthController notifier() => ref.read(authControllerProvider.notifier);

  return TpShellGateActions(
    onSignOut: () => unawaited(notifier().signOut()),
    onRetryProfile: () => unawaited(notifier().retryProfile()),
    onRetrySession: () => unawaited(notifier().retrySession()),
    onOpenStore: onOpenStore,
  );
}

/// The auth layer's contribution to the root `ProviderScope`. See the library
/// comment for what else the composition root must supply alongside this.
final authLayerOverrides = [
  sessionProvider.overrideWith(
    (Ref ref) => deriveSession(ref.watch(authControllerProvider)),
  ),
  shellGateActionsProvider.overrideWith(
    (Ref ref) => buildAuthShellGateActions(ref),
  ),
];
