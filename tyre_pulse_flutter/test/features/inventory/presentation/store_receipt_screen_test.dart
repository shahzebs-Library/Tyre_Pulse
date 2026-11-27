// Receive goods on the phone: local checks, the delivery note photo goes under
// store_receipts/<company>/, a retry after a timeout reuses the same key, the
// list says why it is empty, and the form fits a 390px phone in Arabic.
import 'dart:async';
import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_riverpod/misc.dart' show Override;
import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/app/localization/tp_localizations.dart';
import 'package:tyre_pulse/core/errors/app_error.dart';
import 'package:tyre_pulse/core/network/supabase_error_mapper.dart';
import 'package:tyre_pulse/core/permissions/access_resolver.dart';
import 'package:tyre_pulse/core/permissions/roles.dart';
import 'package:tyre_pulse/core/workspace/workspace_context.dart';
import 'package:tyre_pulse/core/workspace/workspace_providers.dart';
import 'package:tyre_pulse/core/workspace/workspace_scope.dart';
import 'package:tyre_pulse/features/inventory/data/store_receipt_repository.dart';
import 'package:tyre_pulse/features/inventory/domain/store_receipt.dart';
import 'package:tyre_pulse/features/inventory/inventory_providers.dart';
import 'package:tyre_pulse/features/inventory/presentation/store_receipt_screen.dart';

final class _Repo implements StoreReceiptRepository {
  StoreReceiptBoard boardValue = const StoreReceiptBoard();
  final List<String> keys = <String>[];
  final List<Map<String, Object?>> payloads = <Map<String, Object?>>[];
  final List<String> uploads = <String>[];
  final List<Object> answers = <Object>[];
  final List<String> cancels = <String>[];
  Completer<void>? hold;

  @override
  Future<StoreReceiptBoard> board({String? search}) async => boardValue;

  @override
  Future<void> cancel(String requestId) async => cancels.add(requestId);

  @override
  Future<StoreReceiptOutcome> submit(
    StoreReceiptDraft draft, {
    required String clientUuid,
  }) async {
    keys.add(clientUuid);
    payloads.add(draft.toPayload(clientUuid));
    if (hold != null) await hold!.future;
    final Object next = answers.isEmpty
        ? const StoreReceiptOutcome(id: 'r1', status: 'pending')
        : answers.removeAt(0);
    if (next is SupabaseFailure) throw next;
    return next as StoreReceiptOutcome;
  }

  @override
  Future<void> uploadPhoto(String path, Uint8List bytes) async =>
      uploads.add(path);
}

const OpenPoLine _line = OpenPoLine(
  poLineId: 'pl-1',
  poNumber: 'PO-77',
  qtyOrdered: 10,
  qtyOpen: 6,
  site: 'NHC',
  itemCode: 'FLT-01',
  itemName: 'Oil filter',
);
const List<ReceivingLocation> _locs = <ReceivingLocation>[
  ReceivingLocation(id: 'loc-1', code: 'WH1', site: 'NHC'),
];

const WorkspaceContext _keeper = WorkspaceContext(
  userId: 'keeper-1',
  tenantId: 'org-1',
  role: UserRole.known(RoleId.storeKeeper),
  effectivePermissions: AccessState(role: UserRole.known(RoleId.storeKeeper)),
  countryScope: CountryScope.none,
  siteScope: SiteScope.none,
);

Widget _app(
  _Repo repo,
  Widget home, {
  Locale locale = const Locale('en'),
  bool online = true,
}) {
  int n = 0;
  return ProviderScope(
    overrides: <Override>[
      storeReceiptRepositoryProvider.overrideWithValue(repo),
      inventoryIdFactoryProvider.overrideWithValue(() => 'key-${n++}'),
      workspaceContextProvider.overrideWithValue(_keeper),
      inventoryOnlineCheckProvider.overrideWithValue(() async => online),
    ],
    child: MaterialApp(
      locale: locale,
      localizationsDelegates: TpLocalizations.delegates,
      supportedLocales: TpLocalizations.supportedLocales,
      home: home,
    ),
  );
}

