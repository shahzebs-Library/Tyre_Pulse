/// The Home branch root - today, a MINIMAL, DELIBERATELY NARROW stopgap.
///
/// # Why this file exists in a phase whose brief is "Work Orders only"
///
/// `app/router/routes.dart` declares [HomeRoute] and `app/router/app_router
/// .dart` wires it as branch 0's root, but as of this phase NOTHING in
/// `lib/features/` had ever registered [TpRouteId.home] with the shared
/// screen registry - confirmed by reading every `*_screen_registrations
/// .dart` file and `main.dart`'s own composition-root chain before writing
/// this one. `TpRouteId.home` therefore rendered [TpScreenNotAvailable] for
/// every signed-in user, on every cold start and after every sign-in (the
/// router's own `resolveRedirect` sends a freshly signed-in session
/// straight to [TpRoutePaths.home]).
///
/// `app/router/shell_tabs.dart`'s own comment establishes the architecture
/// this app is built around: "every pushed screen with no branch of its
/// own lives here" (branch 0), i.e. Home is meant to be where every
/// SECONDARY, non-tab-bar destination is reached from - `overview`,
/// `reports`, `analytics`, `team`, `tasks`, `preventiveMaintenance`,
/// `workOrders`, `workshop`, the whole `admin/*` tree, and more, are ALL
/// nested under branch 0 with no `TpShellDestination` of their own (see
/// that file's `TpShell.destinations` list - it has exactly nine entries,
/// one per branch, and none of the routes above is among them). There is
/// no hamburger menu, no drawer, and no app-bar overflow menu anywhere in
/// `app_shell.dart` either - the bottom `NavigationBar` and whatever
/// renders inside the active branch are the WHOLE navigation surface. So
/// Home was not merely unfinished chrome around an otherwise-reachable
/// feature: it was the ONLY place this phase's actual deliverable
/// ([WorkOrdersListScreen], `/work-orders`) could ever be reached from,
/// and building it, at least minimally, was the only way to satisfy this
/// phase's own requirement that Work Orders be genuinely reachable rather
/// than registered-but-unreachable - the exact defect the phase's brief
/// names as the bug the production app itself already has (its two
/// "work orders" screens: one on the tab bar reading the wrong table,
/// the other reading the right table and linked from nowhere at all).
///
/// # This is NOT the eventual Home hub design
///
/// There is no Home-hub specification file in this repository to build
/// against (checked: `docs/` here holds only `BOOTSTRAP.md` and
/// `TOOLCHAIN.md`), and several sibling comments elsewhere in this
/// codebase reference an external spec by section number ("spec section
/// 10 lists Approvals as a primary tab for the Supervisor persona") that
/// is not available here either. A real Home hub - persona-based quick
/// actions, KPI tiles, the full catalogue of secondary destinations this
/// file's own library comment lists above - is its own feature, deserving
/// its own dedicated phase with its own real design, not a byproduct of a
/// Work Orders dispatch. So this screen does exactly one thing: it states
/// plainly that it is a placeholder, and it offers exactly the one real,
/// working action this phase actually built - [WorkOrdersListScreen] -
/// gated by the SAME [ModuleKey.workorders] decision the destination
/// itself enforces, mirroring `vehicle_detail_screen.dart`'s own
/// `canStartInspection` gate on its "Start Inspection" button. A LATER
/// Home phase should REPLACE this screen builder entirely - not extend
/// it - once a real design exists; this file's only job is to close a
/// reachability gap this phase's brief was explicit could not be left
/// open.
library;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:tyre_pulse/app/localization/tp_direction.dart';
import 'package:tyre_pulse/app/localization/tp_localizations.dart';
import 'package:tyre_pulse/app/router/routes.dart';
import 'package:tyre_pulse/app/theme/tp_colors.dart';
import 'package:tyre_pulse/app/theme/tp_spacing.dart';
import 'package:tyre_pulse/core/design_system/design_system.dart';
import 'package:tyre_pulse/core/permissions/module_registry.dart';
import 'package:tyre_pulse/core/permissions/permission_providers.dart';

