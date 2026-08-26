/// The route guard, as a widget.
///
/// Artifact 03 section 5.5, and it is the single most important line in the
/// navigation design:
///
/// > A GoRouter `redirect` that returns `/home` for a denied route rebuilds the
/// > exact defect that was reported twice: the screen vanishes and the user
/// > lands on the main page with no explanation. The redirect must not decide
/// > access at all.
///
/// So the redirect handles the SESSION only, and access is decided here, in the
/// route's builder, rendering a refusal IN PLACE. Nothing navigates on a
/// refusal.
library;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:tyre_pulse/app/localization/tp_localizations.dart';
import 'package:tyre_pulse/app/router/back_navigation.dart';
import 'package:tyre_pulse/app/router/route_access.dart';
import 'package:tyre_pulse/app/router/tp_back.dart';
import 'package:tyre_pulse/core/design_system/design_system.dart';

/// Renders [child] when the guard is satisfied, and an explanation when it is
/// not.
class TpModuleGuard extends ConsumerWidget {
  const TpModuleGuard({
    required this.guard,
    required this.child,
    this.backFallback,
    super.key,
  });

  final RouteGuard guard;
  final Widget child;

  /// Where the refusal's Back action goes.
  final String? backFallback;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final ModuleAccessResolver resolver = ref.watch(
      moduleAccessResolverProvider,
    );
    final ModuleAccessDecision decision = resolver.decide(guard);

    return switch (decision) {
      ModuleAccessAllowed() => child,
      // The only case that may show a spinner, and only because it ends by
      // itself. Loading and denied are separate branches on purpose: fusing
      // them is what produced a spinner that ran forever.
      ModuleAccessResolving() => const TpScaffold(body: TpLoadingState()),
      ModuleAccessDenied(reason: final ModuleDenialReason reason) => TpScaffold(
        body: TpPermissionDeniedState(
          reason: describeDenial(AppLocalizations.of(context), reason),
          onBack: () => _goBack(context),
        ),
      ),
    };
  }

  void _goBack(BuildContext context) {
    final String? fallback = backFallback;
    if (fallback == null) {
      backTo(TpBack.of(context));
    } else {
      backTo(TpBack.of(context), fallback: fallback);
    }
  }
}

/// Turns a denial reason into a sentence.
///
/// Public so the same wording is used anywhere a refusal is shown - a tile that
/// explains why it is disabled, a sheet, a message. A second wording for the
/// same refusal is how a user learns that the app contradicts itself.
String describeDenial(AppLocalizations l10n, ModuleDenialReason reason) {
  return switch (reason) {
    ModuleDenialReason.notGranted => l10n.deniedNotGranted,
    ModuleDenialReason.adminOnly => l10n.deniedAdminOnly,
    ModuleDenialReason.superAdminOnly => l10n.deniedSuperAdminOnly,
    ModuleDenialReason.permissionsUnavailable =>
      l10n.deniedPermissionsUnavailable,
  };
}
