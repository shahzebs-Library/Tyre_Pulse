/// The durable secure store: staged writes with a single commit point, and
/// reads that report why they were empty.
///
/// Pure Dart on top of [SecureSlotStore]. No Flutter, no plugin, no platform -
/// so every rule below is verifiable against a fake that fails on demand, which
/// is the only way this behaviour can be tested at all. On a real device the
/// failures it defends against appear perhaps once in thousands of writes, and
/// the code path that gets them wrong compiles and behaves perfectly whenever
/// nothing fails. That is exactly how the original bug survived.
///
/// ## Why a write is staged
///
/// Ported from `mobile/lib/secureStorage.ts`. The naive write deletes the old
/// value and then writes the new one, which leaves a window where the previous
/// value is already gone and the new one does not exist yet. Every way of
/// landing in that window is real on this fleet's hardware: a keystore write is
/// a binder IPC that can be refused (a key invalidated by a lock-screen change,
/// a restore from backup, a stalled call this app has been ANR-reported for),
/// and Android can kill the process the moment the user backgrounds it.
/// Interrupted there, the value was unrecoverable - for the session that is a
/// forced re-login for somebody who does not know their password, and for a
/// queue it is an inspector's unsynced work destroyed with no error shown.
///
/// So every write goes to a NEW generation of slots and the metadata write is
/// the single commit point. Before it, a reader still sees the complete
/// previous value; after it, the complete new one. The previous generation is
/// retired only afterwards, and failing to retire it costs a few stale slots,
/// never data.
///
/// **Stated cost:** a write interrupted before the commit leaves its
/// half-written generation behind with nothing pointing at it. That is
/// deliberate. Orphaned bytes are recoverable by reinstalling; a destroyed
/// session or queue is not.
library;

import 'dart:async';
import 'dart:convert';
import 'dart:math';

import 'package:tyre_pulse/core/errors/app_error.dart';
import 'package:tyre_pulse/core/storage/secure_key_value_store.dart';
import 'package:tyre_pulse/core/storage/secure_read.dart';
import 'package:tyre_pulse/core/storage/secure_slot_store.dart';

/// Committed pointer to one generation of value slots.
///
/// Writing this record is what makes a value visible. Nothing else does.
class _ChunkMeta {
  const _ChunkMeta({required this.chunks, required this.generation});

  final int chunks;
  final String generation;
}

class _SlotRead {
  const _SlotRead(this.value, {required this.unreadable});

  final String? value;
  final bool unreadable;
}

class _MetaRead {
  const _MetaRead(this.meta, {required this.unreadable});

  final _ChunkMeta? meta;
  final bool unreadable;
}

/// A [SecureKeyValueStore] whose writes cannot destroy the previous value and
/// whose reads say why they were empty.
class StagedSecureStore extends SecureKeyValueStore {
  StagedSecureStore({
    required SecureSlotStore slots,
    int chunkSize = defaultChunkSize,
    int readAttempts = defaultReadAttempts,
    Duration readRetryStep = defaultReadRetryStep,
    Future<void> Function(Duration delay)? sleep,
    Random? random,
    DateTime Function()? clock,
  })  : assert(chunkSize >= 2, 'a chunk must be able to hold a surrogate pair'),
        assert(readAttempts >= 1, 'a read must be attempted at least once'),
        _slots = slots,
        _chunkSize = chunkSize,
        _readAttempts = readAttempts,
        _readRetryStep = readRetryStep,
        _sleep = sleep ?? Future<void>.delayed,
        _random = random ?? Random(),
        _clock = clock ?? DateTime.now;

  /// Characters per slot.
  ///
  /// Mirrors the 1800 the React Native adapter uses, because the values are the
  /// same values. Kept even though `flutter_secure_storage` has no documented
  /// per-slot limit: the commit-point invariant is the point and it generalises,
  /// and a bounded slot is the conservative choice on hardware whose behaviour
  /// with a very large keystore entry is UNVERIFIED.
  static const int defaultChunkSize = 1800;

  /// A refused keystore call is transient far more often than it is fatal, so a
  /// read is retried before anything is concluded from it. Kept small: this sits
  /// on the cold-start path, inside the caller's own restore budget.
  static const int defaultReadAttempts = 3;

  /// Backoff step. Attempt n waits `step * n`.
  static const Duration defaultReadRetryStep = Duration(milliseconds: 60);

  final SecureSlotStore _slots;
  final int _chunkSize;
  final int _readAttempts;
  final Duration _readRetryStep;
  final Future<void> Function(Duration delay) _sleep;
  final Random _random;
  final DateTime Function() _clock;

  int _readFailures = 0;

  @override
  int get readFailureCount => _readFailures;

