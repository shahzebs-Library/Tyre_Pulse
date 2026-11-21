/// The phone's outbox for physical inventory captures and their photos.
///
/// # Why its own outbox
///
/// The shared sync engine's command registry and queue are reserved wiring
/// files (AGENTS.md "Seven files no agent may edit"), so a new command type
/// cannot be registered from a feature. This outbox keeps the same guarantees
/// inside the feature, without touching them:
///
/// * Encrypted, per-user slot in [SecureKeyValueStore]
///   (`inventory_pi_outbox_v1:<userId>`). Another user on a shared phone never
///   sees or sends someone else's captures.
/// * Every write is one read-modify-write inside [OutboxLock] (shared by
///   the foreground app and the background worker through a lock file), and
///   re-reads the slot inside the lock, so one instance can never overwrite
///   a capture another instance just saved.
/// * Every write goes through `updateValue`, which refuses when the read
///   failed, so a Keystore hiccup cannot replace the queue with nothing.
/// * A capture is the only copy until the server has it: it is removed ONLY
///   when the capture and every photo are confirmed. A server refusal is kept
///   with its reason ([PendingCapture.lastError]) and shown, never dropped.
/// * Idempotent by construction: the capture is keyed by its client_uuid and
///   each photo by its own client_uuid, so replays after a timeout, a crash or
///   a lost response store nothing twice. A photo already uploaded is not
///   uploaded again ([PendingPhoto.storagePath]).
///
/// [flush] runs from the capture screen (open, after every save), app-wide
/// from `PhysicalOutboxSyncBinding` (sign-in, foreground, network back) and
/// from the background worker after its queue pass (`background_sync.dart`,
/// periodic and connectivity one-off), always through
/// `physical_outbox_runner.dart`, which enforces the signed-in-user rule
/// (docs/inventory/102_PHYSICAL_INVENTORY_GUIDE.md section 6).
library;

import 'dart:convert';
import 'dart:typed_data';

import 'package:crypto/crypto.dart' as crypto;
import 'package:tyre_pulse/core/network/supabase_error_mapper.dart';
import 'package:tyre_pulse/core/storage/secure_key_value_store.dart';
import 'package:tyre_pulse/features/inventory/data/outbox_lock.dart';
import 'package:tyre_pulse/features/inventory/data/physical_inventory_repository.dart';
import 'package:tyre_pulse/features/inventory/domain/physical_capture.dart';

/// The result of one [PhysicalCaptureOutbox.flush].
/// The outcome of reading a photo file. "Missing" (the file is gone) and
/// "read error" (it exists but could not be read just now) are different:
/// a read error is retried later; a missing file is flagged for the person.
/// Neither is ever treated as uploaded.
sealed class PhotoRead {
  const PhotoRead();
}

final class PhotoBytes extends PhotoRead {
  const PhotoBytes(this.bytes);
  final Uint8List bytes;
}

final class PhotoMissing extends PhotoRead {
  const PhotoMissing();
}

final class PhotoReadError extends PhotoRead {
  const PhotoReadError(this.error);
  final Object error;
}

/// Error codes stored on a capture for the screen to translate.
const String piErrPhotoMissing = 'photo_missing';
const String piErrPhotoReadFailed = 'photo_read_failed';

final class OutboxFlushResult {
  const OutboxFlushResult({
    required this.sent,
    required this.remaining,
    required this.refused,
    required this.stoppedOffline,
  });

  final int sent;
  final int remaining;
  final int refused;
  final bool stoppedOffline;
}

final class PhysicalCaptureOutbox {
  PhysicalCaptureOutbox(
    this._store, {
    required Future<PhotoRead> Function(String path) readBytes,
    Future<void> Function(String path)? deleteFile,
    OutboxLock? lock,
  })  : _readBytes = readBytes,
        _deleteFile = deleteFile,
        _lock = lock ?? IsolateOutboxLock();

  final SecureKeyValueStore _store;
  final Future<PhotoRead> Function(String path) _readBytes;
  final Future<void> Function(String path)? _deleteFile;

  /// Held around EVERY mutation (one read-modify-write of the slot), never
  /// across a network call. The device outbox uses a lock file shared by
  /// every isolate and process (`outbox_lock.dart`).
  final OutboxLock _lock;
  bool _flushing = false;

  static String slotFor(String userId) => 'inventory_pi_outbox_v1:$userId';

  /// Every capture still waiting for [userId]. Throws [StorageReadFailure]
  /// when the store could not be read (the screen must say so).
  Future<List<PendingCapture>> pending(String userId) async {
    final read = await _store.read(slotFor(userId));
    if (read.failed) {
      throw StorageReadFailure(key: slotFor(userId), status: read.status);
    }
    return _decode(read.value, userId);
  }

