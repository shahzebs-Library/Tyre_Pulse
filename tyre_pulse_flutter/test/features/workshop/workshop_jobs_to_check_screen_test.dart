import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/app/localization/tp_localizations.dart';
import 'package:tyre_pulse/app/theme/tp_theme.dart';
import 'package:tyre_pulse/core/storage/private_storage_reference_resolver.dart';
import 'package:tyre_pulse/core/storage/storage_providers.dart';
import 'package:tyre_pulse/features/workshop/data/workshop_job_check_service.dart';
import 'package:tyre_pulse/features/workshop/presentation/workshop_jobs_to_check_screen.dart';
import 'package:tyre_pulse/features/workshop/workshop_providers.dart';

final class _FakeChecks implements WorkshopJobCheckService {
  _FakeChecks({this.answer = const WorkshopCheckDecision(ok: true)});

  final WorkshopCheckDecision answer;
  final List<(String, String, String?)> decided = <(String, String, String?)>[];

  static final WorkshopCheckItem waiting = WorkshopCheckItem(
    id: 'c-1',
    jobId: 'wo-1',
    status: 'submitted',
    workDone: 'Replaced the brake pads and bled the system',
    completedAt: DateTime(2026, 11, 27, 9, 40),
    workOrderNo: 'GCKR/JC/1001/1126',
    assetNo: 'TM514',
    site: 'NHC',
    technicianName: 'SHARIF KHAN',
    quickPicks: const <String>['replaced'],
    parts: const <({String name, num qty})>[(name: 'Brake pad set', qty: 2)],
    afterPhotos: const <String>[
      'tp-storage://tyre-photos/modules/workshop/a/b.jpg',
    ],
    km: 68420,
    engineHours: 8742,
    signature: 'data:image/png;base64,iVBORw0KGgo=',
  );

  static final WorkshopCheckItem returned = WorkshopCheckItem(
    id: 'c-2',
    jobId: 'wo-2',
    status: 'returned',
    workDone: 'Fixed hydraulic leak',
    completedAt: DateTime(2026, 11, 26, 15, 5),
    workOrderNo: 'GCKR/JC/0998/1126',
    assetNo: 'MP083',
    site: 'NHC',
    technicianName: 'SHOUKAT ALI',
    afterPhotos: const <String>[
      'tp-storage://tyre-photos/modules/workshop/a/c.jpg',
    ],
    decisionNote: 'Still leaking at the boom joint',
    decidedByName: 'Mahmoud',
  );

  @override
  Future<List<WorkshopCheckItem>> list(WorkshopCheckQueue queue) async =>
      queue == WorkshopCheckQueue.toCheck
          ? <WorkshopCheckItem>[waiting]
          : <WorkshopCheckItem>[returned];

  @override
  Future<WorkshopCheckDecision> decide({
    required String completionId,
    required String decision,
    String? note,
  }) async {
    decided.add((completionId, decision, note));
    return answer;
  }
}

Future<void> _pump(WidgetTester tester, _FakeChecks checks) async {
  await tester.binding.setSurfaceSize(const Size(390, 1400));
  addTearDown(() => tester.binding.setSurfaceSize(null));
  await tester.pumpWidget(
    ProviderScope(
      overrides: [
        workshopJobCheckServiceProvider.overrideWithValue(checks),
        privateStorageReferenceResolverProvider.overrideWithValue(
          PrivateStorageReferenceResolver(
            (String bucket, String path, int expiresIn) async =>
                throw StateError('offline'),
          ),
        ),
      ],
      child: MaterialApp(
        theme: TpTheme.light,
        locale: const Locale('en'),
        supportedLocales: TpLocalizations.supportedLocales,
        localizationsDelegates: TpLocalizations.delegates,
        home: const WorkshopJobsToCheckScreen(),
      ),
    ),
  );
  await tester.pumpAndSettle();
}

