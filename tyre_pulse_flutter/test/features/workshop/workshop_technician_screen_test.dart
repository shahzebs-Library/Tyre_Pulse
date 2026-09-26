import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/app/localization/tp_localizations.dart';
import 'package:tyre_pulse/app/theme/tp_theme.dart';
import 'package:tyre_pulse/core/permissions/access_resolver.dart';
import 'package:tyre_pulse/core/permissions/roles.dart';
import 'package:tyre_pulse/core/workspace/workspace_context.dart';
import 'package:tyre_pulse/core/workspace/workspace_providers.dart';
import 'package:tyre_pulse/core/workspace/workspace_scope.dart';
import 'package:tyre_pulse/features/workshop/data/workshop_repository.dart';
import 'package:tyre_pulse/features/workshop/presentation/workshop_screen.dart';
import 'package:tyre_pulse/features/workshop/presentation/workshop_technician_screen.dart';
import 'package:tyre_pulse/features/workshop/workshop_providers.dart';

const WorkspaceContext _tyreMan = WorkspaceContext(
  userId: 'tech-1',
  role: UserRole.known(RoleId.tyreMan),
  effectivePermissions: AccessState(role: UserRole.known(RoleId.tyreMan)),
  countryScope: CountryScope.none,
  siteScope: SiteScope.none,
  fullName: 'Ijaz Ali',
);

final class _FakeRepo implements WorkshopRepository {
  final List<RecordWorkshopEventInput> recorded = <RecordWorkshopEventInput>[];

  @override
  Future<List<WorkshopJob>> listMyJobs(String userId) async =>
      const <WorkshopJob>[
        WorkshopJob(
          id: 'wo-1',
          workOrderNo: 'GCKR/JC/1001/0926',
          assetNo: 'TM514',
          status: 'In Progress',
          site: 'NHC',
        ),
      ];

  @override
  Future<List<WorkshopEventRecord>> listMyRecentEvents(
    String userId, {
    int limit = 200,
  }) async =>
      const <WorkshopEventRecord>[];

  @override
  Future<List<WorkshopTask>> listTasksForJob(String jobId) async =>
      const <WorkshopTask>[];

  @override
  Future<WorkshopEventRecord> recordEvent({
    required WorkspaceContext workspace,
    required RecordWorkshopEventInput input,
  }) async {
    recorded.add(input);
    return WorkshopEventRecord(
      eventType: input.eventType,
      jobId: input.jobId,
      reasonCode: input.reasonCode,
      clientUuid: 'ws_${recorded.length}',
      localAt: DateTime.now(),
    );
  }
}

Future<void> _pump(WidgetTester tester, _FakeRepo repo) async {
  await tester.binding.setSurfaceSize(const Size(390, 1400));
  addTearDown(() => tester.binding.setSurfaceSize(null));
  await tester.pumpWidget(
    ProviderScope(
      overrides: [
        workshopRepositoryProvider.overrideWithValue(repo),
        workspaceContextProvider.overrideWithValue(_tyreMan),
      ],
      child: MaterialApp(
        theme: TpTheme.light,
        locale: const Locale('en'),
        supportedLocales: TpLocalizations.supportedLocales,
        localizationsDelegates: TpLocalizations.delegates,
        home: const WorkshopScreen(),
      ),
    ),
  );
  await tester.pumpAndSettle();
}

void main() {
  testWidgets('a technician lands on My Jobs, not the job-card board', (
    WidgetTester tester,
  ) async {
    await _pump(tester, _FakeRepo());
    expect(find.byType(WorkshopTechnicianScreen), findsOneWidget);
    expect(find.text('GCKR/JC/1001/0926'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('work cannot be recorded before checking in', (
    WidgetTester tester,
  ) async {
    final _FakeRepo repo = _FakeRepo();
    await _pump(tester, repo);
    await tester.tap(find.byKey(WorkshopTechnicianKeys.action('start_job')));
    await tester.pumpAndSettle();
    expect(find.text('Check in first'), findsOneWidget);
    expect(repo.recorded, isEmpty);
  });

  testWidgets('check in, then start the job - two queued events', (
    WidgetTester tester,
  ) async {
    final _FakeRepo repo = _FakeRepo();
    await _pump(tester, repo);
    await tester.tap(find.byKey(WorkshopTechnicianKeys.checkToggle));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(WorkshopTechnicianKeys.action('start_job')));
    await tester.pumpAndSettle();
    expect(
      repo.recorded.map((RecordWorkshopEventInput e) => e.eventType),
      <String>['check_in', 'start_job'],
    );
    expect(repo.recorded.last.jobId, 'wo-1');
    expect(repo.recorded.last.assetNo, 'TM514');
    expect(find.text('Working'), findsOneWidget);
  });

  test('only field trades get the technician screen', () {
    expect(isWorkshopTechnician(_tyreMan), isTrue);
    expect(isWorkshopTechnician(null), isFalse);
  });
}
