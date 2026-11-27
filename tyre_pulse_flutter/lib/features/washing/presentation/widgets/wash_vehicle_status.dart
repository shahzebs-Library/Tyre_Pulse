/// The wash facts shown under the picked vehicle: when it was last washed,
/// with which wash type, how many days ago, and whether it is due again.
///
/// Read from the same wash history the history page shows (see
/// `wash_insights.dart`). While that history loads, or when it could not be
/// read, the strip says so instead of claiming "never washed".
library;

import 'package:flutter/material.dart';
import 'package:tyre_pulse/app/localization/tp_localizations.dart';
import 'package:tyre_pulse/app/theme/tp_colors.dart';
import 'package:tyre_pulse/app/theme/tp_spacing.dart';
import 'package:tyre_pulse/core/design_system/design_system.dart';
import 'package:tyre_pulse/features/washing/domain/wash_insights.dart';
import 'package:tyre_pulse/features/washing/presentation/widgets/wash_ui.dart';

class WashVehicleStatus extends StatelessWidget {
  const WashVehicleStatus({
    required this.loading,
    required this.failed,
    required this.info,
    super.key,
  });

  final bool loading;
  final bool failed;
  final AssetWashInfo? info;

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final TpPalette palette = TpPalette.of(context);
    final TextTheme text = Theme.of(context).textTheme;

    Widget body;
    if (loading) {
      body = Row(
        children: <Widget>[
          const SizedBox(
            width: 16,
            height: 16,
            child: CircularProgressIndicator(strokeWidth: 2),
          ),
          const SizedBox(width: TpSpace.sm),
          Expanded(
            child: Text(
              l10n.washHistoryChecking,
              style: text.bodySmall?.copyWith(color: palette.textSecondary),
            ),
          ),
        ],
      );
    } else if (failed) {
      body = Row(
        children: <Widget>[
          Icon(Icons.cloud_off_rounded, size: 18, color: palette.textMuted),
          const SizedBox(width: TpSpace.sm),
          Expanded(
            child: Text(
              l10n.washHistoryUnavailable,
              style: text.bodySmall?.copyWith(color: palette.textSecondary),
            ),
          ),
        ],
      );
    } else if (info == null) {
      body = Wrap(
        spacing: TpSpace.sm,
        runSpacing: TpSpace.xs,
        crossAxisAlignment: WrapCrossAlignment.center,
        children: <Widget>[
          Text(
            l10n.washNoHistoryForAsset,
            style: text.bodyMedium?.copyWith(
              color: palette.text,
              fontWeight: FontWeight.w700,
            ),
          ),
          WashBadge(
            label: l10n.washDueBadge,
            icon: Icons.water_drop_rounded,
            colors: palette.info,
          ),
        ],
      );
    } else {
      final AssetWashInfo i = info!;
      final String? type = i.lastWash.washType;
      body = Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisSize: MainAxisSize.min,
        children: <Widget>[
          Text(
            l10n.washLastWash(i.lastWash.washDate!.substring(0, 10)),
            style: text.bodyMedium?.copyWith(
              color: palette.text,
              fontWeight: FontWeight.w700,
            ),
          ),
          const SizedBox(height: TpSpace.xs),
          Wrap(
            spacing: TpSpace.sm,
            runSpacing: TpSpace.xs,
            crossAxisAlignment: WrapCrossAlignment.center,
            children: <Widget>[
              Text(
                l10n.washDaysSince(i.daysSince),
                style: text.bodySmall?.copyWith(color: palette.textSecondary),
              ),
              if (type != null) WashTypeChip(type: type),
              if (i.daysOverdue > 0)
                WashBadge(
                  label: l10n.washOverdueBadge(i.daysOverdue),
                  icon: Icons.warning_amber_rounded,
                  colors: palette.warning,
                )
              else if (i.isDue)
                WashBadge(
                  label: l10n.washDueBadge,
                  icon: Icons.water_drop_rounded,
                  colors: palette.info,
                )
              else
                WashBadge(
                  label: l10n.washUpToDateBadge,
                  icon: Icons.check_circle_rounded,
                  colors: palette.ok,
                ),
            ],
          ),
          if (i.lastWash.nextWashDue != null) ...<Widget>[
            const SizedBox(height: TpSpace.xs),
            Text(
              l10n.washNextDue(i.lastWash.nextWashDue!),
              key: const ValueKey<String>('washing.status.nextDue'),
              style: text.bodySmall?.copyWith(
                color: palette.textSecondary,
                fontWeight: FontWeight.w700,
              ),
            ),
          ],
        ],
      );
    }

    return Container(
      padding: const EdgeInsets.all(TpSpace.md),
      decoration: BoxDecoration(
        color: palette.surfaceAlt,
        borderRadius: BorderRadius.circular(TpRadius.md),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          const WashGem(
            icon: Icons.history_rounded,
            tone: TpGemTone.teal,
            size: 36,
          ),
          const SizedBox(width: TpSpace.md),
          Expanded(child: body),
        ],
      ),
    );
  }
}
