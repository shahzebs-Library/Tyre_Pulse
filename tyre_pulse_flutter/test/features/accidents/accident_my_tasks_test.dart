import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/app/localization/tp_localizations.dart';
import 'package:tyre_pulse/app/router/notification_routing.dart';
import 'package:tyre_pulse/app/router/routes.dart';
import 'package:tyre_pulse/app/theme/tp_theme.dart';
import 'package:tyre_pulse/core/push/push_message.dart';
import 'package:tyre_pulse/features/accidents/accidents_providers.dart';
import 'package:tyre_pulse/features/accidents/data/accident_tasks_repository.dart';
import 'package:tyre_pulse/features/accidents/presentation/accident_my_tasks_screen.dart';

AccidentTask _task(
  String id, {
  bool mine = true,
  bool overdue = false,
  String sla = 'none',
  num days = 1,
}) =>
    AccidentTask.fromRow(<String, dynamic>{
      'workstream_id': id,
      'accident_id': '00000000-0000-0000-0000-0000000000$id',
      'workstream_key': 'repair',
      'workstream_name': 'Repair',
      'reference_no': 'ACC-$id',
      'asset_no': 'TM$id',
      'site': 'NHC',
      'assigned_to_me': mine,
      'overdue': overdue,
      'sla_state': sla,
      'days_in_step': days,
      'owner_role': 'PMV Manager',
    });

void main() {
  test('tasks sort overdue first, then by SLA state and age', () {
    final List<AccidentTask> sorted = sortAccidentTasks(<AccidentTask>[
      _task('01', days: 9),
      _task('02', overdue: true, sla: 'breached'),
      _task('03', sla: 'warning'),
    ]);
    expect(
      sorted.map((AccidentTask t) => t.workstreamId).toList(),
      <String>['02', '03', '01'],
    );
  });

  test('a step notice opens the case workstream, the digest the task list', () {
    expect(
      notificationDestination(
        const TpNotificationTarget(
          type: 'accident.sla_breach',
          entityType: 'accident',
          entityId: 'abc',
          workstreamKey: 'repair',
        ),
      ),
      isA<AccidentCaseRoute>(),
    );
    expect(
      notificationDestination(
        const TpNotificationTarget(
          type: 'accident.stage_changed',
          entityType: 'accident',
          entityId: 'abc',
        ),
      ),
      isA<AccidentDetailRoute>(),
    );
    expect(
      const PushMessage(
        data: <String, String>{
          'type': 'accident.task_digest',
          'entity_type': 'accident_tasks',
        },
      ).destination,
      isA<AccidentTasksRoute>(),
    );
    expect(
      const PushMessage(
        data: <String, String>{
          'type': 'accident.workstream_assigned',
          'entity_type': 'accident',
          'entity_id': 'abc',
          'workstream_key': 'assessment',
        },
      ).destination,
      isA<AccidentCaseRoute>(),
    );
  });

  Widget host(AccidentTasksResult result,
          {Locale locale = const Locale('en')}) =>
      ProviderScope(
        overrides: [
          accidentMyTasksProvider.overrideWith((Ref ref) async => result),
        ],
        child: MaterialApp(
          locale: locale,
          theme: TpTheme.light,
          localizationsDelegates: TpLocalizations.delegates,
          supportedLocales: TpLocalizations.supportedLocales,
          home: const AccidentMyTasksScreen(route: AccidentTasksRoute()),
        ),
      );

  testWidgets('lists assigned-to-me and team steps with SLA badges',
      (WidgetTester tester) async {
    await tester.pumpWidget(
      host(
        AccidentTasksResult(
          available: true,
          tasks: sortAccidentTasks(<AccidentTask>[
            _task('01', sla: 'running'),
            _task('02', overdue: true, sla: 'breached'),
            _task('03', mine: false),
          ]),
        ),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.text('Assigned to me (2)'), findsOneWidget);
    expect(find.text('For my team (1)'), findsOneWidget);
    expect(find.text('OVERDUE'), findsOneWidget);
    expect(find.text('NO TARGET'), findsOneWidget);
    expect(find.text('3 open, 1 overdue'), findsOneWidget);
  });

  testWidgets('says plainly when tracking is not switched on',
      (WidgetTester tester) async {
    await tester.pumpWidget(
      host(
          const AccidentTasksResult(tasks: <AccidentTask>[], available: false)),
    );
    await tester.pumpAndSettle();
    expect(
      find.text('Accident task tracking is not switched on yet.'),
      findsOneWidget,
    );
  });

  testWidgets('renders in Arabic', (WidgetTester tester) async {
    await tester.pumpWidget(
      host(
        AccidentTasksResult(
            available: true, tasks: <AccidentTask>[_task('01')]),
        locale: const Locale('ar'),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.text('مهام الحوادث الخاصة بي'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });
}
