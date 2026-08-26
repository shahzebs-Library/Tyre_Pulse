/// Daily meter log - driver-captured odometer (km) and engine-hour readings
/// for fleets without telematics.
///
/// Ported from `mobile/lib/meterLogs.ts` (`mobile/` is READ-ONLY reference
/// material - see `AGENTS.md` rule "Never edit them from this project").
/// That file's own library comment explains the design; the parts load
/// -bearing for this port are repeated here rather than paraphrased:
///
/// Reads go direct to Supabase (RLS/country enforced server-side); the WRITE
/// routes through the offline command queue so a reading captured with no
/// signal is never lost. Odometer readings feed `vehicle_fleet.current_km`
/// via a V213 server trigger, so "actual current km" stays authoritative -
/// this repository never writes that column itself.
///
/// # Regression policy (V340): a low reading WARNS, it never REJECTS
///
/// A reading LOWER than the asset's last known meter is NEVER rejected by
/// this repository. It is submitted and accepted; a server BEFORE-INSERT
/// trigger (`flag_meter_regression`) stamps `flagged`/`flag_reason` for
/// admin review. The FLAG COLUMNS ARE SERVER-SET, so [submitMeterReading]'s
/// write payload never carries them - enforced structurally here, not just
/// by convention: `flagged`/`flag_reason` are absent from
/// `CommandRegistry.specFor(CommandType.odometerLog).fieldAllowList`
/// (`lib/core/sync/command_registry.dart`), so even a caller bug that tried
/// to send them would have the keys silently dropped before the write ever
/// reaches the queue. The caller (`MeterLogScreen`) is responsible for the
/// WARNING itself - comparing a typed reading against [getLastOdometer]'s
/// result is a display/confirmation concern, not a write-path one.
///
/// # The write shape: always one row, sometimes two, through the SHARED
/// # generic queue - not a bespoke one
///
/// [submitMeterReading] always enqueues an `ODOMETER_LOG` command, and
/// enqueues a SECOND, independent `ENGINE_HOURS_LOG` command only when an
/// hours value was actually supplied - two separate rows, each with its own
/// gauge photo and its own idempotency key, sharing a common `base` map of
/// fields that do not vary between them. This mirrors `submitMeterReading`
/// in `mobile/lib/meterLogs.ts` field for field, including the exact
/// idempotency-key SHAPE (`odo_<asset>_<date>_<random8>` /
/// `hrs_<asset>_<date>_<random8>`) - see `_freshIdempotencyKey` below for
/// why the random suffix cannot be reused across calls but MUST be stable
/// within one call.
///
/// Unlike checklist submission's OWN bespoke offline queue
/// (`inspection_sync_engine.dart` predates and does not use
/// `CommandType`), `ODOMETER_LOG` and `ENGINE_HOURS_LOG` are both ordinary,
/// fully-queueable, idempotent INSERT commands already declared in
/// `lib/core/sync/command_registry.dart` - this file therefore follows
/// `checklist_submission_repository.dart`'s pattern exactly: build the
/// payload(s), call [QueuedCommandRepository.enqueue], and stop. Pushing a
/// claimed command to Supabase, waiting for its photos and retrying on
/// failure is `lib/core/sync/sync_engine.dart`'s job, not this file's.
///
/// # A confirmed, pre-existing gap in the shared sync layer - not introduced
/// # or fixable here
///
/// `CommandSpec.requiresMediaReady` is `false` for both `ODOMETER_LOG` and
/// `ENGINE_HOURS_LOG` (only `TYRE_CHANGE` and `CHECKLIST_SUBMISSION` are
/// flagged `true` today) even though both commands carry a `photos` field -
/// `command_registry.dart`'s own doc comment on
/// [CommandSpec.requiresMediaReady] names this explicitly as "flagged for
/// review, not silently widened". So a meter reading's gauge photo can in
/// principle be pushed to `odometer_logs`/`engine_hours_logs` before its
/// own upload has finished, the same latent gap every other photo-bearing
/// command besides those two shares. This is shared, out-of-scope
/// infrastructure (`command_registry.dart` is not edited by this feature)
/// and is recorded here rather than silently accepted.
///
/// # Why the "synced / pending sync / flagged" three-way flash is NOT
/// # reproduced
///
/// `mobile/lib/recordQueue.ts`'s `saveCommand` attempts an immediate online
/// write and only falls back to durable local storage on failure, so the RN
/// screen can tell the driver SYNCHRONOUSLY whether their reading reached
/// the server or was queued. `QueuedCommandRepository.enqueue` in THIS
/// codebase never attempts an online write at all - see its own library
/// comment: "it does not attempt an online write first... Pushing a claimed
/// command to Supabase is sync_engine.dart's job" - so there is no
/// synchronous "delivered / queued" signal available here to report
/// honestly. `MeterLogScreen` therefore follows THIS codebase's own already
/// -established convention for exactly this moment
/// (`checklist_fill_controller.dart`'s `submit()`, which reports a single
/// "submitted" outcome with no synced/pending distinction) rather than the
/// RN screen's synchronous one - reporting a distinction this Flutter sync
/// architecture cannot actually observe would be a fabricated signal, which
/// AGENTS.md rule 1 forbids regardless of how reassuring it would read. The
/// one part of the RN flash that IS knowable client-side before submission -
/// "this reading is below the last one and will be flagged for admin
/// review" - is preserved, as the confirmation dialog `MeterLogScreen` shows
/// before the write is even attempted.
library;

