/// The shell: which branches exist, and which of them reach the bottom bar.
///
/// Artifact 03 section 2.4 gives the branch design. Nine branches, each with
/// its own Navigator, which is what gives per-tab history for free - the thing
/// the Expo tab navigator had to be coerced into.
///
/// Branches exist for `history`, `checklists` and `approvals` even though they
/// are not primary tabs today, because they are the three places the app pushes
/// a detail screen and expects Back to return to the LIST.
///
/// > Do not build one branch per role. Spec section 10: one app,
/// > permission driven experiences. Build every branch, then filter which
/// > appear in the bar.
///
/// THE CAP IS EXPLICIT, ON PURPOSE. Artifact 03 section 2.3 measured the
/// production bar rendering SIX primary tabs for four roles while the design
/// says five, because the bar is derived from module defaults and nobody
/// bounded it. [kMaxPrimaryTabs] bounds it here, and the destinations that do
/// not fit come back as [TpShellTabLayout.overflow] rather than disappearing.
///
/// That last point is the lesson from the incident spec section 39 names: a
/// duplicate declaration hid the Vehicle Washing tab, the screen was reachable
/// only by scrolling the Home hub, and NO WASH WAS EVER LOGGED. One registry
/// decides both what is on the bar and what the Home hub must show, so a
/// destination can be demoted but never lost.
library;

import 'package:flutter/material.dart';
import 'package:tyre_pulse/app/localization/tp_localizations.dart';
import 'package:tyre_pulse/app/router/route_access.dart';
import 'package:tyre_pulse/app/router/routes.dart';

/// The most destinations the bottom bar may carry.
///
/// Five. More than five on a phone bar makes every target smaller than the
/// touch minimum spec section 53 asks for.
const int kMaxPrimaryTabs = 5;

/// A localised label for a destination.
typedef TpDestinationLabel = String Function(AppLocalizations l10n);

/// One branch of the shell.
@immutable
class TpShellDestination {
  const TpShellDestination({
    required this.branchIndex,
    required this.routeId,
    required this.location,
    required this.guard,
    required this.icon,
    required this.label,
    required this.isPrimary,
    this.isAnchored = false,
  });

  /// Index into the branch list. This is what `goBranch` takes, so it must
  /// match the order the branches are declared in the router exactly.
  final int branchIndex;

  /// The route at the root of this branch.
  final String routeId;

  final String location;

  /// What the destination requires. The SAME predicate gates the bar item and
  /// the route, so a tile can never be shown for a screen that then refuses.
  final RouteGuard guard;

  final IconData icon;
  final TpDestinationLabel label;

  /// Whether this destination is eligible for the bottom bar at all.
  final bool isPrimary;

  /// Anchored destinations keep their place when the bar is capped.
  ///
  /// Home and Profile are anchored. Profile is not vanity: it carries the
  /// offline queue, and sync notifications route to it, so a field worker must
  /// always be one tap from it.
  final bool isAnchored;
}

/// What the bar shows, and what it could not fit.
@immutable
class TpShellTabLayout {
  const TpShellTabLayout({required this.visible, required this.overflow});

  /// In bar order.
  final List<TpShellDestination> visible;

  /// Accessible, but not on the bar. The Home hub must render these, or they
  /// become unreachable.
  final List<TpShellDestination> overflow;
}

