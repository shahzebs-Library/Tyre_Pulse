/// A submitted-but-not-yet-confirmed inspection, and the JSON shape it is
/// persisted under on this device.
///
/// # Why this exists at all, and why it is not a `pending_commands` row
///
/// `lib/core/database/tables/queue_tables.dart`'s own library comment
/// states the intended design plainly: "There is deliberately no separate
/// `pending_inspections` table... An inspection is a command like any
/// other... One queue, one sync engine, one lock." That is the RIGHT
/// design in principle, and this feature does not use it, for a concrete
/// reason recorded here so the decision can be revisited rather than
/// silently re-litigated:
///
/// `lib/core/sync/command_registry.dart` is a closed, 1:1 port of the 14
/// commands in `mobile/lib/recordQueue.ts`'s own `CommandType` union -
/// `test/core/sync/command_registry_test.dart` pins "there are exactly 14
/// commands - 16 minus the two excluded" as a hard assertion, both
/// exclusions being RN's OWN commands (`CHECKLIST_APPROVAL`,
/// `REPAIR_REQUEST`), not a placeholder slot future features are meant to
/// fill one at a time. Inspection submission was NEVER one of those 16 -
/// in production it lives entirely in the separate `mobile/lib/
/// offlineQueue.ts`, which this port's own docs (artifact 01 section 2.14,
/// 2.3) never list as a mirror of `recordQueue.ts`. Adding a 15th
/// `CommandType` here would require touching `command_registry.dart` AND
/// renumbering the pinned test in `test/core/sync/`, both outside this
/// phase's directory boundary - and, more importantly, `SyncEngine`
/// (`lib/core/sync/sync_engine.dart`) is wired into a REAL periodic
/// background task (`background_sync.dart`) that unconditionally claims
/// every due `pending_commands` row for the active workspace with no type
/// filter: a row whose `commandType` string it does not recognise is
/// claimed anyway and permanently marked `failed` after
/// `QueueRetryPolicy.maxRetries` fruitless attempts, because nothing about
/// an unregistered wire string ever changes between retries. Putting an
/// inspection submission there without teaching the registry about it
/// would not queue the work - it would poison it.
///
/// So this feature keeps its own small, dedicated queue -
/// [InspectionSubmissionQueue] - reproducing the properties that matter
/// (a stable idempotency key shared by every attempt, `pending` vs
/// `synced` vs `failed`, a refuse-rather-than-guess read) using only
/// primitives available inside `lib/features/inspections/`: one JSON file
/// per queued submission via `path_provider` (already a `pubspec.yaml`
/// dependency), never a shared blob. This is a literal reproduction of
/// what production ACTUALLY does - `offlineQueue.ts` is and always was a
/// separate mechanism from `recordQueue.ts` - built on the safer
/// one-file-per-row shape this codebase already uses for draft photos and
/// queue media, rather than RN's single-blob-rewrite shape (the exact
/// defect class artifact 05's Drift tables were built to eliminate
/// structurally).
///
/// A DRAFT (`InspectionDrafts`/`InspectionDraftPositions`/`DraftPhotos`/
/// `CapturedSignatures`, all consumed via `DraftsDao`/`MediaDao`) is NOT
/// discarded the moment a [QueuedInspection] is created. It is discarded
/// only once the queue entry reaches [InspectionQueueStatus.synced] - see
/// `InspectionSyncEngine`. Until then the draft's own tyre-position rows
/// and photo files remain the durable source of truth this queue entry's
/// payload snapshot was built from, so a retry never needs to re-copy or
/// relocate a single file.
library;

import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:tyre_pulse/features/inspections/domain/inspection_gps_fix.dart';
import 'package:tyre_pulse/features/inspections/domain/inspection_payload.dart';
import 'package:tyre_pulse/features/inspections/domain/tyre_position_reading.dart';

/// Mirrors RN's `OfflineInspection.sync_status`, minus the states that
/// exist only to coordinate several independent claimants
/// (`pending_commands.status`'s `processing`/`blocked`/`retry`) - this
/// queue has exactly one consumer, [InspectionSyncEngine], so those
/// distinctions would carry no information here.
enum InspectionQueueStatus { pending, synced, failed }

String inspectionQueueStatusToWire(InspectionQueueStatus status) =>
    switch (status) {
      InspectionQueueStatus.pending => 'pending',
      InspectionQueueStatus.synced => 'synced',
      InspectionQueueStatus.failed => 'failed',
    };

InspectionQueueStatus inspectionQueueStatusFromWire(String? wire) =>
    switch (wire) {
      'synced' => InspectionQueueStatus.synced,
      'failed' => InspectionQueueStatus.failed,
      _ => InspectionQueueStatus.pending,
    };

