// Issue to a job card on the phone: the job card must be checked first, a
// shortage is shown and nothing posts, an identical retry reuses its key, and
// the screen fits a 390px phone at 2x text in Arabic.
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_riverpod/misc.dart' show Override;
import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/app/localization/tp_localizations.dart';
import 'package:tyre_pulse/core/errors/app_error.dart';
import 'package:tyre_pulse/core/network/supabase_error_mapper.dart';
import 'package:tyre_pulse/features/inventory/data/job_card_issue_repository.dart';
import 'package:tyre_pulse/features/inventory/domain/job_card_issue.dart';
import 'package:tyre_pulse/features/inventory/inventory_providers.dart';
import 'package:tyre_pulse/features/inventory/presentation/job_card_issue_screen.dart';
import 'package:tyre_pulse/features/stock_count/domain/stock_item.dart';

final class _Repo implements JobCardIssueRepository {
  final List<String> keys = <String>[];
  final List<Map<String, Object?>> payloads = <Map<String, Object?>>[];
  final List<Object> answers = <Object>[];
  JobCardRef? card = const JobCardRef(
    workOrderNo: 'GCKR/JC/1/0826',
    assetNo: 'TM514',
    status: 'Open',
  );

  List<JobCardReservation> reservations = const <JobCardReservation>[];
  bool reservationsFail = false;

  @override
  Future<JobCardRef?> findJobCard(String number) async => card;

  @override
  Future<List<JobCardReservation>> openReservations({
    required String jobCard,
    required String stockId,
  }) async {
    if (reservationsFail) throw StateError('read failed');
    return reservations;
  }

  @override
  Future<JobCardMoveOutcome> post(
    JobCardMoveDraft draft, {
    required String idempotencyKey,
  }) async {
    keys.add(idempotencyKey);
    payloads.add(draft.toPayload(idempotencyKey));
    final Object next = answers.isEmpty
        ? const JobCardMovePosted(movementId: 'm')
        : answers.removeAt(0);
    if (next is SupabaseFailure) throw next;
    return next as JobCardMoveOutcome;
  }
}

const StockItem _line = StockItem(
  id: 'stock-1',
  site: 'NHC',
  description: 'Oil filter',
  quantity: 4,
  reserved: 1,
);

Widget _app(_Repo repo, {Locale locale = const Locale('en')}) {
  int n = 0;
  return ProviderScope(
    overrides: <Override>[
      jobCardIssueRepositoryProvider.overrideWithValue(repo),
      inventoryIdFactoryProvider.overrideWithValue(() => 'key-${n++}'),
    ],
    child: MaterialApp(
      locale: locale,
      localizationsDelegates: TpLocalizations.delegates,
      supportedLocales: TpLocalizations.supportedLocales,
      home: const JobCardIssueScreen(item: _line, move: JobCardMove.issue),
    ),
  );
}

void _tall(WidgetTester tester) {
  tester.view
    ..physicalSize = const Size(800, 2000)
    ..devicePixelRatio = 1;
  addTearDown(tester.view.reset);
}

