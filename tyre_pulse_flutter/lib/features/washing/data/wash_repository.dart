/// Vehicle washing - driver-captured wash records.
///
/// Ported from `mobile/lib/wash.ts` (`mobile/` is READ-ONLY reference
/// material - see `AGENTS.md` rule "Never edit them from this project"),
/// which itself states it "mirrors lib/meterLogs.ts" - see
/// `features/meter_logs/data/meter_log_repository.dart`'s own library
/// comment for the reasoning shared between the two: reads go direct to
/// Supabase (org/country/site RLS enforced server-side); the WRITE routes
/// through the shared offline command queue (`WASH_RECORD`, an ordinary
/// idempotent insert command already declared in
/// `lib/core/sync/command_registry.dart` - not a bespoke queue) so a wash
/// logged with no signal is never lost.
///
/// # `cost` / `water_liters` / `duration_min` are deliberately never written
///
/// `wash_records` and `CommandType.washRecord`'s field allow-list both still
/// carry these three columns, but `mobile/lib/wash.ts`'s own comment on
/// `submitWash` says plainly: "cost / water_liters / duration_min are no
/// longer written (removed per field feedback)". This repository follows
/// that instruction exactly - it never populates those three keys - rather
/// than reintroducing input for them. This is a disclosed, intentional gap
/// matching the reference source, not an oversight; `WashingScreen` carries
/// no controls for them either.
///
/// # `wash_date` is locked to today; `wash_time` is captured automatically
///
/// [submitWash] always dates the record today (a caller-supplied
/// [SubmitWashInput.washDate] is accepted only for parity with the
/// reference's own optional override - `WashingScreen` never offers a way
/// to set one) and computes `wash_time` as the device's LOCAL `HH:MM` at the
/// moment of the call - never user-editable, mirroring `submitWash`'s own
/// comment: "Time is captured automatically at save (local HH:MM), never
/// user-editable."
///
/// # Why there is no "synced / pending" distinction here either
///
/// Same reasoning as `meter_log_repository.dart`'s own library comment:
/// `QueuedCommandRepository.enqueue` never attempts an online write, so this
/// Flutter port cannot honestly report the RN reference's synchronous
/// online/offline outcome. `WashingScreen` reports a single "saved" outcome,
/// matching this codebase's own established convention
/// (`checklist_fill_controller.dart`'s `submit()`).
library;

import 'package:supabase_flutter/supabase_flutter.dart';
import 'package:tyre_pulse/core/database/dao/queue_dao.dart'
    show QueuedMediaAttachment;
import 'package:tyre_pulse/core/network/supabase_gateway.dart';
import 'package:tyre_pulse/core/network/supabase_tables.dart';
import 'package:tyre_pulse/core/sync/command_registry.dart';
import 'package:tyre_pulse/core/sync/queued_command_repository.dart';
import 'package:tyre_pulse/core/workspace/workspace_context.dart';
import 'package:tyre_pulse/features/washing/data/wash_record.dart';
import 'package:uuid/uuid.dart';

const String _washColumns = 'id,asset_no,vehicle_type,wash_date,wash_time,'
    'wash_type,site,bay,washed_by,water_liters,cost,duration_min,'
    'odometer_km,status,notes,photos,created_at';

/// Local (device-timezone) `YYYY-MM-DD`. This feature's own copy of the same
/// small technique `meter_log_repository.dart`'s `todayIsoDate` provides -
/// see that function's own doc comment for why no timezone correction is
/// needed in Dart, unlike the ported `todayISODate()`.
String todayIsoDate() {
  final DateTime now = DateTime.now();
  final String y = now.year.toString().padLeft(4, '0');
  final String m = now.month.toString().padLeft(2, '0');
  final String d = now.day.toString().padLeft(2, '0');
  return '$y-$m-$d';
}

/// Local `HH:MM`, mirroring `submitWash`'s own `now.getHours()`/
/// `now.getMinutes()` - both already local-time getters in JavaScript, so
/// this needs no UTC round trip either.
String _nowLocalHhMm() {
  final DateTime now = DateTime.now();
  final String h = now.hour.toString().padLeft(2, '0');
  final String m = now.minute.toString().padLeft(2, '0');
  return '$h:$m';
}

/// What [WashRepository.submitWash] actually sent.
final class SubmitWashInput {
  const SubmitWashInput({
    required this.assetNo,
    this.vehicleType,
    this.site,
    this.country,
    this.washedBy,
    this.washDate,
    this.washType,
    this.status,
    this.bay,
    this.odometerKm,
    this.notes,
    this.photoLocalPaths = const <String>[],
  });

  final String assetNo;
  final String? vehicleType;
  final String? site;
  final String? country;

  /// The operator's name. `washed_by` on the row.
  final String? washedBy;

  /// `YYYY-MM-DD`. Defaults to [todayIsoDate] when null - see the library
  /// comment on why `WashingScreen` never supplies one of its own.
  final String? washDate;

  /// One of [kWashTypes]. Required to submit - validated by the caller
  /// before this is constructed.
  final String? washType;

  /// One of [kWashStatusChoices]. Falls back to [kWashDefaultStatus] when
  /// blank, mirroring `submitWash`'s own
  /// `input.status?.trim() || 'In Progress'`.
  final String? status;

  final String? bay;
  final num? odometerKm;
  final String? notes;

  /// Up to [WashPhotoCapture.maxPhotos] local file paths, in display order.
  final List<String> photoLocalPaths;
}

