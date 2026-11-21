// Background / app-wide flush of the physical inventory outbox: only the
// signed-in user's outbox, only when it matches the cached workspace user,
// replays never duplicate, photos upload once, nothing is lost on failure,
// and a failure never escapes the background worker.
import 'dart:convert';
import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/core/errors/app_error.dart';
import 'package:tyre_pulse/core/network/supabase_error_mapper.dart';
import 'package:tyre_pulse/core/storage/secure_key_value_store.dart';
import 'package:tyre_pulse/core/storage/secure_read.dart';
import 'package:tyre_pulse/features/inventory/data/physical_capture_outbox.dart';
import 'package:tyre_pulse/features/inventory/data/physical_inventory_repository.dart';
import 'package:tyre_pulse/features/inventory/data/physical_outbox_runner.dart';
import 'package:tyre_pulse/features/inventory/domain/physical_capture.dart';

final class _Store extends SecureKeyValueStore {
  final Map<String, String> values = <String, String>{};
  final List<String> reads = <String>[];

  @override
  int get readFailureCount => 0;

  @override
  Future<SecureRead> read(String key) async {
    reads.add(key);
    final String? v = values[key];
    return v == null ? const SecureRead.absent() : SecureRead.ok(v);
  }

  @override
  Future<void> write(String key, String value) async => values[key] = value;

  @override
  Future<void> delete(String key) async => values.remove(key);
}

/// A server that keys captures and photos by client_uuid (like the RPCs) and
/// treats an object already at a path as uploaded.
final class _Server implements PhysicalInventoryRepository {
  final Map<String, Map<String, Object?>> captures =
      <String, Map<String, Object?>>{};
  final Map<String, Map<String, Object?>> photos =
      <String, Map<String, Object?>>{};
  final Set<String> objects = <String>{};
  int uploadCalls = 0;
  int captureCalls = 0;
  bool loseNextCaptureResponse = false;
  bool offline = false;
  Error? crash;

  @override
  Future<Map<String, Object?>> capture(Map<String, Object?> payload) async {
    if (crash != null) throw crash!;
    if (offline) {
      throw const SupabaseFailure(
        error: AppError(kind: AppErrorKind.network, message: 'offline'),
        cause: SupabaseFailureCause.offline,
      );
    }
    captureCalls += 1;
    final String id = payload['client_uuid']! as String;
    captures.putIfAbsent(id, () => payload);
    if (loseNextCaptureResponse) {
      loseNextCaptureResponse = false;
      throw const SupabaseFailure(
        error: AppError(kind: AppErrorKind.network, message: 'timeout'),
        cause: SupabaseFailureCause.timeout,
      );
    }
    return <String, Object?>{'id': 'srv-$id', 'temp_ref': 'UNK-$id'};
  }

  @override
  Future<void> upload(String path, Uint8List bytes) async {
    uploadCalls += 1;
    objects.add(path);
  }

