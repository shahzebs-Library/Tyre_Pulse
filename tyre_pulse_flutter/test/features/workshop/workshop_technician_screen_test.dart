import 'dart:async';

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
import 'package:tyre_pulse/features/workshop/data/workshop_photo_capture.dart';
import 'package:tyre_pulse/features/workshop/data/workshop_photo_uploader.dart';
import 'package:tyre_pulse/features/workshop/data/workshop_repository.dart';
import 'package:tyre_pulse/features/workshop/domain/workshop_evidence.dart';
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

final class _FakePicker implements WorkshopPhotoPicker {
  int captured = 0;
  final List<String> discarded = <String>[];

  @override
  Future<String?> capture(WorkshopPhotoSource source) async {
    captured++;
    return '/docs/workshop_photos/p$captured.jpg';
  }

  @override
  Future<void> discard(String localPath) async => discarded.add(localPath);
}

final class _FakeUploader implements WorkshopPhotoUploader {
  _FakeUploader({this.online = true});

  final bool online;

  @override
  Future<String> upload({
    required String localPath,
    required String userId,
    required int index,
  }) async {
    if (!online) throw StateError('offline');
    return 'tp-storage://tyre-photos/modules/workshop/$index.jpg';
  }
}

Future<void> _pump(
  WidgetTester tester,
  _FakeRepo repo, {
  WorkshopPhotoPicker? picker,
  WorkshopPhotoUploader? uploader,
  WorkshopLocator? locator,
}) async {
  await tester.binding.setSurfaceSize(const Size(390, 1400));
  addTearDown(() => tester.binding.setSurfaceSize(null));
  await tester.pumpWidget(
    ProviderScope(
      overrides: [
        workshopRepositoryProvider.overrideWithValue(repo),
        workspaceContextProvider.overrideWithValue(_tyreMan),
        workshopPhotoPickerProvider.overrideWithValue(picker ?? _FakePicker()),
        workshopPhotoUploaderProvider
            .overrideWithValue(uploader ?? _FakeUploader()),
        workshopLocatorProvider.overrideWithValue(locator ?? () async => null),
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

  Future<void> checkInAndOpen(WidgetTester tester, String action) async {
    await tester.tap(find.byKey(WorkshopTechnicianKeys.checkToggle));
    await tester.pumpAndSettle();
    await tester.ensureVisible(
      find.byKey(WorkshopTechnicianKeys.action(action)),
    );
    await tester.tap(find.byKey(WorkshopTechnicianKeys.action(action)));
    await tester.pumpAndSettle();
  }

  testWidgets('Report Problem attaches a photo and the GPS fix', (
    WidgetTester tester,
  ) async {
    final _FakeRepo repo = _FakeRepo();
    final _FakePicker picker = _FakePicker();
    await _pump(
      tester,
      repo,
      picker: picker,
      locator: () async => const WorkshopGpsReading(lat: 24.7, lng: 46.6),
    );
    await checkInAndOpen(tester, 'report_problem');
    await tester.enterText(
      find.byKey(WorkshopTechnicianKeys.noteField),
      'Hub seal torn',
    );
    await tester.tap(find.byKey(WorkshopTechnicianKeys.photoCamera));
    await tester.pumpAndSettle();
    expect(find.byKey(WorkshopTechnicianKeys.photoRemove(0)), findsOneWidget);
    await tester.tap(find.byKey(WorkshopTechnicianKeys.noteSubmit));
    await tester.pumpAndSettle();

    final RecordWorkshopEventInput e = repo.recorded.last;
    expect(e.eventType, 'report_problem');
    expect(e.note, 'Hub seal torn');
    expect(e.photoRefs, <String>[
      'tp-storage://tyre-photos/modules/workshop/0.jpg',
    ]);
    expect(e.gps?.lat, 24.7);
    // Server confirmed the upload, so the local copy is removed.
    expect(picker.discarded, <String>['/docs/workshop_photos/p1.jpg']);
    // The check-in carried the same fix.
    expect(repo.recorded.first.gps?.lng, 46.6);
  });

  testWidgets('offline: the photo is dropped, the event still records', (
    WidgetTester tester,
  ) async {
    final _FakeRepo repo = _FakeRepo();
    final _FakePicker picker = _FakePicker();
    await _pump(
      tester,
      repo,
      picker: picker,
      uploader: _FakeUploader(online: false),
    );
    await checkInAndOpen(tester, 'request_parts');
    await tester.tap(find.byKey(WorkshopTechnicianKeys.photoGallery));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(WorkshopTechnicianKeys.noteSubmit));
    await tester.pumpAndSettle();

    final RecordWorkshopEventInput e = repo.recorded.last;
    expect(e.eventType, 'request_parts');
    expect(e.photoRefs, isEmpty);
    // SnackBars queue: let the check-in confirmation time out first.
    await tester.pump(const Duration(seconds: 5));
    await tester.pumpAndSettle();
    expect(
      find.text(
        'Recorded. The photo could not be attached without a connection.',
      ),
      findsOneWidget,
    );
    // Never delete a photo the server did not confirm.
    expect(picker.discarded, isEmpty);
  });

  testWidgets('photos are offered only on Report Problem / Request Parts', (
    WidgetTester tester,
  ) async {
    await _pump(tester, _FakeRepo());
    await checkInAndOpen(tester, 'request_assistance');
    expect(find.byKey(WorkshopTechnicianKeys.noteField), findsOneWidget);
    expect(find.byKey(WorkshopTechnicianKeys.photoCamera), findsNothing);
  });

  testWidgets('a GPS read that never answers does not block a tap', (
    WidgetTester tester,
  ) async {
    final _FakeRepo repo = _FakeRepo();
    final Completer<WorkshopGpsReading?> never =
        Completer<WorkshopGpsReading?>();
    await _pump(tester, repo, locator: () => never.future);
    await tester.tap(find.byKey(WorkshopTechnicianKeys.checkToggle));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 100));
    expect(repo.recorded.single.eventType, 'check_in');
    expect(repo.recorded.single.gps, isNull);
    // Let the 15 s guard expire so no timer outlives the test.
    await tester.pump(const Duration(seconds: 16));
  });

  test('only field trades get the technician screen', () {
    expect(isWorkshopTechnician(_tyreMan), isTrue);
    expect(isWorkshopTechnician(null), isFalse);
  });
}
