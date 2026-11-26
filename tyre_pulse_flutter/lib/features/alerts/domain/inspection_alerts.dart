/// Tyre alerts taken from what inspectors actually recorded.
///
/// The tyre register's `risk_level` is not filled in by any intake today, so
/// a feed built only on it always reads zero while inspections report flat,
/// damaged and worn tyres. This turns each vehicle's latest inspection into
/// alerts, using the tyre diagram's own reading of a wheel so the feed, the
/// diagram and Home's recent-inspection cards always agree.
library;

import 'package:tyre_pulse/app/theme/tp_colors.dart';
import 'package:tyre_pulse/features/alerts/domain/tyre_alert.dart';
import 'package:tyre_pulse/features/tyre_diagram/domain/tyre_completeness.dart';
import 'package:tyre_pulse/features/tyre_diagram/domain/tyre_condition.dart';

/// Alert id for one wheel on one inspection. Acknowledging it stores this id
/// the same way a register alert is stored, so it stays hidden afterwards.
String inspectionAlertId(String inspectionId, String position) =>
    'insp:$inspectionId:$position';

/// Rows must be ordered newest first. Only the first (latest) inspection of
/// each asset counts: an older finding the vehicle has since been inspected
/// past is not an active alert.
List<TyreAlert> alertsFromInspections(Iterable<Map<String, Object?>> rows) {
  final Set<String> seen = <String>{};
  final List<TyreAlert> out = <TyreAlert>[];
  for (final Map<String, Object?> row in rows) {
    final String asset = (row['asset_no'] as String? ?? '').trim();
    final String id = '${row['id'] ?? ''}';
    if (asset.isEmpty || id.isEmpty) continue;
    // A rejected or cancelled inspection is not a finding anyone signed off; skip it so
    // the vehicle's next inspection speaks for it instead.
    final String approval =
        (row['approval_status'] as String? ?? '').trim().toLowerCase();
    final String status = (row['status'] as String? ?? '').trim().toLowerCase();
    if (approval == 'rejected' || status == 'cancelled') continue;
    // A vehicle is (organisation, country, asset number): the same code can
    // name a different machine in another country, and one must not hide the
    // other's findings.
    final String key = <Object?>[
      row['organisation_id'] ?? '',
      (row['country'] as String? ?? '').trim().toUpperCase(),
      asset.toUpperCase(),
    ].join('|');
    if (!seen.add(key)) continue;
    for (final TyreEntryPair pair in readTyreEntries(row['tyre_conditions'])) {
      final TpStatus status = wheelStatusFor(pair.entry);
      final String? level = switch (status) {
        TpStatus.critical => 'Critical',
        TpStatus.warning => 'High',
        _ => null,
      };
      if (level == null) continue;
      // Canonical keys first (what this app writes), legacy aliases after.
      final Object? serial = pair.entry['serial_number'] ??
          pair.entry['serial'] ??
          pair.entry['serial_no'];
      final Object? tread = pair.entry['tread_depth_mm'] ??
          pair.entry['tread_depth'] ??
          pair.entry['tread'];
      out.add(
        TyreAlert(
          id: inspectionAlertId(id, pair.key),
          riskLevel: level,
          assetNo: asset,
          site: row['site'] as String?,
          position: pair.key,
          serialNo: serial is String && serial.trim().isNotEmpty
              ? serial.trim()
              : null,
          treadDepthMm: tread is num ? tread : num.tryParse('${tread ?? ''}'),
          issueDate: row['inspection_date'] as String?,
        ),
      );
    }
  }
  return out;
}

/// One feed from register alerts and inspection alerts.
///
/// Acknowledged alerts are dropped, a wheel that the register already flags is
/// not repeated from an inspection, and the list is ordered most urgent first
/// (Critical, then newest) before it is cut to [limit], so a long feed never
/// drops a critical finding to make room for an older warning.
List<TyreAlert> mergeTyreAlerts({
  required Iterable<TyreAlert> register,
  required Iterable<TyreAlert> inspection,
  required Set<String> acknowledged,
  int limit = 300,
}) {
  String wheel(TyreAlert a) => '${(a.assetNo ?? '').trim().toUpperCase()}|'
      '${(a.position ?? '').trim().toUpperCase()}';
  final Set<String> registerWheels = <String>{
    for (final TyreAlert a in register)
      if ((a.assetNo ?? '').trim().isNotEmpty &&
          (a.position ?? '').trim().isNotEmpty)
        wheel(a),
  };
  final List<TyreAlert> all = <TyreAlert>[
    ...register,
    ...inspection.where((TyreAlert a) => !registerWheels.contains(wheel(a))),
  ].where((TyreAlert a) => !acknowledged.contains(a.id)).toList();
  all.sort((TyreAlert a, TyreAlert b) {
    final int rank = (b.isCritical ? 1 : 0) - (a.isCritical ? 1 : 0);
    if (rank != 0) return rank;
    return (b.issueDate ?? '').compareTo(a.issueDate ?? '');
  });
  return all.take(limit).toList(growable: false);
}