/// One queued submission, and everything needed to retry it without
/// re-reading the draft.
@immutable
class QueuedInspection {
  const QueuedInspection({
    required this.id,
    required this.draftKey,
    required this.payload,
    required this.createdAt,
    this.status = InspectionQueueStatus.pending,
    this.syncedAt,
    this.error,
    this.attempts = 0,
  });

  /// The client-generated idempotency key. Shared by the immediate online
  /// attempt AND every queued retry - written as `inspections.client_uuid`
  /// on every push, so a lost response after a committed insert can never
  /// create a duplicate. Also this queue entry's own file name
  /// (`<id>.json`).
  final String id;

  /// The draft this submission was built from. Needed so
  /// [InspectionSyncEngine] can discard the draft (and its photos and
  /// signature) once, and only once, [status] reaches
  /// [InspectionQueueStatus.synced].
  final String draftKey;

  final InspectionPayload payload;
  final InspectionQueueStatus status;
  final DateTime createdAt;
  final DateTime? syncedAt;

  /// Sanitised before storage - never a raw driver message. See
  /// `AppError.technical` for the same discipline elsewhere in this
  /// codebase.
  final String? error;

  final int attempts;

  QueuedInspection copyWith({
    InspectionPayload? payload,
    InspectionQueueStatus? status,
    DateTime? syncedAt,
    bool clearSyncedAt = false,
    String? error,
    bool clearError = false,
    int? attempts,
  }) {
    return QueuedInspection(
      id: id,
      draftKey: draftKey,
      payload: payload ?? this.payload,
      createdAt: createdAt,
      status: status ?? this.status,
      syncedAt: clearSyncedAt ? null : (syncedAt ?? this.syncedAt),
      error: clearError ? null : (error ?? this.error),
      attempts: attempts ?? this.attempts,
    );
  }

  Map<String, Object?> toJson() {
    return <String, Object?>{
      'schemaVersion': 1,
      'id': id,
      'draftKey': draftKey,
      'status': inspectionQueueStatusToWire(status),
      'createdAt': createdAt.toIso8601String(),
      'syncedAt': syncedAt?.toIso8601String(),
      'error': error,
      'attempts': attempts,
      'payload': _payloadToJson(payload),
    };
  }

  String toJsonString() => jsonEncode(toJson());

  static QueuedInspection fromJson(Map<String, Object?> json) {
    final Object? rawId = json['id'];
    final Object? rawDraftKey = json['draftKey'];
    if (rawId is! String || rawId.isEmpty) {
      throw const FormatException('Queued inspection JSON has no usable "id".');
    }
    if (rawDraftKey is! String || rawDraftKey.isEmpty) {
      throw const FormatException(
        'Queued inspection JSON has no usable "draftKey".',
      );
    }
    final Object? rawPayload = json['payload'];
    if (rawPayload is! Map) {
      throw const FormatException(
        'Queued inspection JSON has no usable "payload".',
      );
    }

    return QueuedInspection(
      id: rawId,
      draftKey: rawDraftKey,
      payload: _payloadFromJson(rawPayload.cast<String, Object?>()),
      status: inspectionQueueStatusFromWire(json['status'] as String?),
      createdAt: _dateTimeOrNow(json['createdAt']),
      syncedAt: _dateTimeOrNull(json['syncedAt']),
      error: json['error'] as String?,
      attempts: (json['attempts'] as num?)?.toInt() ?? 0,
    );
  }

  static QueuedInspection fromJsonString(String raw) =>
      fromJson((jsonDecode(raw) as Map).cast<String, Object?>());

  static Map<String, Object?> _payloadToJson(InspectionPayload p) {
    return <String, Object?>{
      'title': p.title,
      'site': p.site,
      'assetNo': p.assetNo,
      'vehicleType': p.vehicleType,
      'inspector': p.inspector,
      'createdBy': p.createdBy,
      'inspectionDate': p.inspectionDate.toIso8601String(),
      'scheduledDate': p.scheduledDate.toIso8601String(),
      'inspectionType': p.inspectionType,
      'tyreConditions': <String, Object?>{
        for (final MapEntry<String, TyrePositionReading> e
            in p.tyreConditions.entries)
          e.key: _readingToJson(e.value),
      },
      'notes': p.notes,
      'findings': p.findings,
      'odometerKm': p.odometerKm,
      'hourMeter': p.hourMeter,
      'inspectorSignature': p.inspectorSignature,
      'approvalStatus': p.approvalStatus,
      'status': p.status,
      'country': p.country,
      'gpsFix': p.gpsFix == null
          ? null
          : <String, Object?>{
              'latitude': p.gpsFix!.latitude,
              'longitude': p.gpsFix!.longitude,
              'accuracyMeters': p.gpsFix!.accuracyMeters,
              'capturedAt': p.gpsFix!.capturedAt.toIso8601String(),
            },
    };
  }