/// The narrow surface this feature needs from Supabase. Abstract so a
/// screen/controller can be tested against a fake, mirroring
/// `MeterLogRepository`'s own split.
abstract interface class WashRepository {
  /// Recent wash records (this org, country/site scoped by RLS), newest
  /// first, bounded to [limit] (matches the TS source's own default of
  /// 200 - it is also the source the "due for wash" list is derived from,
  /// which needs enough history to see every asset's most recent wash).
  /// Throws on failure, mirroring `listRecentWashes`'s own `if (error)
  /// throw error`.
  Future<List<WashRecord>> listRecentWashes({int limit = 200});

  /// Logs a vehicle wash for [workspace]. Never throws for an ordinary
  /// offline condition, for the same reason
  /// `MeterLogRepository.submitMeterReading` does not.
  Future<Set<String>> submitWash({
    required WorkspaceContext workspace,
    required SubmitWashInput input,
  });

  /// The signed-in user's display name (`full_name` else `username`), used
  /// only to pre-fill the "Operator name" field - mirroring
  /// `mobile/app/(app)/washing.tsx`'s own `useState(profile?.full_name ??
  /// '')`. [WorkspaceContext] does not carry a display name itself (only
  /// `WorkspaceProfile`, an earlier/raw shape, does), so this repository
  /// reads `profiles` directly - the SAME columns, the SAME best-effort
  /// contract, and the SAME reasoning
  /// `InspectionApprovalRepository.currentUserDisplayName`
  /// (`lib/features/approvals/data/inspection_approval_repository.dart`)
  /// already establishes for the identical need on a sibling feature:
  /// returns `null` on any failure or when nothing is found, and a missing
  /// display name must never block logging a wash.
  Future<String?> currentUserDisplayName(String userId);
}

final class SupabaseWashRepository
    with SupabaseGateway
    implements WashRepository {
  SupabaseWashRepository(this._client, this._commands);

  final SupabaseClient _client;
  final QueuedCommandRepository _commands;

  static const Uuid _uuid = Uuid();

  @override
  Future<List<WashRecord>> listRecentWashes({int limit = 200}) async {
    final List<Map<String, dynamic>> rows =
        await guard<List<Map<String, dynamic>>>(
      () => _client
          .from(SupabaseTables.washRecords)
          .select(_washColumns)
          .order('wash_date', ascending: false, nullsFirst: false)
          .order('created_at', ascending: false)
          .limit(limit),
    );
    return <WashRecord>[
      for (final Map<String, dynamic> row in rows) WashRecord.fromRow(row),
    ];
  }

  @override
  Future<Set<String>> submitWash({
    required WorkspaceContext workspace,
    required SubmitWashInput input,
  }) async {
    final String asset = input.assetNo.trim();
    final String date = input.washDate ?? todayIsoDate();
    final List<String> photos = <String>[
      for (final String path in input.photoLocalPaths)
        if (path.trim().isNotEmpty) path,
    ];
    final String status = _trimmedOrNull(input.status) ?? kWashDefaultStatus;

    final EnqueueResult result = await _commands.enqueue(
      type: CommandType.washRecord,
      payload: <String, Object?>{
        'asset_no': asset,
        'vehicle_type': _trimmedOrNull(input.vehicleType),
        'site': _trimmedOrNull(input.site),
        'country': input.country,
        'created_by': workspace.userId,
        'washed_by': _trimmedOrNull(input.washedBy),
        'wash_date': date,
        'wash_time': _nowLocalHhMm(),
        'wash_type': _trimmedOrNull(input.washType),
        'bay': _trimmedOrNull(input.bay),
        'odometer_km': input.odometerKm,
        'status': status,
        'notes': _trimmedOrNull(input.notes),
        'photos': photos.isEmpty ? null : photos,
        // Deliberately absent: cost, water_liters, duration_min. See the
        // library comment.
      },
      workspace: workspace,
      now: DateTime.now(),
      attachments: <QueuedMediaAttachment>[
        for (int i = 0; i < photos.length; i++)
          QueuedMediaAttachment(
            localPath: photos[i],
            fileName: _basename(photos[i]),
            orderIndex: i,
          ),
      ],
      country: input.country ?? workspace.activeCountry,
      // One wash per asset per day from this device, plus a random suffix
      // so a genuine second wash the same day still records - see
      // `MeterLogRepository._freshSuffix`'s own doc comment for why the
      // suffix needs no RN-runtime compatibility shim in Dart, and why it
      // is safe to mint exactly once here.
      idempotencyKey: 'wash_${asset}_${date}_${_uuid.v4().substring(0, 8)}',
    );

    return result.droppedFields;
  }

  @override
  Future<String?> currentUserDisplayName(String userId) async {
    if (userId.isEmpty) return null;
    try {
      final Map<String, dynamic>? row = await guard<Map<String, dynamic>?>(
        () => _client
            .from(SupabaseTables.profiles)
            .select('full_name,username')
            .eq('id', userId)
            .maybeSingle(),
      );
      if (row == null) return null;
      final String full =
          (row['full_name'] as Object?)?.toString().trim() ?? '';
      if (full.isNotEmpty) return full;
      final String username =
          (row['username'] as Object?)?.toString().trim() ?? '';
      return username.isEmpty ? null : username;
    } on Object {
      return null;
    }
  }

  static String _basename(String path) {
    final int slash = path.lastIndexOf(RegExp(r'[\\/]'));
    return slash < 0 ? path : path.substring(slash + 1);
  }
}

String? _trimmedOrNull(String? raw) {
  final String trimmed = raw?.trim() ?? '';
  return trimmed.isEmpty ? null : trimmed;
}
