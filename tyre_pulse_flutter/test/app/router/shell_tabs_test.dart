/// The bottom bar.
///
/// Artifact 03 section 2.3 measured the production bar rendering SIX primary
/// tabs for four roles while the design says five, because nobody bounded it.
/// It also names the incident that makes the OVERFLOW half matter: a duplicate
/// declaration hid the Vehicle Washing tab, the screen was reachable only by
/// scrolling the Home hub, and no wash was ever logged.
///
/// So there are two properties here, and the second is the important one:
/// the bar is capped, and nothing that is capped out disappears.
library;

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/app/localization/tp_localizations.dart';
import 'package:tyre_pulse/app/router/route_access.dart';
import 'package:tyre_pulse/app/router/shell_tabs.dart';

TpShellDestination destination({
  required int index,
  required String routeId,
  required RouteGuard guard,
  bool isPrimary = true,
  bool isAnchored = false,
}) {
  return TpShellDestination(
    branchIndex: index,
    routeId: routeId,
    location: '/$routeId',
    guard: guard,
    icon: Icons.circle,
    label: (AppLocalizations l10n) => routeId,
    isPrimary: isPrimary,
    isAnchored: isAnchored,
  );
}

/// Allows a fixed set of modules and nothing else.
bool Function(RouteGuard) allowing(Set<RouteModule> modules) {
  return (RouteGuard guard) => switch (guard) {
        AuthenticatedOnly() => true,
        PublicRoute() => true,
        ModuleGuarded(module: final RouteModule module) =>
          modules.contains(module),
        AdminOnly() => false,
        SuperAdminOnly() => false,
      };
}

