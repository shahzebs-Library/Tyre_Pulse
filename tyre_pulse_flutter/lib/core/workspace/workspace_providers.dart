/// Riverpod wiring for the workspace layer.
///
/// The controller here is a thin adapter. All of the ordering, validation and
/// failure handling lives in [WorkspaceSwitcher], which is pure Dart, so the
/// rules in spec section 8 are tested without a widget binding.
///
/// This file and `permission_providers.dart` are the only files in
/// `core/workspace` and `core/permissions` that import Flutter.
library;

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:tyre_pulse/core/errors/app_error.dart';
import 'package:tyre_pulse/core/permissions/permission_providers.dart';
import 'package:tyre_pulse/core/workspace/workspace_context.dart';
import 'package:tyre_pulse/core/workspace/workspace_scope.dart';
import 'package:tyre_pulse/core/workspace/workspace_state.dart';
import 'package:tyre_pulse/core/workspace/workspace_switch.dart';

/// The narrow surface a workspace change needs from the data layer.
///
/// **Must be overridden at the composition root.** The implementation belongs
/// to the repository and cache layers, not here.
final workspaceDependenciesProvider = Provider<WorkspaceDependencies>((ref) {
  throw UnimplementedError(
    'workspaceDependenciesProvider has no value. Override it at the '
    'composition root with the implementation that reads the profile, the '
    'currency mapping and the scoped caches.',
  );
});

/// The switcher, built from the dependencies and the resolver ordering.
final workspaceSwitcherProvider = Provider<WorkspaceSwitcher>(
  (ref) => WorkspaceSwitcher(
    ref.watch(workspaceDependenciesProvider),
    precedence: ref.watch(adminRevokePrecedenceProvider),
  ),
);

/// The active workspace and its lifecycle.
final workspaceControllerProvider =
    NotifierProvider<WorkspaceController, WorkspaceState>(
      WorkspaceController.new,
    );

/// Holds the active workspace.
///
/// It does not load anything. The session layer adopts a context once the
/// profile resolves, and every later change goes through [switchTo] so the
/// five obligations run in one place.
final class WorkspaceController extends Notifier<WorkspaceState> {
  @override
  WorkspaceState build() => const WorkspaceState.unresolved();

  /// Installs the workspace resolved at sign-in, or after a forced reload.
  ///
  /// Adoption is not a switch: there is no previous workspace to invalidate
  /// caches against, and running the switch pipeline here would re-fetch a
  /// profile the caller has just read.
  void adopt(WorkspaceContext workspace) {
    state = WorkspaceState(workspace: workspace);
  }

  /// Clears the workspace on sign-out. Nothing scoped may survive it.
  void clear() {
    state = const WorkspaceState.unresolved();
  }

  /// Changes country or site selection.
  ///
  /// Never throws. A refusal lands in [WorkspaceState.lastError] with the
  /// workspace unchanged, so a screen can render the reason instead of a
  /// spinner that will never end.
  Future<void> switchTo(WorkspaceSelection selection) async {
    final WorkspaceContext? current = state.workspace;
    if (current == null) {
      state = state.copyWith(
        isResolving: false,
        lastError: const AppError(
          kind: AppErrorKind.validation,
          message: 'Your workspace is still loading. Try again in a moment.',
          technical: 'switchTo called before a workspace was adopted',
        ),
      );
      return;
    }

    state = state.copyWith(isResolving: true, clearLastError: true);

    final WorkspaceSwitchOutcome outcome = await ref
        .read(workspaceSwitcherProvider)
        .switchTo(current: current, selection: selection);

    state = switch (outcome) {
      WorkspaceSwitchApplied(
        context: final WorkspaceContext next,
        warnings: final List<AppError> warnings,
      ) =>
        WorkspaceState(workspace: next, warnings: warnings),
      WorkspaceSwitchRefused(error: final AppError error) => state.copyWith(
        isResolving: false,
        lastError: error,
      ),
    };
  }
}

/// The active workspace, or null before one is adopted.
final workspaceContextProvider = Provider<WorkspaceContext?>(
  (ref) => ref.watch(workspaceControllerProvider).workspace,
);

/// The single country currently selected, or null for "everything in scope".
///
/// A null means a query carries NO country filter. It does not mean the user
/// has no country. Their scope is [countryScopeProvider].
final activeCountryProvider = Provider<String?>(
  (ref) => ref.watch(workspaceContextProvider)?.activeCountry,
);

/// The country scope from `profiles.country`, the ARRAY.
final countryScopeProvider = Provider<CountryScope>(
  (ref) =>
      ref.watch(workspaceContextProvider)?.countryScope ?? CountryScope.none,
);

/// The site scope from `profiles.sites`, the ARRAY. Not the legacy scalar.
final siteScopeProvider = Provider<SiteScope>(
  (ref) => ref.watch(workspaceContextProvider)?.siteScope ?? SiteScope.none,
);

/// The explicit site filter to apply. Empty means no filter.
final activeSitesProvider = Provider<List<String>>(
  (ref) => ref.watch(workspaceContextProvider)?.siteIds ?? const <String>[],
);

/// The currency for the active country, resolved from the server.
///
/// Null means it is not resolved. Render a dash or Unavailable. NEVER
/// substitute a default: the Kotlin build hard-coded SAR for every user, and
/// `mobile/lib/execReportPdf.ts` still does it today.
final activeCurrencyProvider = Provider<String?>(
  (ref) => ref.watch(workspaceContextProvider)?.currency,
);
