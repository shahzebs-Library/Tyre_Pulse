/// The assignment lane: offline banner, optimistic "Pending sync" status, the
/// mandatory cause and note on a block, a refused update being shown (not
/// dropped) in the reader's language, the asset / tyre / record lines and
/// online-only evidence upload.
library;

import 'dart:io';
import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/app/localization/tp_localizations.dart';
import 'package:tyre_pulse/features/my_work/data/queued_workforce_transition.dart';
import 'package:tyre_pulse/features/my_work/data/workforce_assignment_evidence.dart';
import 'package:tyre_pulse/features/my_work/data/workforce_assignments_repository.dart';
import 'package:tyre_pulse/features/my_work/data/workforce_sync_engine.dart';
import 'package:tyre_pulse/features/my_work/domain/workforce_transition.dart';
import 'package:tyre_pulse/features/my_work/presentation/workforce_assignments_panel.dart';
import 'package:tyre_pulse/features/my_work/workforce_sync_providers.dart';

import '../data/workforce_test_fakes.dart';

const String userA = '11111111-1111-1111-1111-111111111111';

final class FakeEvidenceSource implements WorkforceEvidenceSource {
  FakeEvidenceSource({this.countsResult = const <String, int>{}});

  Map<String, int>? countsResult;
  final List<WorkforceEvidenceFile> uploads = <WorkforceEvidenceFile>[];

  /// Like the real source: every requested id is present (0 when it has no
  /// rows), or the whole answer is null when it could not be read.
  @override
  Future<Map<String, int>?> counts(List<String> assignmentIds) async {
    final Map<String, int>? known = countsResult;
    if (known == null) return null;
    return <String, int>{
      for (final String id in assignmentIds) id: known[id] ?? 0,
    };
  }

  @override
  Future<void> upload(
    WorkforceAssignment assignment,
    WorkforceEvidenceFile file,
  ) async {
    final WorkforceEvidenceProblem? problem = validateWorkforceEvidence(file);
    if (problem != null) throw WorkforceEvidenceException(problem);
    uploads.add(file);
    countsResult = <String, int>{
      ...?countsResult,
      assignment.id: (countsResult?[assignment.id] ?? 0) + 1,
    };
  }
}

final class FakeEvidencePicker implements WorkforceEvidencePicker {
  FakeEvidencePicker(this.file);

  final WorkforceEvidenceFile? file;

  @override
  Future<WorkforceEvidenceFile?> pickPdf() async => file;

  @override
  Future<WorkforceEvidenceFile?> pickPhoto({required bool fromCamera}) async =>
      file;
}

Future<(FakeWorkforceQueue, FakeWorkforceRemote)> pump(
  WidgetTester tester, {
  required String status,
  bool offline = false,
  List<Object>? remoteScript,
  WorkforceAssignment? assignment,
  FakeEvidenceSource? evidence,
  FakeEvidencePicker? picker,
}) async {
  final FakeWorkforceQueue queue = FakeWorkforceQueue();
  final FakeWorkforceRemote remote = FakeWorkforceRemote(remoteScript);
  int n = 0;
  final WorkforceTransitionEngine engine = WorkforceTransitionEngine(
    queue: queue,
    remote: remote,
    newId: () => 'key-${++n}-0000000000',
  );
  await tester.pumpWidget(
    ProviderScope(
      overrides: [
        workforceUserIdProvider.overrideWithValue(userA),
        workforceTransitionEngineProvider.overrideWithValue(engine),
        workforceAssignmentsProvider.overrideWith(
          (Ref ref) async => WorkforceAssignmentSnapshot(
            items: <WorkforceAssignment>[
              assignment ??
                  WorkforceAssignment(
                    id: 'a1',
                    title: 'Replace valve',
                    status: status,
                    priority: 'normal',
                  ),
            ],
            offline: offline,
          ),
        ),
        workforceEvidenceSourceProvider
            .overrideWithValue(evidence ?? FakeEvidenceSource()),
        workforceEvidencePickerProvider
            .overrideWithValue(picker ?? FakeEvidencePicker(null)),
      ],
      child: const MaterialApp(
        supportedLocales: TpLocalizations.supportedLocales,
        localizationsDelegates: TpLocalizations.delegates,
        home: Scaffold(
          body: SingleChildScrollView(child: WorkforceAssignmentsPanel()),
        ),
      ),
    ),
  );
  await tester.pumpAndSettle();
  return (queue, remote);
}

