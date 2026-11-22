// The count screen's "Finish counting" action: shown only while counting is
// open, refuses with unsent lines and offline, confirms first, and sends ONE
// idempotency key per confirmed press.
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_riverpod/misc.dart' show Override;
import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/app/localization/tp_localizations.dart';
import 'package:tyre_pulse/core/permissions/access_resolver.dart';
import 'package:tyre_pulse/core/permissions/roles.dart';
import 'package:tyre_pulse/core/storage/secure_key_value_store.dart';
import 'package:tyre_pulse/core/storage/secure_read.dart';
import 'package:tyre_pulse/core/workspace/workspace_context.dart';
import 'package:tyre_pulse/core/workspace/workspace_providers.dart';
import 'package:tyre_pulse/core/workspace/workspace_scope.dart';
import 'package:tyre_pulse/features/inventory/data/count_draft_store.dart';
import 'package:tyre_pulse/features/inventory/data/inventory_audit_repository.dart';
import 'package:tyre_pulse/features/inventory/domain/count_models.dart';
import 'package:tyre_pulse/features/inventory/domain/count_session.dart';
import 'package:tyre_pulse/features/inventory/inventory_providers.dart';
import 'package:tyre_pulse/features/inventory/presentation/blind_count_screen.dart';

const WorkspaceContext _ctx = WorkspaceContext(
  userId: 'u1',
  role: UserRole.known(RoleId.admin),
  effectivePermissions: AccessState(role: UserRole.known(RoleId.admin)),
  countryScope: CountryScope.none,
  siteScope: SiteScope.none,
);

final class _Store extends SecureKeyValueStore {
  final Map<String, String> values = <String, String>{};

  @override
  int get readFailureCount => 0;

  @override
  Future<SecureRead> read(String key) async {
    final String? v = values[key];
    return v == null ? const SecureRead.absent() : SecureRead.ok(v);
  }

  @override
  Future<void> write(String key, String value) async => values[key] = value;

  @override
  Future<void> delete(String key) async => values.remove(key);
}

final class _Repo implements InventoryAuditRepository {
  final List<(String, String)> calls = <(String, String)>[];

  @override
  Future<Object?> completeCounting({
    required String auditId,
    required String idempotencyKey,
  }) async {
    calls.add((auditId, idempotencyKey));
    return <String, Object?>{'status': 'counting_completed'};
  }

  @override
  Future<AuditCounterView> counterView(String auditId) =>
      throw UnimplementedError();

  @override
  Future<List<InventoryAuditSummary>> myAudits() async =>
      const <InventoryAuditSummary>[];

  @override
  Future<CountSubmitResult> submit({
    required String auditId,
    required List<CountLine> lines,
    required String deviceId,
  }) =>
      throw UnimplementedError();

  @override
  Future<String> uploadPhoto({
    required String auditId,
    required String clientUuid,
    required String localPath,
  }) =>
      throw UnimplementedError();
}

AuditCounterView _view(String status) => AuditCounterView(
      audit: InventoryAuditSummary(
        id: 'aud-1',
        reference: 'AUD-9',
        status: status,
      ),
      locations: const <AuditLocation>[AuditLocation(id: 'L1', code: 'A-01')],
      prompts: const <AuditItemPrompt>[],
    );

Future<_Store> _storeWith(List<CountLine> lines) async {
  final _Store store = _Store();
  await CountDraftStore(store).save(
    CountSession(
      auditId: 'aud-1',
      userId: 'u1',
      startedAt: DateTime.utc(2026, 11, 20),
      lines: lines,
    ),
  );
  return store;
}

CountLine _line(String id, CountLineState state) => CountLine(
      clientUuid: id,
      locationId: 'L1',
      scannedCode: 'X',
      countedAt: DateTime.utc(2026, 11, 20, 9),
      countedQty: 1,
      state: state,
    );

Future<void> _pump(
  WidgetTester tester, {
  required _Store store,
  required _Repo repo,
  required String status,
  bool online = true,
  List<String>? keys,
}) async {
  int n = 0;
  await tester.pumpWidget(
    ProviderScope(
      overrides: <Override>[
        workspaceContextProvider.overrideWithValue(_ctx),
        _draftsOverride(store),
        inventoryAuditRepositoryProvider.overrideWithValue(repo),
        inventoryOnlineCheckProvider.overrideWithValue(() async => online),
        inventoryIdFactoryProvider.overrideWithValue(() {
          final String k = 'key-${++n}';
          keys?.add(k);
          return k;
        }),
        auditCounterViewProvider
            .overrideWith((Ref ref, String id) async => _view(status)),
      ],
      child: const MaterialApp(
        localizationsDelegates: TpLocalizations.delegates,
        supportedLocales: TpLocalizations.supportedLocales,
        home: BlindCountScreen(auditId: 'aud-1'),
      ),
    ),
  );
  await tester.pumpAndSettle();
}

