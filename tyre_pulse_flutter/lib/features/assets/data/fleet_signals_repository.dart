/// The two register-wide reads behind the Fleet & assets due lines.
///
/// Both are PostgREST on real tables (AGENTS.md rule 3), with the exact
/// columns Vehicle 360 already reads for one asset
/// (`asset_360_repository.dart`), plus `asset_no` and `country` so a row can
/// be matched back to its asset:
///
/// - `pm_programs` (V253): id, name, asset_no, country, status,
///   meter_source, meter_interval, next_due, next_due_meter, priority -
///   active plans only.
/// - `corrective_actions` (V496 `source_type`): id, asset_no, country,
///   status - inspection-raised actions only. Closed ones are counted out on
///   the device by `countOpenTyreActions`, because a blank status is open to
///   V496's own index and SQL `not in` would silently drop it.
///
/// Each read is paged with an `id` tiebreak and capped. A read that fills
/// its cap is reported as FAILED, never as a partial answer: a due list
/// that silently stops at the cap would tell a supervisor an asset has
/// nothing due when it was simply not read.
library;

import 'package:supabase_flutter/supabase_flutter.dart';
import 'package:tyre_pulse/core/network/supabase_gateway.dart';
import 'package:tyre_pulse/core/network/supabase_tables.dart';
import 'package:tyre_pulse/features/assets/data/vehicle_fleet_repository.dart'
    show PagedRows, fetchAllPages;
import 'package:tyre_pulse/features/assets/domain/fleet_signals.dart';

/// Row cap for each register-wide read.
const int fleetSignalsRowCap = 5000;

abstract interface class FleetSignalsSource {
  /// One page of active `pm_programs` rows, ordered by id.
  Future<List<Map<String, dynamic>>> pmPage(String? country, int from, int to);

  /// One page of inspection-raised `corrective_actions`, ordered by id.
  Future<List<Map<String, dynamic>>> actionPage(
    String? country,
    int from,
    int to,
  );
}

final class SupabaseFleetSignalsSource
    with SupabaseGateway
    implements FleetSignalsSource {
  SupabaseFleetSignalsSource(this._client);

  final SupabaseClient _client;

  @override
  Future<List<Map<String, dynamic>>> pmPage(String? country, int from, int to) {
    return guard(() async {
      var q = _client
          .from(SupabaseTables.pmPrograms)
          .select(
            'id, name, asset_no, country, status, meter_source, '
            'meter_interval, next_due, next_due_meter, priority',
          )
          .eq('status', 'active');
      if (country != null) {
        q = q.or('country.eq.$country,country.is.null');
      }
      return q.order('id').range(from, to);
    });
  }

  @override
  Future<List<Map<String, dynamic>>> actionPage(
    String? country,
    int from,
    int to,
  ) {
    return guard(() async {
      var q = _client
          .from(SupabaseTables.correctiveActions)
          .select('id, asset_no, country, status')
          .eq('source_type', 'inspection');
      if (country != null) {
        q = q.or('country.eq.$country,country.is.null');
      }
      return q.order('id').range(from, to);
    });
  }
}

/// What the register-wide read produced.
sealed class FleetSignalsOutcome {
  const FleetSignalsOutcome();
}

final class FleetSignalsLoaded extends FleetSignalsOutcome {
  const FleetSignalsLoaded(this.signals);
  final FleetSignals signals;
}

/// Either read failed or filled its cap. The list shows no due lines and
/// the "Due soon" filter says it could not check, rather than implying
/// nothing is due.
final class FleetSignalsUnavailable extends FleetSignalsOutcome {
  const FleetSignalsUnavailable();
}

/// Reads both tables for [country] (null = every country the caller's RLS
/// scope allows). Never throws.
Future<FleetSignalsOutcome> loadFleetSignals(
  FleetSignalsSource source, {
  String? country,
}) async {
  final String? scope =
      (country == null || country.trim().isEmpty) ? null : country.trim();
  try {
    final List<PagedRows<Map<String, dynamic>>> pages =
        await Future.wait(<Future<PagedRows<Map<String, dynamic>>>>[
      fetchAllPages<Map<String, dynamic>>(
        (int from, int to) => source.pmPage(scope, from, to),
        maxRows: fleetSignalsRowCap,
      ),
      fetchAllPages<Map<String, dynamic>>(
        (int from, int to) => source.actionPage(scope, from, to),
        maxRows: fleetSignalsRowCap,
      ),
    ]);
    if (pages[0].truncated || pages[1].truncated) {
      return const FleetSignalsUnavailable();
    }
    return FleetSignalsLoaded(
      FleetSignals.fromRows(pmRows: pages[0].rows, actionRows: pages[1].rows),
    );
  } on Object {
    return const FleetSignalsUnavailable();
  }
}
