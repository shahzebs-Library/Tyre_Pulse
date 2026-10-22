import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/core/storage/secure_key_value_store.dart';
import 'package:tyre_pulse/core/storage/secure_read.dart';
import 'package:tyre_pulse/features/my_work/data/workforce_assignment_cache.dart';

final class _Store extends SecureKeyValueStore {
  final Map<String, String> values = <String, String>{};
  bool failReads = false;
  bool failWrites = false;
  bool failDeletes = false;

  @override
  int get readFailureCount => 0;

  @override
  Future<SecureRead> read(String key) async {
    if (failReads) return const SecureRead.unreadable();
    final String? v = values[key];
    return v == null ? const SecureRead.absent() : SecureRead.ok(v);
  }

  @override
  Future<void> write(String key, String value) async {
    if (failWrites) throw StateError('write refused');
    values[key] = value;
  }

  @override
  Future<void> delete(String key) async {
    if (failDeletes) throw StateError('delete refused');
    values.remove(key);
  }
}

const List<Map<String, Object?>> _rows = <Map<String, Object?>>[
  <String, Object?>{'id': 'a1', 'title': 'Replace tyre', 'status': 'assigned'},
];

void main() {
  late _Store store;
  late DateTime now;
  late WorkforceAssignmentCache cache;

  setUp(() {
    store = _Store();
    now = DateTime.utc(2026, 10, 22, 8);
    cache = WorkforceAssignmentCache(store, clock: () => now);
  });

  test('round-trips for the same user', () async {
    await cache.save(userId: 'u1', rows: _rows);
    final List<Map<String, Object?>>? loaded = await cache.load('u1');
    expect(loaded, isNotNull);
    expect(loaded!.single['title'], 'Replace tyre');
  });

  test('empty and unknown slots load as null', () async {
    expect(await cache.load('u1'), isNull);
  });

  test('another user never reads it, and the slot is deleted on that attempt',
      () async {
    await cache.save(userId: 'u1', rows: _rows);

    expect(await cache.load('u2'), isNull);
    expect(store.values, isEmpty);
    // The first user's data is gone for good, not merely hidden.
    expect(await cache.load('u1'), isNull);
  });

  test('a later save by another user replaces the slot (single slot)',
      () async {
    await cache.save(userId: 'u1', rows: _rows);
    await cache.save(userId: 'u2', rows: const <Map<String, Object?>>[]);
    expect(store.values.keys, <String>[WorkforceAssignmentCache.slot]);
    expect(await cache.load('u1'), isNull);
  });

  test('clear removes the slot', () async {
    await cache.save(userId: 'u1', rows: _rows);
    await cache.clear();
    expect(store.values, isEmpty);
  });

  test('expired data is discarded, not shown', () async {
    await cache.save(userId: 'u1', rows: _rows);
    now = now.add(const Duration(days: 31));
    expect(await cache.load('u1'), isNull);
    expect(store.values, isEmpty);
  });

  test('data inside the age limit is still served', () async {
    await cache.save(userId: 'u1', rows: _rows);
    now = now.add(const Duration(days: 29));
    expect(await cache.load('u1'), isNotNull);
  });

  test('corrupt content is discarded and reported as no cache', () async {
    store.values[WorkforceAssignmentCache.slot] = '{not json';
    expect(await cache.load('u1'), isNull);
    expect(store.values, isEmpty);
  });

  test('wrong shape is discarded', () async {
    store.values[WorkforceAssignmentCache.slot] = '[1,2,3]';
    expect(await cache.load('u1'), isNull);
    expect(store.values, isEmpty);
  });

  test('storage faults never throw', () async {
    store.failWrites = true;
    await cache.save(userId: 'u1', rows: _rows);

    store.failReads = true;
    expect(await cache.load('u1'), isNull);

    store.failDeletes = true;
    await cache.clear();
  });

  test('an unreadable store does not delete what it could not read', () async {
    await cache.save(userId: 'u1', rows: _rows);
    store.failReads = true;
    expect(await cache.load('u1'), isNull);
    store.failReads = false;
    expect(await cache.load('u1'), isNotNull);
  });
}
