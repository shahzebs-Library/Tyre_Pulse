/// Shared pieces of the Vehicle 360 cost snapshot and the single-asset
/// financial report, so the two screens can never draw the same figure two
/// different ways.
library;

import 'package:flutter/material.dart';
import 'package:intl/intl.dart' show DateFormat;
import 'package:tyre_pulse/app/localization/tp_localizations.dart';
import 'package:tyre_pulse/app/theme/tp_colors.dart';
import 'package:tyre_pulse/app/theme/tp_spacing.dart';
import 'package:tyre_pulse/features/assets/domain/asset_financials.dart';

/// `SAR 42,680`. The currency always comes from the data, never assumed.
String assetMoneyLabel(String currency, double value, {int decimals = 0}) =>
    '$currency ${formatAssetMoney(value, decimals: decimals)}';

/// Distinct, theme-aware colours for the four buckets.
Color assetBucketColor(BuildContext context, AssetCostBucket bucket) {
  final TpPalette p = TpPalette.of(context);
  return switch (bucket) {
    AssetCostBucket.spareParts => p.primary,
    AssetCostBucket.lubricants => p.info.base,
    AssetCostBucket.tyres => p.warning.base,
    AssetCostBucket.labour => p.ok.base,
  };
}

String assetBucketLabel(AppLocalizations l10n, AssetCostBucket bucket) =>
    switch (bucket) {
      AssetCostBucket.spareParts => l10n.fleetMockFinBucketParts,
      AssetCostBucket.lubricants => l10n.fleetMockFinBucketLubricants,
      AssetCostBucket.tyres => l10n.fleetMockFinBucketTyres,
      AssetCostBucket.labour => l10n.fleetMockFinBucketLabour,
    };

String assetPercent(double share) => '${(share * 100).round()}%';

/// The stacked composition bar plus its legend. Buckets with nothing in them
/// are left out of both, so the legend never lists a 0% slice.
class AssetCompositionBar extends StatelessWidget {
  const AssetCompositionBar({
    required this.summary,
    required this.currency,
    this.showAmounts = false,
    super.key,
  });

  final AssetFinancialSummary summary;
  final String currency;
  final bool showAmounts;

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final TpPalette palette = TpPalette.of(context);
    final TextTheme text = Theme.of(context).textTheme;
    final List<AssetCostBucket> present = AssetCostBucket.values
        .where((AssetCostBucket b) => summary.amountOf(b) > 0)
        .toList();
    if (present.isEmpty) return const SizedBox.shrink();
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: <Widget>[
        ClipRRect(
          borderRadius: BorderRadius.circular(TpRadius.pill),
          child: SizedBox(
            height: 14,
            child: Row(
              children: <Widget>[
                for (final AssetCostBucket b in present)
                  Expanded(
                    flex: (summary.shareOf(b)! * 1000).round().clamp(1, 1000),
                    child: ColoredBox(color: assetBucketColor(context, b)),
                  ),
              ],
            ),
          ),
        ),
        const SizedBox(height: TpSpace.sm),
        Wrap(
          spacing: TpSpace.lg,
          runSpacing: TpSpace.xs,
          children: <Widget>[
            for (final AssetCostBucket b in present)
              Row(
                mainAxisSize: MainAxisSize.min,
                children: <Widget>[
                  Container(
                    width: 10,
                    height: 10,
                    decoration: BoxDecoration(
                      color: assetBucketColor(context, b),
                      shape: BoxShape.circle,
                    ),
                  ),
                  const SizedBox(width: TpSpace.xs),
                  Text(
                    showAmounts
                        ? '${assetBucketLabel(l10n, b)}  '
                            '${assetMoneyLabel(currency, summary.amountOf(b))}'
                            ' · ${assetPercent(summary.shareOf(b)!)}'
                        : '${assetBucketLabel(l10n, b)}  '
                            '${assetPercent(summary.shareOf(b)!)}',
                    style: text.labelSmall?.copyWith(
                      color: palette.textSecondary,
                    ),
                  ),
                ],
              ),
          ],
        ),
      ],
    );
  }
}

/// One KPI: a label, a value, and an optional note under it.
class AssetKpiTile extends StatelessWidget {
  const AssetKpiTile({
    required this.label,
    required this.value,
    this.note,
    this.noteColor,
    this.noteIcon,
    super.key,
  });

