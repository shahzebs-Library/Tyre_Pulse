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
/// The human-owned sync wiring could later call [flush] from the background
/// worker; until then the screen flushes on open, after every save, when the
/// network comes back and when the app returns to the foreground
/// (docs/inventory/102_PHYSICAL_INVENTORY_GUIDE.md section 6).
library;

import 'dart:convert';
import 'dart:typed_data';

import 'package:crypto/crypto.dart' as crypto;
import 'package:tyre_pulse/core/network/supabase_error_mapper.dart';
import 'package:tyre_pulse/core/storage/secure_key_value_store.dart';
import 'package:tyre_pulse/features/inventory/data/physical_inventory_repository.dart';
import 'package:tyre_pulse/features/inventory/domain/physical_capture.dart';

/// The result of one [PhysicalCaptureOutbox.flush].
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
    required Future<Uint8List?> Function(String path) readBytes,
    Future<void> Function(String path)? deleteFile,
  })  : _readBytes = readBytes,
        _deleteFile = deleteFile;

  final SecureKeyValueStore _store;
  final Future<Uint8List?> Function(String path) _readBytes;
  final Future<void> Function(String path)? _deleteFile;
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

  /// Adds [capture] (a replay of the same client_uuid replaces nothing).
  Future<void> add(PendingCapture capture) => _store.updateValue(
        slotFor(capture.userId),
        (String? current) {
          final List<PendingCapture> all = _decode(current, capture.userId);
          if (all
              .any((PendingCapture c) => c.clientUuid == capture.clientUuid)) {
            return _encode(all);
          }
          return _encode(<PendingCapture>[...all, capture]);
        },
      );

  Future<void> _replace(String userId, PendingCapture updated) =>
      _store.updateValue(slotFor(userId), (String? current) {
        final List<PendingCapture> all = <PendingCapture>[
          for (final PendingCapture c in _decode(current, userId))
            if (c.clientUuid == updated.clientUuid) updated else c,
        ];
        return _encode(all);
      });

  Future<void> _remove(String userId, String clientUuid) =>
      _store.updateValue(slotFor(userId), (String? current) {
        final List<PendingCapture> all = _decode(current, userId)
            .where((PendingCapture c) => c.clientUuid != clientUuid)
            .toList();
        return all.isEmpty ? null : _encode(all);
      });

  /// Sends everything it can. Stops at the first connectivity failure (the
  /// rest waits for the network); a refusal is recorded on that capture and
  /// the next capture is tried.
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
      for (PendingCapture c in await pending(userId)) {
        try {
          if (!c.captureSent) {
            final Map<String, Object?> r =
                await repository.capture(c.toPayload(deviceId: deviceId));
            c = c.copyWith(
              serverId: '${r['id']}',
              tempRef: r['temp_ref'] as String?,
              clearError: true,
            );
            await _replace(userId, c);
          }
          final List<PendingPhoto> photos = <PendingPhoto>[...c.photos];
          for (int i = 0; i < photos.length; i++) {
            PendingPhoto p = photos[i];
            if (p.attached) continue;
            final Uint8List? bytes = await _readBytes(p.localPath);
            if (bytes == null) {
              // The file is gone (cleared by the OS). The capture itself is
              // kept on the server; the photo cannot be recovered.
              photos[i] = p.copyWith(attached: true);
              continue;
            }
            final String path =
                p.storagePath ?? piPhotoPath(orgId, c.sessionId, p.clientUuid);
            if (p.storagePath == null) {
              await repository.upload(path, bytes);
              p = p.copyWith(storagePath: path);
              photos[i] = p;
              await _replace(userId, c.copyWith(photos: photos));
            }
            await repository.attachPhoto(<String, Object?>{
              'client_uuid': p.clientUuid,
              'capture_id': c.serverId,
              'storage_path': path,
              'photo_role': p.role,
              'purpose':
                  c.kind == 'identified' ? 'count_proof' : 'identification',
              'sha256': crypto.sha256.convert(bytes).toString(),
              'byte_size': bytes.length,
            });
            photos[i] = p.copyWith(attached: true);
            await _replace(userId, c.copyWith(photos: photos));
          }
          await _remove(userId, c.clientUuid);
          for (final PendingPhoto p in c.photos) {
            await _deleteFile?.call(p.localPath);
          }
          sent += 1;
        } on SupabaseFailure catch (f) {
          if (f.isConnectivity || f.isSchemaMismatch) {
            offline = f.isConnectivity;
            break;
          }
          refused += 1;
          await _replace(userId, c.copyWith(lastError: f.error.message));
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
