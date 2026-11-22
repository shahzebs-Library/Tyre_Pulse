// Two outbox instances over one secure-store slot (the foreground app and the
// background worker): a capture added while the other instance removes a
// finished one must never be lost. Proves the lock is load-bearing with a
// no-lock control, and covers the lock file itself (stale break, timeout).
import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/core/storage/secure_key_value_store.dart';
import 'package:tyre_pulse/core/storage/secure_read.dart';
import 'package:tyre_pulse/features/inventory/data/outbox_lock.dart';
import 'package:tyre_pulse/features/inventory/data/physical_capture_outbox.dart';
import 'package:tyre_pulse/features/inventory/data/physical_inventory_repository.dart';
import 'package:tyre_pulse/features/inventory/domain/physical_capture.dart';

/// A store whose reads and writes yield, so two read-modify-writes interleave
/// exactly as they can across isolates.
final class _SlowStore extends SecureKeyValueStore {
  final Map<String, String> values = <String, String>{};

  @override
  int get readFailureCount => 0;

  @override
  Future<SecureRead> read(String key) async {
    final String? v = values[key];
    await Future<void>.delayed(const Duration(milliseconds: 15));
    return v == null ? const SecureRead.absent() : SecureRead.ok(v);
  }

  @override
  Future<void> write(String key, String value) async {
    await Future<void>.delayed(const Duration(milliseconds: 15));
    values[key] = value;
  }

  @override
  Future<void> delete(String key) async {
    await Future<void>.delayed(const Duration(milliseconds: 15));
    values.remove(key);
  }
}

/// No mutual exclusion at all: what two separate isolates had before.
final class _NoLock implements OutboxLock {
  @override
  Future<T> run<T>(Future<T> Function() body) => body();
}

final class _Repo implements PhysicalInventoryRepository {
  int captures = 0;

  @override
  Future<Map<String, Object?>> capture(Map<String, Object?> payload) async {
    captures += 1;
    return <String, Object?>{'id': 'srv-${payload['client_uuid']}'};
  }

  @override
  Future<void> upload(String path, Uint8List bytes) async {}

  @override
  Future<void> attachPhoto(Map<String, Object?> payload) async {}

  @override
  Future<List<PhysicalSession>> openSessions() async =>
      const <PhysicalSession>[];

  @override
  Future<List<InventoryPlace>> stores() async => const <InventoryPlace>[];

  @override
  Future<InventoryPlace?> placeById(String id) async => null;

  @override
  Future<List<MaterialPick>> search(String query) async =>
      const <MaterialPick>[];

  @override
  Future<PhysicalSession> startSession({
    required String idempotencyKey,
    required String country,
    required String site,
    String? locationId,
  }) =>
      throw UnimplementedError();
}

PendingCapture _capture(String id) => PendingCapture(
      clientUuid: id,
      userId: 'u1',
      sessionId: 's1',
      kind: 'unidentified',
      quantity: 1,
      capturedAt: DateTime.utc(2026, 11, 21),
      refs: const <String, String>{'description': 'x'},
    );

PhysicalCaptureOutbox _outbox(SecureKeyValueStore store, OutboxLock lock) =>
    PhysicalCaptureOutbox(
      store,
      readBytes: (String p) async =>
          PhotoBytes(Uint8List.fromList(utf8.encode(p))),
      lock: lock,
    );

/// Instance A (background) flushes c1 to completion and removes it; while
/// that is in flight instance B (foreground) adds c2.
Future<List<String>> _interleave(OutboxLock lockA, OutboxLock lockB) async {
  final _SlowStore store = _SlowStore();
  final PhysicalCaptureOutbox a = _outbox(store, lockA);
  final PhysicalCaptureOutbox b = _outbox(store, lockB);
  await a.add(_capture('c1'));
  final Future<OutboxFlushResult> flushing =
      a.flush(userId: 'u1', orgId: 'org', repository: _Repo());
  // Land B's add inside A's final remove (read, then write back).
  await Future<void>.delayed(const Duration(milliseconds: 40));
  await b.add(_capture('c2'));
  await flushing;
  return (await b.pending('u1'))
      .map((PendingCapture c) => c.clientUuid)
      .toList();
}

void main() {
  late Directory dir;

  setUp(() async => dir = await Directory.systemTemp.createTemp('pi_lock'));
  tearDown(() async => dir.delete(recursive: true));

  FileOutboxLock fileLock({
    Duration stale = const Duration(seconds: 60),
    Duration timeout = const Duration(seconds: 20),
  }) =>
      FileOutboxLock(
        () async => '${dir.path}/outbox.lock',
        staleAfter: stale,
        timeout: timeout,
      );

  test('control: without a shared lock two writers overwrite each other',
      () async {
    // Both read the same list before either writes, as two isolates can.
    final _SlowStore store = _SlowStore();
    await Future.wait(<Future<void>>[
      _outbox(store, _NoLock()).add(_capture('c1')),
      _outbox(store, _NoLock()).add(_capture('c2')),
    ]);
    expect(
      (await _outbox(store, _NoLock()).pending('u1')).length,
      lessThan(2),
    );
  });

  test('two instances sharing the lock file never lose a capture', () async {
    // Separate FileOutboxLock objects on the same path, as two isolates have.
    final List<String> left = await _interleave(fileLock(), fileLock());
    expect(left, <String>['c2']);
    expect(File('${dir.path}/outbox.lock').existsSync(), isFalse);
  });

  test('every interleaving keeps every added capture', () async {
    final _SlowStore store = _SlowStore();
    final PhysicalCaptureOutbox a = _outbox(store, fileLock());
    final PhysicalCaptureOutbox b = _outbox(store, fileLock());
    await Future.wait(<Future<void>>[
      for (int i = 0; i < 6; i++) (i.isEven ? a : b).add(_capture('c$i')),
    ]);
    expect((await a.pending('u1')).length, 6);
  });

  test('a stale lock left by a killed holder is broken', () async {
    final File f = File('${dir.path}/outbox.lock')..writeAsStringSync('dead');
    f.setLastModifiedSync(DateTime.now().subtract(const Duration(minutes: 5)));
    final int v = await fileLock().run(() async => 7);
    expect(v, 7);
    expect(f.existsSync(), isFalse);
  });

  test('a live lock is waited for, then times out without running', () async {
    File('${dir.path}/outbox.lock').writeAsStringSync('someone');
    bool ran = false;
    await expectLater(
      fileLock(timeout: const Duration(milliseconds: 100))
          .run(() async => ran = true),
      throwsA(isA<OutboxLockTimeout>()),
    );
    expect(ran, isFalse);
  });
}