  final String label;
  final String value;
  final String? note;
  final Color? noteColor;
  final IconData? noteIcon;

  @override
  Widget build(BuildContext context) {
    final TpPalette palette = TpPalette.of(context);
    final TextTheme text = Theme.of(context).textTheme;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      mainAxisSize: MainAxisSize.min,
      children: <Widget>[
        Text(
          label,
          maxLines: 2,
          style: text.labelSmall?.copyWith(color: palette.textSecondary),
        ),
        const SizedBox(height: 2),
        FittedBox(
          fit: BoxFit.scaleDown,
          alignment: AlignmentDirectional.centerStart,
          child: Text(
            value,
            style: text.titleMedium?.copyWith(fontWeight: FontWeight.w900),
          ),
        ),
        if (note != null) ...<Widget>[
          const SizedBox(height: 2),
          Row(
            mainAxisSize: MainAxisSize.min,
            children: <Widget>[
              if (noteIcon != null) ...<Widget>[
                Icon(noteIcon, size: 14, color: noteColor ?? palette.textMuted),
                const SizedBox(width: 2),
              ],
              Flexible(
                child: Text(
                  note!,
                  maxLines: 2,
                  style: text.labelSmall?.copyWith(
                    color: noteColor ?? palette.textMuted,
                    fontWeight: FontWeight.w600,
                  ),
                ),
              ),
            ],
          ),
        ],
      ],
    );
  }
}

/// A change percentage note, coloured as a cost: a rise is a warning, a fall
/// is good. Null when there is nothing to compare against.
({String text, Color color, IconData icon})? assetChangeNote(
  BuildContext context,
  double? pct,
) {
  if (pct == null) return null;
  final TpPalette palette = TpPalette.of(context);
  final bool up = pct > 0;
  return (
    text: '${up ? '+' : ''}${pct.toStringAsFixed(1)}%',
    color: up ? palette.critical.base : palette.ok.base,
    icon: up ? Icons.arrow_upward_rounded : Icons.arrow_downward_rounded,
  );
}

/// Monthly cost bars with value labels. Drawn with plain widgets - the
/// project carries no chart package, and a handful of bars does not justify
/// one.
///
/// Every month in [monthly] is drawn: the chart must never show fewer months
/// than the total it sits beside counts. The height grows with the text
/// scale (labels above and below the bars keep their room), and the chart is
/// read to a screen reader as one summary instead of a bar at a time.
///
/// Labels never shrink below [minLabelSize] (no `FittedBox`: shrinking text
/// back down would cancel the reader's own text size, WCAG 1.4.4). When a
/// label is wider than its bar's slot, alternate labels are skipped instead,
/// anchored on the latest month, and the peak month always keeps its value.
class AssetMonthlyBars extends StatelessWidget {
  const AssetMonthlyBars({required this.monthly, super.key});

  final List<AssetMonthlyCost> monthly;

  /// Tallest bar, in logical pixels.
  static const double barHeight = 110;

  /// Smallest label font size, before the reader's text scale.
  static const double minLabelSize = 12;

