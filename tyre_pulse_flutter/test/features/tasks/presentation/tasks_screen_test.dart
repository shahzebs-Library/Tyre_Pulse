import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/app/router/routes.dart';
import 'package:tyre_pulse/core/design_system/design_system.dart';
import 'package:tyre_pulse/core/permissions/access_resolver.dart';
import 'package:tyre_pulse/core/permissions/roles.dart';
import 'package:tyre_pulse/features/checklists/data/checklist_draft_repository.dart';
import 'package:tyre_pulse/features/checklists/data/checklist_remote_models.dart';
import 'package:tyre_pulse/features/checklists/domain/checklist_field.dart';
import 'package:tyre_pulse/features/checklists/domain/checklist_template.dart';
import 'package:tyre_pulse/features/my_work/data/my_work_loader.dart';
import 'package:tyre_pulse/features/my_work/presentation/my_work_widgets.dart';
import 'package:tyre_pulse/features/tasks/data/task_item.dart';
import 'package:tyre_pulse/features/tasks/presentation/tasks_screen.dart';
import 'package:tyre_pulse/features/workshop/data/workshop_repository.dart';

import '../../my_work/my_work_test_support.dart';

const TasksScreen _screen = TasksScreen(route: TasksRoute());

MyWorkGateway _gateway({
  bool failTasks = false,
  bool bilingual = false,
}) =>
    MyWorkGateway(
      checklists: () async => MyWorkChecklistData(
        assignments: const <ChecklistAssignmentRecord>[
          ChecklistAssignmentRecord(
            id: 'wash',
            templateId: 't-wash',
            templateName: 'Vehicle washing verification',
            assetNo: 'TM-118',
            site: 'Al Quoz Yard',
            dueDate: '2026-08-26',
          ),
          ChecklistAssignmentRecord(
            id: 'odo',
            templateId: 't-odo',
            templateName: 'Record odometer and hours',
            assetNo: 'BUS-062',
            site: 'Al Quoz Yard',
            dueDate: '2026-08-28',
          ),
          ChecklistAssignmentRecord(
            id: 'later',
            templateId: 't-odo',
            templateName: 'Weekly generator checklist',
            assetNo: 'GEN-021',
            dueDate: '2026-08-30',
          ),
          ChecklistAssignmentRecord(
            id: 'done',
            templateId: 't-odo',
            templateName: 'Finished checklist',
            dueDate: '2026-08-27',
            status: 'completed',
          ),
        ],
        templates: <ChecklistTemplateRecord>[
          ChecklistTemplateRecord(
            template: ChecklistTemplate(
              id: 't-wash',
              fields: <ChecklistField>[
                ChecklistField(
                  id: 'f',
                  type: 'text',
                  label: 'Clean',
                  labels: bilingual
                      ? const <String, String>{'ar': 'نظيف'}
                      : const <String, String>{},
                ),
              ],
            ),
          ),
        ],
      ),
      drafts: () async => <ChecklistDraftHeader>[
        ChecklistDraftHeader(
          draftKey: 'draft-1',
          templateId: 't-daily',
          templateName: 'Daily plant and vehicle checklist',
          templateVersion: 1,
          assetNo: 'CP-045',
          filled: 8,
          total: 18,
          updatedAt: DateTime(2026, 8, 28, 9),
        ),
      ],
      workOrders: () async => const <WorkshopJob>[
        WorkshopJob(
          id: 'wo-1',
          workOrderNo: 'WO-2026-1184',
          assetNo: 'WL-027',
          priority: 'High',
        ),
      ],
      correctiveActions: failTasks
          ? () => Future<List<TaskItem>>.error(Exception('offline'))
          : () async => const <TaskItem>[],
      checklistApprovals: () async => const MyWorkQueueCount(2),
      inspectionApprovals: () async => const MyWorkQueueCount(5),
    );

