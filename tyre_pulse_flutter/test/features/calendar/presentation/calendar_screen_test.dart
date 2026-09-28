import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/app/router/routes.dart';
import 'package:tyre_pulse/core/design_system/design_system.dart';
import 'package:tyre_pulse/features/calendar/presentation/calendar_screen.dart';
import 'package:tyre_pulse/features/checklists/data/checklist_remote_models.dart';
import 'package:tyre_pulse/features/inspections/domain/inspection_plan.dart';
import 'package:tyre_pulse/features/my_work/data/my_work_loader.dart';
import 'package:tyre_pulse/features/my_work/presentation/my_work_widgets.dart';

import '../../my_work/my_work_test_support.dart';

const CalendarScreen _screen = CalendarScreen(route: CalendarRoute());

MyWorkGateway _gateway({bool cappedPlans = false}) => MyWorkGateway(
      checklists: () async => const MyWorkChecklistData(
        assignments: <ChecklistAssignmentRecord>[
          ChecklistAssignmentRecord(
            id: 'late',
            templateId: 't',
            templateName: 'Vehicle washing verification',
            assetNo: 'TM-118',
            site: 'Al Quoz Yard',
            dueDate: '2026-08-27',
          ),
          ChecklistAssignmentRecord(
            id: 'tomorrow',
            templateId: 't',
            templateName: 'Weekly generator checklist',
            assetNo: 'GEN-021',
            site: 'Jebel Ali',
            dueDate: '2026-08-29',
          ),
          ChecklistAssignmentRecord(
            id: 'done',
            templateId: 't',
            templateName: 'Odometer reading',
            assetNo: 'BUS-062',
            site: 'Al Quoz Yard',
            dueDate: '2026-08-28',
            status: 'completed',
          ),
        ],
      ),
      inspectionPlans: () async => MyWorkPage<InspectionPlan>(
        <InspectionPlan>[
          InspectionPlan(
            id: 'p1',
            assetNo: 'PUMP-014',
            site: 'Al Quoz Yard',
            scheduledDate: DateTime.utc(2026, 8, 28),
            state: InspectionPlanState.due,
            inspectionTime: '13:00',
          ),
        ],
        truncated: cappedPlans,
      ),
      checklistApprovals: () async => const MyWorkQueueCount(2),
      inspectionApprovals: () async => const MyWorkQueueCount(5),
    );

void main() {
  testWidgets('today shows due, completed and carried overdue work', (
    WidgetTester tester,
  ) async {
    await pumpMyWork(tester, _screen, gateway: _gateway());

    expect(find.text("Today's field plan"), findsOneWidget);
    expect(find.text('Field Operator'), findsOneWidget);
    expect(
      find.byKey(CalendarScreenKeys.item('checklist:late')),
      findsOneWidget,
    );
    expect(
      find.byKey(CalendarScreenKeys.item('checklist:done')),
      findsOneWidget,
    );
    expect(find.byKey(CalendarScreenKeys.item('plan:p1')), findsOneWidget);
    expect(
      find.byKey(CalendarScreenKeys.item('checklist:tomorrow')),
      findsNothing,
    );
    // Only the plan carries a real time.
    expect(find.text('1:00 PM'), findsOneWidget);
    expect(find.text('Start inspection'), findsOneWidget);
    expect(find.byKey(MyWorkKeys.approvals), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('a capped plan read says plans may be missing', (
    WidgetTester tester,
  ) async {
    await pumpMyWork(tester, _screen, gateway: _gateway(cappedPlans: true));
    expect(find.byKey(MyWorkKeys.partial), findsOneWidget);
    expect(find.byKey(MyWorkKeys.incomplete), findsOneWidget);
    expect(find.textContaining('inspection plans'), findsOneWidget);
    // The plans that did load are still shown.
    expect(find.byKey(CalendarScreenKeys.item('plan:p1')), findsOneWidget);
  });

  testWidgets('an uncapped plan read shows no partial banner', (
    WidgetTester tester,
  ) async {
    await pumpMyWork(tester, _screen, gateway: _gateway());
    expect(find.byKey(MyWorkKeys.partial), findsNothing);
  });

  testWidgets('the day strip moves to tomorrow', (WidgetTester tester) async {
    await pumpMyWork(tester, _screen, gateway: _gateway());
    await tester.tap(find.byKey(CalendarScreenKeys.day(1)));
    await tester.pumpAndSettle();
    expect(
      find.byKey(CalendarScreenKeys.item('checklist:tomorrow')),
      findsOneWidget,
    );
    expect(find.byKey(CalendarScreenKeys.item('checklist:late')), findsNothing);
  });

  testWidgets('the site filter narrows the day', (WidgetTester tester) async {
    await pumpMyWork(tester, _screen, gateway: _gateway());
    await tester.tap(find.byKey(CalendarScreenKeys.site));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Jebel Ali').last);
    await tester.pumpAndSettle();
    expect(find.byKey(CalendarScreenKeys.item('plan:p1')), findsNothing);
    expect(find.byKey(TpStateKeys.empty), findsOneWidget);
  });

  testWidgets('a failed load renders a retryable error state', (
    WidgetTester tester,
  ) async {
    await pumpMyWork(
      tester,
      _screen,
      gateway: MyWorkGateway(
        inspectionPlans: () =>
            Future<MyWorkPage<InspectionPlan>>.error(Exception('offline')),
      ),
    );
    expect(find.byKey(TpStateKeys.error), findsOneWidget);
  });
}