Override _draftsOverride(_Store store) =>
    countDraftStoreProvider.overrideWithValue(CountDraftStore(store));

Future<void> _tapFinish(WidgetTester tester) async {
  final Finder button = find.byKey(const Key('inventory.count.finish'));
  await tester.ensureVisible(button);
  await tester.pumpAndSettle();
  await tester.tap(button);
  await tester.pumpAndSettle();
}

void main() {
  testWidgets('not offered while counting is not open', (tester) async {
    await _pump(
      tester,
      store: await _storeWith(const <CountLine>[]),
      repo: _Repo(),
      status: 'assigned',
    );
    expect(find.byKey(const Key('inventory.count.finish')), findsNothing);
  });

  testWidgets('unsent lines: refused, explained, nothing sent', (tester) async {
    final _Repo repo = _Repo();
    await _pump(
      tester,
      store: await _storeWith(<CountLine>[
        _line('a', CountLineState.submitted),
        _line('b', CountLineState.draft),
      ]),
      repo: repo,
      status: 'in_progress',
    );
    await _tapFinish(tester);
    expect(
      find.byKey(const Key('inventory.count.finishConfirm')),
      findsNothing,
    );
    expect(
      find.text(
        '1 lines are still on this phone. Send them before you finish '
        'counting.',
      ),
      findsWidgets,
    );
    expect(repo.calls, isEmpty);
  });

  testWidgets('offline: refused with a clear message, nothing sent',
      (tester) async {
    final _Repo repo = _Repo();
    await _pump(
      tester,
      store: await _storeWith(<CountLine>[
        _line('a', CountLineState.submitted),
      ]),
      repo: repo,
      status: 'in_progress',
      online: false,
    );
    await _tapFinish(tester);
    expect(
      find.byKey(const Key('inventory.count.finishConfirm')),
      findsNothing,
    );
    expect(
      find.text(
        'No connection. Finishing counting needs signal; nothing was changed.',
      ),
      findsOneWidget,
    );
    expect(repo.calls, isEmpty);
  });

  testWidgets('cancel at the confirmation sends nothing', (tester) async {
    final _Repo repo = _Repo();
    final List<String> keys = <String>[];
    await _pump(
      tester,
      store: await _storeWith(const <CountLine>[]),
      repo: repo,
      status: 'recount',
      keys: keys,
    );
    await _tapFinish(tester);
    expect(
      find.byKey(const Key('inventory.count.finishConfirm')),
      findsOneWidget,
    );
    await tester.tap(find.byKey(const Key('inventory.count.finishCancel')));
    await tester.pumpAndSettle();
    expect(repo.calls, isEmpty);
    expect(keys, isEmpty, reason: 'no key is minted for a cancelled press');
  });

  testWidgets('confirmed press sends once, with a fresh key per press',
      (tester) async {
    final _Repo repo = _Repo();
    final List<String> keys = <String>[];
    await _pump(
      tester,
      store: await _storeWith(<CountLine>[
        _line('a', CountLineState.submitted),
      ]),
      repo: repo,
      status: 'in_progress',
      keys: keys,
    );
    await _tapFinish(tester);
    await tester.tap(find.byKey(const Key('inventory.count.finishGo')));
    await tester.pumpAndSettle();
    expect(repo.calls, <(String, String)>[('aud-1', 'key-1')]);
    expect(
      find.text('Counting finished. The audit is ready for reconciliation.'),
      findsOneWidget,
    );

    // A second press is a new request with its own key (let the snackbar
    // from the first press go away so it does not cover the button).
    await tester.pump(const Duration(seconds: 10));
    await tester.pumpAndSettle();
    await _tapFinish(tester);
    await tester.tap(find.byKey(const Key('inventory.count.finishGo')));
    await tester.pumpAndSettle();
    expect(repo.calls.map(((String, String) c) => c.$2), <String>[
      'key-1',
      'key-2',
    ]);
  });
}
