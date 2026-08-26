/// Notification routing.
///
/// Artifact 03 section 4.2: the evaluation ORDER is load bearing, and each rule
/// is ahead of the next for a stated reason. These tests pin the order, because
/// reordering the rules does not look like a bug - every rule still looks
/// correct on its own.
library;

import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/app/router/notification_routing.dart';
import 'package:tyre_pulse/app/router/routes.dart';

TpRoute? route({String? type, String? entityType, String? entityId}) {
  return notificationDestination(
    TpNotificationTarget(
      type: type,
      entityType: entityType,
      entityId: entityId,
    ),
  );
}

void main() {
  group('local device notifications win on exact type', () {
    test('an inspection reminder opens a NEW inspection', () {
      // The string contains "inspection" and would otherwise fall into the
      // approval queue bucket - somebody else's work.
      expect(route(type: 'inspection_reminder'), const NewInspectionRoute());
    });

    test('sync and photo notifications open Profile', () {
      // Profile carries the offline queue: sync, retry and clear all live
      // there.
      for (final String type in <String>[
        'sync_success',
        'sync_failure',
        'photo_failure',
      ]) {
        expect(route(type: type), const ProfileRoute());
      }
    });

    test('a wash reminder opens washing', () {
      expect(route(type: 'wash_due'), const WashingRoute());
    });
  });

  group('an approval decision goes to your own work', () {
    test('a checklist decision opens the checklist hub', () {
      expect(
        route(type: 'approval_decision', entityType: 'checklist_submission'),
        const ChecklistsRoute(),
      );
    });

    test('any other decision opens your own history', () {
      // Not a generic hub, and not somebody else's queue.
      expect(
        route(type: 'approval_decision', entityType: 'inspection'),
        const ActivityHistoryRoute(),
      );
    });
  });

  group('order between the entity buckets', () {
    test('a checklist assignment is a CHECKLIST, not workshop work', () {
      // The workshop bucket matches "assign", so checklist must be tested
      // first or `checklist_assignment` is swallowed by it.
      expect(
        route(entityType: 'checklist_assignment'),
        const ChecklistApprovalsRoute(),
      );
    });

    test('a quality inspection JOB CARD is workshop work, not a tyre '
        'inspection', () {
      // The workshop bucket is ahead of the inspection bucket for exactly this
      // string.
      expect(route(entityType: 'qc_inspection_job'), const WorkshopRoute());
    });

    test('an inspection approval request goes to the signing queue', () {
      expect(
        route(entityType: 'inspection_approval'),
        const InspectionApprovalsRoute(),
      );
    });
  });

  group('the entity id widens a list into a detail', () {
    test('a work order with an id opens that work order', () {
      expect(
        route(entityType: 'work_order', entityId: 'wo-7'),
        const WorkOrderDetailRoute(workOrderId: WorkOrderId('wo-7')),
      );
    });

    test('a work order with no id opens the board', () {
      expect(route(entityType: 'work_order'), const WorkshopRoute());
    });

    test('a PARTS REQUEST id is not a work order id, so it opens the board',
        () {
      // The conservative half of the widening. A parts request carries a parts
      // request id; routing it to /work-orders/:id would open the wrong record
      // or nothing at all, which is worse than opening the list.
      expect(
        route(entityType: 'parts_request', entityId: 'pr-1'),
        const WorkshopRoute(),
      );
    });

    test('an accident with an id opens that accident', () {
      expect(
        route(entityType: 'accident', entityId: 'acc-3'),
        const AccidentDetailRoute(accidentId: AccidentId('acc-3')),
      );
    });

    test('a CLAIM id is not an accident id, so it opens the register', () {
      expect(
        route(entityType: 'insurance_claim', entityId: 'clm-1'),
        const AccidentDashboardRoute(),
      );
    });

    test('an inspection approval with an id opens that review', () {
      expect(
        route(entityType: 'inspection_approval', entityId: 'i-5'),
        const InspectionApprovalReviewRoute(
          inspectionId: InspectionId('i-5'),
        ),
      );
    });

    test('a checklist approval with an id opens that review', () {
      expect(
        route(entityType: 'checklist_approval', entityId: 's-5'),
        const ChecklistApprovalReviewRoute(
          submissionId: SubmissionId('s-5'),
        ),
      );
    });

    test('a blank entity id is treated as absent', () {
      expect(route(entityType: 'accident', entityId: '   '),
          const AccidentDashboardRoute());
    });
  });

  group('the tap stays put when nothing sensible can be opened', () {
    test('an unknown kind returns null', () {
      // It must never navigate to a location that does not resolve: that is
      // what put the product owner on a raw developer error screen listing
      // every route in the app.
      expect(route(type: 'something_nobody_anticipated'), isNull);
      expect(route(), isNull);
      expect(route(entityType: ''), isNull);
    });

    test('an alert opens alerts', () {
      expect(route(entityType: 'alert'), const AlertsRoute());
    });
  });

  group('matching is case insensitive', () {
    test('an upper case entity type still routes', () {
      expect(route(entityType: 'ACCIDENT'), const AccidentDashboardRoute());
      expect(route(type: 'WASH_DUE'), const WashingRoute());
    });
  });

  group('entity type falls back to type', () {
    test('a row with only a type still routes on the entity rules', () {
      expect(route(type: 'accident_reported'), const AccidentDashboardRoute());
    });
  });

  group('every destination is a real route', () {
    test('nothing routes to a path that does not exist', () {
      // In the production app two computed destinations pointed at DIRECTORIES
      // with no index screen, and a literal grep found nothing because they
      // were computed. This resolves each returned route instead.
      const Set<String> realPaths = <String>{
        TpRoutePaths.newInspection,
        TpRoutePaths.profile,
        TpRoutePaths.washing,
        TpRoutePaths.checklists,
        TpRoutePaths.activityHistory,
        TpRoutePaths.checklistApprovals,
        TpRoutePaths.workshop,
        TpRoutePaths.inspectionApprovals,
        TpRoutePaths.accidentDashboard,
        TpRoutePaths.alerts,
      };

      const List<String> entityTypes = <String>[
        'inspection_reminder',
        'sync_success',
        'wash_due',
        'approval_decision',
        'checklist_assignment',
        'work_order',
        'parts_request',
        'qc',
        'workshop_job',
        'inspection',
        'accident',
        'incident',
        'insurance_claim',
        'alert',
      ];

      for (final String entity in entityTypes) {
        final TpRoute? destination = route(type: entity, entityType: entity);
        if (destination == null) continue;
        final String path = Uri.parse(destination.location).path;
        expect(
          realPaths.contains(path),
          isTrue,
          reason: '"$entity" routes to "$path", which is not a real screen.',
        );
      }
    });
  });
}
