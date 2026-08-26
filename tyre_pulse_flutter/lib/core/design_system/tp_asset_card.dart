/// A vehicle or a piece of plant, as a list row.
///
/// STUB. [TpAssetSummary] is a view model defined here because the fleet domain
/// model does not exist yet. When it does, this widget should take that model
/// and this class should be deleted rather than kept as a parallel shape that
/// has to be mapped to.
///
/// The asset number is drawn through [TpIdentifierText]. `TM514` next to Arabic
/// text is exactly where the bidirectional algorithm visibly reorders a mixed
/// run, and an asset number that reads back wrong sends work to the wrong
/// machine.
library;

import 'package:flutter/material.dart';
import 'package:tyre_pulse/app/localization/tp_direction.dart';
import 'package:tyre_pulse/app/theme/tp_colors.dart';
import 'package:tyre_pulse/app/theme/tp_spacing.dart';
import 'package:tyre_pulse/app/theme/tp_typography.dart';
import 'package:tyre_pulse/core/design_system/tp_card.dart';
import 'package:tyre_pulse/core/design_system/tp_status_chip.dart';

/// What the card needs to draw an asset.
@immutable
class TpAssetSummary {
  const TpAssetSummary({
    required this.assetNo,
    this.description,
    this.siteName,
    this.status = TpStatus.unknown,
    this.statusLabel,
    this.detail,
  });

  /// `vehicle_fleet.asset_no`. A business code, unique per country rather than
  /// globally.
  final String assetNo;

  final String? description;
  final String? siteName;

  /// Defaults to [TpStatus.unknown]: an asset nobody has assessed must not
  /// default to looking healthy.
  final TpStatus status;

  final String? statusLabel;

  /// A short line: last inspection, current meter, already formatted.
  final String? detail;
}

class TpAssetCard extends StatelessWidget {
  const TpAssetCard({required this.asset, this.onTap, super.key});

  final TpAssetSummary asset;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final TpPalette palette = TpPalette.of(context);
    final TextTheme text = Theme.of(context).textTheme;

    return TpCard(
      onTap: onTap,
      margin: const EdgeInsets.only(bottom: TpSpace.sm),
      padding: const EdgeInsets.all(TpSpace.lg),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: <Widget>[
                TpIdentifierText(
                  asset.assetNo,
                  style: TpTypography.identifier(palette).copyWith(
                    fontSize: 16,
                  ),
                ),
                if (asset.description != null) ...<Widget>[
                  const SizedBox(height: 2),
                  Text(
                    asset.description!,
                    style: text.bodyMedium,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                  ),
                ],
                if (asset.siteName != null || asset.detail != null) ...<Widget>[
                  const SizedBox(height: TpSpace.xs),
                  Text(
                    <String>[
                      if (asset.siteName != null) asset.siteName!,
                      if (asset.detail != null) asset.detail!,
                    ].join('  |  '),
                    style: text.labelSmall,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                  ),
                ],
              ],
            ),
          ),
          const SizedBox(width: TpSpace.md),
          TpStatusChip(
            status: asset.status,
            label: asset.statusLabel,
            isCompact: true,
          ),
        ],
      ),
    );
  }
}