Widget _form({bool photo = false}) => StoreReceiptFormScreen(
      line: _line,
      locations: _locs,
      pickPhoto: photo ? () async => '/tmp/dn.jpg' : null,
      readPhoto: (String _) async => Uint8List.fromList(<int>[1, 2, 3]),
    );

void _tall(WidgetTester tester) {
  tester.view
    ..physicalSize = const Size(800, 2200)
    ..devicePixelRatio = 1;
  addTearDown(tester.view.reset);
}

Future<void> _send(WidgetTester tester) async {
  await tester.ensureVisible(find.byKey(const Key('inventory.sr.send')));
  await tester.tap(find.byKey(const Key('inventory.sr.send')));
  await tester.pumpAndSettle();
}

void main() {
  testWidgets('more than is open is refused locally; nothing is sent',
      (WidgetTester tester) async {
    _tall(tester);
    final _Repo repo = _Repo();
    await tester.pumpWidget(_app(repo, _form()));
    await tester.enterText(find.byKey(const Key('inventory.sr.qty')), '7');
    await _send(tester);
    expect(find.text('More than is still open on this line.'), findsOneWidget);
    expect(repo.payloads, isEmpty);
  });

  testWidgets('a rejection needs a reason', (WidgetTester tester) async {
    _tall(tester);
    final _Repo repo = _Repo();
    await tester.pumpWidget(_app(repo, _form()));
    await tester.enterText(find.byKey(const Key('inventory.sr.qty')), '5');
    await tester.enterText(find.byKey(const Key('inventory.sr.rejected')), '1');
    await tester.pumpAndSettle();
    await _send(tester);
    expect(find.text('Say why goods were rejected.'), findsOneWidget);
    await tester.enterText(find.byKey(const Key('inventory.sr.reason')), 'Wet');
    await _send(tester);
    expect(repo.payloads.single['qty_rejected'], 1);
    expect(repo.payloads.single['rejection_reason'], 'Wet');
  });

  testWidgets('offline then retry reuses the key; photo path is the company',
      (WidgetTester tester) async {
    _tall(tester);
    final _Repo repo = _Repo()
      ..answers.add(
        const SupabaseFailure(
          error: AppError(kind: AppErrorKind.network, message: 'offline'),
          cause: SupabaseFailureCause.timeout,
        ),
      );
    await tester.pumpWidget(_app(repo, _form(photo: true)));
    await tester.enterText(find.byKey(const Key('inventory.sr.qty')), '4');
    await tester.ensureVisible(find.byKey(const Key('inventory.sr.photo')));
    await tester.tap(find.byKey(const Key('inventory.sr.photo')));
    await tester.pumpAndSettle();
    expect(find.text('Photo attached'), findsOneWidget);
    await _send(tester);
    expect(
      find.textContaining('No connection. Nothing was sent.'),
      findsOneWidget,
    );
    await _send(tester);
    expect(repo.keys, <String>['key-0', 'key-0']);
    expect(repo.uploads, <String>['org-1/store_receipts/key-0.jpg']);
    expect(
      repo.payloads.last['delivery_note_path'],
      'org-1/store_receipts/key-0.jpg',
    );
    expect(repo.payloads.last.containsKey('unit_cost'), isFalse);
  });

  testWidgets('empty list explains why', (WidgetTester tester) async {
    final _Repo repo = _Repo();
    await tester.pumpWidget(_app(repo, const StoreReceiptScreen()));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('inventory.sr.empty')), findsOneWidget);
    expect(find.text('No open purchase order lines'), findsOneWidget);
  });

  testWidgets('lines and my receipts are listed with their status',
      (WidgetTester tester) async {
    final _Repo repo = _Repo()
      ..boardValue = const StoreReceiptBoard(
        lines: <OpenPoLine>[_line],
        locations: _locs,
        mine: <MyStoreReceipt>[
          MyStoreReceipt(id: 'r9', status: 'pending', poNumber: 'PO-77'),
        ],
      );
    await tester.pumpWidget(_app(repo, const StoreReceiptScreen()));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('inventory.sr.line.pl-1')), findsOneWidget);
    expect(find.textContaining('Waiting for approval'), findsOneWidget);
    expect(find.byKey(const Key('inventory.sr.withdraw.r9')), findsOneWidget);
  });

  testWidgets('received quantity starts empty and a failed send never posts',
      (WidgetTester tester) async {
    _tall(tester);
    final _Repo repo = _Repo();
    await tester.pumpWidget(_app(repo, _form()));
    final TextField qty =
        tester.widget<TextField>(find.byKey(const Key('inventory.sr.qty')));
    expect(qty.controller!.text, isEmpty);
    expect(find.byKey(const Key('inventory.sr.online')), findsOneWidget);
    await _send(tester);
    expect(find.text('Enter the quantity received.'), findsOneWidget);
    await tester.enterText(find.byKey(const Key('inventory.sr.qty')), '1,000');
    await _send(tester);
    expect(find.textContaining('Do not use commas'), findsOneWidget);
    await tester.enterText(find.byKey(const Key('inventory.sr.qty')), '2');
    await tester.enterText(find.byKey(const Key('inventory.sr.rejected')), 'x');
    await _send(tester);
    expect(
      find.textContaining('rejected quantity as a plain number'),
      findsOneWidget,
    );
    expect(repo.payloads, isEmpty);
  });

  testWidgets('double tap on Send records once', (WidgetTester tester) async {
    _tall(tester);
    final _Repo repo = _Repo()..hold = Completer<void>();
    await tester.pumpWidget(_app(repo, _form()));
    await tester.enterText(find.byKey(const Key('inventory.sr.qty')), '2');
    await tester.ensureVisible(find.byKey(const Key('inventory.sr.send')));
    await tester.tap(find.byKey(const Key('inventory.sr.send')));
    await tester.tap(
      find.byKey(const Key('inventory.sr.send')),
      warnIfMissed: false,
    );
    await tester.pump();
    repo.hold!.complete();
    await tester.pumpAndSettle();
    expect(repo.payloads, hasLength(1));
  });

  testWidgets('the key survives leaving and reopening the form until confirmed',
      (WidgetTester tester) async {
    _tall(tester);
    final _Repo repo = _Repo()
      ..answers.addAll(<Object>[
        const SupabaseFailure(
          error: AppError(kind: AppErrorKind.network, message: 'offline'),
          cause: SupabaseFailureCause.timeout,
        ),
        const StoreReceiptOutcome(id: 'r1', status: 'pending'),
        const StoreReceiptOutcome(id: 'r2', status: 'pending'),
      ]);
    int n = 0;
    final ProviderContainer c = ProviderContainer(
      overrides: <Override>[
        storeReceiptRepositoryProvider.overrideWithValue(repo),
        inventoryIdFactoryProvider.overrideWithValue(() => 'key-${n++}'),
        workspaceContextProvider.overrideWithValue(_keeper),
      ],
    );
    addTearDown(c.dispose);
    Future<void> openAndSend(String q) async {
      await tester.pumpWidget(
        UncontrolledProviderScope(
          container: c,
          child: MaterialApp(
            localizationsDelegates: TpLocalizations.delegates,
            supportedLocales: TpLocalizations.supportedLocales,
            home: Builder(
              builder: (BuildContext context) => TextButton(
                key: const Key('open'),
                onPressed: () => Navigator.of(context).push(
                  MaterialPageRoute<void>(builder: (_) => _form()),
                ),
                child: const Text('open'),
              ),
            ),
          ),
        ),
      );
      await tester.tap(find.byKey(const Key('open')));
      await tester.pumpAndSettle();
      await tester.enterText(find.byKey(const Key('inventory.sr.qty')), q);
      await _send(tester);
    }

    await openAndSend('2');
    await tester.pumpWidget(const SizedBox());
    await openAndSend('3'); // reopened and edited: same key until confirmed
    await openAndSend('1'); // a new delivery after confirmation
    expect(repo.keys, <String>['key-0', 'key-0', 'key-1']);
  });

  testWidgets('no connection: the photo is not taken',
      (WidgetTester tester) async {
    _tall(tester);
    final _Repo repo = _Repo();
    await tester.pumpWidget(_app(repo, _form(photo: true), online: false));
    await tester.ensureVisible(find.byKey(const Key('inventory.sr.photo')));
    await tester.tap(find.byKey(const Key('inventory.sr.photo')));
    await tester.pumpAndSettle();
    expect(
      find.textContaining('Connect before taking the photo'),
      findsOneWidget,
    );
    expect(find.text('Photo attached'), findsNothing);
  });

  testWidgets('a server refusal is shown in the user\'s words, not raw text',
      (WidgetTester tester) async {
    _tall(tester);
    final _Repo repo = _Repo()
      ..answers.add(
        const SupabaseFailure(
          error: AppError(kind: AppErrorKind.authorization, message: 'x'),
          cause: SupabaseFailureCause.serverRaise,
          rawMessage:
              'You can record a receipt only for a site assigned to you by name.',
        ),
      );
    await tester.pumpWidget(_app(repo, _form(), locale: const Locale('ar')));
    await tester.enterText(find.byKey(const Key('inventory.sr.qty')), '2');
    await _send(tester);
    expect(find.textContaining('غير مخصص لك بالاسم'), findsOneWidget);
  });

  testWidgets('withdraw asks first and sends once',
      (WidgetTester tester) async {
    _tall(tester);
    final _Repo repo = _Repo()
      ..boardValue = const StoreReceiptBoard(
        mine: <MyStoreReceipt>[
          MyStoreReceipt(id: 'r9', status: 'pending', poNumber: 'PO-77'),
        ],
      );
    await tester.pumpWidget(_app(repo, const StoreReceiptScreen()));
    await tester.pumpAndSettle();
    await tester.scrollUntilVisible(
      find.byKey(const Key('inventory.sr.withdraw.r9')),
      200,
      scrollable: find.byType(Scrollable).first,
    );
    await tester.tap(find.byKey(const Key('inventory.sr.withdraw.r9')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('inventory.sr.withdraw.keep')));
    await tester.pumpAndSettle();
    expect(repo.cancels, isEmpty);
    await tester.scrollUntilVisible(
      find.byKey(const Key('inventory.sr.withdraw.r9')),
      200,
      scrollable: find.byType(Scrollable).first,
    );
    await tester.tap(find.byKey(const Key('inventory.sr.withdraw.r9')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('inventory.sr.withdraw.confirm')));
    await tester.pumpAndSettle();
    expect(repo.cancels, <String>['r9']);
  });

  testWidgets('search narrows the open lines', (WidgetTester tester) async {
    final _Repo repo = _Repo()
      ..boardValue = const StoreReceiptBoard(
        lines: <OpenPoLine>[
          _line,
          OpenPoLine(
            poLineId: 'pl-2',
            poNumber: 'PO-88',
            qtyOrdered: 4,
            qtyOpen: 4,
            itemCode: 'BRK-07',
          ),
        ],
        locations: _locs,
      );
    await tester.pumpWidget(_app(repo, const StoreReceiptScreen()));
    await tester.pumpAndSettle();
    await tester.enterText(find.byKey(const Key('inventory.sr.search')), 'brk');
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('inventory.sr.line.pl-2')), findsOneWidget);
    expect(find.byKey(const Key('inventory.sr.line.pl-1')), findsNothing);
    await tester.enterText(find.byKey(const Key('inventory.sr.search')), 'zzz');
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('inventory.sr.noMatch')), findsOneWidget);
  });

  for (final Locale locale in const <Locale>[Locale('ar'), Locale('ur')]) {
    testWidgets(
        'form and list fit a 360dp phone at 2x text in ${locale.languageCode}',
        (WidgetTester tester) async {
      tester.view
        ..physicalSize = const Size(360, 780)
        ..devicePixelRatio = 1;
      addTearDown(tester.view.reset);
      final _Repo repo = _Repo()
        ..boardValue = const StoreReceiptBoard(
          lines: <OpenPoLine>[_line],
          locations: _locs,
        );
      for (final Widget home in <Widget>[_form(), const StoreReceiptScreen()]) {
        await tester.pumpWidget(
          MediaQuery(
            data: const MediaQueryData(
              size: Size(360, 780),
              textScaler: TextScaler.linear(2),
            ),
            child: _app(repo, home, locale: locale),
          ),
        );
        await tester.pumpAndSettle();
        expect(tester.takeException(), isNull);
      }
    });
  }
}
