import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/app/localization/tp_localizations.dart';
import 'package:tyre_pulse/app/theme/tp_theme.dart';
import 'package:tyre_pulse/features/workshop/data/workshop_completion_service.dart';
import 'package:tyre_pulse/features/workshop/data/workshop_photo_capture.dart';
import 'package:tyre_pulse/features/workshop/data/workshop_repository.dart';
import 'package:tyre_pulse/features/workshop/domain/workshop_completion.dart';
import 'package:tyre_pulse/features/workshop/presentation/workshop_completion_sheet.dart';
import 'package:tyre_pulse/features/workshop/presentation/workshop_copy.dart';

const String _sig = 'data:image/png;base64,'
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

const WorkshopJob _job = WorkshopJob(
  id: 'wo-1',
  workOrderNo: 'GCKR/JC/1001/0926',
  assetNo: 'TM514',
);

final class _Picker implements WorkshopPhotoPicker {
  int n = 0;
  final List<WorkshopPhotoSource> sources = <WorkshopPhotoSource>[];
  @override
  Future<String?> capture(WorkshopPhotoSource source) async {
    sources.add(source);
    return '/tmp/p${++n}.jpg';
  }

  @override
  Future<void> discard(String localPath) async {}
}

Future<WorkshopCompletionDraft?> _open(
  WidgetTester tester, {
  WorkshopCompletionDraft initial = const WorkshopCompletionDraft(),
  _Picker? picker,
  List<WorkshopPartUsed> requested = const <WorkshopPartUsed>[],
  WorkshopAssetMeters meters = WorkshopAssetMeters.unknown,
}) async {
  await tester.binding.setSurfaceSize(const Size(400, 2400));
  addTearDown(() => tester.binding.setSurfaceSize(null));
  WorkshopCompletionDraft? result;
  await tester.pumpWidget(
    MaterialApp(
      theme: TpTheme.light,
      locale: const Locale('en'),
      supportedLocales: TpLocalizations.supportedLocales,
      localizationsDelegates: TpLocalizations.delegates,
      home: Builder(
        builder: (BuildContext context) => TextButton(
          onPressed: () async {
            result = await showWorkshopCompletionSheet(
              context: context,
              copy: WorkshopCopy.of(context),
              job: _job,
              picker: picker ?? _Picker(),
              requestedParts: Future<List<WorkshopPartUsed>>.value(requested),
              meters: Future<WorkshopAssetMeters>.value(meters),
              initial: initial,
              onDraftChanged: (_) {},
            );
          },
          child: const Text('open'),
        ),
      ),
    ),
  );
  await tester.tap(find.text('open'));
  await tester.pumpAndSettle();
  return result;
}

void main() {
  testWidgets('nothing can be sent until what / after photo / signature', (
    WidgetTester tester,
  ) async {
    await _open(tester);
    await tester.tap(find.byKey(WorkshopCompletionKeys.submit));
    await tester.pumpAndSettle();
    // Disabled: the sheet is still open.
    expect(find.byKey(WorkshopCompletionKeys.sheet), findsOneWidget);
    expect(find.byKey(WorkshopCompletionKeys.missing), findsOneWidget);
    expect(find.textContaining('an after photo'), findsOneWidget);
    expect(find.textContaining('your signature'), findsOneWidget);
    expect(find.text('Send for supervisor approval'), findsOneWidget);
  });

  testWidgets('quick pick + camera after photo + signature -> sendable', (
    WidgetTester tester,
  ) async {
    final _Picker picker = _Picker();
    await _open(
      tester,
      picker: picker,
      initial: const WorkshopCompletionDraft(signature: _sig),
    );
    await tester.tap(find.byKey(WorkshopCompletionKeys.quickPick('replaced')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(WorkshopCompletionKeys.afterCamera));
    await tester.pumpAndSettle();
    expect(picker.sources, <WorkshopPhotoSource>[WorkshopPhotoSource.camera]);
    expect(find.byKey(WorkshopCompletionKeys.missing), findsNothing);
    await tester.tap(find.byKey(WorkshopCompletionKeys.submit));
    await tester.pumpAndSettle();
    expect(find.byKey(WorkshopCompletionKeys.sheet), findsNothing);
  });

  testWidgets('parts from the job requests are one tap; meters as carried', (
    WidgetTester tester,
  ) async {
    await _open(
      tester,
      requested: const <WorkshopPartUsed>[
        WorkshopPartUsed(name: 'Brake pad set', qty: 2, requestId: 'pr-1'),
      ],
      meters: const WorkshopAssetMeters(
        hasKm: false,
        hasHours: true,
        lastHours: 4120,
      ),
    );
    expect(find.byKey(WorkshopCompletionKeys.requestedPart(0)), findsOneWidget);
    expect(find.byKey(WorkshopCompletionKeys.km), findsNothing);
    expect(find.byKey(WorkshopCompletionKeys.hours), findsOneWidget);
    expect(find.text('Last reading: 4120'), findsOneWidget);
  });

  group('domain', () {
    test('quick picks alone count as what was done', () {
      const WorkshopCompletionDraft d = WorkshopCompletionDraft(
        quickPicks: <String>{'repaired', 'inspected'},
        afterPhotos: <String>['a'],
        signature: _sig,
      );
      expect(d.missing((String p) => p), isEmpty);
      expect(d.effectiveWorkDone((String p) => p), 'repaired, inspected');
    });

    test('blank meter is not read, never zero', () {
      expect(parseWorkshopMeter(''), isNull);
      expect(parseWorkshopMeter('-3'), isNull);
      expect(parseWorkshopMeter('12,450'), 12450);
    });

    test('Quality Inspection / pending means with the supervisor', () {
      expect(isWorkshopJobAwaitingQc('Quality Inspection', null), isTrue);
      expect(isWorkshopJobAwaitingQc('In Progress', 'pending'), isTrue);
      expect(isWorkshopJobAwaitingQc('In Progress', 'failed'), isFalse);
      expect(isWorkshopJobReturned('failed'), isTrue);
    });

    test('payload: client_uuid is the command key, never a status', () {
      final Map<String, Object?> p = workshopCompletionPayload(
        key: 'jobdone_1',
        job: _job,
        draft: const WorkshopCompletionDraft(
          quickPicks: <String>{'replaced'},
          parts: <WorkshopPartUsed>[
            WorkshopPartUsed(name: 'Seal', qty: 1, requestId: 'pr-1'),
          ],
          afterPhotos: <String>['tp-storage://tyre-photos/a.jpg'],
          signature: _sig,
          engineHours: 4200,
        ),
        workDone: 'Replaced seal',
        now: DateTime.utc(2026, 11, 27, 9),
      );
      expect(p['client_uuid'], 'jobdone_1');
      expect(p['job_id'], 'wo-1');
      expect(p['after_photos'], <String>['tp-storage://tyre-photos/a.jpg']);
      expect(p['parts_used'], <Map<String, Object?>>[
        <String, Object?>{'name': 'Seal', 'qty': 1, 'request_id': 'pr-1'},
      ]);
      expect(p.containsKey('status'), isFalse);
      expect(p['km'], isNull);
      expect(p['engine_hours'], 4200);
    });
  });
}
