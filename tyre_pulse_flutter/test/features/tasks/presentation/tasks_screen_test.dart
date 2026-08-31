library;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_riverpod/misc.dart' show Override;
import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/app/localization/tp_localizations.dart';
import 'package:tyre_pulse/app/router/routes.dart';
import 'package:tyre_pulse/app/theme/tp_theme.dart';
import 'package:tyre_pulse/core/design_system/design_system.dart';
import 'package:tyre_pulse/core/workspace/workspace_providers.dart';
import 'package:tyre_pulse/features/tasks/data/task_item.dart';
import 'package:tyre_pulse/features/tasks/data/tasks_repository.dart';
import 'package:tyre_pulse/features/tasks/presentation/tasks_screen.dart';
import 'package:tyre_pulse/features/tasks/tasks_providers.dart';

final class _FakeTasksRepository implements TasksRepository {
  _FakeTasksRepository(this.items);

  final List<TaskItem> items;
  int calls = 0;
  String? lastCountry;

  @override
  Future<List<TaskItem>> listRecent({String? country, int limit = 200}) async {
    calls += 1;
    lastCountry = country;
    return items;
  }
}

final class _FailingTasksRepository implements TasksRepository {
  @override
  Future<List<TaskItem>> listRecent({String? country, int limit = 200}) =>
      Future<List<TaskItem>>.error(Exception('network unavailable'));
}

Future<void> _pump(
  WidgetTester tester,
  TasksRepository repository, {
  Locale locale = const Locale('en'),
  List<Override> extraOverrides = const <Override>[],
}) async {
  await tester.pumpWidget(
    ProviderScope(
      overrides: <Override>[
        tasksRepositoryProvider.overrideWithValue(repository),
        activeCountryProvider.overrideWithValue('KSA'),
        ...extraOverrides,
      ],
      child: MaterialApp(
        debugShowCheckedModeBanner: false,
        theme: TpTheme.light,
        locale: locale,
        supportedLocales: TpLocalizations.supportedLocales,
        localizationsDelegates: TpLocalizations.delegates,
        home: const TasksScreen(route: TasksRoute()),
      ),
    ),
  );
  await tester.pumpAndSettle();
}

void main() {
  testWidgets('matches the compact My Work mock with tabs before the board', (
    WidgetTester tester,
  ) async {
    tester.view.physicalSize = const Size(390, 844);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    final _FakeTasksRepository repository = _FakeTasksRepository(
      const <TaskItem>[
        TaskItem(
          id: 'urgent',
          title: 'Breakdown',
          priority: 'High',
          status: 'Open',
          assetNo: 'Mixer 4271',
          site: 'Qiddiya G2',
          description: 'Engine overheating',
        ),
        TaskItem(
          id: 'progress',
          title: 'Hydraulic leakage',
          priority: 'Medium',
          status: 'In Progress',
          assetNo: 'Pump 2104',
        ),
      ],
    );

    await _pump(tester, repository);

    expect(find.text('My Work'), findsOneWidget);
    expect(find.byKey(TasksScreenKeys.board), findsOneWidget);
    expect(find.byKey(TasksScreenKeys.todayTab), findsOneWidget);
    expect(find.byKey(TasksScreenKeys.inProgressTab), findsOneWidget);
    expect(find.byKey(TasksScreenKeys.completedTab), findsOneWidget);
    expect(find.text('URGENT'), findsOneWidget);
    expect(find.text('IN PROGRESS'), findsNWidgets(2));
    expect(find.byKey(TasksScreenKeys.task('urgent')), findsOneWidget);
    expect(
      tester.getTopLeft(find.byKey(TasksScreenKeys.todayTab)).dy,
      lessThan(tester.getTopLeft(find.byKey(TasksScreenKeys.board)).dy),
    );
    expect(
      tester.getTopLeft(find.text('Breakdown')).dy,
      lessThan(tester.getTopLeft(find.text('Mixer 4271')).dy),
    );
    expect(tester.takeException(), isNull);
    await expectLater(
      find.byType(MaterialApp),
      matchesGoldenFile('goldens/tasks_compact_en.png'),
    );
    expect(repository.lastCountry, 'KSA');
  });

  testWidgets('Completed tab contains closed work and no open work', (
    WidgetTester tester,
  ) async {
    final _FakeTasksRepository repository = _FakeTasksRepository(
      const <TaskItem>[
        TaskItem(id: 'open', title: 'Open task', status: 'Open'),
        TaskItem(id: 'closed', title: 'Closed task', status: 'Closed'),
      ],
    );
    await _pump(tester, repository);

    await tester.tap(find.byKey(TasksScreenKeys.completedTab));
    await tester.pumpAndSettle();

    expect(find.byKey(TasksScreenKeys.task('closed')), findsOneWidget);
    expect(find.byKey(TasksScreenKeys.task('open')), findsNothing);
  });

  testWidgets('empty data renders the design-system empty state', (
    WidgetTester tester,
  ) async {
    await _pump(tester, _FakeTasksRepository(const <TaskItem>[]));
    expect(find.byKey(TpStateKeys.empty), findsOneWidget);
    expect(find.text('No tasks'), findsOneWidget);
  });

  testWidgets('a read failure renders a retryable error state', (
    WidgetTester tester,
  ) async {
    await _pump(tester, _FailingTasksRepository());
    expect(find.byKey(TpStateKeys.error), findsOneWidget);
    expect(find.text('My work could not be loaded right now.'), findsOneWidget);
  });

  testWidgets('pull-to-refresh requests fresh corrective actions', (
    WidgetTester tester,
  ) async {
    final _FakeTasksRepository repository = _FakeTasksRepository(
      const <TaskItem>[
        TaskItem(id: 'open', title: 'Open task', status: 'Open'),
      ],
    );
    await _pump(tester, repository);
    expect(repository.calls, 1);

    await tester.fling(find.byType(ListView), const Offset(0, 400), 1000);
    await tester.pumpAndSettle();

    expect(repository.calls, 2);
  });

  testWidgets('Arabic catalog renders in an RTL direction', (
    WidgetTester tester,
  ) async {
    await _pump(
      tester,
      _FakeTasksRepository(const <TaskItem>[]),
      locale: const Locale('ar'),
    );
    expect(find.text('عملي'), findsOneWidget);
    expect(
      Directionality.of(tester.element(find.text('عملي'))),
      TextDirection.rtl,
    );
  });
}
