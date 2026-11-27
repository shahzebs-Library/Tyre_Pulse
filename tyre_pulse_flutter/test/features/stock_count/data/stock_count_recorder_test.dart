// Stock Count records a physical count line (evidence), never a stock change:
// a count difference needs an approver (WP5). The line goes through the
// physical inventory outbox, so it survives offline and is sent once.
import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/core/errors/app_error.dart';
import 'package:tyre_pulse/core/network/supabase_error_mapper.dart';
import 'package:tyre_pulse/core/storage/secure_key_value_store.dart';
import 'package:tyre_pulse/core/storage/secure_read.dart';
import 'package:tyre_pulse/features/inventory/data/physical_capture_outbox.dart';
import 'package:tyre_pulse/features/inventory/data/physical_inventory_repository.dart';
import 'package:tyre_pulse/features/inventory/domain/physical_capture.dart';
import 'package:tyre_pulse/features/stock_count/data/stock_count_recorder.dart';
import 'package:tyre_pulse/features/stock_count/domain/stock_item.dart';

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

SupabaseFailure _fail(SupabaseFailureCause cause, [String msg = 'refused']) =>
    SupabaseFailure(
      error: AppError(kind: AppErrorKind.server, message: msg),
      cause: cause,
    );

final class _Repo implements PhysicalInventoryRepository {
  List<PhysicalSession> open = <PhysicalSession>[];
  final List<Map<String, Object?>> captures = <Map<String, Object?>>[];
  final List<String> started = <String>[];
  SupabaseFailure? sessionsFailure;
  SupabaseFailure? captureFailure;

  @override
  Future<List<PhysicalSession>> openSessions() async {
    if (sessionsFailure != null) throw sessionsFailure!;
    return open;
  }

  @override
  Future<PhysicalSession> startSession({
    required String idempotencyKey,
    required String country,
    required String site,
    String? locationId,
  }) async {
    if (sessionsFailure != null) throw sessionsFailure!;
    started.add('$country|$site');
    final PhysicalSession s = PhysicalSession(
      id: 'new-session',
      reference: 'PI-1',
      site: site.toUpperCase(),
      status: 'open',
      country: country,
    );
    open = <PhysicalSession>[...open, s];
    return s;
  }

  @override
  Future<Map<String, Object?>> capture(Map<String, Object?> payload) async {
    if (captureFailure != null) throw captureFailure!;
    captures.add(payload);
    return <String, Object?>{'id': 'srv-${payload['client_uuid']}'};
  }

  @override
  Future<List<InventoryPlace>> stores() async => const <InventoryPlace>[];

  @override
  Future<InventoryPlace?> placeById(String id) async => null;

  @override
  Future<List<MaterialPick>> search(String query) async =>
      const <MaterialPick>[];

  @override
  Future<void> upload(String path, Uint8List bytes) async {}

  @override
  Future<void> attachPhoto(Map<String, Object?> payload) async {}
}

const StockItem _line = StockItem(
  id: 'stock-1',
  site: 'NHC',
  description: '315/80R22.5 TRIANGLE',
  quantity: 12,
  country: 'KSA',
  itemId: 'item-9',
  locationId: 'loc-1',
  condition: 'new',
  ownership: 'owned',
);

