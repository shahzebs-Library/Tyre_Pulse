/// The tab shell.
///
/// Wraps the `StatefulNavigationShell` GoRouter builds, and runs the five
/// full-screen gates in front of it (artifact 03 section 5.6), IN ORDER:
///
/// 1. session resolving  -> the boot screen
/// 2. no session         -> the redirect has already sent the user to sign in
/// 3. update required    -> [TpUpdateRequiredScreen]
/// 4. profile error      -> [TpProfileUnavailableScreen], fails closed
/// 5. not approved/locked -> [TpAccessBlockedScreen]
///
/// They are checked here rather than in the redirect so a deep link cannot skip
/// them: a link goes to a route, and a route renders inside this shell.
library;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:tyre_pulse/app/localization/tp_localizations.dart';
import 'package:tyre_pulse/app/router/route_access.dart';
import 'package:tyre_pulse/app/router/session.dart';
import 'package:tyre_pulse/app/router/shell_gates.dart';
import 'package:tyre_pulse/app/router/shell_tabs.dart';
import 'package:tyre_pulse/app/theme/tp_colors.dart';
import 'package:tyre_pulse/app/theme/tp_spacing.dart';

class TpAppShell extends ConsumerWidget {
  const TpAppShell({required this.navigationShell, super.key});

  final StatefulNavigationShell navigationShell;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final TpSession session = ref.watch(sessionProvider);

    switch (session.phase) {
      case TpSessionPhase.resolving:
        return const TpBootScreen();
      case TpSessionPhase.timedOut:
        return const TpSessionTimedOutScreen();
      case TpSessionPhase.signedOut:
        // The redirect sends the user to sign in. Rendering the boot screen for
        // the frame in between is honest: something is still being decided.
        return const TpBootScreen();
      case TpSessionPhase.signedIn:
        break;
    }

    switch (session.gate) {
      case TpShellGate.updateRequired:
        return const TpUpdateRequiredScreen();
      case TpShellGate.profileUnavailable:
        return const TpProfileUnavailableScreen();
      case TpShellGate.accessBlocked:
        return const TpAccessBlockedScreen();
      case TpShellGate.none:
        break;
    }

    final ModuleAccessResolver resolver =
        ref.watch(moduleAccessResolverProvider);
    final TpShellTabLayout layout = ensureActiveBranchVisible(
      resolveShellTabs(
        destinations: TpShell.destinations,
        canAccess: (RouteGuard guard) =>
            resolver.decide(guard) is ModuleAccessAllowed,
      ),
      navigationShell.currentIndex,
    );

    final TpPalette palette = TpPalette.of(context);

    return Scaffold(
      backgroundColor: palette.background,
      body: navigationShell,
      bottomNavigationBar: layout.visible.length < 2
          // One destination is not a navigation bar, it is a decoration that
          // costs a row of screen height on a phone held in one hand.
          ? null
          : _TabBar(layout: layout, navigationShell: navigationShell),
    );
  }
}

class _TabBar extends StatelessWidget {
  const _TabBar({required this.layout, required this.navigationShell});

  final TpShellTabLayout layout;
  final StatefulNavigationShell navigationShell;

  @override
  Widget build(BuildContext context) {
    final TpPalette palette = TpPalette.of(context);
    final AppLocalizations l10n = AppLocalizations.of(context);

    final int selected = _selectedIndex();

    return DecoratedBox(
      decoration: BoxDecoration(
        border: Border(
          top: BorderSide(
            color: palette.border,
            width: TpBorderWidth.hairline,
          ),
        ),
      ),
      child: NavigationBar(
        backgroundColor: palette.surface,
        indicatorColor: palette.primarySoft,
        selectedIndex: selected,
        onDestinationSelected: _onSelected,
        destinations: <Widget>[
          for (final TpShellDestination destination in layout.visible)
            NavigationDestination(
              icon: Icon(destination.icon),
              label: destination.label(l10n),
              tooltip: destination.label(l10n),
            ),
        ],
      ),
    );
  }

  int _selectedIndex() {
    final int index = layout.visible.indexWhere(
      (TpShellDestination d) => d.branchIndex == navigationShell.currentIndex,
    );
    // `ensureActiveBranchVisible` guarantees this is found whenever the branch
    // is accessible. The clamp covers the one case it cannot: a branch the user
    // has lost access to while standing in it.
    return index < 0 ? 0 : index;
  }

  void _onSelected(int index) {
    if (index < 0 || index >= layout.visible.length) return;
    final TpShellDestination destination = layout.visible[index];

    // `initialLocation: true` when the tab is already selected. That is the
    // standard "tap the tab you are on to go back to its root" gesture, and it
    // is the only way to unwind a deep stack without pressing Back repeatedly.
    navigationShell.goBranch(
      destination.branchIndex,
      initialLocation:
          destination.branchIndex == navigationShell.currentIndex,
    );
  }
}
