/// Compact master-data vehicle summary used by field capture screens.
library;

import 'package:flutter/material.dart';
import 'package:tyre_pulse/app/localization/tp_direction.dart';
import 'package:tyre_pulse/app/theme/tp_colors.dart';
import 'package:tyre_pulse/app/theme/tp_spacing.dart';
import 'package:tyre_pulse/core/design_system/design_system.dart';
import 'package:tyre_pulse/features/assets/domain/vehicle_asset.dart';
import 'package:tyre_pulse/features/assets/presentation/vehicle_photo_resolver.dart';

class SelectedVehicleCard extends StatelessWidget {
  const SelectedVehicleCard({
    required this.asset,
    required this.changeLabel,
    required this.unavailableLabel,
    required this.onChange,
    this.meterValue,
    super.key,
  });

  final VehicleAsset asset;
  final String changeLabel;
  final String unavailableLabel;
  final VoidCallback onChange;
  final String? meterValue;

  @override
  Widget build(BuildContext context) {
    final TpPalette palette = TpPalette.of(context);
    final String identity = asset.displayIdentity ?? unavailableLabel;
    final String description = <String?>[
      asset.make,
      asset.model,
      asset.vehicleType,
    ]
        .whereType<String>()
        .map((String value) => value.trim())
        .where((String value) => value.isNotEmpty)
        .join(' · ');
    final String? photo = vehiclePhotoAsset(asset);
    final TpStatus status = vehicleStatusTone(asset.status);

    return TpCard(
      padding: const EdgeInsets.all(TpSpace.md),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.center,
        children: <Widget>[
          Container(
            width: 94,
            height: 82,
            clipBehavior: Clip.antiAlias,
            alignment: Alignment.center,
            decoration: BoxDecoration(
              color: palette.surfaceAlt,
              borderRadius: BorderRadius.circular(TpRadius.md),
              border: Border.all(color: palette.border),
            ),
            child: photo == null
                ? Icon(
                    vehicleFallbackIcon(asset),
                    size: 38,
                    color: palette.primary,
                  )
                : Image.asset(
                    photo,
                    width: double.infinity,
                    height: double.infinity,
                    fit: BoxFit.cover,
                    filterQuality: FilterQuality.high,
                    semanticLabel: identity,
                  ),
          ),
          const SizedBox(width: TpSpace.md),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                TpIdentifierText(
                  identity,
                  style: Theme.of(context).textTheme.titleMedium?.copyWith(
                        color: palette.text,
                        fontWeight: FontWeight.w800,
                      ),
                ),
                if (description.isNotEmpty) ...<Widget>[
                  const SizedBox(height: 2),
                  Text(
                    description,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: Theme.of(context).textTheme.bodySmall?.copyWith(
                          color: palette.textSecondary,
                        ),
                  ),
                ],
                if (asset.site?.trim().isNotEmpty == true ||
                    meterValue?.trim().isNotEmpty == true) ...<Widget>[
                  const SizedBox(height: TpSpace.sm),
                  Row(
                    children: <Widget>[
                      Icon(
                        Icons.location_on_outlined,
                        size: TpSizing.iconSm,
                        color: palette.textMuted,
                      ),
                      const SizedBox(width: TpSpace.xs),
                      if (asset.site?.trim().isNotEmpty == true)
                        Flexible(
                          child: Text(
                            asset.site!.trim(),
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: Theme.of(context)
                                .textTheme
                                .labelSmall
                                ?.copyWith(
                                  color: palette.textSecondary,
                                  fontWeight: FontWeight.w600,
                                ),
                          ),
                        ),
                      if (asset.site?.trim().isNotEmpty == true &&
                          meterValue?.trim().isNotEmpty == true)
                        Text(
                          '  ·  ',
                          style: Theme.of(context)
                              .textTheme
                              .labelSmall
                              ?.copyWith(color: palette.textMuted),
                        ),
                      if (meterValue?.trim().isNotEmpty == true)
                        Flexible(
                          child: Text(
                            meterValue!.trim(),
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: Theme.of(context)
                                .textTheme
                                .labelSmall
                                ?.copyWith(
                                  color: palette.textSecondary,
                                  fontWeight: FontWeight.w600,
                                ),
                          ),
                        ),
                    ],
                  ),
                ],
                if (asset.status?.trim().isNotEmpty == true) ...<Widget>[
                  const SizedBox(height: TpSpace.sm),
                  TpStatusChip(
                    status: status,
                    label: asset.status!.trim(),
                    isCompact: true,
                  ),
                ],
              ],
            ),
          ),
          const SizedBox(width: TpSpace.xs),
          IconButton(
            tooltip: changeLabel,
            onPressed: onChange,
            icon: const Icon(Icons.qr_code_scanner_rounded),
            color: palette.primary,
          ),
        ],
      ),
    );
  }
}