void main() {
  testWidgets('sending before checking the job card is refused locally',
      (WidgetTester tester) async {
    _tall(tester);
    final _Repo repo = _Repo();
    await tester.pumpWidget(_app(repo));
    await tester.enterText(
      find.byKey(const Key('inventory.jc.jobCard')),
      'gckr/jc/1/0826',
    );
    await tester.tap(find.byKey(const Key('inventory.jc.send')));
    await tester.pumpAndSettle();
    expect(find.text('Check the job card before sending.'), findsOneWidget);
    expect(repo.payloads, isEmpty);
  });

  testWidgets('a shortage is shown and a retry reuses the same key',
      (WidgetTester tester) async {
    _tall(tester);
    final _Repo repo = _Repo()
      ..answers.addAll(<Object>[
        const SupabaseFailure(
          error: AppError(kind: AppErrorKind.network, message: 'offline'),
          cause: SupabaseFailureCause.timeout,
        ),
        const JobCardMoveShortage(available: 1, requested: 1),
      ]);
    await tester.pumpWidget(_app(repo));
    await tester.enterText(
      find.byKey(const Key('inventory.jc.jobCard')),
      'gckr/jc/1/0826',
    );
    await tester.tap(find.byKey(const Key('inventory.jc.check')));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('inventory.jc.found')), findsOneWidget);

    await tester.ensureVisible(find.byKey(const Key('inventory.jc.send')));
    await tester.tap(find.byKey(const Key('inventory.jc.send')));
    await tester.pumpAndSettle();
    expect(
      find.text('No connection. Nothing was posted; try again when online.'),
      findsOneWidget,
    );
    await tester.tap(find.byKey(const Key('inventory.jc.send')));
    await tester.pumpAndSettle();
    expect(
      find.text('Not enough stock: 1 available. Nothing was posted.'),
      findsOneWidget,
    );
    expect(repo.keys, <String>['key-0', 'key-0']);
    expect(repo.payloads.first['source_doc_id'], 'GCKR/JC/1/0826');
    expect(repo.payloads.first['source_doc_type'], 'job_card');
  });

  testWidgets('after a shortage, Send again mints a new key',
      (WidgetTester tester) async {
    _tall(tester);
    final _Repo repo = _Repo()
      ..answers.addAll(<Object>[
        const JobCardMoveShortage(available: 0, requested: 1),
        const JobCardMovePosted(movementId: 'm'),
      ]);
    await tester.pumpWidget(_app(repo));
    await tester.enterText(
      find.byKey(const Key('inventory.jc.jobCard')),
      'gckr/jc/1/0826',
    );
    await tester.tap(find.byKey(const Key('inventory.jc.check')));
    await tester.pumpAndSettle();
    await tester.ensureVisible(find.byKey(const Key('inventory.jc.send')));
    await tester.tap(find.byKey(const Key('inventory.jc.send')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('inventory.jc.send')));
    await tester.pumpAndSettle();
    expect(repo.keys, <String>['key-0', 'key-1']);
  });

  testWidgets('the oldest open reservation is shown and consumed',
      (WidgetTester tester) async {
    _tall(tester);
    final _Repo repo = _Repo()
      ..reservations = <JobCardReservation>[
        JobCardReservation(
          id: 'res-new',
          qty: 3,
          qtyReleased: 0,
          qtyConsumed: 0,
          createdAt: DateTime.utc(2026, 11, 20),
        ),
        JobCardReservation(
          id: 'res-old',
          qty: 2,
          qtyReleased: 0,
          qtyConsumed: 1,
          createdAt: DateTime.utc(2026, 11, 1),
        ),
      ];
    await tester.pumpWidget(_app(repo));
    await tester.enterText(
      find.byKey(const Key('inventory.jc.jobCard')),
      'gckr/jc/1/0826',
    );
    await tester.tap(find.byKey(const Key('inventory.jc.check')));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('inventory.jc.reservation')), findsOneWidget);
    expect(find.textContaining('Reserved for this job card: 1.'), findsOne);
    expect(find.textContaining('2 reservations'), findsOne);
    await tester.ensureVisible(find.byKey(const Key('inventory.jc.send')));
    await tester.tap(find.byKey(const Key('inventory.jc.send')));
    await tester.pumpAndSettle();
    expect(repo.payloads.single['reservation_id'], 'res-old');
  });

  testWidgets('a failed reservation read is said and does not block',
      (WidgetTester tester) async {
    _tall(tester);
    final _Repo repo = _Repo()..reservationsFail = true;
    await tester.pumpWidget(_app(repo));
    await tester.enterText(
      find.byKey(const Key('inventory.jc.jobCard')),
      'gckr/jc/1/0826',
    );
    await tester.tap(find.byKey(const Key('inventory.jc.check')));
    await tester.pumpAndSettle();
    expect(
      find.byKey(const Key('inventory.jc.reservationFailed')),
      findsOneWidget,
    );
    await tester.ensureVisible(find.byKey(const Key('inventory.jc.send')));
    await tester.tap(find.byKey(const Key('inventory.jc.send')));
    await tester.pumpAndSettle();
    expect(repo.payloads.single.containsKey('reservation_id'), isFalse);
  });

  testWidgets('a closed job card cannot take material',
      (WidgetTester tester) async {
    _tall(tester);
    final _Repo repo = _Repo()
      ..card = const JobCardRef(workOrderNo: 'X', status: 'Closed');
    await tester.pumpWidget(_app(repo));
    await tester.enterText(find.byKey(const Key('inventory.jc.jobCard')), 'X');
    await tester.tap(find.byKey(const Key('inventory.jc.check')));
    await tester.pumpAndSettle();
    await tester.ensureVisible(find.byKey(const Key('inventory.jc.send')));
    await tester.tap(find.byKey(const Key('inventory.jc.send')));
    await tester.pumpAndSettle();
    expect(repo.payloads, isEmpty);
    expect(find.byKey(const Key('inventory.jc.problem')), findsOneWidget);
  });

  testWidgets('fits a 390px phone at 2x text in Arabic',
      (WidgetTester tester) async {
    tester.view
      ..physicalSize = const Size(390, 844)
      ..devicePixelRatio = 1;
    tester.platformDispatcher.textScaleFactorTestValue = 2;
    addTearDown(tester.view.reset);
    addTearDown(tester.platformDispatcher.clearTextScaleFactorTestValue);
    await tester.pumpWidget(_app(_Repo(), locale: const Locale('ar')));
    await tester.pumpAndSettle();
    expect(tester.takeException(), isNull);
  });
}
