/// The compact Total / OK / Monitor / Critical stat row shown above the
/// vehicle layout board.
///
/// Built entirely on [TpStatCard.count] - a real, measured count on every
/// tile, never a placeholder zero (spec section 32). A vehicle with no
/// tyres to inspect (positions is empty) renders NOTHING here rather than
/// four zero tiles that would read as "measured and empty".
library;

import 'package:flutter/material.dart';
import 'package:tyre_pulse/app/localization/tp_localizations.dart';
import 'package:tyre_pulse/app/theme/tp_colors.dart';
import 'package:tyre_pulse/app/theme/tp_spacing.dart';
import 'package:tyre_pulse/core/design_system/tp_stat_card.dart';
import 'package:tyre_pulse/features/tyre_diagram/domain/tyre_diagram_stats.dart';

class TyreDiagramStatRow extends StatelessWidget {
  const TyreDiagramStatRow({required this.stats, super.key});

  final TyreDiagramStats stats;

  @override
  Widget build(BuildContext context) {
    if (stats.total == 0) return const SizedBox.shrink();
    final AppLocalizations l10n = AppLocalizations.of(context);

    return Row(
      children: <Widget>[
        Expanded(
          child: TpStatCard.count(
            label: l10n.tyreDiagramStatTotal,
            count: stats.total,
            caption: stats.unrecorded > 0
                ? l10n.tyreDiagramStatUnrecordedCaption(stats.unrecorded)
                : null,
          ),
        ),
        const SizedBox(width: TpSpace.sm),
        Expanded(
          child: TpStatCard.count(
            label: l10n.tyreDiagramStatOk,
            count: stats.ok,
            status: TpStatus.ok,
          ),
        ),
        const SizedBox(width: TpSpace.sm),
        Expanded(
          child: TpStatCard.count(
            label: l10n.tyreDiagramStatMonitor,
            count: stats.monitor,
            status: TpStatus.warning,
          ),
        ),
        const SizedBox(width: TpSpace.sm),
        Expanded(
          child: TpStatCard.count(
            label: l10n.tyreDiagramStatCritical,
            count: stats.critical,
            status: TpStatus.critical,
          ),
        ),
      ],
    );
  }
}
