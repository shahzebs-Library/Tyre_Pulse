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