void main() {
  testWidgets('Assigned tab groups real work in the mock order', (
    WidgetTester tester,
  ) async {
    await pumpMyWork(tester, _screen, gateway: _gateway());

    expect(find.text('My tasks'), findsOneWidget);
    expect(find.byKey(TasksScreenKeys.reportIssue), findsOneWidget);
    expect(find.byKey(TasksScreenKeys.stats), findsOneWidget);
    expect(find.text('Synced'), findsOneWidget);

    double y(String text) => tester.getTopLeft(find.text(text).first).dy;
    expect(y('Overdue'), lessThan(y('Vehicle washing verification')));
    expect(
      y('Vehicle washing verification'),
      lessThan(y('Daily plant and vehicle checklist')),
    );
    expect(
      y('Daily plant and vehicle checklist'),
      lessThan(y('Record odometer and hours')),
    );
    expect(y('Record odometer and hours'), lessThan(y('Work orders')));
    expect(find.textContaining('WO-2026-1184'), findsOneWidget);

    // Date-only due: late by days, and no invented clock time.
    expect(find.text('Overdue by'), findsOneWidget);
    expect(find.text('2 days'), findsOneWidget);
    expect(find.text('8/18 answered'), findsOneWidget);
    expect(find.text('Draft saved'), findsOneWidget);

    // Upcoming work is collapsed behind "Coming up".
    expect(find.text('Weekly generator checklist'), findsNothing);
    await tester.tap(find.byKey(TasksScreenKeys.comingUp));
    await tester.pumpAndSettle();
    expect(find.text('Weekly generator checklist'), findsOneWidget);

    // Approval queues carry the real counts.
    expect(find.byKey(MyWorkKeys.approvals), findsOneWidget);
    expect(find.text('2'), findsWidgets);
    expect(find.byKey(TasksScreenKeys.history), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('Completed tab shows completed work only', (
    WidgetTester tester,
  ) async {
    await pumpMyWork(tester, _screen, gateway: _gateway());
    await tester.tap(find.byKey(TasksScreenKeys.completedTab));
    await tester.pumpAndSettle();
    expect(find.text('Finished checklist'), findsOneWidget);
    expect(find.text('Record odometer and hours'), findsNothing);
  });

  testWidgets('search narrows the list by asset', (WidgetTester tester) async {
    await pumpMyWork(tester, _screen, gateway: _gateway());
    await tester.tap(find.byKey(TasksScreenKeys.searchToggle));
    await tester.pumpAndSettle();
    await tester.enterText(find.byKey(TasksScreenKeys.searchField), 'BUS-06');
    await tester.pumpAndSettle();
    expect(find.text('Record odometer and hours'), findsOneWidget);
    expect(find.text('Vehicle washing verification'), findsNothing);
  });

  testWidgets('a failed source is named, the rest still shown', (
    WidgetTester tester,
  ) async {
    await pumpMyWork(tester, _screen, gateway: _gateway(failTasks: true));
    expect(find.byKey(MyWorkKeys.partial), findsOneWidget);
    expect(find.textContaining('corrective actions'), findsOneWidget);
    expect(find.text('Record odometer and hours'), findsOneWidget);
  });

  testWidgets('every source failing renders a retryable error state', (
    WidgetTester tester,
  ) async {
    await pumpMyWork(
      tester,
      _screen,
      gateway: MyWorkGateway(
        correctiveActions: () =>
            Future<List<TaskItem>>.error(Exception('offline')),
      ),
    );
    expect(find.byKey(TpStateKeys.error), findsOneWidget);
  });

  testWidgets('language selector only appears when content carries it', (
    WidgetTester tester,
  ) async {
    await pumpMyWork(tester, _screen, gateway: _gateway());
    expect(find.byKey(MyWorkKeys.language), findsNothing);

    await pumpMyWork(tester, _screen, gateway: _gateway(bilingual: true));
    expect(find.byKey(MyWorkKeys.language), findsOneWidget);
    expect(find.byKey(MyWorkKeys.languageOption('ar')), findsOneWidget);
    expect(find.byKey(MyWorkKeys.languageOption('hi')), findsNothing);
  });

  testWidgets('nothing assigned is an honest empty state, not an error', (
    WidgetTester tester,
  ) async {
    await pumpMyWork(
      tester,
      _screen,
      gateway: MyWorkGateway(
        correctiveActions: () async => const <TaskItem>[],
      ),
    );
    expect(find.byKey(TpStateKeys.empty), findsOneWidget);
    expect(find.text('Nothing assigned'), findsOneWidget);
  });

  testWidgets('a role without approvals sees no approval queue', (
    WidgetTester tester,
  ) async {
    await pumpMyWork(
      tester,
      _screen,
      access: const AccessState(role: UserRole.known(RoleId.reporter)),
      gateway: MyWorkGateway(
        correctiveActions: () async => const <TaskItem>[],
      ),
    );
    expect(find.byKey(MyWorkKeys.approvals), findsNothing);
  });

  testWidgets('Arabic renders right to left', (WidgetTester tester) async {
    await pumpMyWork(
      tester,
      _screen,
      gateway: _gateway(),
      locale: const Locale('ar'),
    );
    expect(find.text('مهامي'), findsOneWidget);
    expect(
      Directionality.of(tester.element(find.text('مهامي'))),
      TextDirection.rtl,
    );
    expect(tester.takeException(), isNull);
  });

  testWidgets('compact phone layout does not overflow', (
    WidgetTester tester,
  ) async {
    await pumpMyWork(tester, _screen, gateway: _gateway());
    tester.view.physicalSize = const Size(390, 844);
    await tester.pumpAndSettle();
    expect(tester.takeException(), isNull);
    await expectLater(
      find.byType(MaterialApp),
      matchesGoldenFile('goldens/tasks_compact_en.png'),
    );
  });
}