/// Every branch, in branch order.
///
/// The order of this list IS the branch order in the router. Changing it
/// changes what `goBranch(index)` means, so add to the end rather than
/// inserting.
abstract final class TpShell {
  static final List<TpShellDestination> destinations = <TpShellDestination>[
    TpShellDestination(
      branchIndex: 0,
      routeId: TpRouteId.home,
      location: TpRoutePaths.home,
      guard: const AuthenticatedOnly(),
      icon: Icons.home,
      label: (AppLocalizations l10n) => l10n.tabHome,
      isPrimary: true,
      isAnchored: true,
    ),
    TpShellDestination(
      branchIndex: 1,
      routeId: TpRouteId.newInspection,
      location: TpRoutePaths.newInspection,
      guard: const ModuleGuarded(RouteModule.inspect),
      icon: Icons.assignment,
      label: (AppLocalizations l10n) => l10n.tabInspect,
      isPrimary: true,
    ),
    // Approvals is primary here and is NOT primary in production. Spec section
    // 10 lists Approvals as a primary tab for the Supervisor persona, and
    // artifact 03 section 2.3 records the gap: `tyre_data_collector` holds the
    // approvals module, so it can clear a queue, but reaches it only by
    // scrolling the Home hub. This is the one place the shell and the spec
    // disagree outright, and the spec is followed.
    TpShellDestination(
      branchIndex: 2,
      routeId: TpRouteId.inspectionApprovals,
      location: TpRoutePaths.inspectionApprovals,
      guard: const ModuleGuarded(RouteModule.approvals),
      icon: Icons.done_all,
      label: (AppLocalizations l10n) => l10n.tabApprovals,
      isPrimary: true,
    ),
    TpShellDestination(
      branchIndex: 3,
      routeId: TpRouteId.accidentDashboard,
      location: TpRoutePaths.accidentDashboard,
      guard: const ModuleGuarded(RouteModule.accidents),
      icon: Icons.report_problem,
      label: (AppLocalizations l10n) => l10n.tabAccidents,
      isPrimary: true,
    ),
    TpShellDestination(
      branchIndex: 4,
      routeId: TpRouteId.meterLog,
      location: TpRoutePaths.meterLog,
      guard: const ModuleGuarded(RouteModule.meter),
      icon: Icons.speed,
      label: (AppLocalizations l10n) => l10n.tabMeter,
      isPrimary: true,
    ),
    TpShellDestination(
      branchIndex: 5,
      routeId: TpRouteId.washing,
      location: TpRoutePaths.washing,
      guard: const ModuleGuarded(RouteModule.washing),
      icon: Icons.local_car_wash,
      label: (AppLocalizations l10n) => l10n.tabWashing,
      isPrimary: true,
    ),
    // Not primary. A branch so that opening an inspection from History and
    // pressing Back returns to History.
    TpShellDestination(
      branchIndex: 6,
      routeId: TpRouteId.activityHistory,
      location: TpRoutePaths.activityHistory,
      guard: const ModuleGuarded(RouteModule.history),
      icon: Icons.history,
      label: (AppLocalizations l10n) => l10n.tabHistory,
      isPrimary: false,
    ),
    // Not primary. A branch so that filling a checklist and pressing Back
    // returns to the checklist list.
    TpShellDestination(
      branchIndex: 7,
      routeId: TpRouteId.checklists,
      location: TpRoutePaths.checklists,
      guard: const ModuleGuarded(RouteModule.checklists),
      icon: Icons.checklist,
      label: (AppLocalizations l10n) => l10n.tabChecklists,
      isPrimary: false,
    ),
    TpShellDestination(
      branchIndex: 8,
      routeId: TpRouteId.profile,
      location: TpRoutePaths.profile,
      guard: const AuthenticatedOnly(),
      icon: Icons.person,
      label: (AppLocalizations l10n) => l10n.tabProfile,
      isPrimary: true,
      isAnchored: true,
    ),
  ];

  /// The branch that owns [location], or 0 (Home) when nothing claims it.
  ///
  /// Longest prefix wins, so `/checklists/history` resolves to the checklists
  /// branch rather than to Home. Home is the fallback because every pushed
  /// screen in the home branch hangs off it.
  static int branchIndexForLocation(String location) {
    int bestIndex = 0;
    int bestLength = 0;
    for (final TpShellDestination destination in destinations) {
      final String prefix = destination.location;
      final bool matches = location == prefix ||
          location.startsWith('$prefix/') ||
          location.startsWith('$prefix?');
      if (matches && prefix.length > bestLength) {
        bestIndex = destination.branchIndex;
        bestLength = prefix.length;
      }
    }
    return bestIndex;
  }
}