  static InspectionPayload _payloadFromJson(Map<String, Object?> json) {
    final Object? rawConditions = json['tyreConditions'];
    final Map<String, TyrePositionReading> conditions =
        <String, TyrePositionReading>{};
    if (rawConditions is Map) {
      rawConditions.forEach((Object? key, Object? value) {
        if (key is String && value is Map) {
          conditions[key] = _readingFromJson(
            key,
            value.cast<String, Object?>(),
          );
        }
      });
    }

    final Object? rawGps = json['gpsFix'];
    InspectionGpsFix? gpsFix;
    if (rawGps is Map) {
      final Map<String, Object?> g = rawGps.cast<String, Object?>();
      final double? lat = (g['latitude'] as num?)?.toDouble();
      final double? lng = (g['longitude'] as num?)?.toDouble();
      final DateTime? capturedAt = _dateTimeOrNull(g['capturedAt']);
      if (lat != null && lng != null && capturedAt != null) {
        gpsFix = InspectionGpsFix(
          latitude: lat,
          longitude: lng,
          accuracyMeters: (g['accuracyMeters'] as num?)?.toDouble(),
          capturedAt: capturedAt,
        );
      }
    }

    return InspectionPayload(
      title: json['title'] as String? ?? '',
      site: json['site'] as String? ?? '',
      assetNo: json['assetNo'] as String? ?? '',
      vehicleType: json['vehicleType'] as String? ?? '',
      inspector: json['inspector'] as String? ?? '',
      createdBy: json['createdBy'] as String?,
      inspectionDate: _dateTimeOrNow(json['inspectionDate']),
      scheduledDate: _dateTimeOrNow(json['scheduledDate']),
      inspectionType: json['inspectionType'] as String? ?? 'Routine',
      tyreConditions: conditions,
      notes: json['notes'] as String? ?? '',
      findings: json['findings'] as String?,
      odometerKm: (json['odometerKm'] as num?)?.toInt(),
      hourMeter: (json['hourMeter'] as num?)?.toDouble(),
      inspectorSignature: json['inspectorSignature'] as String?,
      approvalStatus: json['approvalStatus'] as String?,
      status: json['status'] as String? ?? 'In Progress',
      country: json['country'] as String?,
      gpsFix: gpsFix,
    );
  }

  static Map<String, Object?> _readingToJson(TyrePositionReading r) {
    return <String, Object?>{
      'serialNumber': r.serialNumber,
      'pressurePsi': r.pressurePsi,
      'treadDepthMm': r.treadDepthMm,
      'condition': r.condition,
      'checked': r.checked,
      'photoLocalPath': r.photoLocalPath,
      'photoUrl': r.photoUrl,
      'notes': r.notes,
    };
  }

  static TyrePositionReading _readingFromJson(
    String position,
    Map<String, Object?> json,
  ) {
    return TyrePositionReading(
      position: position,
      serialNumber: json['serialNumber'] as String?,
      pressurePsi: (json['pressurePsi'] as num?)?.toDouble(),
      treadDepthMm: (json['treadDepthMm'] as num?)?.toDouble(),
      condition: json['condition'] as String? ?? TyreReadingCondition.good,
      checked: json['checked'] == true,
      photoLocalPath: json['photoLocalPath'] as String?,
      photoUrl: json['photoUrl'] as String?,
      notes: json['notes'] as String?,
    );
  }

  static DateTime _dateTimeOrNow(Object? raw) =>
      _dateTimeOrNull(raw) ?? DateTime.now().toUtc();

  static DateTime? _dateTimeOrNull(Object? raw) {
    if (raw is! String || raw.isEmpty) return null;
    return DateTime.tryParse(raw);
  }
}

/// The two ways a read of the on-device queue store can come back "empty",
/// and why they must never be conflated.
///
/// Mirrors `QueueUnreadableError` in `mobile/lib/offlineQueue.ts` almost
/// verbatim: "`getQueue()` answers `[]` for BOTH 'there is nothing queued'
/// and 'the store refused to answer'... a torn read plus a save overwrites
/// a field worker's unsynced inspections with an empty list." A directory
/// listing that genuinely enumerates zero files is [ok] with an empty
/// list; a directory that could not be listed at all - the underlying
/// storage is unavailable - is [unreadable] and MUST NOT be treated as "no
/// queued work" by any caller that might go on to prune or overwrite
/// anything.
enum InspectionQueueReadStatus { ok, unreadable }

@immutable
class InspectionQueueReadResult {
  const InspectionQueueReadResult._({
    required this.status,
    required this.items,
  });

  const InspectionQueueReadResult.ok(List<QueuedInspection> items)
      : this._(status: InspectionQueueReadStatus.ok, items: items);

  const InspectionQueueReadResult.unreadable()
      : this._(
          status: InspectionQueueReadStatus.unreadable,
          items: const <QueuedInspection>[],
        );

  final InspectionQueueReadStatus status;
  final List<QueuedInspection> items;

  bool get isReadable => status == InspectionQueueReadStatus.ok;
}
