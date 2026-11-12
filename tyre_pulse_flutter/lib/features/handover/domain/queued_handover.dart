/// A submitted-but-not-yet-confirmed vehicle handover, and the JSON shape it is
/// persisted under on this device.
///
/// # Why a dedicated queue, not `pending_commands`
///
/// Exactly the reasoning `queued_inspection.dart` records for inspections
/// applies here, and is not repeated in full: `lib/core/sync/command_registry
/// .dart` is a closed, pinned 1:1 port of the 14 production offline commands
/// (`test/core/sync/command_registry_test.dart` asserts "exactly 14"), vehicle
/// handover was never one of them, and the background sync engine claims every
/// due `pending_commands` row with no type filter - so an unrecognised command
/// string there is poisoned, not queued. The core sync files are also seven of
/// the files AGENTS.md forbids an agent to touch. So this feature keeps its own
/// small, dedicated queue (`HandoverSubmissionQueue`) using only primitives
/// available inside `lib/features/handover/`: one JSON file per queued
/// submission via `path_provider`, never a shared blob - the same safer
/// one-file-per-row shape `queued_inspection.dart` uses, for the same reasons.
///
/// # Photos and the driver signature travel WITH the queued entry
///
/// Unlike inspections (whose photos stay owned by a Drift draft), a handover's
/// evidence is simpler: the general photos and each damage marker's photo are
/// carried as local filesystem paths inside this entry's own JSON (written
/// atomically by `HandoverSubmissionQueue`), and the image FILES live in a
/// durable folder (`handover_draft_photos`) owned by `HandoverPhotoCapture`.
/// The sync engine uploads any still-local photo on each delivery attempt,
/// swaps the local path for a durable `tp-storage://` reference, and only
/// deletes the local file once the server row is confirmed. A retry re-reads
/// the local paths from this entry, so nothing needs to be relocated between
/// attempts. The driver's drawn signature is a self-contained `data:` URL and
/// is embedded directly.
library;

import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:tyre_pulse/features/handover/domain/handover_damage_marker.dart';
import 'package:tyre_pulse/features/handover/domain/handover_payload.dart';

/// Mirrors the three states a dedicated queue needs - this queue has exactly
/// one consumer, `HandoverSyncEngine`, so the extra `pending_commands` states
/// that only coordinate several claimants would carry no information here.
enum HandoverQueueStatus { pending, synced, failed }

String handoverQueueStatusToWire(HandoverQueueStatus status) =>
    switch (status) {
      HandoverQueueStatus.pending => 'pending',
      HandoverQueueStatus.synced => 'synced',
      HandoverQueueStatus.failed => 'failed',
    };

HandoverQueueStatus handoverQueueStatusFromWire(String? wire) => switch (wire) {
      'synced' => HandoverQueueStatus.synced,
      'failed' => HandoverQueueStatus.failed,
      _ => HandoverQueueStatus.pending,
    };

/// One queued submission, and everything needed to retry it without a redraw.
@immutable
class QueuedHandover {
  const QueuedHandover({
    required this.id,
    required this.payload,
    required this.createdAt,
    this.status = HandoverQueueStatus.pending,
    this.syncedAt,
    this.error,
    this.attempts = 0,
  });

  /// The client-generated idempotency key. Shared by the immediate online
  /// attempt AND every queued retry - written as `handover_reports.client_uuid`
  /// on every push, so a lost response after a committed insert can never
  /// create a duplicate. Also this entry's own file name (`<id>.json`).
  final String id;

  final HandoverPayload payload;
  final HandoverQueueStatus status;
  final DateTime createdAt;
  final DateTime? syncedAt;

  /// Sanitised before storage - never a raw driver message.
  final String? error;

  final int attempts;

  QueuedHandover copyWith({
    HandoverPayload? payload,
    HandoverQueueStatus? status,
    DateTime? syncedAt,
    bool clearSyncedAt = false,
    String? error,
    bool clearError = false,
    int? attempts,
  }) {
    return QueuedHandover(
      id: id,
      payload: payload ?? this.payload,
      createdAt: createdAt,
      status: status ?? this.status,
      syncedAt: clearSyncedAt ? null : (syncedAt ?? this.syncedAt),
      error: clearError ? null : (error ?? this.error),
      attempts: attempts ?? this.attempts,
    );
  }

  Map<String, Object?> toJson() => <String, Object?>{
        'schemaVersion': 1,
        'id': id,
        'status': handoverQueueStatusToWire(status),
        'createdAt': createdAt.toIso8601String(),
        'syncedAt': syncedAt?.toIso8601String(),
        'error': error,
        'attempts': attempts,
        'payload': _payloadToJson(payload),
      };

  String toJsonString() => jsonEncode(toJson());

  static QueuedHandover fromJson(Map<String, Object?> json) {
    final Object? rawId = json['id'];
    if (rawId is! String || rawId.isEmpty) {
      throw const FormatException('Queued handover JSON has no usable "id".');
    }
    final Object? rawPayload = json['payload'];
    if (rawPayload is! Map) {
      throw const FormatException(
        'Queued handover JSON has no usable "payload".',
      );
    }
    return QueuedHandover(
      id: rawId,
      payload: _payloadFromJson(rawPayload.cast<String, Object?>()),
      status: handoverQueueStatusFromWire(json['status'] as String?),
      createdAt: _dateTimeOrNow(json['createdAt']),
      syncedAt: _dateTimeOrNull(json['syncedAt']),
      error: json['error'] as String?,
      attempts: (json['attempts'] as num?)?.toInt() ?? 0,
    );
  }

