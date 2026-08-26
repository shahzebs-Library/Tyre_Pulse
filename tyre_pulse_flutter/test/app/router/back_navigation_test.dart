/// Back navigation.
///
/// Repository rule 15 and spec section 5. The rule under test is the one three
/// earlier fixes in the production app missed: a Back control can never be a
/// dead press.
library;

import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/app/router/back_navigation.dart';
import 'package:tyre_pulse/app/router/routes.dart';

/// A router that records what was asked of it.
class FakeBackRouter implements TpBackRouter {
  FakeBackRouter({this.hasHistory = false, this.throwsOnCanPop = false});

  final bool throwsOnCanPop;
  bool hasHistory;

  int popCount = 0;
  final List<String> goCalls = <String>[];

  @override
  bool canPop() {
    if (throwsOnCanPop) throw StateError('no navigator');
    return hasHistory;
  }

  @override
  void pop() => popCount++;

  @override
  void go(String location) => goCalls.add(location);
}

void main() {
  group('backTo', () {
    test('pops when there is history', () {
      final FakeBackRouter router = FakeBackRouter(hasHistory: true);

      expect(backTo(router), BackOutcome.popped);
      expect(router.popCount, 1);
      expect(router.goCalls, isEmpty);
    });

    test('uses the fallback when there is no history', () {
      // This is the case a bare pop cannot handle: a deep link, a notification
      // tap, a cold start straight into a route. The production defect was that
      // nothing at all happened.
      final FakeBackRouter router = FakeBackRouter();

      expect(
        backTo(router, fallback: TpRoutePaths.activityHistory),
        BackOutcome.replaced,
      );
      expect(router.popCount, 0);
      expect(router.goCalls, <String>[TpRoutePaths.activityHistory]);
    });

    test('never does nothing', () {
      // The property that matters, stated directly: for every router shape,
      // either something was called or the outcome says nothing could be.
      for (final FakeBackRouter router in <FakeBackRouter>[
        FakeBackRouter(hasHistory: true),
        FakeBackRouter(),
        FakeBackRouter(throwsOnCanPop: true),
      ]) {
        final BackOutcome outcome = backTo(router);
        expect(outcome, isNot(BackOutcome.unavailable));
        expect(router.popCount + router.goCalls.length, 1);
      }
    });

    test('a router that cannot report history is treated as having none', () {
      final FakeBackRouter router = FakeBackRouter(throwsOnCanPop: true);

      expect(backTo(router), BackOutcome.replaced);
      expect(router.goCalls, <String>[TpRoutePaths.home]);
    });

    test('a blank fallback degrades to Home rather than navigating nowhere',
        () {
      final FakeBackRouter router = FakeBackRouter();

      expect(backTo(router, fallback: '   '), BackOutcome.replaced);
      expect(router.goCalls, <String>[TpRoutePaths.home]);
    });

    test('no router at all reports unavailable and calls nothing', () {
      expect(backTo(null), BackOutcome.unavailable);
    });

    test('the fallback is trimmed before it is used', () {
      final FakeBackRouter router = FakeBackRouter();

      backTo(router, fallback: '  /checklists  ');
      expect(router.goCalls, <String>[TpRoutePaths.checklists]);
    });
  });

  group('fallback table', () {
    test('an inspection detail falls back to History, not to a list', () {
      // History is the only screen that opens an inspection detail, so it is
      // the only honest parent. Recorded as a product decision in artifact 03.
      expect(
        TpBackFallbacks.forRoute(
          const InspectionDetailRoute(inspectionId: InspectionId('i-1')),
        ),
        TpRoutePaths.activityHistory,
      );
    });

    test('an accident case falls back to ITS OWN accident', () {
      expect(
        TpBackFallbacks.forRoute(
          const AccidentCaseRoute(accidentId: AccidentId('acc-9')),
        ),
        '/accidents/acc-9',
      );
    });

    test('an accident case with no id degrades to the register', () {
      // The production fallback is a ternary and the production test checks
      // both branches. So does this one.
      expect(
        TpBackFallbacks.forRoute(
          const AccidentCaseRoute(accidentId: AccidentId('')),
        ),
        TpRoutePaths.accidentDashboard,
      );
    });

    test('an admin sub page falls back to the admin console', () {
      for (final TpRoute route in <TpRoute>[
        const AdminUsersRoute(),
        const AdminAccessRoute(),
        const AdminApprovalsRoute(),
        const AdminSitesRoute(),
        const AdminAiChatRoute(),
      ]) {
        expect(TpBackFallbacks.forRoute(route), TpRoutePaths.adminConsole);
      }
    });

    test('an approval review falls back to its own queue', () {
      expect(
        TpBackFallbacks.forRoute(
          const InspectionApprovalReviewRoute(
            inspectionId: InspectionId('i-1'),
          ),
        ),
        TpRoutePaths.inspectionApprovals,
      );
      expect(
        TpBackFallbacks.forRoute(
          const ChecklistApprovalReviewRoute(
            submissionId: SubmissionId('s-1'),
          ),
        ),
        TpRoutePaths.checklistApprovals,
      );
    });

    test('a work order detail falls back to the work order list', () {
      expect(
        TpBackFallbacks.forRoute(
          const WorkOrderDetailRoute(workOrderId: WorkOrderId('wo-1')),
        ),
        TpRoutePaths.workOrders,
      );
    });

    test('anything unlisted falls back to Home', () {
      expect(TpBackFallbacks.forRoute(const StockCountRoute()),
          TpRoutePaths.home);
    });

    test('every fallback resolves to a real route path', () {
      // A fallback pointing at a folder with no index screen does not error in
      // the production app - it silently lands on the not-found screen. The
      // production suite resolves every fallback against the real route table
      // for exactly that reason.
      const Set<String> realPaths = <String>{
        TpRoutePaths.home,
        TpRoutePaths.checklists,
        TpRoutePaths.checklistApprovals,
        TpRoutePaths.activityHistory,
        TpRoutePaths.inspectionApprovals,
        TpRoutePaths.accidentDashboard,
        TpRoutePaths.workOrders,
        TpRoutePaths.adminConsole,
      };

      for (final String fallback in TpBackFallbacks.byRouteId.values) {
        expect(
          realPaths.contains(fallback),
          isTrue,
          reason: 'Fallback "$fallback" is not a route in the table.',
        );
      }
    });
  });
}