import 'package:supabase_flutter/supabase_flutter.dart';
import 'package:tyre_pulse/core/database/dao/queue_dao.dart'
    show QueuedMediaAttachment;
import 'package:tyre_pulse/core/network/supabase_gateway.dart';
import 'package:tyre_pulse/core/network/supabase_tables.dart';
import 'package:tyre_pulse/core/sync/command_registry.dart';
import 'package:tyre_pulse/core/sync/queued_command_repository.dart';
import 'package:tyre_pulse/core/workspace/workspace_context.dart';
import 'package:tyre_pulse/features/meter_logs/data/meter_reading.dart';
import 'package:uuid/uuid.dart';

const String _odoColumns =
    'id,asset_no,odometer_km,reading_date,site,source,notes,photos,created_at';

/// Local (device-timezone) `YYYY-MM-DD`, so a reading is dated the driver's
/// own calendar day. Dart's [DateTime.now] already exposes local
/// year/month/day directly, so - unlike the ported `todayISODate()` in
/// `mobile/lib/meterLogs.ts`, which round-trips through a UTC ISO string
/// purely to correct for JavaScript's `Date.toISOString()` always being
/// UTC - no timezone-offset correction is needed here. Kept as this
/// feature's own small copy rather than shared, matching the established
/// "each feature keeps its own copy of a small technique" convention (see
/// `meter_log_photo_capture.dart`'s own library comment).
String todayIsoDate() {
  final DateTime now = DateTime.now();
  final String y = now.year.toString().padLeft(4, '0');
  final String m = now.month.toString().padLeft(2, '0');
  final String d = now.day.toString().padLeft(2, '0');
  return '$y-$m-$d';
}

/// What [MeterLogRepository.submitMeterReading] actually sent.
final class SubmitMeterLogInput {
  const SubmitMeterLogInput({
    required this.assetNo,
    required this.odometerKm,
    this.site,
    this.country,
    this.readingDate,
    this.odometerPhotoLocalPath,
    this.engineHours,
    this.hoursPhotoLocalPath,
    this.notes,
    this.signatureDataUrl,
  });

  final String assetNo;

  /// The typed reading. Validated by the caller before this is constructed -
  /// this repository does not re-validate business rules, only shapes and
  /// sends the write.
  final num odometerKm;

  final String? site;
  final String? country;

  /// `YYYY-MM-DD`. Defaults to [todayIsoDate] when null, mirroring
  /// `submitMeterReading`'s own `date = input.readingDate ?? todayISODate()`.
  final String? readingDate;

  final String? odometerPhotoLocalPath;

  /// Optional engine-hour reading captured alongside the odometer. A second,
  /// independent `ENGINE_HOURS_LOG` row is enqueued only when this is
  /// non-null.
  final num? engineHours;

  final String? hoursPhotoLocalPath;
  final String? notes;

  /// A self-contained signature payload (see
  /// `meter_log_signature_pad.dart`), or `null`. Only included in either
  /// write's payload when non-blank - mirroring the reference's
  /// `...(signature ? { signature } : {})` spread, which OMITS the key
  /// entirely rather than sending an explicit empty value.
  final String? signatureDataUrl;
}