void main() {
  group('the real shell', () {
    test('branch indexes are contiguous and match list order', () {
      // `goBranch` takes this index, so a gap or a reorder silently sends the
      // user to a different tab from the one they pressed.
      for (int i = 0; i < TpShell.destinations.length; i++) {
        expect(TpShell.destinations[i].branchIndex, i);
      }
    });

    test('every branch route id is unique', () {
      final List<String> ids =
          TpShell.destinations.map((TpShellDestination d) => d.routeId).toList();
      expect(ids.toSet().length, ids.length);
    });

    test('Home and Profile are the anchored destinations', () {
      final Set<String> anchored = TpShell.destinations
          .where((TpShellDestination d) => d.isAnchored)
          .map((TpShellDestination d) => d.routeId)
          .toSet();
      expect(anchored, <String>{'home', 'profile'});
    });

    test('an administrator gets a bar of exactly five', () {
      final TpShellTabLayout layout = resolveShellTabs(
        destinations: TpShell.destinations,
        canAccess: (RouteGuard _) => true,
      );
      expect(layout.visible.length, kMaxPrimaryTabs);
      // Everything that did not fit is still reachable from the Home hub.
      expect(layout.overflow, isNotEmpty);
    });

    test('a driver gets Home, Meter, Washing and Profile', () {
      final TpShellTabLayout layout = resolveShellTabs(
        destinations: TpShell.destinations,
        canAccess: allowing(<RouteModule>{RouteModule.meter, RouteModule.washing}),
      );
      expect(
        layout.visible.map((TpShellDestination d) => d.routeId).toList(),
        <String>['home', 'meterLog', 'washing', 'profile'],
      );
    });

    test('an approver with no other module still reaches the queue', () {
      // The tyre_data_collector case. It holds the approvals module, so it can
      // clear a queue, but in production reaches it only by scrolling Home.
      // Spec section 10 lists Approvals as a primary destination.
      final TpShellTabLayout layout = resolveShellTabs(
        destinations: TpShell.destinations,
        canAccess: allowing(<RouteModule>{RouteModule.approvals}),
      );
      expect(
        layout.visible.map((TpShellDestination d) => d.routeId).toList(),
        <String>['home', 'inspectionApprovals', 'profile'],
      );
    });
  });

  group('resolveShellTabs', () {
    final List<TpShellDestination> destinations = <TpShellDestination>[
      destination(
        index: 0,
        routeId: 'home',
        guard: const AuthenticatedOnly(),
        isAnchored: true,
      ),
      destination(
        index: 1,
        routeId: 'a',
        guard: const ModuleGuarded(RouteModule.inspect),
      ),
      destination(
        index: 2,
        routeId: 'b',
        guard: const ModuleGuarded(RouteModule.approvals),
      ),
      destination(
        index: 3,
        routeId: 'c',
        guard: const ModuleGuarded(RouteModule.accidents),
      ),
      destination(
        index: 4,
        routeId: 'd',
        guard: const ModuleGuarded(RouteModule.meter),
      ),
      destination(
        index: 5,
        routeId: 'nonPrimary',
        guard: const ModuleGuarded(RouteModule.history),
        isPrimary: false,
      ),
      destination(
        index: 6,
        routeId: 'profile',
        guard: const AuthenticatedOnly(),
        isAnchored: true,
      ),
    ];

    test('never exceeds the cap', () {
      final TpShellTabLayout layout = resolveShellTabs(
        destinations: destinations,
        canAccess: (RouteGuard _) => true,
      );
      expect(layout.visible.length, lessThanOrEqualTo(kMaxPrimaryTabs));
    });

    test('anchors are never squeezed out by the cap', () {
      final TpShellTabLayout layout = resolveShellTabs(
        destinations: destinations,
        canAccess: (RouteGuard _) => true,
      );
      final Set<String> visible =
          layout.visible.map((TpShellDestination d) => d.routeId).toSet();
      expect(visible.contains('home'), isTrue);
      expect(visible.contains('profile'), isTrue);
    });

    test('nothing accessible is ever lost - it moves to overflow', () {
      final TpShellTabLayout layout = resolveShellTabs(
        destinations: destinations,
        canAccess: (RouteGuard _) => true,
      );
      final Set<String> everywhere = <String>{
        ...layout.visible.map((TpShellDestination d) => d.routeId),
        ...layout.overflow.map((TpShellDestination d) => d.routeId),
      };
      expect(
        everywhere,
        destinations.map((TpShellDestination d) => d.routeId).toSet(),
      );
    });

    test('a non-primary branch is never on the bar', () {
      final TpShellTabLayout layout = resolveShellTabs(
        destinations: destinations,
        canAccess: (RouteGuard _) => true,
      );
      expect(
        layout.visible.any((TpShellDestination d) => d.routeId == 'nonPrimary'),
        isFalse,
      );
      expect(
        layout.overflow
            .any((TpShellDestination d) => d.routeId == 'nonPrimary'),
        isTrue,
      );
    });

    test('an inaccessible destination appears in neither list', () {
      final TpShellTabLayout layout = resolveShellTabs(
        destinations: destinations,
        canAccess: allowing(<RouteModule>{RouteModule.inspect}),
      );
      final Set<String> everywhere = <String>{
        ...layout.visible.map((TpShellDestination d) => d.routeId),
        ...layout.overflow.map((TpShellDestination d) => d.routeId),
      };
      expect(everywhere, <String>{'home', 'a', 'profile'});
    });

    test('the bar is ordered by branch index, not by priority', () {
      final TpShellTabLayout layout = resolveShellTabs(
        destinations: destinations,
        canAccess: (RouteGuard _) => true,
      );
      final List<int> indexes =
          layout.visible.map((TpShellDestination d) => d.branchIndex).toList();
      final List<int> sorted = List<int>.of(indexes)..sort();
      expect(indexes, sorted);
    });
  });

  group('ensureActiveBranchVisible', () {
    final List<TpShellDestination> destinations = <TpShellDestination>[
      destination(
        index: 0,
        routeId: 'home',
        guard: const AuthenticatedOnly(),
        isAnchored: true,
      ),
      destination(
        index: 1,
        routeId: 'a',
        guard: const ModuleGuarded(RouteModule.inspect),
      ),
      destination(
        index: 2,
        routeId: 'b',
        guard: const ModuleGuarded(RouteModule.approvals),
      ),
      destination(
        index: 3,
        routeId: 'c',
        guard: const ModuleGuarded(RouteModule.accidents),
      ),
      destination(
        index: 4,
        routeId: 'd',
        guard: const ModuleGuarded(RouteModule.meter),
      ),
      destination(
        index: 5,
        routeId: 'profile',
        guard: const AuthenticatedOnly(),
        isAnchored: true,
      ),
    ];

    test('promotes the branch the user is actually in', () {
      final TpShellTabLayout base = resolveShellTabs(
        destinations: destinations,
        canAccess: (RouteGuard _) => true,
      );
      // Branch 4 did not fit the cap.
      expect(
        base.visible.any((TpShellDestination d) => d.branchIndex == 4),
        isFalse,
      );

      final TpShellTabLayout promoted = ensureActiveBranchVisible(base, 4);
      expect(
        promoted.visible.any((TpShellDestination d) => d.branchIndex == 4),
        isTrue,
      );
      expect(promoted.visible.length, lessThanOrEqualTo(kMaxPrimaryTabs));
    });

    test('the displaced destination moves to overflow, it is not lost', () {
      final TpShellTabLayout base = resolveShellTabs(
        destinations: destinations,
        canAccess: (RouteGuard _) => true,
      );
      final TpShellTabLayout promoted = ensureActiveBranchVisible(base, 4);

      final Set<String> before = <String>{
        ...base.visible.map((TpShellDestination d) => d.routeId),
        ...base.overflow.map((TpShellDestination d) => d.routeId),
      };
      final Set<String> after = <String>{
        ...promoted.visible.map((TpShellDestination d) => d.routeId),
        ...promoted.overflow.map((TpShellDestination d) => d.routeId),
      };
      expect(after, before);
    });

    test('an anchor is never the one displaced', () {
      final TpShellTabLayout base = resolveShellTabs(
        destinations: destinations,
        canAccess: (RouteGuard _) => true,
      );
      final TpShellTabLayout promoted = ensureActiveBranchVisible(base, 4);
      final Set<String> visible =
          promoted.visible.map((TpShellDestination d) => d.routeId).toSet();
      expect(visible.contains('home'), isTrue);
      expect(visible.contains('profile'), isTrue);
    });

    test('leaves the bar alone when the branch is already visible', () {
      final TpShellTabLayout base = resolveShellTabs(
        destinations: destinations,
        canAccess: (RouteGuard _) => true,
      );
      expect(identical(ensureActiveBranchVisible(base, 0), base), isTrue);
    });

    test('leaves the bar alone when the branch is not accessible', () {
      final TpShellTabLayout base = resolveShellTabs(
        destinations: destinations,
        canAccess: allowing(<RouteModule>{RouteModule.inspect}),
      );
      // Branch 4 is not accessible, so it must not be promoted onto the bar.
      final TpShellTabLayout promoted = ensureActiveBranchVisible(base, 4);
      expect(
        promoted.visible.any((TpShellDestination d) => d.branchIndex == 4),
        isFalse,
      );
    });
  });
}