  /// Indices whose label is drawn when each label needs [step] slots: the
  /// [pinned] index first (when given), then the latest month backwards,
  /// never closer than [step] to a label already chosen.
  static Set<int> labelIndices(int count, int step, {int? pinned}) {
    final Set<int> chosen = <int>{if (pinned != null) pinned};
    for (int i = count - 1; i >= 0; i--) {
      if (chosen.every((int j) => (i - j).abs() >= step)) chosen.add(i);
    }
    return chosen;
  }

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final TpPalette palette = TpPalette.of(context);
    final TextTheme text = Theme.of(context).textTheme;
    final String locale = Localizations.localeOf(context).toString();
    final TextStyle base = text.labelSmall ?? const TextStyle();
    final TextStyle labelStyle = base.copyWith(
      fontSize: (base.fontSize ?? minLabelSize) < minLabelSize
          ? minLabelSize
          : base.fontSize,
    );
    final TextScaler scaler = MediaQuery.textScalerOf(context);
    final double lineHeight =
        scaler.scale(labelStyle.fontSize!) * (labelStyle.height ?? 1.5);
    // Value label + gap + bar + gap + month label, with slack for rounding.
    final double chartHeight = barHeight + lineHeight * 2 + 2 + TpSpace.xs + 8;
    AssetMonthlyCost? peak;
    int? peakIndex;
    for (int i = 0; i < monthly.length; i++) {
      final AssetMonthlyCost c = monthly[i];
      if (c.total > 0 && (peak == null || c.total > peak.total)) {
        peak = c;
        peakIndex = i;
      }
    }
    final double max = peak?.total ?? 0;
    final String summary = peak == null
        ? l10n.assetsFixChartSummaryEmpty(monthly.length)
        : l10n.assetsFixChartSummary(
            monthly.length,
            DateFormat.yMMM(locale).format(peak.month),
            formatAssetMoney(peak.total),
          );
    final List<String> values = <String>[
      for (final AssetMonthlyCost c in monthly)
        c.total > 0 ? formatAssetCompact(c.total) : '',
    ];
    final List<String> months = <String>[
      for (final AssetMonthlyCost c in monthly)
        DateFormat.MMM(locale).format(c.month),
    ];
    final TextDirection direction = Directionality.of(context);
    double widest(List<String> labels) {
      double w = 0;
      for (final String label in labels) {
        if (label.isEmpty) continue;
        final TextPainter painter = TextPainter(
          text: TextSpan(text: label, style: labelStyle),
          textDirection: direction,
          textScaler: scaler,
          maxLines: 1,
        )..layout();
        if (painter.width > w) w = painter.width;
        painter.dispose();
      }
      return w;
    }

    final double valueWidth = widest(values);
    final double monthWidth = widest(months);
    return Semantics(
      label: summary,
      container: true,
      excludeSemantics: true,
      child: SizedBox(
        height: chartHeight,
        child: LayoutBuilder(
          builder: (BuildContext context, BoxConstraints constraints) {
            final int count = monthly.isEmpty ? 1 : monthly.length;
            final double slot = constraints.maxWidth / count;
            int stepFor(double width) {
              if (slot <= 0) return 1;
              final int step = ((width + TpSpace.xs) / slot).ceil();
              return step < 1 ? 1 : step;
            }

            final Set<int> shownValues = labelIndices(
              monthly.length,
              stepFor(valueWidth),
              pinned: peakIndex,
            );
            final Set<int> shownMonths =
                labelIndices(monthly.length, stepFor(monthWidth));
            // A label wider than its slot overflows centred into the
            // neighbouring slots, which are left empty by the step above.
            Widget label(String value, double width, TextStyle style) =>
                SizedBox(
                  height: lineHeight,
                  child: OverflowBox(
                    maxWidth: width + 1,
                    child: Text(
                      value,
                      maxLines: 1,
                      softWrap: false,
                      style: style,
                    ),
                  ),
                );
            return Row(
              crossAxisAlignment: CrossAxisAlignment.end,
              children: <Widget>[
                for (int i = 0; i < monthly.length; i++)
                  Expanded(
                    child: Padding(
                      padding: const EdgeInsets.symmetric(horizontal: 3),
                      child: Column(
                        mainAxisAlignment: MainAxisAlignment.end,
                        children: <Widget>[
                          if (monthly[i].total > 0 && shownValues.contains(i))
                            label(values[i], valueWidth, labelStyle),
                          const SizedBox(height: 2),
                          Container(
                            height: max <= 0
                                ? 2
                                : (monthly[i].total / max * barHeight)
                                    .clamp(2, barHeight),
                            decoration: BoxDecoration(
                              color: monthly[i].total > 0
                                  ? palette.primary
                                  : palette.border,
                              borderRadius: const BorderRadius.vertical(
                                top: Radius.circular(3),
                              ),
                            ),
                          ),
                          const SizedBox(height: TpSpace.xs),
                          if (shownMonths.contains(i))
                            label(
                              months[i],
                              monthWidth,
                              labelStyle.copyWith(
                                color: palette.textSecondary,
                              ),
                            )
                          else
                            SizedBox(height: lineHeight),
                        ],
                      ),
                    ),
                  ),
              ],
            );
          },
        ),
      ),
    );
  }
}