/// The narrow surface this feature needs from Supabase for its two READS.
/// Abstract so a screen/controller can be tested against a fake, mirroring
/// `InspectionApprovalRepository`'s own split.
abstract interface class MeterLogRepository {
  /// The most recent odometer reading for [assetNo] - for the below-last
  /// -reading warning and the "Last reading" display panel.
  ///
  /// Best-effort: mirrors `getLastOdometer`'s own contract in
  /// `mobile/lib/meterLogs.ts` exactly - `if (error || !data || !data
  /// .length) return null` - so this NEVER throws. A field worker's ability
  /// to log a NEW reading must never depend on whether an informational
  /// panel about the OLD one could be fetched.
  Future<LastOdometerReading?> getLastOdometer(String assetNo);

  /// Recent meter readings (this org, country-scoped by RLS), newest first,
  /// bounded to [limit] (matches the TS source's own default of 50). Throws
  /// on failure - this is a real informational list, not a best-effort
  /// panel, mirroring `listRecentReadings`'s own `if (error) throw error`.
  Future<List<MeterReading>> listRecentReadings({int limit = 50});

  /// Logs a daily meter reading for [workspace]. See the library comment
  /// for the write shape. Never throws for an ordinary offline condition -
  /// [QueuedCommandRepository.enqueue] itself only throws for a genuine
  /// caller bug, none of which apply to these insert-only commands.
  Future<MeterLogSubmissionResult> submitMeterReading({
    required WorkspaceContext workspace,
    required SubmitMeterLogInput input,
  });
}

/// What happened when [MeterLogRepository.submitMeterReading] returned.
final class MeterLogSubmissionResult {
  const MeterLogSubmissionResult({
    required this.odometerDroppedFields,
    this.engineHoursDroppedFields,
  });

  /// See [EnqueueResult.droppedFields] - telemetry only, never shown to the
  /// driver.
  final Set<String> odometerDroppedFields;

  /// `null` when no engine-hours reading was supplied, so a caller can tell
  /// "no second row was written" apart from "the second row wrote with
  /// nothing dropped" (an empty set).
  final Set<String>? engineHoursDroppedFields;
}