  /// One locked read-modify-write. [change] receives the list exactly as it
  /// is stored NOW (re-read inside the lock) and returns the new list, so no
  /// caller can ever write back an older snapshot.
  Future<void> _mutate(
    String userId,
    List<PendingCapture> Function(List<PendingCapture> current) change,
  ) =>
      _lock.run(
        () => _store.updateValue(slotFor(userId), (String? raw) {
          final List<PendingCapture> next = change(_decode(raw, userId));
          return next.isEmpty ? null : _encode(next);
        }),
      );

  /// Adds [capture] (a replay of the same client_uuid replaces nothing).
  Future<void> add(PendingCapture capture) =>
      _mutate(capture.userId, (List<PendingCapture> all) {
        if (all.any((PendingCapture c) => c.clientUuid == capture.clientUuid)) {
          return all;
        }
        return <PendingCapture>[...all, capture];
      });

  /// Applies [change] to the STORED version of one capture and returns it, or
  /// null when that capture is no longer stored (another instance finished
  /// or dismissed it). Every other capture is left exactly as stored.
  Future<PendingCapture?> _patch(
    String userId,
    String clientUuid,
    PendingCapture Function(PendingCapture current) change,
  ) async {
    PendingCapture? result;
    await _mutate(userId, (List<PendingCapture> all) {
      final List<PendingCapture> next = <PendingCapture>[];
      for (final PendingCapture c in all) {
        if (c.clientUuid == clientUuid) {
          result = change(c);
          next.add(result!);
        } else {
          next.add(c);
        }
      }
      return next;
    });
    return result;
  }

  /// Moves one photo forward (never back): a known storage path, attached
  /// and lost are only ever set, never cleared, whatever order two flushes
  /// record them in.
  Future<PendingCapture?> _patchPhoto(
    String userId,
    String clientUuid,
    String photoUuid, {
    String? storagePath,
    bool attached = false,
    bool lost = false,
    String? error,
  }) =>
      _patch(userId, clientUuid, (PendingCapture c) {
        return c.copyWith(
          lastError: error,
          photos: <PendingPhoto>[
            for (final PendingPhoto p in c.photos)
              if (p.clientUuid == photoUuid)
                p.copyWith(
                  storagePath: p.storagePath ?? storagePath,
                  attached: p.attached || attached,
                  lost: p.lost || lost,
                )
              else
                p,
          ],
        );
      });

  /// Removes the capture only if its STORED version is complete (sent, every
  /// photo attached). Returns the removed capture, or null.
  Future<PendingCapture?> _removeIfDone(
    String userId,
    String clientUuid,
  ) async {
    PendingCapture? removed;
    await _mutate(userId, (List<PendingCapture> all) {
      final List<PendingCapture> next = <PendingCapture>[];
      for (final PendingCapture c in all) {
        if (c.clientUuid == clientUuid && c.done) {
          removed = c;
        } else {
          next.add(c);
        }
      }
      return next;
    });
    return removed;
  }

  /// Removes a capture the person has acknowledged (e.g. a photo file the OS
  /// deleted). Only a capture the server already holds can be dismissed, so
  /// unsent evidence is never thrown away from here. Returns true when removed.
  Future<bool> dismiss(String userId, String clientUuid) async {
    bool removed = false;
    await _mutate(userId, (List<PendingCapture> all) {
      final List<PendingCapture> keep = <PendingCapture>[
        for (final PendingCapture c in all)
          if (!(c.clientUuid == clientUuid && c.captureSent)) c,
      ];
      removed = keep.length != all.length;
      return keep;
    });
    return removed;
  }

  /// Sends everything it can. Stops at the first connectivity failure (the
  /// rest waits for the network); a refusal is recorded on that capture and
  /// the next capture is tried. Local state is always re-read from the store
  /// after each step, so a capture another instance finished is skipped.
  Future<OutboxFlushResult> flush({
    required String userId,
    required String orgId,
    required PhysicalInventoryRepository repository,
    String? deviceId,
  }) async {
    if (_flushing) {
      final int left = (await pending(userId)).length;
      return OutboxFlushResult(
        sent: 0,
        remaining: left,
        refused: 0,
        stoppedOffline: false,
      );
    }
    _flushing = true;
    int sent = 0;
    int refused = 0;
    bool offline = false;
    try {
      for (final PendingCapture snapshot in await pending(userId)) {
        final String id = snapshot.clientUuid;
        try {
          final PendingCapture? done = await _flushOne(
            snapshot,
            userId: userId,
            orgId: orgId,
            repository: repository,
            deviceId: deviceId,
          );
          if (done == null) continue;
          for (final PendingPhoto p in done.photos) {
            if (p.attached) await _deleteFile?.call(p.localPath);
          }
          sent += 1;
        } on SupabaseFailure catch (f) {
          if (f.isConnectivity || f.isSchemaMismatch) {
            offline = f.isConnectivity;
            break;
          }
          refused += 1;
          await _patch(
            userId,
            id,
            (PendingCapture cur) => cur.copyWith(lastError: f.error.message),
          );
        }
      }
    } finally {
      _flushing = false;
    }
    final int remaining = (await pending(userId)).length;
    return OutboxFlushResult(
      sent: sent,
      remaining: remaining,
      refused: refused,
      stoppedOffline: offline,
    );
  }

