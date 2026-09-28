/// Records a tyre ROTATION as one `tyre_service_events` row - the write
/// behind the Take Action screen's "Rotate tyre" row.
///
/// # Why this table, and why this exact shape
///
/// `tyre_service_events` is a real table (`MIGRATIONS_V151_TYRE_SERVICE_
/// EVENTS.sql`), verified live before this file was written:
///
///  - its `event_type` CHECK allows exactly `rotation`, `repair`,
///    `inflation`, `inspection`, `replacement`, `other` - so `rotation` is
///    the table's own vocabulary, not an invented one;
///  - its INSERT policy admits any signed-in user (`auth.uid() IS NOT
///    NULL`), under the org, country and site RESTRICTIVE walls - so a
///    tyre fitter can record the rotation they just did;
///  - the web's own writer (`src/lib/api/tyreServiceEvents.js`
///    `createServiceEvent`) inserts the same columns this file does, and
///    refuses a row that names neither a tyre serial nor an asset - the
///    same rule [TyreServiceEventRepository.recordRotation] enforces.
///
/// The web Tyre Passport's "Service & repairs" tab reads these rows, so a
/// rotation recorded here is visible in the tyre's history.
///
/// # What a rotation event does NOT do
///
/// It records that the tyre was moved and where to. It does not rewrite
/// `tyre_records.position`: no offline command in
/// `lib/core/sync/command_registry.dart` updates an existing tyre record,
/// and the `tyre_records` UPDATE policy is limited to managers. The
/// position column holds the DESTINATION, matching the web writer
/// (`src/lib/api/tyreRecords.js` records the new position on a rotation),
/// so the Tyre Passport's per-position history puts the tyre where it now
/// is. The source position is kept in [notes] ("Rotated from X to Y").
///
/// # Online only, and it says so
///
/// There is no queued command for this table (the command registry is a
/// protected file that no feature may extend). The write is therefore a
/// direct PostgREST insert through [SupabaseGateway.guard], and a failure is
/// rethrown as an [AppError] for the screen to report honestly - never a
/// silent success.
library;

import 'package:supabase_flutter/supabase_flutter.dart';
import 'package:tyre_pulse/core/errors/app_error.dart';
import 'package:tyre_pulse/core/network/supabase_gateway.dart';
import 'package:tyre_pulse/core/workspace/workspace_context.dart';

/// The live table name (`MIGRATIONS_V151_TYRE_SERVICE_EVENTS.sql`).
const String tyreServiceEventsTable = 'tyre_service_events';

/// The one `event_type` value this feature writes. Part of the table's own
/// CHECK constraint - see the library comment.
const String tyreServiceEventRotation = 'rotation';

/// One insert: a table name and the row to insert. Extracted so a test can
/// capture the exact payload without a real [SupabaseClient].
typedef TyreServiceEventInserter = Future<void> Function(
  String table,
  Map<String, Object?> row,
);

/// Everything a rotation event records. Blank strings are normalised to
/// null before the insert.
final class RecordTyreRotationInput {
  const RecordTyreRotationInput({
    required this.fromPosition,
    required this.toPosition,
    required this.eventDate,
    this.assetNo,
    this.tyreSerial,
    this.site,
    this.notes,
  });

  final String fromPosition;
  final String toPosition;
  final DateTime eventDate;
  final String? assetNo;
  final String? tyreSerial;
  final String? site;
  final String? notes;
}

abstract interface class TyreServiceEventRepository {
  /// Inserts one `rotation` event. Throws [AppError] with
  /// [AppErrorKind.validation] when the input cannot describe a real
  /// rotation, or the classified Supabase error when the write fails.
  Future<void> recordRotation({
    required WorkspaceContext workspace,
    required RecordTyreRotationInput input,
  });
}

final class SupabaseTyreServiceEventRepository
    with SupabaseGateway
    implements TyreServiceEventRepository {
  SupabaseTyreServiceEventRepository(SupabaseClient client)
      : _insert = _defaultInserter(client);

  /// For tests: substitutes how the row is actually inserted.
  SupabaseTyreServiceEventRepository.withInserter(this._insert);

  final TyreServiceEventInserter _insert;

  static TyreServiceEventInserter _defaultInserter(SupabaseClient client) {
    return (String table, Map<String, Object?> row) async {
      await client.from(table).insert(row);
    };
  }

  /// The exact row [recordRotation] inserts. Public so the payload shape is
  /// testable in isolation.
  static Map<String, Object?> rotationRow({
    required WorkspaceContext workspace,
    required RecordTyreRotationInput input,
  }) {
    final String from = input.fromPosition.trim().toUpperCase();
    final String to = input.toPosition.trim().toUpperCase();
    final String? extra = _blankToNull(input.notes);
    final String movedNote = 'Rotated from $from to $to';
    return <String, Object?>{
      'tyre_serial': _blankToNull(input.tyreSerial),
      'asset_no': _blankToNull(input.assetNo)?.toUpperCase(),
      'position': to,
      'event_type': tyreServiceEventRotation,
      'event_date': _isoDay(input.eventDate),
      'site': _blankToNull(input.site),
      'country': _blankToNull(workspace.activeCountry),
      'technician': _blankToNull(workspace.fullName),
      'notes': extra == null ? movedNote : '$movedNote. $extra',
    };
  }

  @override
  Future<void> recordRotation({
    required WorkspaceContext workspace,
    required RecordTyreRotationInput input,
  }) async {
    final String from = input.fromPosition.trim();
    final String to = input.toPosition.trim();
    if (from.isEmpty || to.isEmpty) {
      throw const AppError(
        kind: AppErrorKind.validation,
        message: 'Choose the position the tyre was moved to.',
        technical: 'recordRotation called with a blank from/to position',
      );
    }
    if (from.toUpperCase() == to.toUpperCase()) {
      throw const AppError(
        kind: AppErrorKind.validation,
        message: 'The new position must differ from the current one.',
        technical: 'recordRotation called with from == to',
      );
    }
    if (_blankToNull(input.tyreSerial) == null &&
        _blankToNull(input.assetNo) == null) {
      throw const AppError(
        kind: AppErrorKind.validation,
        message: 'A rotation needs a tyre serial or an asset number.',
        technical: 'recordRotation called with neither serial nor asset',
      );
    }

    final Map<String, Object?> row = rotationRow(
      workspace: workspace,
      input: input,
    );
    await guard<void>(() => _insert(tyreServiceEventsTable, row));
  }

  static String? _blankToNull(String? value) {
    final String trimmed = value?.trim() ?? '';
    return trimmed.isEmpty ? null : trimmed;
  }

  /// A local calendar day, never `toIso8601String()` on a UTC instant -
  /// that rolls the day for anyone east or west of UTC near midnight.
  static String _isoDay(DateTime d) {
    final String m = d.month.toString().padLeft(2, '0');
    final String day = d.day.toString().padLeft(2, '0');
    return '${d.year}-$m-$day';
  }
}
