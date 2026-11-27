// Field report 2026-11-27: a Store Keeper tapped "Matches" in airplane mode;
// Pending sync stayed 0 and, once back online, the count never reached
// physical_inventory_captures. The count WAS in the encrypted outbox, but the
// outbox was flushed only once on the connectivity edge (before the network
// answered) and was not counted as pending. These tests reproduce the path:
// offline record -> waiting and counted -> first flush after reconnect still
// fails -> the auto flusher retries -> the count reaches the server.
import 'dart:async';
import 'dart:typed_data';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_riverpod/misc.dart' show Override;
import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/core/errors/app_error.dart';
import 'package:tyre_pulse/core/network/supabase_error_mapper.dart';
import 'package:tyre_pulse/core/permissions/access_resolver.dart';
import 'package:tyre_pulse/core/permissions/roles.dart';
import 'package:tyre_pulse/core/storage/secure_key_value_store.dart';
import 'package:tyre_pulse/core/storage/secure_read.dart';
import 'package:tyre_pulse/core/workspace/workspace_context.dart';
import 'package:tyre_pulse/core/workspace/workspace_providers.dart';
import 'package:tyre_pulse/core/workspace/workspace_scope.dart';
import 'package:tyre_pulse/features/inventory/data/outbox_auto_flusher.dart';
import 'package:tyre_pulse/features/inventory/data/physical_capture_outbox.dart';
import 'package:tyre_pulse/features/inventory/data/physical_inventory_repository.dart';
import 'package:tyre_pulse/features/inventory/domain/physical_capture.dart';
import 'package:tyre_pulse/features/inventory/physical_inventory_providers.dart';
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
      now: () => DateTime.utc(2026, 11, 27, 9),
    );
  });

  void goOffline() {
    repo
      ..sessionsFailure = _fail(SupabaseFailureCause.offline, 'offline')
      ..captureFailure = _fail(SupabaseFailureCause.offline, 'offline');
  }

  void goOnline() {
    repo
      ..sessionsFailure = null
      ..captureFailure = null;
  }

  Future<bool> flushOnce() async {
    final OutboxFlushResult r = await outbox.flush(
      userId: 'u1',
      orgId: 'org-1',
      repository: repo,
    );
    return r.stoppedOffline && r.remaining > 0;
  }

  test(
      'an offline Matches is kept, counted as pending and sent once the '
      'network really answers', () async {
    // Online first: the store's session is found and remembered.
    expect(
      await recorder.record(
        item: _line,
        count: 12,
        reason: null,
        userId: 'u1',
        orgId: 'org-1',
      ),
      StockCountRecordResult.sent,
    );
    expect(repo.captures, hasLength(1));

    goOffline();
    int changes = 0;
    final StreamSubscription<void> sub =
        outbox.changes.listen((_) => changes++);
    final StockCountRecordResult offline = await recorder.record(
      item: _line,
      count: 12,
      reason: null,
      userId: 'u1',
      orgId: 'org-1',
    );
    expect(offline, StockCountRecordResult.savedOnPhone);
    expect(
      await outbox.pendingCount('u1'),
      1,
      reason: 'the offline count must be on the phone and counted',
    );
    expect(
      changes,
      greaterThan(0),
      reason: 'Pending sync re-reads on outbox changes',
    );

    // The radio is back but the first request still fails: this single
    // attempt is all the old binding ever made.
    expect(await flushOnce(), isTrue);
    expect(await outbox.pendingCount('u1'), 1);

    final List<Duration> slept = <Duration>[];
    final OutboxAutoFlusher auto = OutboxAutoFlusher(
      attempt: flushOnce,
      sleep: (Duration d) async {
        slept.add(d);
        goOnline();
      },
    );
    await auto.trigger();

    expect(slept, hasLength(1));
    expect(repo.captures, hasLength(2));
    expect(repo.captures.last['session_id'], repo.captures.first['session_id']);
    expect(repo.captures.last['quantity'], 12.0);
    expect(await outbox.pendingCount('u1'), 0);
    await sub.cancel();
  });

  test(
      'the first count in a store needs a session: offline it is refused '
      'clearly, never silently dropped', () async {
    goOffline();
    await expectLater(
      recorder.record(
        item: _line,
        count: 3,
        reason: 'shelf',
        userId: 'u1',
        orgId: 'org-1',
      ),
      throwsA(
        isA<StockCountRecordFailure>().having(
          (StockCountRecordFailure f) => f.problem,
          'problem',
          StockCountRecordProblem.needsConnectionForSession,
        ),
      ),
    );
    expect(await outbox.pendingCount('u1'), 0);
  });

  test(
      'the auto flusher gives up after its retries and folds overlapping '
      'triggers into one run', () async {
    int attempts = 0;
    final Completer<void> gate = Completer<void>();
    final OutboxAutoFlusher auto = OutboxAutoFlusher(
      attempt: () async {
        attempts++;
        if (attempts == 1) await gate.future;
        return true;
      },
      retryDelays: const <Duration>[Duration.zero, Duration.zero],
      sleep: (Duration d) async {},
    );
    final Future<void> first = auto.trigger();
    await auto.trigger(); // folded into the run in progress
    expect(auto.running, isTrue);
    gate.complete();
    await first;
    expect(attempts, 3, reason: 'one attempt plus two retries, not more');
    expect(auto.running, isFalse);
  });

  test('a run stops as soon as nothing waits', () async {
    int attempts = 0;
    final OutboxAutoFlusher auto = OutboxAutoFlusher(
      attempt: () async {
        attempts++;
        return false;
      },
      sleep: (Duration d) async => fail('no retry needed'),
    );
    await auto.trigger();
    expect(attempts, 1);
  });

  test('Pending sync counts captures waiting in the outbox, live', () async {
    final ProviderContainer container = ProviderContainer(
      overrides: <Override>[
        workspaceContextProvider.overrideWithValue(
          const WorkspaceContext(
            userId: 'u1',
            role: UserRole.known(RoleId.storeKeeper),
            effectivePermissions:
                AccessState(role: UserRole.known(RoleId.storeKeeper)),
            countryScope: CountryScope.none,
            siteScope: SiteScope.none,
          ),
        ),
        physicalCaptureOutboxProvider.overrideWithValue(outbox),
      ],
    );
    addTearDown(container.dispose);
    final List<int> seen = <int>[];
    container.listen<AsyncValue<int>>(
      physicalOutboxPendingCountProvider,
      (_, AsyncValue<int> next) {
        if (next.hasValue) seen.add(next.value!);
      },
      fireImmediately: true,
    );
    expect(await container.read(physicalOutboxPendingCountProvider.future), 0);
    await outbox.add(
      stockCountCapture(
        item: _line,
        count: 2,
        reason: null,
        clientUuid: 'manual-1',
        userId: 'u1',
        sessionId: 's1',
        capturedAt: DateTime.utc(2026, 11, 27),
      ),
    );
    await Future<void>.delayed(Duration.zero);
    await Future<void>.delayed(Duration.zero);
    expect(seen.last, 1);
  });
}