void main() {
  testWidgets('lists the waiting completions and passes one', (
    WidgetTester tester,
  ) async {
    final _FakeChecks checks = _FakeChecks();
    await _pump(tester, checks);
    expect(find.text('GCKR/JC/1001/1126'), findsOneWidget);
    await tester.tap(find.byKey(WorkshopJobsToCheckKeys.item('c-1')));
    await tester.pumpAndSettle();
    expect(find.text('Brake pad set  x2'), findsOneWidget);
    expect(find.text('Photo not available'), findsOneWidget);
    await tester.ensureVisible(find.byKey(WorkshopJobsToCheckKeys.pass));
    await tester.tap(find.byKey(WorkshopJobsToCheckKeys.pass));
    await tester.pumpAndSettle();
    expect(checks.decided.single, ('c-1', 'pass', null));
    expect(find.text('Job passed and closed.'), findsOneWidget);
  });

  testWidgets('a return needs a reason before it can be sent', (
    WidgetTester tester,
  ) async {
    final _FakeChecks checks = _FakeChecks();
    await _pump(tester, checks);
    await tester.tap(find.byKey(WorkshopJobsToCheckKeys.item('c-1')));
    await tester.pumpAndSettle();
    await tester.ensureVisible(find.byKey(WorkshopJobsToCheckKeys.returnJob));
    await tester.tap(find.byKey(WorkshopJobsToCheckKeys.returnJob));
    await tester.pumpAndSettle();
    final ButtonStyleButton send = tester.widget<ButtonStyleButton>(
      find.descendant(
        of: find.byKey(WorkshopJobsToCheckKeys.returnSend),
        matching: find.byWidgetPredicate((Widget w) => w is ButtonStyleButton),
      ),
    );
    expect(send.onPressed, isNull);
    await tester.enterText(
      find.byKey(WorkshopJobsToCheckKeys.returnNote),
      'Seal still leaks',
    );
    await tester.pump();
    await tester.tap(find.byKey(WorkshopJobsToCheckKeys.returnSend));
    await tester.pumpAndSettle();
    expect(checks.decided.single, ('c-1', 'return', 'Seal still leaks'));
  });

  testWidgets('the server refusal is shown as is', (WidgetTester tester) async {
    final _FakeChecks checks = _FakeChecks(
      answer: const WorkshopCheckDecision(
        ok: false,
        reason: 'Already passed by Mahmoud.',
      ),
    );
    await _pump(tester, checks);
    await tester.tap(find.byKey(WorkshopJobsToCheckKeys.item('c-1')));
    await tester.pumpAndSettle();
    await tester.ensureVisible(find.byKey(WorkshopJobsToCheckKeys.pass));
    await tester.tap(find.byKey(WorkshopJobsToCheckKeys.pass));
    await tester.pumpAndSettle();
    expect(find.text('Already passed by Mahmoud.'), findsOneWidget);
  });

  testWidgets('the Returned queue shows the reason, with no decision buttons',
      (WidgetTester tester) async {
    await _pump(tester, _FakeChecks());
    await tester.tap(find.byKey(WorkshopJobsToCheckKeys.tabReturned));
    await tester.pumpAndSettle();
    expect(
      find.text('Returned because: Still leaking at the boom joint'),
      findsOneWidget,
    );
    await tester.tap(find.byKey(WorkshopJobsToCheckKeys.item('c-2')));
    await tester.pumpAndSettle();
    expect(find.byKey(WorkshopJobsToCheckKeys.pass), findsNothing);
  });

  test('decision answer parsing is defensive', () {
    expect(workshopCheckDecisionFrom(null).ok, isFalse);
    expect(
      workshopCheckDecisionFrom(<String, Object?>{'ok': true}).ok,
      isTrue,
    );
    expect(
      workshopCheckDecisionFrom(
        <String, Object?>{'ok': false, 'reason': ' Nope. '},
      ).reason,
      'Nope.',
    );
  });
}