void main() {
  testWidgets('shows the offline banner when assignments are cached',
      (WidgetTester tester) async {
    await pump(tester, status: 'assigned', offline: true);
    expect(find.byKey(WorkforcePanelKeys.offlineBanner), findsOneWidget);
    expect(find.text('Replace valve'), findsOneWidget);
  });

  testWidgets('an offline tap is kept and shown as pending sync',
      (WidgetTester tester) async {
    final (FakeWorkforceQueue queue, FakeWorkforceRemote _) = await pump(
      tester,
      status: 'assigned',
      remoteScript: <Object>[const SocketException('offline')],
    );
    expect(find.byKey(WorkforcePanelKeys.pending('a1')), findsNothing);

    await tester.tap(
      find.byKey(WorkforcePanelKeys.action('a1', WorkforceAction.start)),
    );
    await tester.pumpAndSettle();

    expect(queue.of(userA), hasLength(1));
    expect(find.byKey(WorkforcePanelKeys.pending('a1')), findsOneWidget);
    expect(find.textContaining('In progress'), findsOneWidget);
  });

  testWidgets('blocking asks for a cause and details, and sends both',
      (WidgetTester tester) async {
    final (FakeWorkforceQueue queue, FakeWorkforceRemote remote) =
        await pump(tester, status: 'in_progress');

    await tester.tap(
      find.byKey(WorkforcePanelKeys.action('a1', WorkforceAction.block)),
    );
    await tester.pumpAndSettle();

    FilledButton confirm() => tester.widget<FilledButton>(
          find.byKey(WorkforcePanelKeys.noteConfirm),
        );
    expect(confirm().onPressed, isNull);
    expect(find.byKey(WorkforcePanelKeys.causeRequired), findsOneWidget);
    expect(remote.calls, isEmpty);

    // Details alone are not enough: the cause is mandatory.
    await tester.enterText(
      find.byKey(WorkforcePanelKeys.noteField),
      'waiting for a valve',
    );
    await tester.pump();
    expect(confirm().onPressed, isNull);

    final Finder stock =
        find.byKey(WorkforcePanelKeys.cause(WorkforceBlockReason.waitingStock));
    await tester.ensureVisible(stock);
    await tester.pumpAndSettle();
    await tester.tap(stock);
    await tester.pump();
    expect(find.byKey(WorkforcePanelKeys.causeRequired), findsNothing);
    expect(confirm().onPressed, isNotNull);

    await tester.tap(find.byKey(WorkforcePanelKeys.noteConfirm));
    await tester.pumpAndSettle();
    expect(remote.calls.single.action, 'block');
    expect(remote.calls.single.note, 'waiting for a valve');
    expect(remote.calls.single.reasonCode, 'waiting_stock');
    expect(queue.of(userA), isEmpty);
  });

  testWidgets('a refused update is shown with its reason until dismissed',
      (WidgetTester tester) async {
    final (FakeWorkforceQueue queue, FakeWorkforceRemote _) = await pump(
      tester,
      status: 'assigned',
      remoteScript: <Object>[rejectedResult('invalid_transition')],
    );

    await tester.tap(
      find.byKey(WorkforcePanelKeys.action('a1', WorkforceAction.start)),
    );
    await tester.pumpAndSettle();

    expect(find.byKey(WorkforcePanelKeys.rejected('a1')), findsOneWidget);
    expect(queue.of(userA).single.status, WorkforceQueueStatus.rejected);
    // The server status stays authoritative.
    expect(find.textContaining('Assigned'), findsOneWidget);

    await tester.tap(
      find.byKey(
        WorkforcePanelKeys.dismiss(queue.of(userA).single.id),
      ),
    );
    await tester.pumpAndSettle();
    expect(queue.of(userA), isEmpty);
    expect(find.byKey(WorkforcePanelKeys.rejected('a1')), findsNothing);
  });

  testWidgets('evidence_required is explained and can be retried',
      (WidgetTester tester) async {
    final (FakeWorkforceQueue queue, FakeWorkforceRemote _) = await pump(
      tester,
      status: 'in_progress',
      remoteScript: <Object>[
        rejectedResult('evidence_required', status: 'in_progress'),
      ],
    );

    await tester.tap(
      find.byKey(WorkforcePanelKeys.action('a1', WorkforceAction.complete)),
    );
    await tester.pumpAndSettle();

    expect(find.byKey(WorkforcePanelKeys.rejected('a1')), findsOneWidget);
    expect(
      find.textContaining('needs evidence before it can be completed'),
      findsWidgets,
    );
    final String id = queue.of(userA).single.id;
    expect(find.byKey(WorkforcePanelKeys.retry(id)), findsOneWidget);
    // Evidence can still be attached while the refusal is on screen.
    expect(find.byKey(WorkforcePanelKeys.evidenceAdd('a1')), findsOneWidget);
  });

  testWidgets('shows asset, tyre and the required-record hint',
      (WidgetTester tester) async {
    await pump(
      tester,
      status: 'in_progress',
      assignment: const WorkforceAssignment(
        id: 'a1',
        title: 'Replace valve',
        status: 'in_progress',
        priority: 'normal',
        assetNo: 'TM514',
        tyreSerial: 'YMA55312',
        tyrePosition: 'LHF1',
        operationalRecordTable: 'tyre_records',
      ),
    );
    expect(
      find.text('Asset TM514 · Tyre YMA55312 · Position LHF1'),
      findsOneWidget,
    );
    expect(
      find.text('Needs a linked tyre record before review'),
      findsOneWidget,
    );
  });

  testWidgets('evidence count unavailable is not shown as zero',
      (WidgetTester tester) async {
    await pump(
      tester,
      status: 'in_progress',
      evidence: FakeEvidenceSource(countsResult: null),
    );
    expect(find.text('Evidence count unavailable'), findsOneWidget);
    expect(find.text('No evidence yet'), findsNothing);
  });

  testWidgets('a picked photo is uploaded and the count refreshes',
      (WidgetTester tester) async {
    final FakeEvidenceSource evidence = FakeEvidenceSource();
    await pump(
      tester,
      status: 'in_progress',
      evidence: evidence,
      picker: FakeEvidencePicker(
        WorkforceEvidenceFile(
          bytes: Uint8List.fromList(<int>[1, 2, 3]),
          fileName: 'photo.jpg',
          mimeType: 'image/jpeg',
          kind: WorkforceEvidenceKind.photo,
        ),
      ),
    );
    expect(find.text('No evidence yet'), findsOneWidget);

    await tester.tap(find.byKey(WorkforcePanelKeys.evidenceAdd('a1')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(WorkforcePanelKeys.evidenceGallery));
    await tester.pumpAndSettle();

    expect(evidence.uploads, hasLength(1));
    expect(find.text('1 evidence file'), findsOneWidget);
    expect(find.text('Evidence uploaded.'), findsOneWidget);
  });

  testWidgets('an unsupported file is refused with a clear message',
      (WidgetTester tester) async {
    final FakeEvidenceSource evidence = FakeEvidenceSource();
    await pump(
      tester,
      status: 'acknowledged',
      evidence: evidence,
      picker: FakeEvidencePicker(
        WorkforceEvidenceFile(
          bytes: Uint8List.fromList(<int>[1]),
          fileName: 'photo.heic',
          mimeType: 'unsupported',
          kind: WorkforceEvidenceKind.photo,
        ),
      ),
    );
    await tester.tap(find.byKey(WorkforcePanelKeys.evidenceAdd('a1')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(WorkforcePanelKeys.evidenceGallery));
    await tester.pumpAndSettle();
    expect(evidence.uploads, isEmpty);
    expect(
      find.text('Only JPG, PNG or PDF files can be attached.'),
      findsOneWidget,
    );
  });

  testWidgets('no evidence action before the work is accepted',
      (WidgetTester tester) async {
    await pump(tester, status: 'assigned');
    expect(find.byKey(WorkforcePanelKeys.evidenceAdd('a1')), findsNothing);
  });
}
