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
import 'package:tyre_pulse/app/router/routes.dart';
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

    final ModuleAccessResolver resolver = ref.watch(
      moduleAccessResolverProvider,
    );
    final TpShellTabLayout layout = ensureActiveBranchVisible(
      resolveShellTabs(
        destinations: TpShell.destinations,
        canAccess: (RouteGuard guard) =>
            resolver.decide(guard) is ModuleAccessAllowed,
      ),
      navigationShell.currentIndex,
    );

    final TpPalette palette = TpPalette.of(context);
    final String activePath = GoRouterState.of(context).uri.path;
    final bool hasScreenOwnedNavigation =
        activePath == TpRoutePaths.newInspection ||
            activePath == TpRoutePaths.home;

    return Scaffold(
      backgroundColor: palette.background,
      body: navigationShell,
      bottomNavigationBar: hasScreenOwnedNavigation || layout.visible.length < 2
          // One destination is not a navigation bar, it is a decoration that
          // costs a row of screen height on a phone held in one hand. The
          // The approved Home dashboard owns its compact raised-centre action
          // bar, while the multi-step inspection flow owns a persistent action
          // instead. In both cases a second shell bar would duplicate controls
          // and consume the exact working height the reference allocates.
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

    return SafeArea(
      top: false,
      child: DecoratedBox(
        decoration: BoxDecoration(
          color: palette.surface,
          border: Border(
            top: BorderSide(
              color: palette.border,
              width: TpBorderWidth.hairline,
            ),
          ),
        ),
        child: SizedBox(
          height: 72,
          child: Row(
            children: <Widget>[
              for (int index = 0; index < layout.visible.length; index++)
                Expanded(
                  child: _TabDestination(
                    destination: layout.visible[index],
                    label: layout.visible[index].label(l10n),
                    isSelected: index == selected,
                    onTap: () => _onSelected(index),
                  ),
                ),
            ],
          ),
        ),
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
      initialLocation: destination.branchIndex == navigationShell.currentIndex,
    );
  }
}

class _TabDestination extends StatelessWidget {
  const _TabDestination({
    required this.destination,
    required this.label,
    required this.isSelected,
    required this.onTap,
  });

  final TpShellDestination destination;
  final String label;
  final bool isSelected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final TpPalette palette = TpPalette.of(context);
    final Color color = isSelected ? palette.primary : palette.text;
    return Semantics(
      selected: isSelected,
      button: true,
      label: label,
      child: InkWell(
        onTap: onTap,
        child: Container(
          decoration: BoxDecoration(
            border: Border(
              top: BorderSide(
                color: isSelected ? palette.primary : Colors.transparent,
                width: 3,
              ),
            ),
          ),
          padding: const EdgeInsets.only(top: 7, bottom: 5),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: <Widget>[
              Icon(destination.icon, color: color, size: 26),
              const SizedBox(height: 3),
              Text(
                label,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: Theme.of(context).textTheme.labelSmall?.copyWith(
                      color: color,
                      fontWeight:
                          isSelected ? FontWeight.w800 : FontWeight.w600,
                    ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
