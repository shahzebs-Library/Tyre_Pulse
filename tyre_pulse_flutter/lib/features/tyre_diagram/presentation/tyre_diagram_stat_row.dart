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
import 'package:tyre_pulse/core/design_system/tp_text_scale.dart';
import 'package:tyre_pulse/features/tyre_diagram/domain/tyre_diagram_stats.dart';

class TyreDiagramStatRow extends StatelessWidget {
  const TyreDiagramStatRow({required this.stats, super.key});

  final TyreDiagramStats stats;

  @override
  Widget build(BuildContext context) {
    if (stats.total == 0) return const SizedBox.shrink();
    final AppLocalizations l10n = AppLocalizations.of(context);

    final List<Widget> cards = <Widget>[
      TpStatCard.count(
        label: l10n.tyreDiagramStatTotal,
        count: stats.total,
        caption: stats.unrecorded > 0
            ? l10n.tyreDiagramStatUnrecordedCaption(stats.unrecorded)
            : null,
      ),
      TpStatCard.count(
        label: l10n.tyreDiagramStatOk,
        count: stats.ok,
        status: TpStatus.ok,
      ),
      TpStatCard.count(
        label: l10n.tyreDiagramStatMonitor,
        count: stats.monitor,
        status: TpStatus.warning,
      ),
      TpStatCard.count(
        label: l10n.tyreDiagramStatCritical,
        count: stats.critical,
        status: TpStatus.critical,
      ),
    ];

    Widget row(List<Widget> items) => Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            for (int i = 0; i < items.length; i++) ...<Widget>[
              if (i > 0) const SizedBox(width: TpSpace.sm),
              Expanded(child: items[i]),
            ],
          ],
        );

    // Four across while each tile has room for its label and count at the
    // person's text size; otherwise two rows of two, so a count never
    // breaks one digit per line and a label never splits mid-word.
    return LayoutBuilder(
      builder: (BuildContext context, BoxConstraints constraints) {
        final double tileWidth = (constraints.maxWidth - 3 * TpSpace.sm) / 4;
        if (tileWidth >= 64 * tpTextScaleFactor(context)) return row(cards);
        return Column(
          children: <Widget>[
            row(cards.sublist(0, 2)),
            const SizedBox(height: TpSpace.sm),
            row(cards.sublist(2)),
          ],
        );
      },
    );
  }
}