  @override
  Future<SecureRead> read(String key) async {
    _requireKey(key);

    final metaRead = await _readMeta(key);
    if (metaRead.unreadable) {
      // We never learned whether a chunk set exists. Falling back to the plain
      // slot here would find nothing and report a signed-out user.
      return _record(const SecureRead.unreadable());
    }

    final meta = metaRead.meta;
    if (meta == null) {
      // No committed chunk set, or metadata we read fine and could not use.
      // Fall back to the plain slot; that is a different answer from "could not
      // read", and conflating them is how a full offline queue reads as empty.
      final plain = await _readSlot(key);
      if (plain.unreadable) return _record(const SecureRead.unreadable());
      final value = plain.value;
      return value == null ? const SecureRead.absent() : SecureRead.ok(value);
    }

    final parts = <String>[];
    var anyMissing = false;
    for (var index = 0; index < meta.chunks; index++) {
      final part = await _readSlot(_chunkKey(key, index, meta.generation));
      if (part.unreadable) {
        // Unreadable outranks missing: a slot we could not read tells us
        // nothing, so we must not report the stronger `torn`.
        return _record(const SecureRead.unreadable());
      }
      final value = part.value;
      if (value == null) {
        anyMissing = true;
        continue;
      }
      parts.add(value);
    }

    if (anyMissing) {
      // Metadata was committed, so a value WAS stored here, yet a slot is
      // definitively gone. Never `absent`: the caller must not conclude this
      // device was never signed in.
      return _record(const SecureRead.torn());
    }

    return SecureRead.ok(parts.join());
  }

  @override
  Future<void> write(String key, String value) async {
    _requireKey(key);

    // The generation currently committed, so it can be retired AFTER the new
    // one is live. Read before anything is written.
    final previous = (await _readMeta(key)).meta;

    if (value.length <= _chunkSize) {
      // Write the plain slot first. It becomes authoritative only once the
      // metadata is gone, so the previous chunked value stays readable until
      // then, and the metadata delete is this path's commit point.
      await _write(key, value);
      await _delete(_metaKey(key));
      await _dropChunksQuietly(key, previous);
      return;
    }

    final generation = _newGeneration();
    final chunks = _split(value, _chunkSize);
    for (var index = 0; index < chunks.length; index++) {
      // Sequential rather than concurrent: a refusal stops immediately instead
      // of leaving sibling writes in flight, and these are small values on a
      // constrained keystore.
      await _write(_chunkKey(key, index, generation), chunks[index]);
    }

    // COMMIT POINT. Everything above is invisible to a reader. The moment this
    // lands, the new value is the one served. If any write above failed we
    // never reach here and the previous value is still intact and complete.
    await _write(
      _metaKey(key),
      jsonEncode(<String, Object?>{
        'chunks': chunks.length,
        'gen': generation,
      }),
    );

    // Retire what the previous generation used, and the plain slot it may have
    // occupied. Best effort by design: metadata now points at the new chunks,
    // so a leftover slot is wasted space and can never be served as a value.
    await _dropChunksQuietly(key, previous);
    await _deleteQuietly(key);
  }

  @override
  Future<void> delete(String key) async {
    _requireKey(key);

    final meta = (await _readMeta(key)).meta;

    // Order matters, and it is the reverse of the write.
    //
    // Metadata first, because deleting it DECOMMITS the chunk set: after this
    // a reader falls back to the plain slot, and once that is gone the answer
    // is `absent`. Dropping chunks first instead would leave metadata pointing
    // at missing slots, so a deliberate sign-out would read as `torn` - a
    // storage fault that never happened.
    await _delete(_metaKey(key));

    // The plain slot decides what a reader now sees, so a failure here is
    // reported rather than swallowed: a sign-out that quietly failed leaves a
    // session on the device.
    await _delete(key);

    // Chunks are now unreachable garbage. A failure to remove them costs slots,
    // never correctness, and must not fail a sign-out.
    await _dropChunksQuietly(key, meta);
  }

  // --- slots -------------------------------------------------------------

  /// Read ONE slot, retrying a REFUSAL.
  ///
  /// A resolved null is authoritative and is never retried - the slot really is
  /// empty. Only a thrown call is retried, because that is the binder/Keystore
  /// failure this app has been ANR-reported for.
  Future<_SlotRead> _readSlot(String key) async {
    for (var attempt = 0; attempt < _readAttempts; attempt++) {
      if (attempt > 0) await _sleep(_readRetryStep * attempt);
      try {
        return _SlotRead(await _slots.readSlot(key), unreadable: false);
      } on Object {
        // Deliberately swallowed, and this is the one place it is right to do
        // so: the caller receives `unreadable`, which carries the same
        // information without a rejection escaping into a session bootstrap or
        // a queue read. Rule 5 is about losing information, and none is lost.
        continue;
      }
    }
    return const _SlotRead(null, unreadable: true);
  }

