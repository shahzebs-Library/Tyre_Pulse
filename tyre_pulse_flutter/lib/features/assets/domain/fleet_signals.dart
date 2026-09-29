/// The per-asset "what needs attention" lines on the Fleet & assets list:
/// the next preventive-maintenance service and the open inspection tyre
/// actions (owner mock `Fleet_&_Assets.jpg`: "Service due in 320 km",
/// "2 tyre actions").
///
/// Pure: no Flutter, no Supabase. The rows come from the same two tables
/// and the same columns the Vehicle 360 header reads one asset at a time
/// (`pm_programs`, V253; `corrective_actions` with `source_type`, V496), read
/// once for the whole register instead of once per row. The decoding and
/// the service-due rule are the Vehicle 360 ones ([pmPlanFromRow],
/// [resolveAssetServiceDue], [countOpenTyreActions]) so the list and the
/// detail screen can never disagree about the same asset.
///
/// # What is deliberately NOT shown
///
/// - Engine hours. `vehicle_fleet` carries no live hour reading (the
///   `engine_hours_logs` table has no sync trigger), and reading the latest
///   log for every asset would page the whole log table onto a phone. An
///   hour-metered plan therefore falls back to its calendar date, exactly
///   as Vehicle 360 does when no hour reading exists.
/// - "Inspection due today", "Hydraulic issue open", an operational risk
///   score: the mock shows them, but no table the app reads produces them
///   per asset. They are left out rather than guessed.
library;

import 'package:flutter/foundation.dart' show immutable;
import 'package:tyre_pulse/features/assets/domain/asset_360_facts.dart';
import 'package:tyre_pulse/features/assets/domain/vehicle_asset.dart';
import 'package:tyre_pulse/features/preventive_maintenance/domain/pm_plan.dart';

/// Kilometres at or under which a meter service reads "due soon". A
/// presentation rule, stated here once.
const int fleetDueSoonKm = 1000;

/// Days at or under which a calendar service reads "due soon". The same
/// 14-day window the PM screen's [PmDueBand.dueSoon] uses.
const int fleetDueSoonDays = 14;

/// Whether [due] is overdue or inside the due-soon window.
bool isFleetServiceDueSoon(AssetServiceDue? due) {
  if (due == null) return false;
  if (due.isOverdue) return true;
  return switch (due.unit) {
    AssetServiceDueUnit.km => due.remaining <= fleetDueSoonKm,
    AssetServiceDueUnit.days => due.remaining <= fleetDueSoonDays,
    // Hours are never measured on the list (see the library comment).
    AssetServiceDueUnit.hours => false,
  };
}

/// One asset's signals as the list renders them.
@immutable
class FleetAssetSignal {
  const FleetAssetSignal({this.serviceDue, this.tyreActions = 0});

  final AssetServiceDue? serviceDue;

  /// Open inspection tyre actions. Zero means none are open.
  final int tyreActions;

  bool get isDueSoon => isFleetServiceDueSoon(serviceDue);
}

/// Every active PM plan and every inspection-raised corrective action for
/// the register, grouped by asset.
@immutable
class FleetSignals {
  const FleetSignals._(this._plans, this._actions);

  /// Groups [pmRows] (`pm_programs`) and [actionRows] (`corrective_actions`
  /// with `source_type = 'inspection'`) by asset number.
  ///
  /// Asset numbers are compared trimmed and upper-cased, the canonical form
  /// V337 enforces on every business table. A row carries its own country:
  /// the same asset number in another country is another machine, so a
  /// row is matched to an asset only when neither side's country is known
  /// to differ.
  factory FleetSignals.fromRows({
    required Iterable<Map<String, dynamic>> pmRows,
    required Iterable<Map<String, dynamic>> actionRows,
  }) {
    final Map<String, List<(String?, PmPlan)>> plans =
        <String, List<(String?, PmPlan)>>{};
    for (final Map<String, dynamic> row in pmRows) {
      final PmPlan? plan = pmPlanFromRow(row);
      final String? key = _key(row['asset_no']);
      if (plan == null || key == null) continue;
      plans
          .putIfAbsent(key, () => <(String?, PmPlan)>[])
          .add((_text(row['country']), plan));
    }
    final Map<String, List<(String?, Map<String, dynamic>)>> actions =
        <String, List<(String?, Map<String, dynamic>)>>{};
    for (final Map<String, dynamic> row in actionRows) {
      final String? key = _key(row['asset_no']);
      if (key == null) continue;
      actions
          .putIfAbsent(key, () => <(String?, Map<String, dynamic>)>[])
          .add((_text(row['country']), row));
    }
    return FleetSignals._(plans, actions);
  }

  final Map<String, List<(String?, PmPlan)>> _plans;
  final Map<String, List<(String?, Map<String, dynamic>)>> _actions;

  /// The signal for [asset] on [now]. An asset with no asset number has
  /// nothing to match and gets an empty signal.
  FleetAssetSignal signalFor(VehicleAsset asset, DateTime now) {
    final String? key = _key(asset.assetNo);
    if (key == null) return const FleetAssetSignal();
    final String? country = asset.country;
    final Iterable<PmPlan> plans = (_plans[key] ?? const <(String?, PmPlan)>[])
        .where(((String?, PmPlan) e) => _sameCountry(e.$1, country))
        .map(((String?, PmPlan) e) => e.$2);
    final Iterable<Map<String, dynamic>> actionRows =
        (_actions[key] ?? const <(String?, Map<String, dynamic>)>[])
            .where(
              ((String?, Map<String, dynamic>) e) =>
                  _sameCountry(e.$1, country),
            )
            .map(((String?, Map<String, dynamic>) e) => e.$2);
    return FleetAssetSignal(
      serviceDue: resolveAssetServiceDue(
        plans,
        currentKm: asset.currentKm,
        engineHours: null,
        now: now,
      ),
      tyreActions: countOpenTyreActions(actionRows),
    );
  }

  static bool _sameCountry(String? row, String? asset) {
    if (row == null || asset == null) return true;
    return row.toLowerCase() == asset.trim().toLowerCase();
  }

  static String? _key(Object? raw) {
    final String? text = _text(raw);
    return text?.toUpperCase();
  }

  static String? _text(Object? raw) {
    if (raw is! String) return null;
    final String trimmed = raw.trim();
    return trimmed.isEmpty ? null : trimmed;
  }
}

/// How the list is ordered. [assetNumber] keeps the register's own order.
enum FleetSortOrder { assetNumber, serviceDue, tyreActions }

/// Compares two service-due signals for [FleetSortOrder.serviceDue]: overdue
/// first, then the Vehicle 360 unit order (km, hours, days) and the smallest
/// remaining figure; an asset with nothing measured goes last.
int compareFleetServiceDue(AssetServiceDue? a, AssetServiceDue? b) {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  if (a.isOverdue != b.isOverdue) return a.isOverdue ? -1 : 1;
  final int byUnit = a.unit.index.compareTo(b.unit.index);
  if (byUnit != 0) return byUnit;
  return a.remaining.compareTo(b.remaining);
}
