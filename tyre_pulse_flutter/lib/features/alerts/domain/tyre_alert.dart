/// One active Critical/High risk record shown in the tyre Alerts feed.
library;

import 'package:tyre_pulse/app/theme/tp_colors.dart';

enum TyreAlertFilter { all, critical, warnings, info }

final class TyreAlert {
  const TyreAlert({
    required this.id,
    required this.riskLevel,
    this.assetNo,
    this.site,
    this.brand,
    this.position,
    this.serialNo,
    this.treadDepthMm,
    this.issueDate,
  });

  final String id;
  final String riskLevel;
  final String? assetNo;
  final String? site;
  final String? brand;
  final String? position;
  final String? serialNo;
  final num? treadDepthMm;
  final String? issueDate;

  bool get isCritical => riskLevel.toLowerCase() == 'critical';
  bool get isWarning => riskLevel.toLowerCase() == 'high';

  TpStatus get status => isCritical ? TpStatus.critical : TpStatus.warning;

  bool matches(TyreAlertFilter filter) => switch (filter) {
        TyreAlertFilter.all => true,
        TyreAlertFilter.critical => isCritical,
        TyreAlertFilter.warnings => isWarning,
        // The verified source contains only Critical/High tyre risk rows.
        // Info remains a working filter with an honest empty result.
        TyreAlertFilter.info => false,
      };
}