  Future<void> _write(String key, String value) async {
    try {
      await _slots.writeSlot(key, value);
    } on Object catch (error, stackTrace) {
      Error.throwWithStackTrace(_writeFailed(key, error), stackTrace);
    }
  }

  Future<void> _delete(String key) async {
    try {
      await _slots.deleteSlot(key);
    } on Object catch (error, stackTrace) {
      Error.throwWithStackTrace(_writeFailed(key, error), stackTrace);
    }
  }

  Future<void> _deleteQuietly(String key) async {
    try {
      await _slots.deleteSlot(key);
    } on Object {
      // Garbage collection of a slot nothing points at. Reporting it would turn
      // a successful write into a visible failure for no gain.
    }
  }

  Future<void> _dropChunksQuietly(String key, _ChunkMeta? meta) async {
    if (meta == null) return;
    for (var index = 0; index < meta.chunks; index++) {
      await _deleteQuietly(_chunkKey(key, index, meta.generation));
    }
  }

  AppError _writeFailed(String key, Object error) => AppError(
        kind: AppErrorKind.storage,
        message: 'This device could not save your work just now. '
            'Nothing has been lost. Try again in a moment.',
        // Slot names are declared constants, not user data. The stored VALUE is
        // never included: it is a session token, an offline queue or captured
        // field work.
        technical: 'secure storage write failed for slot "$key": $error',
        cause: error,
        isRetryable: true,
      );

  // --- metadata ----------------------------------------------------------

  Future<_MetaRead> _readMeta(String key) async {
    final raw = await _readSlot(_metaKey(key));
    if (raw.unreadable) return const _MetaRead(null, unreadable: true);

    final text = raw.value;
    if (text == null || text.isEmpty) {
      return const _MetaRead(null, unreadable: false);
    }

    try {
      final decoded = jsonDecode(text);
      if (decoded is! Map<String, dynamic>) {
        return const _MetaRead(null, unreadable: false);
      }
      final chunks = decoded['chunks'];
      final generation = decoded['gen'];
      if (chunks is! int || chunks < 1) {
        return const _MetaRead(null, unreadable: false);
      }
      if (generation is! String || generation.isEmpty) {
        // Every generation this app writes is non-empty. Metadata without one
        // cannot address any slot, so it is unusable rather than unreadable and
        // the caller correctly falls back to the plain slot.
        return const _MetaRead(null, unreadable: false);
      }
      return _MetaRead(
        _ChunkMeta(chunks: chunks, generation: generation),
        unreadable: false,
      );
    } on FormatException {
      // Metadata we READ FINE and could not parse is a different answer from
      // one we could not read at all.
      return const _MetaRead(null, unreadable: false);
    }
  }

  String _newGeneration() {
    final stamp = _clock().millisecondsSinceEpoch.toRadixString(36);
    final salt = _random.nextInt(1 << 20).toRadixString(36).padLeft(4, '0');
    return '$stamp$salt';
  }

  static String _metaKey(String key) => '${key}_meta';

  static String _chunkKey(String key, int index, String generation) =>
      '${key}_g${generation}_chunk_$index';

  SecureRead _record(SecureRead read) {
    if (read.failed) _readFailures++;
    return read;
  }

  static void _requireKey(String key) {
    if (key.isEmpty) {
      // An empty slot name is a programming error, not a runtime condition. The
      // React Native adapter warned and returned silently; that hides a bug
      // behind a value that reads as "nothing stored", which is the exact
      // conflation this class exists to remove.
      throw ArgumentError.value(key, 'key', 'A storage slot name is required');
    }
  }

  /// Splits [value] into slot-sized pieces WITHOUT ever cutting a surrogate
  /// pair.
  ///
  /// Dart strings are UTF-16 and the platform slots are UTF-8. A lone surrogate
  /// half sitting in a keystore slot is not guaranteed to round-trip, so a note
  /// containing an emoji could come back corrupted. Cutting one character
  /// earlier costs nothing.
  static List<String> _split(String value, int size) {
    final out = <String>[];
    var start = 0;
    while (start < value.length) {
      var end = start + size;
      if (end >= value.length) {
        end = value.length;
      } else if (_isHighSurrogate(value.codeUnitAt(end - 1))) {
        end -= 1;
      }
      out.add(value.substring(start, end));
      start = end;
    }
    return out;
  }

  static bool _isHighSurrogate(int codeUnit) =>
      codeUnit >= 0xD800 && codeUnit <= 0xDBFF;
}
