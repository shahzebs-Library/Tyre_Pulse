/// Riverpod wiring for the permission layer.
///
/// Small providers, kept separate. Spec section 4 forbids one giant global
/// provider: a widget that watches a single module's decision must not rebuild
/// because an unrelated part of the session changed.
///
/// This file is the ONLY one in `core/permissions` that imports Flutter. The
/// resolver, the registry, the role model and the capability table are pure
/// Dart and are tested without a widget binding.
library;

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:tyre_pulse/core/permissions/access_resolver.dart';
import 'package:tyre_pulse/core/permissions/module_registry.dart';

/// The three things loaded at sign-in: the profile's role and super-admin
/// flag, `get_my_access_grants()`, and `get_user_module_permissions()`.
///
/// **Must be overridden at the composition root**, once the repository that
/// loads them exists. It throws rather than returning a permissive default,
/// because a missing override that quietly denied everything would look like a
/// permission bug in production and a missing override that quietly allowed
/// everything would be worse.
///
/// The repository behind it must report which of its three reads failed
/// INDEPENDENTLY, and set [AccessState.permissionsError] only when the grants
/// or the matrix genuinely failed. A `Future.wait` with no per-member error
/// handling turns one failure into three, and this flag closes three
/// administration modules when it is set - it has to stay narrow.
final accessStateProvider = Provider<AccessState>((ref) {
  throw UnimplementedError(
    'accessStateProvider has no value. Override it at the composition root '
    'with the signed-in AccessState, or with AccessState.signedOut before '
    'sign-in.',
  );
});

/// Which of the two documented orderings the application follows on the
/// admin-versus-revoke question.
///
/// Defaults to the server's behaviour. See [AdminRevokePrecedence] for the
/// three call sites that disagree and why this is still an open product
/// decision. Overriding this provider is how the answer gets applied
/// everywhere at once, including the workspace switcher's navigation rebuild.
final adminRevokePrecedenceProvider = Provider<AdminRevokePrecedence>(
  (ref) => AdminRevokePrecedence.serverAppUserCan,
);

/// The full decision for one module, including the reason.
///
/// Prefer this over [canAccessModuleProvider] anywhere a person will see the
/// outcome. A guard that only knows the boolean cannot explain a refusal, and
/// an unexplained refusal is how a denied screen ends up rendering a spinner
/// or, worse, nothing at all.
final moduleAccessProvider = Provider.family<AccessDecision, ModuleKey>(
  (ref, module) => resolveModuleAccess(
    module: module,
    access: ref.watch(accessStateProvider),
    precedence: ref.watch(adminRevokePrecedenceProvider),
  ),
);

/// The boolean, for a call site that genuinely only needs to hide a tile.
final canAccessModuleProvider = Provider.family<bool, ModuleKey>(
  (ref, module) => ref.watch(moduleAccessProvider(module)).isAllowed,
);

/// Every module the signed-in user reaches.
///
/// Navigation is built from this. Deriving the tab set from the same resolver
/// the screens use is what stops the two drifting: the production app gated
/// the tab bar on the registry and the screens on their own role lists, so an
/// inspector saw a tile, tapped it, and was thrown back to Home.
final allowedModulesProvider = Provider<Set<ModuleKey>>(
  (ref) => allowedModulesFor(
    ref.watch(accessStateProvider),
    precedence: ref.watch(adminRevokePrecedenceProvider),
  ),
);
