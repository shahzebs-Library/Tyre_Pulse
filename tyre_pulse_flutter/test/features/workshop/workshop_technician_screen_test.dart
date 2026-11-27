import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:signature/signature.dart';
import 'package:tyre_pulse/app/localization/tp_localizations.dart';
import 'package:tyre_pulse/app/theme/tp_theme.dart';
import 'package:tyre_pulse/core/permissions/access_resolver.dart';
import 'package:tyre_pulse/core/permissions/roles.dart';
import 'package:tyre_pulse/core/workspace/workspace_context.dart';
import 'package:tyre_pulse/core/workspace/workspace_providers.dart';
import 'package:tyre_pulse/core/workspace/workspace_scope.dart';
import 'package:tyre_pulse/features/workshop/data/workshop_completion_service.dart';
import 'package:tyre_pulse/features/workshop/data/workshop_offline.dart';
import 'package:tyre_pulse/features/workshop/data/workshop_photo_capture.dart';
import 'package:tyre_pulse/features/workshop/data/workshop_photo_uploader.dart';
import 'package:tyre_pulse/features/workshop/data/workshop_repository.dart';
import 'package:tyre_pulse/features/workshop/domain/workshop_completion.dart';
import 'package:tyre_pulse/features/workshop/domain/workshop_evidence.dart';
import 'package:tyre_pulse/features/workshop/presentation/workshop_completion_sheet.dart';
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
  _FakeRepo({this.online = true, this.status = 'In Progress', this.qc});

  final bool online;
  final String status;
  final String? qc;
  final List<RecordWorkshopEventInput> recorded = <RecordWorkshopEventInput>[];

  @override
  Future<List<WorkshopJob>> listMyJobs(String userId) async {
    if (!online) throw StateError('offline');
    return <WorkshopJob>[
      WorkshopJob(
        id: 'wo-1',
        workOrderNo: 'GCKR/JC/1001/0926',
        assetNo: 'TM514',
        status: status,
        qcStatus: qc,
        site: 'NHC',
      ),
    ];
  }

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

final class _MemoryCache implements WorkshopOfflineCache {
  WorkshopOfflineSnapshot? snapshot;
  int saves = 0;

  @override
  Duration get maxAge => const Duration(days: 7);

  @override
  Future<void> save({
    required String userId,
    required List<WorkshopJob> jobs,
    required List<WorkshopEventRecord> events,
  }) async {
    saves++;
    snapshot = WorkshopOfflineSnapshot(
      jobs: jobs,
      events: events,
      cachedAt: DateTime.now(),
    );
  }

  @override
  Future<WorkshopOfflineSnapshot?> load(String userId) async => snapshot;

  @override
  Future<void> clear() async => snapshot = null;
}

final class _FakeCompletion implements WorkshopCompletionService {
  final List<WorkshopCompletionDraft> submitted = <WorkshopCompletionDraft>[];
  final List<String> workDone = <String>[];

  @override
  Future<List<WorkshopPartUsed>> jobPartsRequests(String jobId) async =>
      const <WorkshopPartUsed>[];

  @override
  Future<WorkshopAssetMeters> assetMeters(String? assetNo) async =>
      WorkshopAssetMeters.unknown;

  @override
  Future<String> submit({
    required WorkspaceContext workspace,
    required WorkshopJob job,
    required WorkshopCompletionDraft draft,
    required String workDone,
    String? taskId,
  }) async {
    submitted.add(draft);
    this.workDone.add(workDone);
    return 'jobdone_1';
  }
}

final class _FakeParts implements WorkshopPartsRequester {
  _FakeParts({this.online = true});

  final bool online;
  final List<WorkshopPartsRequestInput> sent = <WorkshopPartsRequestInput>[];

  @override
  Future<void> request(WorkshopPartsRequestInput input) async {
    if (!online) throw StateError('offline');
    sent.add(input);
  }
}