final class SupabaseMeterLogRepository
    with SupabaseGateway
    implements MeterLogRepository {
  SupabaseMeterLogRepository(this._client, this._commands);

  final SupabaseClient _client;
  final QueuedCommandRepository _commands;

  static const Uuid _uuid = Uuid();

  @override
  Future<LastOdometerReading?> getLastOdometer(String assetNo) async {
    final String asset = assetNo.trim();
    if (asset.isEmpty) return null;
    try {
      final List<Map<String, dynamic>> rows =
          await guard<List<Map<String, dynamic>>>(
        () => _client
            .from(SupabaseTables.odometerLogs)
            .select('odometer_km,reading_date,created_at')
            .eq('asset_no', asset)
            .not('odometer_km', 'is', null)
            .order('reading_date', ascending: false, nullsFirst: false)
            .order('created_at', ascending: false)
            .limit(1),
      );
      if (rows.isEmpty) return null;
      final Map<String, dynamic> row = rows.first;
      return LastOdometerReading(
        odometerKm: _numOrNull(row['odometer_km']),
        readingDate: _stringOrNull(row['reading_date']),
      );
    } on Object {
      // Best-effort - see this method's own doc comment.
      return null;
    }
  }

  @override
  Future<List<MeterReading>> listRecentReadings({int limit = 50}) async {
    final List<Map<String, dynamic>> rows =
        await guard<List<Map<String, dynamic>>>(
      () => _client
          .from(SupabaseTables.odometerLogs)
          .select(_odoColumns)
          .order('reading_date', ascending: false, nullsFirst: false)
          .order('created_at', ascending: false)
          .limit(limit),
    );
    return <MeterReading>[
      for (final Map<String, dynamic> row in rows) MeterReading.fromRow(row),
    ];
  }

  @override
  Future<MeterLogSubmissionResult> submitMeterReading({
    required WorkspaceContext workspace,
    required SubmitMeterLogInput input,
  }) async {
    final String asset = input.assetNo.trim();
    final String date = input.readingDate ?? todayIsoDate();
    final String? signature = _trimmedOrNull(input.signatureDataUrl);
    final String? site = _trimmedOrNull(input.site);
    final String? notes = _trimmedOrNull(input.notes);

    final Map<String, Object?> base = <String, Object?>{
      'asset_no': asset,
      'reading_date': date,
      'source': 'Mobile',
      'site': site,
      'country': input.country,
      'created_by': workspace.userId,
      'notes': notes,
      // Included only when non-blank - see [SubmitMeterLogInput
      // .signatureDataUrl]'s own doc comment.
      if (signature != null) 'signature': signature,
    };

    final DateTime now = DateTime.now();

    final EnqueueResult odometerResult = await _commands.enqueue(
      type: CommandType.odometerLog,
      payload: <String, Object?>{
        ...base,
        'odometer_km': input.odometerKm,
        'photos': input.odometerPhotoLocalPath == null
            ? null
            : <String>[input.odometerPhotoLocalPath!],
      },
      workspace: workspace,
      now: now,
      attachments: input.odometerPhotoLocalPath == null
          ? const <QueuedMediaAttachment>[]
          : <QueuedMediaAttachment>[
              QueuedMediaAttachment(
                localPath: input.odometerPhotoLocalPath!,
                fileName: _basename(input.odometerPhotoLocalPath!),
                orderIndex: 0,
              ),
            ],
      country: input.country ?? workspace.activeCountry,
      // One reading per asset per day from this device - the random suffix
      // means a genuine second reading the same day is never blocked. Must
      // be minted ONCE per submit action and never regenerated on a retry;
      // it is safe here precisely because [enqueue] is called exactly once
      // per call to this method (the sync engine retries the STORED row,
      // never re-derives this key) - see the library comment.
      idempotencyKey: 'odo_${asset}_${date}_${_freshSuffix()}',
    );

    Set<String>? engineHoursDropped;
    final num? hours = input.engineHours;
    if (hours != null) {
      final EnqueueResult hoursResult = await _commands.enqueue(
        type: CommandType.engineHoursLog,
        payload: <String, Object?>{
          ...base,
          'engine_hours': hours,
          'photos': input.hoursPhotoLocalPath == null
              ? null
              : <String>[input.hoursPhotoLocalPath!],
        },
        workspace: workspace,
        now: now,
        attachments: input.hoursPhotoLocalPath == null
            ? const <QueuedMediaAttachment>[]
            : <QueuedMediaAttachment>[
                QueuedMediaAttachment(
                  localPath: input.hoursPhotoLocalPath!,
                  fileName: _basename(input.hoursPhotoLocalPath!),
                  orderIndex: 0,
                ),
              ],
        country: input.country ?? workspace.activeCountry,
        idempotencyKey: 'hrs_${asset}_${date}_${_freshSuffix()}',
      );
      engineHoursDropped = hoursResult.droppedFields;
    }

    return MeterLogSubmissionResult(
      odometerDroppedFields: odometerResult.droppedFields,
      engineHoursDroppedFields: engineHoursDropped,
    );
  }

  /// An 8-character random suffix, matching the SHAPE of the reference's own
  /// `safeUuid().slice(0, 8)`. `safeUuid()` exists in the TS source only to
  /// work around older Hermes/RN runtimes lacking `crypto.randomUUID` - a
  /// concern this Dart port does not share, since `package:uuid` (already
  /// used throughout this codebase, e.g.
  /// `checklist_submission_repository.dart`) needs no such fallback. A v4
  /// UUID's first eight characters are always plain hex digits (the first
  /// hyphen sits at index 8), so this reads identically to the reference's
  /// own slice.
  static String _freshSuffix() => _uuid.v4().substring(0, 8);

  static String _basename(String path) {
    final int slash = path.lastIndexOf(RegExp(r'[\\/]'));
    return slash < 0 ? path : path.substring(slash + 1);
  }
}

String? _trimmedOrNull(String? raw) {
  final String trimmed = raw?.trim() ?? '';
  return trimmed.isEmpty ? null : trimmed;
}

String? _stringOrNull(Object? raw) {
  if (raw is! String) return null;
  final String trimmed = raw.trim();
  return trimmed.isEmpty ? null : trimmed;
}

num? _numOrNull(Object? raw) {
  if (raw is num) return raw;
  if (raw is String) return num.tryParse(raw.trim());
  return null;
}