/// Works out what the bottom bar shows.
///
/// Pure: it takes the destinations and an access predicate, so the rule can be
/// tested without a router, a session or a permission service.
TpShellTabLayout resolveShellTabs({
  required List<TpShellDestination> destinations,
  required bool Function(RouteGuard guard) canAccess,
  int maxTabs = kMaxPrimaryTabs,
}) {
  final List<TpShellDestination> accessible =
      destinations.where((TpShellDestination d) => canAccess(d.guard)).toList();

  final List<TpShellDestination> anchors = accessible
      .where((TpShellDestination d) => d.isPrimary && d.isAnchored)
      .toList();
  final List<TpShellDestination> candidates = accessible
      .where((TpShellDestination d) => d.isPrimary && !d.isAnchored)
      .toList();

  // Anchors are placed first so they can never be squeezed out, then the
  // remaining slots are filled in declaration order, which is the priority
  // order.
  final int remaining = maxTabs - anchors.length;
  final int slotsForCandidates = remaining <= 0
      ? 0
      : (remaining > candidates.length ? candidates.length : remaining);
  final Set<String> chosen = <String>{
    ...anchors.map((TpShellDestination d) => d.routeId),
    ...candidates
        .take(slotsForCandidates)
        .map((TpShellDestination d) => d.routeId),
  };

  final List<TpShellDestination> visible = accessible
      .where((TpShellDestination d) => chosen.contains(d.routeId))
      .toList()
    ..sort(
      (TpShellDestination a, TpShellDestination b) =>
          a.branchIndex.compareTo(b.branchIndex),
    );

  final List<TpShellDestination> overflow = accessible
      .where((TpShellDestination d) => !chosen.contains(d.routeId))
      .toList();

  return TpShellTabLayout(visible: visible, overflow: overflow);
}

/// Guarantees the branch the user is actually IN appears on the bar.
///
/// Without this, standing in a branch that did not fit the cap leaves the bar
/// highlighting a destination the user is not on - a small lie that is worse
/// than a missing highlight, because it tells them they are somewhere else.
///
/// The cap is respected: the active destination REPLACES the last non-anchored
/// entry rather than being appended, and the displaced one moves to the
/// overflow so the Home hub still lists it.
TpShellTabLayout ensureActiveBranchVisible(
  TpShellTabLayout layout,
  int activeBranchIndex, {
  int maxTabs = kMaxPrimaryTabs,
}) {
  final bool alreadyVisible = layout.visible
      .any((TpShellDestination d) => d.branchIndex == activeBranchIndex);
  if (alreadyVisible) return layout;

  final Iterable<TpShellDestination> matches = layout.overflow
      .where((TpShellDestination d) => d.branchIndex == activeBranchIndex);
  // The branch is not accessible at all. Leave the bar alone rather than
  // promoting a destination the user may not open.
  if (matches.isEmpty) return layout;
  final TpShellDestination active = matches.first;

  final List<TpShellDestination> visible =
      List<TpShellDestination>.of(layout.visible);
  final List<TpShellDestination> overflow =
      List<TpShellDestination>.of(layout.overflow)
        ..removeWhere((TpShellDestination d) => d.routeId == active.routeId);

  final int replaceAt =
      visible.lastIndexWhere((TpShellDestination d) => !d.isAnchored);

  if (visible.length >= maxTabs && replaceAt >= 0) {
    overflow.add(visible[replaceAt]);
    visible[replaceAt] = active;
  } else {
    visible.add(active);
  }

  visible.sort(
    (TpShellDestination a, TpShellDestination b) =>
        a.branchIndex.compareTo(b.branchIndex),
  );

  return TpShellTabLayout(visible: visible, overflow: overflow);
}
