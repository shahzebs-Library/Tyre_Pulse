// Physical inventory outbox on the phone: offline save, replay without
// duplicates, photos uploaded once, refusals kept with their reason, and one
// user never sees another user's captures (docs/inventory/102 section 6).
import 'dart:convert';
import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/core/errors/app_error.dart';
import 'package:tyre_pulse/core/network/supabase_error_mapper.dart';
import 'package:tyre_pulse/core/storage/secure_key_value_store.dart';
import 'package:tyre_pulse/core/storage/secure_read.dart';
import 'package:tyre_pulse/features/inventory/data/physical_capture_outbox.dart';
import 'package:tyre_pulse/features/inventory/data/physical_inventory_repository.dart';
import 'package:tyre_pulse/features/inventory/domain/physical_capture.dart';

final class _Store extends SecureKeyValueStore {
  final Map<String, String> values = <String, String>{};
  bool failReads = false;

  @override
  int get readFailureCount => 0;

  @override
  Future<SecureRead> read(String key) async {
    if (failReads) return const SecureRead.unreadable();
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
  final Map<String, Map<String, Object?>> captures =
      <String, Map<String, Object?>>{};
  final List<String> uploads = <String>[];
  final List<Map<String, Object?>> attached = <Map<String, Object?>>[];
  SupabaseFailure? captureFailure;
  SupabaseFailure? attachFailure;

  @override
  Future<Map<String, Object?>> capture(Map<String, Object?> payload) async {
    if (captureFailure != null) throw captureFailure!;
    final String id = payload['client_uuid']! as String;
    captures[id] = payload;
    return <String, Object?>{
      'id': 'srv-$id',
      'temp_ref': payload['kind'] == 'identified' ? null : 'UNK-$id',
    };
  }

  @override
  Future<void> upload(String path, Uint8List bytes) async => uploads.add(path);

  @override
  Future<void> attachPhoto(Map<String, Object?> payload) async {
    if (attachFailure != null) throw attachFailure!;
    attached.add(payload);
  }

  @override
  Future<List<PhysicalSession>> openSessions() async =>
      const <PhysicalSession>[];

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

PendingCapture _capture(
  String id, {
  String user = 'u1',
  List<PendingPhoto> photos = const <PendingPhoto>[],
}) =>
    PendingCapture(
      clientUuid: id,
      userId: user,
      sessionId: 's1',
      kind: 'unidentified',
      quantity: 3,
      capturedAt: DateTime.utc(2026, 11, 21, 8),
      refs: const <String, String>{'description': 'seal kit'},
      photos: photos,
    );

void main() {
  late _Store store;
  late _Repo repo;
  late List<String> deleted;
  late PhysicalCaptureOutbox outbox;

  setUp(() {
    store = _Store();
    repo = _Repo();
    deleted = <String>[];
    outbox = PhysicalCaptureOutbox(
      store,
      readBytes: (String p) async =>
          p == 'missing.jpg' ? null : Uint8List.fromList(utf8.encode('img:$p')),
      deleteFile: (String p) async => deleted.add(p),
    );
  });

  test('rules mirror the server: normalised refs, quantity, capture kind', () {
    expect(normRef('abc-123 / x'), 'ABC123X');
    expect(normRef('  '), isNull);
    expect(parseQty('0'), 0);
    expect(parseQty('2,5'), 2.5);
    expect(parseQty('-1'), isNull);
    expect(parseQty('x'), isNull);
    expect(
      captureKindFor(canonicalId: 'c', refs: const <String, String>{}),
      'identified',
    );
    expect(
      captureKindFor(
        canonicalId: null,
        refs: const <String, String>{'oem': 'A1'},
      ),
      'proposed_new',
    );
    expect(
      captureKindFor(canonicalId: null, refs: const <String, String>{}),
      'unidentified',
    );
    expect(piPhotoPath('org', 's', 'p'), 'physical_inventory/org/s/p.jpg');
  });

  test('offline: the capture stays on the phone and nothing is lost', () async {
    await outbox.add(_capture('c1'));
    repo.captureFailure = _fail(SupabaseFailureCause.offline);
    final OutboxFlushResult r =
        await outbox.flush(userId: 'u1', orgId: 'org', repository: repo);
    expect(r.stoppedOffline, isTrue);
    expect(r.remaining, 1);
    expect((await outbox.pending('u1')).single.clientUuid, 'c1');
  });

  test('sends the capture and each photo once, then clears local copies',
      () async {
    await outbox.add(
      _capture(
        'c1',
        photos: const <PendingPhoto>[
          PendingPhoto(clientUuid: 'p1', localPath: 'a.jpg', role: 'label'),
          PendingPhoto(clientUuid: 'p2', localPath: 'b.jpg', role: 'location'),
        ],
      ),
    );
    await outbox.add(_capture('c1')); // a double tap: same client_uuid
    expect((await outbox.pending('u1')).length, 1);
    final OutboxFlushResult r =
        await outbox.flush(userId: 'u1', orgId: 'org', repository: repo);
    expect(r.sent, 1);
    expect(r.remaining, 0);
    expect(repo.captures.keys, <String>['c1']);
    expect(repo.uploads, <String>[
      'physical_inventory/org/s1/p1.jpg',
      'physical_inventory/org/s1/p2.jpg',
    ]);
    expect(
      repo.attached.map((Map<String, Object?> a) => a['capture_id']).toSet(),
      <String>{'srv-c1'},
    );
    expect((repo.attached.first['sha256']! as String).length, 64);
    expect(repo.attached.first['purpose'], 'identification');
    expect(deleted, <String>['a.jpg', 'b.jpg']);
  });

  test('a failed attach is retried without uploading the photo again',
      () async {
    await outbox.add(
      _capture(
        'c1',
        photos: const <PendingPhoto>[
          PendingPhoto(clientUuid: 'p1', localPath: 'a.jpg', role: 'item'),
        ],
      ),
    );
    repo.attachFailure = _fail(SupabaseFailureCause.timeout);
    await outbox.flush(userId: 'u1', orgId: 'org', repository: repo);
    final PendingCapture left = (await outbox.pending('u1')).single;
    expect(left.captureSent, isTrue);
    expect(left.photos.single.storagePath, isNotNull);
    repo.attachFailure = null;
    await outbox.flush(userId: 'u1', orgId: 'org', repository: repo);
    expect(repo.uploads.length, 1, reason: 'bytes are uploaded once');
    expect(repo.attached.length, 1);
    expect(await outbox.pending('u1'), isEmpty);
  });

  test('a refusal is kept with its reason, never dropped', () async {
    await outbox.add(_capture('c1'));
    repo.captureFailure = _fail(
      SupabaseFailureCause.rowLevelSecurity,
      'Store outside your scope.',
    );
    final OutboxFlushResult r =
        await outbox.flush(userId: 'u1', orgId: 'org', repository: repo);
    expect(r.refused, 1);
    expect(
      (await outbox.pending('u1')).single.lastError,
      'Store outside your scope.',
    );
  });

  test('another user on the same phone never sees these captures', () async {
    await outbox.add(_capture('c1'));
    expect(await outbox.pending('u2'), isEmpty);
    await outbox.flush(userId: 'u2', orgId: 'org', repository: repo);
    expect(repo.captures, isEmpty);
  });

  test('an unreadable store refuses to write instead of wiping the queue',
      () async {
    await outbox.add(_capture('c1'));
    store.failReads = true;
    expect(
      () => outbox.add(_capture('c2')),
      throwsA(isA<StorageReadFailure>()),
    );
    store.failReads = false;
    expect((await outbox.pending('u1')).length, 1);
  });

  test('search results put genuine before aftermarket and skip unapproved', () {
    final List<MaterialPick> picks = MaterialPick.fromSearch(<String, Object?>{
      'results': <Object?>[
        <String, Object?>{
          'canonical_id': 'c',
          'description': 'Oil filter',
          'status': 'active',
          'variants': <Object?>[
            <String, Object?>{
              'variant_id': 'a',
              'classification': 'aftermarket',
              'status': 'active',
              'part_number': 'FC1',
            },
            <String, Object?>{
              'variant_id': 'g',
              'classification': 'genuine',
              'status': 'active',
              'part_number': 'OEM1',
            },
            <String, Object?>{
              'variant_id': 'p',
              'classification': 'genuine',
              'status': 'proposed',
            },
          ],
        },
        <String, Object?>{
          'canonical_id': 'x',
          'description': 'Proposed',
          'status': 'proposed',
        },
      ],
    });
    expect(
      picks.map((MaterialPick p) => p.variantId),
      <String?>['g', 'a', null],
    );
  });
}