Future<void> _pump(
  WidgetTester tester,
  _FakeRepo repo, {
  WorkshopPhotoPicker? picker,
  WorkshopPhotoUploader? uploader,
  WorkshopLocator? locator,
  _MemoryCache? cache,
  _FakeParts? parts,
  _FakeCompletion? completion,
  List<WorkshopEventRecord> pending = const <WorkshopEventRecord>[],
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
        workshopOfflineCacheProvider.overrideWithValue(cache ?? _MemoryCache()),
        workshopPartsRequesterProvider.overrideWithValue(parts ?? _FakeParts()),
        workshopPendingEventsProvider
            .overrideWithValue((String userId) async => pending),
        workshopCompletionServiceProvider
            .overrideWithValue(completion ?? _FakeCompletion()),
        workshopPendingCompletionsProvider.overrideWithValue(
          (String userId) async => const <String, WorkshopPendingCompletion>{},
        ),
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
    if (find.byKey(WorkshopTechnicianKeys.action(action)).evaluate().isEmpty) {
      await tester.ensureVisible(find.byKey(WorkshopTechnicianKeys.moreToggle));
      await tester.tap(find.byKey(WorkshopTechnicianKeys.moreToggle));
      await tester.pumpAndSettle();
    }
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

  testWidgets('only state-valid actions: Start first, then Pause / Finish', (
    WidgetTester tester,
  ) async {
    final _FakeRepo repo = _FakeRepo();
    await _pump(tester, repo);
    expect(
      find.byKey(WorkshopTechnicianKeys.action('start_job')),
      findsOneWidget,
    );
    expect(
      find.byKey(WorkshopTechnicianKeys.action('pause_job')),
      findsNothing,
    );
    expect(
      find.byKey(WorkshopTechnicianKeys.action('resume_job')),
      findsNothing,
    );
    await tester.tap(find.byKey(WorkshopTechnicianKeys.checkToggle));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(WorkshopTechnicianKeys.action('start_job')));
    await tester.pumpAndSettle();
    expect(
      find.byKey(WorkshopTechnicianKeys.action('start_job')),
      findsNothing,
    );
    expect(
      find.byKey(WorkshopTechnicianKeys.action('pause_job')),
      findsOneWidget,
    );
    expect(
      find.byKey(WorkshopTechnicianKeys.action('complete_task')),
      findsOneWidget,
    );
  });

  testWidgets('Pause asks why and records the reason', (
    WidgetTester tester,
  ) async {
    final _FakeRepo repo = _FakeRepo();
    await _pump(tester, repo);
    await tester.tap(find.byKey(WorkshopTechnicianKeys.checkToggle));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(WorkshopTechnicianKeys.action('start_job')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(WorkshopTechnicianKeys.action('pause_job')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(WorkshopTechnicianKeys.pauseReason('vehicle')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(WorkshopTechnicianKeys.pauseSubmit));
    await tester.pumpAndSettle();

    final RecordWorkshopEventInput e = repo.recorded.last;
    expect(e.eventType, 'pause_job');
    expect(e.reasonCode, 'vehicle');
    expect(find.text('Waiting for Vehicle'), findsOneWidget);
    expect(
      find.byKey(WorkshopTechnicianKeys.action('resume_job')),
      findsOneWidget,
    );
  });

  testWidgets('opened offline: cached jobs + unsynced taps, no error page', (
    WidgetTester tester,
  ) async {
    final _MemoryCache cache = _MemoryCache()
      ..snapshot = WorkshopOfflineSnapshot(
        jobs: const <WorkshopJob>[
          WorkshopJob(id: 'wo-9', workOrderNo: 'GCKR/JC/0009', assetNo: 'TM9'),
        ],
        events: <WorkshopEventRecord>[
          WorkshopEventRecord(
            eventType: 'check_in',
            at: DateTime.now().subtract(const Duration(hours: 1)),
          ),
        ],
        cachedAt: DateTime.now().subtract(const Duration(hours: 1)),
      );
    await _pump(
      tester,
      _FakeRepo(online: false),
      cache: cache,
      pending: <WorkshopEventRecord>[
        WorkshopEventRecord(
          eventType: 'start_job',
          jobId: 'wo-9',
          clientUuid: 'ws_pending',
          localAt: DateTime.now().subtract(const Duration(minutes: 5)),
        ),
      ],
    );
    expect(find.byKey(WorkshopTechnicianKeys.offlineBanner), findsOneWidget);
    expect(find.text('GCKR/JC/0009'), findsOneWidget);
    expect(find.text('Working'), findsOneWidget);
  });

  testWidgets('a live load is cached for next time', (
    WidgetTester tester,
  ) async {
    final _MemoryCache cache = _MemoryCache();
    await _pump(tester, _FakeRepo(), cache: cache);
    expect(cache.saves, 1);
    expect(cache.snapshot?.jobs.single.id, 'wo-1');
    expect(find.byKey(WorkshopTechnicianKeys.offlineBanner), findsNothing);
  });

  testWidgets('Request Parts also files a parts request', (
    WidgetTester tester,
  ) async {
    final _FakeRepo repo = _FakeRepo();
    final _FakeParts parts = _FakeParts();
    await _pump(tester, repo, parts: parts);
    await checkInAndOpen(tester, 'request_parts');
    await tester.enterText(
      find.byKey(WorkshopTechnicianKeys.partName),
      'Brake pad set',
    );
    await tester.enterText(find.byKey(WorkshopTechnicianKeys.partQty), '2');
    await tester.tap(find.byKey(WorkshopTechnicianKeys.noteSubmit));
    await tester.pumpAndSettle();

    expect(repo.recorded.last.eventType, 'request_parts');
    expect(parts.sent.single.partName, 'Brake pad set');
    expect(parts.sent.single.qty, 2);
    expect(parts.sent.single.jobId, 'wo-1');
    expect(parts.sent.single.requestedBy, 'tech-1');
  });

  testWidgets('a parts request that cannot be sent is said out loud', (
    WidgetTester tester,
  ) async {
    final _FakeRepo repo = _FakeRepo();
    await _pump(tester, repo, parts: _FakeParts(online: false));
    await checkInAndOpen(tester, 'request_parts');
    await tester.enterText(
      find.byKey(WorkshopTechnicianKeys.partName),
      'Air filter',
    );
    await tester.tap(find.byKey(WorkshopTechnicianKeys.noteSubmit));
    await tester.pumpAndSettle();
    expect(repo.recorded.last.eventType, 'request_parts');
    // SnackBars queue: wait until this one reaches the screen.
    bool seen = false;
    for (int i = 0; i < 10 && !seen; i++) {
      seen = find
          .textContaining('the parts request could not be sent')
          .evaluate()
          .isNotEmpty;
      await tester.pump(const Duration(seconds: 2));
      await tester.pumpAndSettle();
    }
    expect(seen, isTrue);
  });

  testWidgets('a job with the supervisor waits: chip, no work actions', (
    WidgetTester tester,
  ) async {
    await _pump(tester, _FakeRepo(status: 'Quality Inspection', qc: 'pending'));
    expect(find.byKey(WorkshopTechnicianKeys.awaitingApproval), findsOneWidget);
    expect(find.text('Waiting for supervisor approval'), findsOneWidget);
    expect(
      find.byKey(WorkshopTechnicianKeys.action('start_job')),
      findsNothing,
    );
  });

  testWidgets('a returned job says so and can be started again', (
    WidgetTester tester,
  ) async {
    await _pump(tester, _FakeRepo(qc: 'failed'));
    expect(find.text('Returned by supervisor'), findsOneWidget);
    expect(
      find.byKey(WorkshopTechnicianKeys.action('start_job')),
      findsOneWidget,
    );
  });

  Future<void> openCompletion(WidgetTester tester) async {
    await tester.tap(find.byKey(WorkshopTechnicianKeys.checkToggle));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(WorkshopTechnicianKeys.action('start_job')));
    await tester.pumpAndSettle();
    await tester
        .tap(find.byKey(WorkshopTechnicianKeys.action('complete_task')));
    await tester.pumpAndSettle();
  }

  Future<void> fillCompletion(WidgetTester tester) async {
    await tester.enterText(
      find.byKey(WorkshopCompletionKeys.workDone),
      'Replaced hub seal',
    );
    await tester.ensureVisible(find.byKey(WorkshopCompletionKeys.afterCamera));
    await tester.tap(find.byKey(WorkshopCompletionKeys.afterCamera));
    await tester.pumpAndSettle();
    await tester.ensureVisible(find.byType(Signature));
    await tester.drag(find.byType(Signature), const Offset(120, 20));
    await tester.runAsync(
      () => Future<void>.delayed(const Duration(milliseconds: 300)),
    );
    await tester.pumpAndSettle();
  }

  testWidgets('Complete opens the sheet; a full completion goes to approval', (
    WidgetTester tester,
  ) async {
    final _FakeRepo repo = _FakeRepo();
    final _FakeCompletion completion = _FakeCompletion();
    await _pump(tester, repo, completion: completion);
    await openCompletion(tester);
    expect(find.byKey(WorkshopCompletionKeys.sheet), findsOneWidget);
    expect(completion.submitted, isEmpty);

    await fillCompletion(tester);
    expect(find.byKey(WorkshopCompletionKeys.missing), findsNothing);
    await tester.tap(find.byKey(WorkshopCompletionKeys.submit));
    await tester.pumpAndSettle();

    expect(completion.submitted, hasLength(1));
    expect(completion.workDone.single, 'Replaced hub seal');
    expect(
      completion.submitted.single.afterPhotos.single,
      startsWith('tp-storage://'),
    );
    expect(completion.submitted.single.signature, startsWith('data:image/png'));
    expect(repo.recorded.last.eventType, 'complete_task');
    expect(find.text('Waiting for supervisor approval'), findsOneWidget);
    expect(
      find.byKey(WorkshopTechnicianKeys.action('pause_job')),
      findsNothing,
    );
  });

  testWidgets('no signal for the after photo: nothing is sent', (
    WidgetTester tester,
  ) async {
    final _FakeCompletion completion = _FakeCompletion();
    await _pump(
      tester,
      _FakeRepo(),
      completion: completion,
      uploader: _FakeUploader(online: false),
    );
    await openCompletion(tester);
    await fillCompletion(tester);
    await tester.tap(find.byKey(WorkshopCompletionKeys.submit));
    await tester.pumpAndSettle();
    expect(completion.submitted, isEmpty);
    expect(find.byKey(WorkshopTechnicianKeys.awaitingApproval), findsNothing);
  });

  test('only field trades get the technician screen', () {
    expect(isWorkshopTechnician(_tyreMan), isTrue);
    expect(isWorkshopTechnician(null), isFalse);
  });
}