  @override
  Future<void> attachPhoto(Map<String, Object?> payload) async {
    photos.putIfAbsent(payload['client_uuid']! as String, () => payload);
  }

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

PendingCapture _capture(String id, String user) => PendingCapture(
      clientUuid: id,
      userId: user,
      sessionId: 's1',
      kind: 'unidentified',
      quantity: 2,
      capturedAt: DateTime.utc(2026, 11, 21, 8),
      refs: const <String, String>{'description': 'filter'},
      photos: <PendingPhoto>[
        PendingPhoto(clientUuid: '$id-p', localPath: '$id.jpg', role: 'item'),
      ],
    );

void main() {
  late _Store store;
  late _Server server;
  late List<String> deleted;
  late PhysicalCaptureOutbox outbox;

  setUp(() {
    store = _Store();
    server = _Server();
    deleted = <String>[];
    outbox = PhysicalCaptureOutbox(
      store,
      readBytes: (String p) async =>
          PhotoBytes(Uint8List.fromList(utf8.encode(p))),
      deleteFile: (String p) async => deleted.add(p),
    );
  });

  Future<PhysicalFlushOutcome?> bg({
    String? signedIn = 'u1',
    String workspaceUser = 'u1',
    String? org = 'org',
  }) =>
      flushPhysicalOutboxInBackground(
        store: store,
        repository: server,
        signedInUserId: signedIn,
        workspaceUserId: workspaceUser,
        orgId: org,
        outbox: outbox,
      );

  test('the background worker sends the signed-in user captures and photos',
      () async {
    store.values[inventoryDeviceIdSlot] = 'dev-1';
    await outbox.add(_capture('c1', 'u1'));
    final PhysicalFlushOutcome? r = await bg();
    expect(r?.result?.sent, 1);
    expect(r?.result?.remaining, 0);
    expect(server.captures['c1']?['device_id'], 'dev-1');
    expect(server.objects, <String>{'physical_inventory/org/s1/c1-p.jpg'});
    expect(server.photos.keys, <String>['c1-p']);
    expect(deleted, <String>['c1.jpg']);
  });

  test('another signed-in user never flushes or reads the cached user outbox',
      () async {
    await outbox.add(_capture('c1', 'u1'));
    store.reads.clear();
    final PhysicalFlushOutcome? r = await bg(signedIn: 'u2');
    expect(r?.skipped, PhysicalFlushSkip.otherUser);
    expect(store.reads, isEmpty);
    expect(server.captures, isEmpty);
    expect((await outbox.pending('u1')).length, 1);
  });

  test('signed out or no organisation: nothing is sent, nothing is lost',
      () async {
    await outbox.add(_capture('c1', 'u1'));
    expect((await bg(signedIn: null))?.skipped, PhysicalFlushSkip.notSignedIn);
    expect((await bg(org: null))?.skipped, PhysicalFlushSkip.noOrganisation);
    expect(server.captureCalls, 0);
    expect((await outbox.pending('u1')).length, 1);
  });

  test('a lost response is replayed by client_uuid without a duplicate',
      () async {
    await outbox.add(_capture('c1', 'u1'));
    server.loseNextCaptureResponse = true;
    final PhysicalFlushOutcome? first = await bg();
    expect(first?.result?.stoppedOffline, isTrue);
    expect((await outbox.pending('u1')).length, 1);
    expect(deleted, isEmpty);
    final PhysicalFlushOutcome? second = await bg();
    expect(second?.result?.sent, 1);
    expect(server.captureCalls, 2);
    expect(server.captures.length, 1);
    expect(server.photos.length, 1);
    expect(server.uploadCalls, 1);
  });

  test('offline keeps everything and the next run sends it once', () async {
    await outbox.add(_capture('c1', 'u1'));
    server.offline = true;
    expect((await bg())?.result?.remaining, 1);
    server.offline = false;
    expect((await bg())?.result?.sent, 1);
    expect((await bg())?.result?.sent, 0);
    expect(server.uploadCalls, 1);
  });

  test('an unexpected failure never escapes the background worker', () async {
    await outbox.add(_capture('c1', 'u1'));
    server.crash = StateError('boom');
    expect(await bg(), isNull);
    expect((await outbox.pending('u1')).length, 1);
    expect(deleted, isEmpty);
  });

  test('a bin label resolves to its store only when that is unambiguous', () {
    const InventoryPlace a = InventoryPlace(
      id: 'a',
      site: 'YARD',
      code: 'WH-A',
      locationType: 'warehouse',
      country: 'KSA',
    );
    const InventoryPlace b = InventoryPlace(
      id: 'b',
      site: 'NHC',
      code: 'WH-B',
      locationType: 'warehouse',
      country: 'KSA',
    );
    const InventoryPlace bin = InventoryPlace(
      id: 'x',
      site: 'yard',
      code: 'BIN-1',
      locationType: 'bin',
      country: 'KSA',
    );
    expect(storeForPlace(a, <InventoryPlace>[a, b])?.id, 'a');
    expect(storeForPlace(bin, <InventoryPlace>[a, b])?.id, 'a');
    const InventoryPlace a2 = InventoryPlace(
      id: 'a2',
      site: 'YARD',
      code: 'WH-A2',
      locationType: 'warehouse',
      country: 'KSA',
    );
    expect(storeForPlace(bin, <InventoryPlace>[a, a2, b]), isNull);
  });
}
