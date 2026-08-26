/// Route round-trips.
///
/// Spec section 41: the Kotlin rebuild routed on `jobId` while the ViewModel
/// read `workOrderId`, and it crashed. These tests assert the two halves agree
/// - that a route builds a location under the CANONICAL parameter name, and
/// that parsing that name gives the value back.
///
/// The canonical names are asserted LITERALLY on purpose. A test that reads the
/// name from the same constant the code writes it with would pass through a
/// rename and prove nothing.
library;

import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/app/router/routes.dart';

TpRouteParameters params({
  Map<String, String> path = const <String, String>{},
  Map<String, String> query = const <String, String>{},
}) {
  return TpRouteParameters(path: path, query: query);
}

/// Pulls the query values back out of a built location, so a round-trip test
/// exercises the real string rather than a hand-written map.
Map<String, String> queryOf(String location) =>
    Uri.parse(location).queryParameters;

void main() {
  group('canonical parameter names', () {
    test('an asset number is always assetNo, never asset or asset_no', () {
      const AssetNo asset = AssetNo('TM514');

      expect(
        const NewInspectionRoute(assetNo: asset).location,
        contains('assetNo=TM514'),
      );
      expect(
        const MeterLogRoute(assetNo: asset).location,
        contains('assetNo=TM514'),
      );
      expect(
        const TyreChangeRoute(assetNo: asset).location,
        contains('assetNo=TM514'),
      );
      expect(
        const RcaRoute(assetNo: asset).location,
        contains('assetNo=TM514'),
      );
      expect(
        const ReportIssueRoute(assetNo: asset).location,
        contains('assetNo=TM514'),
      );
      expect(
        const RepairRequestRoute(assetNo: asset).location,
        contains('assetNo=TM514'),
      );
      expect(
        const VehiclesRoute(assetNo: asset).location,
        contains('assetNo=TM514'),
      );
      expect(
        const ChecklistFillRoute(
          templateId: TemplateId('t1'),
          assetNo: asset,
        ).location,
        contains('assetNo=TM514'),
      );

      // The Expo spellings must be gone entirely.
      for (final TpRoute route in <TpRoute>[
        const NewInspectionRoute(assetNo: asset),
        const MeterLogRoute(assetNo: asset),
        const VehiclesRoute(assetNo: asset),
        const ChecklistFillRoute(templateId: TemplateId('t1'), assetNo: asset),
      ]) {
        expect(route.location, isNot(contains('asset=')));
        expect(route.location, isNot(contains('asset_no=')));
        expect(route.location, isNot(contains('q=')));
      }
    });

    test('a tyre position is always tyrePosition, never position', () {
      const TyrePosition position = TyrePosition('LHF1');

      expect(
        const NewInspectionRoute(tyrePosition: position).location,
        contains('tyrePosition=LHF1'),
      );
      final String tyreChange = const TyreChangeRoute(tyrePosition: position)
          .location;
      expect(tyreChange, contains('tyrePosition=LHF1'));
      // `position=` on its own would match `tyrePosition=` as a substring, so
      // the assertion is on the separator.
      expect(tyreChange, isNot(contains('?position=')));
      expect(tyreChange, isNot(contains('&position=')));
    });

    test('a tyre serial is always tyreSerial, never serial or q', () {
      const TyreSerial serial = TyreSerial('EP0604207');

      for (final TpRoute route in <TpRoute>[
        const NewInspectionRoute(tyreSerial: serial),
        const RcaRoute(tyreSerial: serial),
        const ReportIssueRoute(tyreSerial: serial),
        const SerialSearchRoute(tyreSerial: serial),
      ]) {
        expect(route.location, contains('tyreSerial=EP0604207'));
        expect(route.location, isNot(contains('?serial=')));
        expect(route.location, isNot(contains('&serial=')));
        expect(route.location, isNot(contains('q=')));
      }
    });

    test('a checklist draft key is draftKey, never resume', () {
      const ChecklistFillRoute route = ChecklistFillRoute(
        templateId: TemplateId('t1'),
        draftKey: DraftKey('u1:t1:TM514'),
      );
      expect(route.location, contains('draftKey='));
      expect(route.location, isNot(contains('resume=')));
    });

    test('a checklist assignment is assignmentId, never assignment', () {
      const ChecklistFillRoute route = ChecklistFillRoute(
        templateId: TemplateId('t1'),
        assignmentId: AssignmentId('a1'),
      );
      expect(route.location, contains('assignmentId=a1'));
      expect(route.location, isNot(contains('?assignment=')));
      expect(route.location, isNot(contains('&assignment=')));
    });

    test('an accident id is a path segment on BOTH accident routes', () {
      const AccidentId id = AccidentId('acc-1');
      expect(
        const AccidentDetailRoute(accidentId: id).location,
        '/accidents/acc-1',
      );
      // In production this one is `?id=`. Here it is a path segment, and it is
      // nested under the accident so Back returns to the accident.
      expect(
        const AccidentCaseRoute(accidentId: id).location,
        '/accidents/acc-1/case',
      );
      expect(
        const AccidentCaseRoute(accidentId: id).location,
        isNot(contains('id=')),
      );
    });

    test('a work order id is workOrderId, never jobId', () {
      const WorkOrderDetailRoute route = WorkOrderDetailRoute(
        workOrderId: WorkOrderId('wo-1'),
      );
      expect(route.location, '/work-orders/wo-1');
      expect(
        WorkOrderDetailRoute.parse(
          params(path: <String, String>{'workOrderId': 'wo-1'}),
        ),
        route,
      );
    });
  });

  group('round trips', () {
    test('path parameters survive build then parse', () {
      const AccidentId accident = AccidentId('a-1');
      expect(
        AccidentDetailRoute.parse(
          params(path: <String, String>{'accidentId': accident.value}),
        ),
        const AccidentDetailRoute(accidentId: accident),
      );
      expect(
        AccidentCaseRoute.parse(
          params(path: <String, String>{'accidentId': accident.value}),
        ),
        const AccidentCaseRoute(accidentId: accident),
      );
      expect(
        InspectionDetailRoute.parse(
          params(path: <String, String>{'inspectionId': 'i-1'}),
        ),
        const InspectionDetailRoute(inspectionId: InspectionId('i-1')),
      );
      expect(
        InspectionApprovalReviewRoute.parse(
          params(path: <String, String>{'inspectionId': 'i-1'}),
        ),
        const InspectionApprovalReviewRoute(inspectionId: InspectionId('i-1')),
      );
      expect(
        ChecklistApprovalReviewRoute.parse(
          params(path: <String, String>{'submissionId': 's-1'}),
        ),
        const ChecklistApprovalReviewRoute(submissionId: SubmissionId('s-1')),
      );
    });

    test('query parameters survive build then parse, through the URL', () {
      const NewInspectionRoute original = NewInspectionRoute(
        siteName: SiteName('NHC'),
        assetNo: AssetNo('TM514'),
        tyreSerial: TyreSerial('EP0604207'),
        tyrePosition: TyrePosition('LHF1'),
      );

      final NewInspectionRoute parsed = NewInspectionRoute.parse(
        params(query: queryOf(original.location)),
      );

      expect(parsed, original);
      expect(parsed.siteName, const SiteName('NHC'));
      expect(parsed.assetNo, const AssetNo('TM514'));
      expect(parsed.tyreSerial, const TyreSerial('EP0604207'));
      expect(parsed.tyrePosition, const TyrePosition('LHF1'));
    });

    test('a mixed path and query route survives the round trip', () {
      const ChecklistFillRoute original = ChecklistFillRoute(
        templateId: TemplateId('tpl-1'),
        assignmentId: AssignmentId('asg-1'),
        siteName: SiteName('DIRIYAH-G1'),
        assetNo: AssetNo('MP093'),
        draftKey: DraftKey('u1:tpl-1:MP093'),
      );

      final ChecklistFillRoute parsed = ChecklistFillRoute.parse(
        params(
          path: <String, String>{'templateId': 'tpl-1'},
          query: queryOf(original.location),
        ),
      );

      expect(parsed, original);
      expect(parsed.draftKey, const DraftKey('u1:tpl-1:MP093'));
    });

    test('values needing encoding survive the round trip', () {
      // A site name with a space is real - "RED SEA" is a live site.
      const MeterLogRoute original = MeterLogRoute(
        assetNo: AssetNo('TM 514'),
        siteName: SiteName('RED SEA'),
      );
      final MeterLogRoute parsed = MeterLogRoute.parse(
        params(query: queryOf(original.location)),
      );
      expect(parsed, original);
      expect(parsed.siteName, const SiteName('RED SEA'));
    });

    test('an id needing encoding survives as a path segment', () {
      const WorkOrderDetailRoute original = WorkOrderDetailRoute(
        workOrderId: WorkOrderId('GCKR/JC/1005/0826'),
      );
      // The slashes must be encoded or they would create extra segments.
      expect(original.location, isNot('/work-orders/GCKR/JC/1005/0826'));
      expect(original.location, contains('%2F'));
      // The router decodes path parameters before handing them over.
      expect(
        WorkOrderDetailRoute.parse(
          params(path: <String, String>{'workOrderId': 'GCKR/JC/1005/0826'}),
        ),
        original,
      );
    });
  });

  group('parameter handling', () {
    test('an omitted optional parameter leaves the location bare', () {
      expect(const NewInspectionRoute().location, '/inspect/new');
      expect(const VehiclesRoute().location, '/vehicles');
      expect(const SerialSearchRoute().location, '/serial-search');
    });

    test('a blank query value is treated as absent, not as a value', () {
      final VehiclesRoute parsed = VehiclesRoute.parse(
        params(query: <String, String>{'assetNo': '   '}),
      );
      expect(parsed.assetNo, isNull);
      expect(parsed.location, '/vehicles');
    });

    test('a missing required path parameter fails loudly', () {
      // A matched route cannot be missing a segment of its own template, so an
      // absence here means the template and the route class have drifted -
      // which is precisely the spec section 41 defect.
      expect(
        () => AccidentDetailRoute.parse(params()),
        throwsA(isA<StateError>()),
      );
    });
  });

  group('identifier types', () {
    test('two identifiers of different types are never equal', () {
      expect(const AccidentId('x') == const InspectionId('x'), isFalse);
      expect(const AssetNo('x') == const TyreSerial('x'), isFalse);
      expect(const SubmissionId('x') == const TemplateId('x'), isFalse);
    });

    test('the same identifier type compares by value', () {
      expect(const AccidentId('x'), const AccidentId('x'));
      expect(const AccidentId('x'), isNot(const AccidentId('y')));
      expect(const AccidentId('x').hashCode, const AccidentId('x').hashCode);
    });

    test('routes of different types are never equal', () {
      expect(
        const InspectionDetailRoute(inspectionId: InspectionId('1')) ==
            const InspectionApprovalReviewRoute(
              inspectionId: InspectionId('1'),
            ),
        isFalse,
      );
    });
  });

  group('route identity', () {
    test('every route id is unique', () {
      final List<String> ids = <String>[
        TpRouteId.boot,
        TpRouteId.login,
        TpRouteId.register,
        TpRouteId.home,
        TpRouteId.notifications,
        TpRouteId.scanner,
        TpRouteId.serialSearch,
        TpRouteId.tyreRecords,
        TpRouteId.vehicles,
        TpRouteId.alerts,
        TpRouteId.calendar,
        TpRouteId.overview,
        TpRouteId.reports,
        TpRouteId.analytics,
        TpRouteId.fleetAi,
        TpRouteId.team,
        TpRouteId.tyreChange,
        TpRouteId.reportIssue,
        TpRouteId.repairRequest,
        TpRouteId.rca,
        TpRouteId.stockCount,
        TpRouteId.tasks,
        TpRouteId.preventiveMaintenance,
        TpRouteId.workOrders,
        TpRouteId.workOrderDetail,
        TpRouteId.workshop,
        TpRouteId.adminConsole,
        TpRouteId.adminUsers,
        TpRouteId.adminAccess,
        TpRouteId.adminApprovals,
        TpRouteId.adminSites,
        TpRouteId.adminAiChat,
        TpRouteId.newInspection,
        TpRouteId.accidentDashboard,
        TpRouteId.accidentReport,
        TpRouteId.accidentDetail,
        TpRouteId.accidentCase,
        TpRouteId.meterLog,
        TpRouteId.washing,
        TpRouteId.profile,
        TpRouteId.activityHistory,
        TpRouteId.inspectionDetail,
        TpRouteId.checklists,
        TpRouteId.checklistHistory,
        TpRouteId.checklistFill,
        TpRouteId.inspectionApprovals,
        TpRouteId.inspectionApprovalReview,
        TpRouteId.checklistApprovals,
        TpRouteId.checklistApprovalReview,
      ];
      expect(ids.toSet().length, ids.length);
      // 49 addressable routes: the 48 ported from the Expo app, minus the
      // duplicate work order list that is deliberately not ported, plus the
      // work order detail that is new surface.
      expect(ids.length, 49);
    });
  });
}