void main() {
  late _Store store;
  late _Repo repo;
  late PhysicalCaptureOutbox outbox;
  late StockCountRecorder recorder;
  int n = 0;

  setUp(() {
    store = _Store();
    repo = _Repo();
    outbox = PhysicalCaptureOutbox(
      store,
      readBytes: (String p) async => const PhotoMissing(),
    );
    n = 0;
    recorder = StockCountRecorder(
      repository: repo,
      outbox: outbox,
      store: store,
      newId: () => 'id-${n++}',
      now: () => DateTime.utc(2026, 11, 24, 9),
    );
  });

  test('the capture is an identified count line, never an expected qty', () {
    final PendingCapture c = stockCountCapture(
      item: _line,
      count: 9,
      reason: '  ',
      clientUuid: 'c1',
      userId: 'u1',
      sessionId: 's1',
      capturedAt: DateTime.utc(2026),
    );
    final Map<String, Object?> p = c.toPayload();
    expect(p['kind'], 'identified');
    expect(p['item_id'], 'item-9');
    expect(p['quantity'], 9);
    expect(p['location_id'], 'loc-1');
    expect(p['remarks'], isNull);
    expect((p['refs']! as Map)['stock_id'], 'stock-1');
    expect(p.values, isNot(contains(12)), reason: 'system qty never sent');
  });

  test('the genuine mark travels in the payload and survives the outbox', () {
    final PendingCapture c = stockCountCapture(
      item: _line,
      count: 12,
      reason: null,
      clientUuid: 'c1',
      userId: 'u1',
      sessionId: 's1',
      capturedAt: DateTime.utc(2026),
      genuine: false,
      genuineNote: '  copy part ',
    );
    final Map<String, Object?> p = c.toPayload();
    expect(p['genuine'], false);
    expect(p['genuine_note'], 'copy part');
    final PendingCapture back = PendingCapture.fromJson(c.toJson());
    expect(back.genuine, false);
    expect(back.genuineNote, 'copy part');
    expect(back.copyWith(serverId: 'x').genuine, false);

    // Not stated: the keys are left out (an older server ignores them).
    final Map<String, Object?> none = stockCountCapture(
      item: _line,
      count: 1,
      reason: null,
      clientUuid: 'c2',
      userId: 'u1',
      sessionId: 's1',
      capturedAt: DateTime.utc(2026),
    ).toPayload();
    expect(none.containsKey('genuine'), isFalse);
    expect(none.containsKey('genuine_note'), isFalse);
  });

  test('a line without an ERP item is proposed for review', () {
    final PendingCapture c = stockCountCapture(
      item: const StockItem(id: 's', site: 'NHC', description: 'Seal kit'),
      count: 1,
      reason: null,
      clientUuid: 'c1',
      userId: 'u1',
      sessionId: 's1',
      capturedAt: DateTime.utc(2026),
    );
    expect(c.kind, 'proposed_new');
    expect(c.condition, 'unknown');
  });

  test('online: starts a session once, sends, and reuses the session',
      () async {
    final StockCountRecordResult r = await recorder.record(
      item: _line,
      count: 9,
      reason: 'shelf B',
      userId: 'u1',
      orgId: 'org',
    );
    expect(r, StockCountRecordResult.sent);
    expect(repo.started, <String>['KSA|NHC']);
    expect(repo.captures.single['session_id'], 'new-session');
    expect(await outbox.pending('u1'), isEmpty);

    await recorder.record(
      item: _line,
      count: 8,
      reason: null,
      userId: 'u1',
      orgId: 'org',
    );
    expect(repo.started, hasLength(1), reason: 'session reused');
    expect(repo.captures, hasLength(2));
  });

  test('an open session for the store is joined, not duplicated', () async {
    repo.open = <PhysicalSession>[
      const PhysicalSession(
        id: 'other-site',
        reference: 'x',
        site: 'DIRIYAH',
        status: 'open',
        country: 'KSA',
      ),
      const PhysicalSession(
        id: 'nhc',
        reference: 'y',
        site: 'NHC',
        status: 'open',
        country: 'KSA',
      ),
    ];
    await recorder.record(
      item: _line,
      count: 3,
      reason: null,
      userId: 'u1',
      orgId: 'org',
    );
    expect(repo.started, isEmpty);
    expect(repo.captures.single['session_id'], 'nhc');
  });

  test('offline after a session is known: saved on the phone, sent later',
      () async {
    await recorder.record(
      item: _line,
      count: 9,
      reason: null,
      userId: 'u1',
      orgId: 'org',
    );
    repo
      ..sessionsFailure = _fail(SupabaseFailureCause.offline)
      ..captureFailure = _fail(SupabaseFailureCause.offline);
    final StockCountRecordResult r = await recorder.record(
      item: _line,
      count: 7,
      reason: null,
      userId: 'u1',
      orgId: 'org',
    );
    expect(r, StockCountRecordResult.savedOnPhone);
    expect(await outbox.pending('u1'), hasLength(1));

    repo
      ..sessionsFailure = null
      ..captureFailure = null;
    await outbox.flush(userId: 'u1', orgId: 'org', repository: repo);
    await outbox.flush(userId: 'u1', orgId: 'org', repository: repo);
    expect(repo.captures.where((m) => m['quantity'] == 7), hasLength(1));
    expect(await outbox.pending('u1'), isEmpty);
  });

  test('offline with no session for the store: nothing saved, says why',
      () async {
    repo.sessionsFailure = _fail(SupabaseFailureCause.offline);
    await expectLater(
      recorder.record(
        item: _line,
        count: 1,
        reason: null,
        userId: 'u1',
        orgId: 'org',
      ),
      throwsA(
        isA<StockCountRecordFailure>().having(
          (StockCountRecordFailure f) => f.problem,
          'problem',
          StockCountRecordProblem.needsConnectionForSession,
        ),
      ),
    );
    expect(await outbox.pending('u1'), isEmpty);
  });

  test('a server refusal is kept on the phone with its reason', () async {
    repo.captureFailure = _fail(
      SupabaseFailureCause.forbidden,
      'Recording a physical inventory capture needs stock:count.',
    );
    await expectLater(
      recorder.record(
        item: _line,
        count: 1,
        reason: null,
        userId: 'u1',
        orgId: 'org',
      ),
      throwsA(isA<StockCountRefused>()),
    );
    final List<PendingCapture> left = await outbox.pending('u1');
    expect(left.single.lastError, contains('stock:count'));
  });

  test('no store or country: refused before anything is saved', () async {
    await expectLater(
      recorder.record(
        item: const StockItem(id: 's', description: 'x'),
        count: 1,
        reason: null,
        userId: 'u1',
        orgId: 'org',
        fallbackCountry: 'All',
      ),
      throwsA(isA<StockCountRecordFailure>()),
    );
    expect(repo.started, isEmpty);
  });

  group('Add stock (new line for approval)', () {
    test('the capture is a proposed new line, never a stock write', () {
      final PendingCapture c = newStockCapture(
        size: ' 315/80R22.5 ',
        description: 'Triangle',
        quantity: 6,
        clientUuid: 'c1',
        userId: 'u1',
        sessionId: 's1',
        capturedAt: DateTime.utc(2026),
      );
      final Map<String, Object?> p = c.toPayload();
      expect(p['kind'], 'proposed_new');
      expect(p['item_id'], isNull);
      expect(p['canonical_id'], isNull);
      expect(p['quantity'], 6);
      expect(p['condition'], 'unknown', reason: 'not stated, stays unknown');
      expect(p['client_uuid'], 'c1');
      expect(p['idempotency_key'], 'c1');
      final Map<Object?, Object?> refs = p['refs']! as Map<Object?, Object?>;
      expect(refs['description'], '315/80R22.5 Triangle');
      expect(refs['tyre_size'], '315/80R22.5');
      expect(refs['source'], 'stock_count_add');
      expect(refs.containsKey('stock_id'), isFalse);
    });

    test('online: recorded through the capture RPC in that store', () async {
      final StockCountRecordResult r = await recorder.recordNew(
        size: '315/80R22.5',
        description: null,
        site: 'nhc',
        quantity: 4,
        country: 'KSA',
        userId: 'u1',
        orgId: 'org',
      );
      expect(r, StockCountRecordResult.sent);
      expect(repo.started, <String>['KSA|nhc']);
      expect(repo.captures.single['kind'], 'proposed_new');
      expect(repo.captures.single['quantity'], 4);
      expect(await outbox.pending('u1'), isEmpty);
    });

    test('offline with a known session: saved once, sent once', () async {
      await recorder.recordNew(
        size: '315/80R22.5',
        description: null,
        site: 'NHC',
        quantity: 1,
        country: 'KSA',
        userId: 'u1',
        orgId: 'org',
      );
      repo
        ..sessionsFailure = _fail(SupabaseFailureCause.offline)
        ..captureFailure = _fail(SupabaseFailureCause.offline);
      final StockCountRecordResult r = await recorder.recordNew(
        size: '385/65R22.5',
        description: 'Spare',
        site: 'NHC',
        quantity: 9,
        country: 'KSA',
        userId: 'u1',
        orgId: 'org',
      );
      expect(r, StockCountRecordResult.savedOnPhone);
      repo
        ..sessionsFailure = null
        ..captureFailure = null;
      await outbox.flush(userId: 'u1', orgId: 'org', repository: repo);
      await outbox.flush(userId: 'u1', orgId: 'org', repository: repo);
      expect(repo.captures.where((m) => m['quantity'] == 9), hasLength(1));
      expect(await outbox.pending('u1'), isEmpty);
    });

    test('All countries or no store: refused, nothing saved', () async {
      for (final String? country in <String?>['All', null, '  ']) {
        await expectLater(
          recorder.recordNew(
            size: '315/80R22.5',
            description: null,
            site: 'NHC',
            quantity: 2,
            country: country,
            userId: 'u1',
            orgId: 'org',
          ),
          throwsA(
            isA<StockCountRecordFailure>().having(
              (StockCountRecordFailure f) => f.problem,
              'problem',
              StockCountRecordProblem.noPlace,
            ),
          ),
        );
      }
      await expectLater(
        recorder.recordNew(
          size: '315/80R22.5',
          description: null,
          site: ' ',
          quantity: 2,
          country: 'KSA',
          userId: 'u1',
          orgId: 'org',
        ),
        throwsA(isA<StockCountRecordFailure>()),
      );
      expect(repo.started, isEmpty);
      expect(await outbox.pending('u1'), isEmpty);
    });

    test('a server refusal is kept on the phone with its reason', () async {
      repo.captureFailure = _fail(
        SupabaseFailureCause.forbidden,
        'Recording a physical inventory capture needs stock:count.',
      );
      await expectLater(
        recorder.recordNew(
          size: '315/80R22.5',
          description: null,
          site: 'NHC',
          quantity: 2,
          country: 'KSA',
          userId: 'u1',
          orgId: 'org',
        ),
        throwsA(isA<StockCountRefused>()),
      );
      expect((await outbox.pending('u1')).single.kind, 'proposed_new');
    });
  });
}