  static QueuedHandover fromJsonString(String raw) =>
      fromJson((jsonDecode(raw) as Map).cast<String, Object?>());

  static Map<String, Object?> _payloadToJson(HandoverPayload p) {
    return <String, Object?>{
      'assetNo': p.assetNo,
      'country': p.country,
      'handoverType': p.handoverType.key,
      'fromDriver': p.fromDriver,
      'toDriver': p.toDriver,
      'handoverAt': p.handoverAt?.toIso8601String(),
      'odometerKm': p.odometerKm,
      'fuelLevelPct': p.fuelLevelPct,
      'conditionRating': p.conditionRating?.key,
      'cleanliness': p.cleanliness?.key,
      // Each marker keeps BOTH its durable ref (if any) and its still-local
      // path, so a retry after a restart can re-upload the exact file.
      'damages': <Map<String, Object?>>[
        for (final HandoverDamageMarker m in p.damages)
          <String, Object?>{
            'view': m.view.key,
            'x': m.x,
            'y': m.y,
            'type': m.type.key,
            'level': m.level.key,
            'note': m.note,
            'photo_url': m.photoUrl,
            'photoLocalPath': m.photoLocalPath,
          },
      ],
      'signatureDataUrl': p.signatureDataUrl,
      'photos': List<String>.of(p.photos),
      'notes': p.notes,
      'createdBy': p.createdBy,
      'approvalStatus': p.approvalStatus,
    };
  }

  static HandoverPayload _payloadFromJson(Map<String, Object?> json) {
    final List<HandoverDamageMarker> damages = <HandoverDamageMarker>[];
    final Object? rawDamages = json['damages'];
    if (rawDamages is List) {
      for (final Object? item in rawDamages) {
        if (item is Map) {
          final Map<String, Object?> m = item.cast<String, Object?>();
          damages.add(
            HandoverDamageMarker(
              view: HandoverDamageView.fromKey(m['view'] as String?) ??
                  HandoverDamageView.front,
              type: HandoverDamageType.fromKey(m['type'] as String?) ??
                  HandoverDamageType.other,
              level: HandoverDamageLevel.fromKey(m['level'] as String?) ??
                  HandoverDamageLevel.minor,
              x: (m['x'] as num?)?.toDouble(),
              y: (m['y'] as num?)?.toDouble(),
              note: m['note']?.toString(),
              photoUrl: m['photo_url']?.toString(),
              photoLocalPath: m['photoLocalPath']?.toString(),
            ),
          );
        }
      }
    }

    final List<String> photos = <String>[];
    final Object? rawPhotos = json['photos'];
    if (rawPhotos is List) {
      for (final Object? item in rawPhotos) {
        if (item is String && item.trim().isNotEmpty) photos.add(item);
      }
    }

    return HandoverPayload(
      assetNo: json['assetNo'] as String? ?? '',
      handoverType: HandoverType.fromKey(json['handoverType'] as String?) ??
          HandoverType.checkout,
      country: json['country'] as String?,
      fromDriver: json['fromDriver'] as String?,
      toDriver: json['toDriver'] as String?,
      handoverAt: _dateTimeOrNull(json['handoverAt']),
      odometerKm: (json['odometerKm'] as num?)?.toDouble(),
      fuelLevelPct: (json['fuelLevelPct'] as num?)?.toDouble(),
      conditionRating:
          HandoverConditionRating.fromKey(json['conditionRating'] as String?),
      cleanliness: HandoverCleanliness.fromKey(json['cleanliness'] as String?),
      damages: damages,
      signatureDataUrl: json['signatureDataUrl'] as String?,
      photos: photos,
      notes: json['notes'] as String? ?? '',
      createdBy: json['createdBy'] as String?,
      approvalStatus: json['approvalStatus'] as String?,
    );
  }

  static DateTime _dateTimeOrNow(Object? raw) =>
      _dateTimeOrNull(raw) ?? DateTime.now().toUtc();

  static DateTime? _dateTimeOrNull(Object? raw) {
    if (raw is! String || raw.isEmpty) return null;
    return DateTime.tryParse(raw);
  }
}

/// The two ways a read of the on-device queue store can come back "empty", and
/// why they must never be conflated - mirrors `InspectionQueueReadResult` and
/// `mobile/lib/offlineQueue.ts`'s `QueueUnreadableError`. A directory that
/// enumerated zero files is [ok] with an empty list; a directory that could not
/// be listed at all is [unreadable] and MUST NOT be treated as "no queued work"
/// by any caller that might prune or overwrite anything.
enum HandoverQueueReadStatus { ok, unreadable }

@immutable
class HandoverQueueReadResult {
  const HandoverQueueReadResult._({required this.status, required this.items});

  const HandoverQueueReadResult.ok(List<QueuedHandover> items)
      : this._(status: HandoverQueueReadStatus.ok, items: items);

  const HandoverQueueReadResult.unreadable()
      : this._(
          status: HandoverQueueReadStatus.unreadable,
          items: const <QueuedHandover>[],
        );

  final HandoverQueueReadStatus status;
  final List<QueuedHandover> items;

  bool get isReadable => status == HandoverQueueReadStatus.ok;
}
