/// Tyre replacement - records a tyre change against `tyre_records`.
///
/// Ported from `mobile/app/(app)/tyre-change.tsx` (`mobile/` is READ-ONLY
/// reference material - see `AGENTS.md` rule "Never edit them from this
/// project"). That screen is a SINGLE offline-queued write and makes NO
/// Supabase reads at all: pick the asset, position and the new tyre's
/// details, and submit.
///
/// # This is one `TYRE_CHANGE` insert - not a multi-step transaction
///
/// `CommandType.tyreChange` (`lib/core/sync/command_registry.dart`) already
/// declares this exact write: table `tyre_records`, operation insert. This
/// file does nothing beyond building that ONE payload and calling
/// [QueuedCommandRepository.enqueue] once, matching `tyre-change.tsx`
/// exactly - it is one `saveCommand('TYRE_CHANGE', {...})` call and nothing
/// else, verified by reading the file directly.
///
/// TWO migration-planning documents describe something larger, and BOTH are
/// aspiration, not verified production behaviour:
///
/// - `docs/flutter-migration/09-migration-matrix.md`'s Phase 7 exit
///   criterion sketches a six-step transactional flow ("close old fitment,
///   update removed tyre, create new fitment, update replacement tyre,
///   record meter, write history... Prefer a server RPC").
/// - `docs/flutter-migration/02-backend-table-rpc-map.md`'s table states,
///   in passing, that "a tyre replacement is a write to `tyre_records` plus
///   a `tyre_status_marks` row" - but `tyre_status_marks` is written
///   EXCLUSIVELY by `mobile/lib/tyreScrap.ts` (grepped directly: it is the
///   ONLY file in `mobile/` that references the table), which backs the
///   SCRAP/undo-scrap flow on the Serial Tracker screen, a wholly separate
///   feature from tyre replacement. `tyre-change.tsx` never references that
///   table. `mobile/__tests__/` carries no test naming `TYRE_CHANGE` or
///   `tyre-change` either, so no verified-business-logic source (source of
///   truth rank 3) requires it.
///
/// Per AGENTS.md's own source-of-truth order - "2. Working React Native
/// production behaviour" outranks "5. New Flutter implementation", and a
/// planning document is neither of those - the directly-read, directly
/// -verified screen wins over both sketches. This port follows the screen.
///
/// # The literal constants the reference screen hard-codes on every submit
///
/// `qty` is always `1`, `risk_level` is always `'Low'`, `category` is
/// always `'Tyre Change'`, and `fitment_date`/`issue_date` are BOTH set to
/// TODAY - reproduced here verbatim, not made configurable, because the
/// reference never exposes a control for any of the four.
///
/// # `serial_no` / `serial_number` / `tyre_serial` - one typed value, three
/// # columns
///
/// The reference writes the SAME entered serial into all three columns (or
/// omits all three together when blank) - `const sn = serial.trim() ||
/// null; serial_no: sn, serial_number: sn, tyre_serial: sn`. This port does
/// the same.
///
/// # `tyre_position` is deliberately left unset
///
/// `CommandRegistry.specFor(CommandType.tyreChange).fieldAllowList`
/// includes `tyre_position` as well as `position`, but the reference screen
/// only ever writes `position`. This repository follows the reference
/// exactly: writing a second column the production screen never populates,
/// on a guess about what it might be for, is precisely the invention
/// AGENTS.md rule 1 forbids. If `tyre_position` is later shown to be the
/// column another surface actually reads, that is a considered follow-up
/// change to this ONE payload map, not a silent addition made here.
///
/// # `photos` - a flat list, the SAME shape wash/meter-log already use
///
/// [SubmitTyreReplacementInput.photoLocalPaths] is a flat, orderable list -
/// the reference passes `photos.filter(Boolean).length ? ... : null` to a
/// bare array, the same shape `WASH_RECORD` and `ODOMETER_LOG` already
/// carry. It is NOT the keyed-by-field-id map checklist submissions use -
/// see `wash_repository.dart`'s own library comment for the identical
/// shape and the same distinction.
///
/// # Write-only, no Supabase client
///
/// Unlike `MeterLogRepository`/`WashRepository`, this feature has no read
/// surface of its own - the reference screen makes zero Supabase calls.
/// Asset lookup for auto-fill (see `presentation/tyre_replacement_screen
/// .dart`) is a SEPARATE, ADDED capability this port layers on via the
/// ALREADY-BUILT `VehicleFleetRepository`
/// (`features/assets/data/vehicle_fleet_repository.dart`), never
/// re-implemented here. So this class depends on nothing but
/// [QueuedCommandRepository] and never constructs a `SupabaseClient`.
///
/// # No synced/pending distinction reported
///
/// Same reasoning as `meter_log_repository.dart`'s own library comment:
/// [QueuedCommandRepository.enqueue] never attempts an online write first,
/// so there is no synchronous "delivered / queued" signal this Flutter
/// sync architecture can honestly report. The presentation layer reports a
/// single "saved" outcome, matching every sibling feature's own
/// convention.
library;

import 'package:tyre_pulse/core/database/dao/queue_dao.dart'
    show QueuedMediaAttachment;
