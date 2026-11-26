// Receive goods on the phone: local checks, the delivery note photo goes under
// store_receipts/<company>/, a retry after a timeout reuses the same key, the
// list says why it is empty, and the form fits a 390px phone in Arabic.
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

  @override
  Future<StoreReceiptBoard> board({String? search}) async => boardValue;

  @override
  Future<void> cancel(String requestId) async {}

  @override
  Future<StoreReceiptOutcome> submit(
    StoreReceiptDraft draft, {
    required String clientUuid,
  }) async {
    keys.add(clientUuid);
    payloads.add(draft.toPayload(clientUuid));
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
}) {
  int n = 0;
  return ProviderScope(
    overrides: <Override>[
      storeReceiptRepositoryProvider.overrideWithValue(repo),
      inventoryIdFactoryProvider.overrideWithValue(() => 'key-${n++}'),
      workspaceContextProvider.overrideWithValue(_keeper),
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
    expect(repo.uploads, <String>['store_receipts/org-1/key-0.jpg']);
    expect(
      repo.payloads.last['delivery_note_path'],
      'store_receipts/org-1/key-0.jpg',
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

  testWidgets('form fits a 390px phone at 2x text in Arabic',
      (WidgetTester tester) async {
    tester.view
      ..physicalSize = const Size(390, 844)
      ..devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    final _Repo repo = _Repo();
    await tester.pumpWidget(
      MediaQuery(
        data: const MediaQueryData(textScaler: TextScaler.linear(2)),
        child: _app(repo, _form(), locale: const Locale('ar')),
      ),
    );
    await tester.pumpAndSettle();
    expect(tester.takeException(), isNull);
    expect(find.text('تسجيل التسليم'), findsOneWidget);
  });
}