class HomeScreen extends ConsumerWidget {
  const HomeScreen({required this.route, super.key});

  /// [HomeRoute] carries no parameters of its own. Threaded through anyway,
  /// matching every other registered screen in this codebase (see
  /// `washing_screen.dart`'s own comment on why the typed route is kept
  /// even when it has nothing to read today).
  final HomeRoute route;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final bool canOpenWorkOrders = ref.watch(
      canAccessModuleProvider(ModuleKey.workorders),
    );
    // Hoisted rather than computed inline where it is used - the quick
    // action tile below nests six widgets deep, and the wrapped chain
    // does not fit at that indent. Mirrors
    // `checklist_approvals_queue_screen.dart`'s own `style` local, just
    // computed once at the top of this flat single-method build rather
    // than in a nested helper this file does not have.
    final TextStyle? tileSubtitleStyle = Theme.of(context).textTheme.bodySmall
        ?.copyWith(color: TpPalette.of(context).textMuted);

    return TpScaffold(
      // No back fallback: Home is the root of its own branch, and of the
      // whole signed-in app. See `tp_scaffold.dart`'s own library comment
      // - "A branch root, or Home, leaves backFallback null and gets the
      // system default - so hardware Back still EXITS THE APP from Home
      // rather than trapping the user inside it."
      appBar: TpAppBar(title: l10n.homeNavTitle, showBack: false),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(
          TpSpace.lg,
          TpSpace.lg,
          TpSpace.lg,
          TpSpace.xxxl,
        ),
        children: <Widget>[
          Text(
            l10n.homeGreeting,
            style: Theme.of(context).textTheme.headlineSmall,
          ),
          const SizedBox(height: TpSpace.xxl),
          Text(
            l10n.homeQuickActionsHeading,
            style: Theme.of(context).textTheme.labelLarge,
          ),
          const SizedBox(height: TpSpace.md),
          if (canOpenWorkOrders)
            TpCard(
              // A PUSH, not a `go`. `WorkOrdersRoute` is nested inside the
              // SAME branch 0 `StatefulShellBranch` as `HomeRoute` in
              // `app_router.dart` - this is a push that continues within
              // Home's own Navigator, not a branch switch (contrast
              // `vehicle_detail_screen.dart`'s `_startInspection`, which
              // genuinely crosses from branch 0 into branch 1 and uses
              // `context.go` for exactly that reason). Pushing keeps Home
              // underneath on the stack, so Back from the list pops
              // straight back here with real history - `app_router.dart`'s
              // own rule 2.
              onTap: () => context.push(const WorkOrdersRoute().location),
              child: Row(
                children: <Widget>[
                  DecoratedBox(
                    decoration: BoxDecoration(
                      color: TpPalette.of(context).info.soft,
                      shape: BoxShape.circle,
                    ),
                    child: Padding(
                      padding: const EdgeInsets.all(TpSpace.sm),
                      child: Icon(
                        Icons.build_circle_outlined,
                        size: TpSizing.iconMd,
                        color: TpPalette.of(context).info.onSoft,
                      ),
                    ),
                  ),
                  const SizedBox(width: TpSpace.md),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      mainAxisSize: MainAxisSize.min,
                      children: <Widget>[
                        Text(
                          l10n.homeWorkOrdersTile,
                          style: Theme.of(context).textTheme.titleSmall,
                        ),
                        Text(
                          l10n.homeWorkOrdersTileSubtitle,
                          style: tileSubtitleStyle,
                        ),
                      ],
                    ),
                  ),
                  Icon(
                    TpDirection.isRtl(context)
                        ? Icons.chevron_left
                        : Icons.chevron_right,
                    color: TpPalette.of(context).textMuted,
                  ),
                ],
              ),
            )
          else
            TpCard(
              isDashed: true,
              child: Text(
                l10n.homeNoQuickActionsMessage,
                style: Theme.of(context).textTheme.bodyMedium,
              ),
            ),
        ],
      ),
    );
  }
}