import 'package:tyre_pulse/core/sync/command_registry.dart';
import 'package:tyre_pulse/core/sync/queued_command_repository.dart';
import 'package:tyre_pulse/core/workspace/workspace_context.dart';
import 'package:uuid/uuid.dart';

/// Local (device-timezone) `YYYY-MM-DD`. This feature's own copy of the
/// technique `meter_log_repository.todayIsoDate`/`wash_repository
/// .todayIsoDate` already establish - see either's own doc comment for why
/// no timezone correction is needed in Dart, unlike the ported
/// `todayISODate()` this mirrors.
String todayIsoDate() {
  final DateTime now = DateTime.now();
  final String y = now.year.toString().padLeft(4, '0');
  final String m = now.month.toString().padLeft(2, '0');
  final String d = now.day.toString().padLeft(2, '0');
  return '$y-$m-$d';
}

/// What [TyreReplacementRepository.submitTyreReplacement] actually sent.
final class SubmitTyreReplacementInput {
  const SubmitTyreReplacementInput({
    required this.assetNo,
    required this.position,
    this.site,
    this.country,
    this.brand,
    this.size,
    this.serialNo,
    this.costPerTyre,
    this.kmAtFitment,
    this.treadDepthMm,
    this.removalReason,
    this.photoLocalPaths = const <String>[],
  });

  final String assetNo;

  /// The chosen or typed position value - see
  /// `features/tyre_exchange/domain/tyre_replacement_position.dart` for how
  /// the picker derives one, and for which vocabulary this is. Validated as
  /// non-blank by the caller before this is constructed, matching every
  /// sibling repository's own contract.
  final String position;

  final String? site;
  final String? country;
  final String? brand;
  final String? size;
  final String? serialNo;
  final num? costPerTyre;
  final num? kmAtFitment;
  final num? treadDepthMm;
  final String? removalReason;

  /// Up to `TyreReplacementPhotoCapture.maxPhotos` local file paths, in
  /// display order.
  final List<String> photoLocalPaths;
}

/// Records a tyre replacement. Never throws for an ordinary offline
/// condition - [QueuedCommandRepository.enqueue] itself only throws for a
/// genuine caller bug (a blank workspace, a missing update target), neither
/// of which applies to this insert-only command.
abstract interface class TyreReplacementRepository {
  /// Returns the set of payload keys the command queue's allow-list
  /// dropped - telemetry only, never shown to the field worker. See
  /// [EnqueueResult.droppedFields].
  Future<Set<String>> submitTyreReplacement({
    required WorkspaceContext workspace,
    required SubmitTyreReplacementInput input,
  });
}

final class DefaultTyreReplacementRepository
    implements TyreReplacementRepository {
  DefaultTyreReplacementRepository(this._commands);

  final QueuedCommandRepository _commands;

  static const Uuid _uuid = Uuid();

  @override
  Future<Set<String>> submitTyreReplacement({
    required WorkspaceContext workspace,
    required SubmitTyreReplacementInput input,
  }) async {
    final String asset = input.assetNo.trim();
    final String position = input.position.trim();
    final String today = todayIsoDate();
    final String? sn = _trimmedOrNull(input.serialNo);
    final List<String> photos = <String>[
      for (final String path in input.photoLocalPaths)
        if (path.trim().isNotEmpty) path,
    ];

    final EnqueueResult result = await _commands.enqueue(
      type: CommandType.tyreChange,
      payload: <String, Object?>{
        'asset_no': asset,
        'site': _trimmedOrNull(input.site),
        'country': input.country,
        'position': position,
        'brand': _trimmedOrNull(input.brand),
        'size': _trimmedOrNull(input.size),
        'serial_no': sn,
        'serial_number': sn,
        'tyre_serial': sn,
        'cost_per_tyre': input.costPerTyre,
        'qty': 1,
        'km_at_fitment': input.kmAtFitment,
        'tread_depth': input.treadDepthMm,
        'fitment_date': today,
        'issue_date': today,
        'risk_level': 'Low',
        'category': 'Tyre Change',
        'removal_reason': _trimmedOrNull(input.removalReason),
        'photos': photos.isEmpty ? null : photos,
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
      // One replacement per asset+position per day from this device, plus a
      // random suffix so a genuine second replacement of the same wheel the
      // same day still records - mirrors `MeterLogRepository._freshSuffix`'s
      // own doc comment for why the suffix needs no cross-platform shim in
      // Dart and is safe to mint exactly once here, since [enqueue] is
      // called exactly once per call to this method.
      idempotencyKey:
          'tyrechg_${asset}_${_slug(position)}_${today}_'
          '${_uuid.v4().substring(0, 8)}',
    );

    return result.droppedFields;
  }

  static String _basename(String path) {
    final int slash = path.lastIndexOf(RegExp(r'[\\/]'));
    return slash < 0 ? path : path.substring(slash + 1);
  }

  static String _slug(String value) =>
      value.replaceAll(RegExp(r'[^A-Za-z0-9]+'), '_');
}

String? _trimmedOrNull(String? raw) {
  final String trimmed = raw?.trim() ?? '';
  return trimmed.isEmpty ? null : trimmed;
}