  /// Sends one capture and its photos. Returns the capture once it was
  /// removed from the phone (sent and every photo attached), else null (kept:
  /// a photo is missing or unreadable, or another instance finished it).
  /// Every step re-reads the stored capture, so state only moves forward.
  Future<PendingCapture?> _flushOne(
    PendingCapture snapshot, {
    required String userId,
    required String orgId,
    required PhysicalInventoryRepository repository,
    String? deviceId,
  }) async {
    final String id = snapshot.clientUuid;
    PendingCapture cur = snapshot;
    if (!cur.captureSent) {
      final Map<String, Object?> r =
          await repository.capture(cur.toPayload(deviceId: deviceId));
      final PendingCapture? next = await _patch(
        userId,
        id,
        (PendingCapture c) => c.captureSent
            ? c.copyWith(clearError: true)
            : c.copyWith(
                serverId: '${r['id']}',
                tempRef: r['temp_ref'] as String?,
                clearError: true,
              ),
      );
      if (next == null) return null;
      cur = next;
    }
    String? photoProblem;
    for (final PendingPhoto original in snapshot.photos) {
      final String pid = original.clientUuid;
      final PendingPhoto? p = _photoIn(cur, pid);
      if (p == null) continue;
      if (p.attached || p.lost) {
        if (p.lost) photoProblem ??= piErrPhotoMissing;
        continue;
      }
      final PhotoRead read = await _readBytes(p.localPath);
      if (read is PhotoMissing) {
        photoProblem ??= piErrPhotoMissing;
        final PendingCapture? next = await _patchPhoto(
          userId,
          id,
          pid,
          lost: true,
          error: piErrPhotoMissing,
        );
        if (next == null) return null;
        cur = next;
        continue;
      }
      if (read is PhotoReadError) {
        // Exists but unreadable right now: keep it pending, retry later.
        photoProblem = piErrPhotoReadFailed;
        final PendingCapture? next = await _patch(
          userId,
          id,
          (PendingCapture c) => c.copyWith(lastError: piErrPhotoReadFailed),
        );
        if (next == null) return null;
        cur = next;
        continue;
      }
      final Uint8List bytes = (read as PhotoBytes).bytes;
      String path = p.storagePath ?? piPhotoPath(orgId, cur.sessionId, pid);
      if (p.storagePath == null) {
        await repository.upload(path, bytes);
        final PendingCapture? next =
            await _patchPhoto(userId, id, pid, storagePath: path);
        if (next == null) return null;
        cur = next;
        path = _photoIn(cur, pid)?.storagePath ?? path;
      }
      await repository.attachPhoto(<String, Object?>{
        'client_uuid': pid,
        'capture_id': cur.serverId,
        'storage_path': path,
        'photo_role': p.role,
        'purpose': cur.kind == 'identified' ? 'count_proof' : 'identification',
        'sha256': crypto.sha256.convert(bytes).toString(),
        'byte_size': bytes.length,
      });
      final PendingCapture? next =
          await _patchPhoto(userId, id, pid, attached: true);
      if (next == null) return null;
      cur = next;
    }
    // Not done while a photo is missing or unreadable: kept, and shown.
    if (photoProblem != null) return null;
    return _removeIfDone(userId, id);
  }

  static PendingPhoto? _photoIn(PendingCapture c, String photoUuid) {
    for (final PendingPhoto p in c.photos) {
      if (p.clientUuid == photoUuid) return p;
    }
    return null;
  }

  static List<PendingCapture> _decode(String? raw, String userId) {
    if (raw == null || raw.isEmpty) return <PendingCapture>[];
    final Object? decoded = jsonDecode(raw);
    if (decoded is! Map || decoded['items'] is! List) {
      throw const FormatException('physical inventory outbox is not an object');
    }
    return <PendingCapture>[
      for (final Object? item in decoded['items'] as List)
        if (item is Map)
          PendingCapture.fromJson(Map<String, Object?>.from(item)),
    ].where((PendingCapture c) => c.userId == userId).toList();
  }

  static String _encode(List<PendingCapture> all) => jsonEncode(
        <String, Object?>{
          'version': 1,
          'items': <Object?>[for (final PendingCapture c in all) c.toJson()],
        },
      );
}
