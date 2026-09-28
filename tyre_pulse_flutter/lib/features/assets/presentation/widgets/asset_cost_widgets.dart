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
class AssetMonthlyBars extends StatelessWidget {
  const AssetMonthlyBars({required this.monthly, super.key});

  final List<AssetMonthlyCost> monthly;

  @override
  Widget build(BuildContext context) {
    final TpPalette palette = TpPalette.of(context);
    final TextTheme text = Theme.of(context).textTheme;
    final String locale = Localizations.localeOf(context).toString();
    final List<AssetMonthlyCost> shown =
        monthly.length > 12 ? monthly.sublist(monthly.length - 12) : monthly;
    final double max = shown.fold<double>(
      0,
      (double m, AssetMonthlyCost c) => c.total > m ? c.total : m,
    );
    return SizedBox(
      height: 170,
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.end,
        children: <Widget>[
          for (final AssetMonthlyCost c in shown)
            Expanded(
              child: Padding(
                padding: const EdgeInsets.symmetric(horizontal: 3),
                child: Column(
                  mainAxisAlignment: MainAxisAlignment.end,
                  children: <Widget>[
                    if (c.total > 0)
                      FittedBox(
                        child: Text(
                          formatAssetCompact(c.total),
                          style: text.labelSmall?.copyWith(fontSize: 10),
                        ),
                      ),
                    const SizedBox(height: 2),
                    Container(
                      height:
                          max <= 0 ? 2 : (c.total / max * 110).clamp(2, 110),
                      decoration: BoxDecoration(
                        color: c.total > 0 ? palette.primary : palette.border,
                        borderRadius: const BorderRadius.vertical(
                          top: Radius.circular(3),
                        ),
                      ),
                    ),
                    const SizedBox(height: TpSpace.xs),
                    FittedBox(
                      child: Text(
                        DateFormat.MMM(locale).format(c.month),
                        style: text.labelSmall?.copyWith(
                          color: palette.textSecondary,
                        ),
                      ),
                    ),
                  ],
                ),
              ),
            ),
        ],
      ),
    );
  }
}
