/// Zoomable five-view board for one real fleet asset.
library;

import 'package:flutter/material.dart';
import 'package:tyre_pulse/app/theme/tp_colors.dart';
import 'package:tyre_pulse/app/theme/tp_spacing.dart';
import 'package:tyre_pulse/core/design_system/design_system.dart';
import 'package:tyre_pulse/features/assets/domain/vehicle_asset.dart';
import 'package:tyre_pulse/features/assets/presentation/vehicle_photo_resolver.dart';

@visibleForTesting
abstract final class VehicleMultiViewBoardKeys {
  static const Key board = Key('vehicle_multiview.board');
  static const Key image = Key('vehicle_multiview.image');
  static const Key zoomDialog = Key('vehicle_multiview.zoom_dialog');
  static const Key zoomImage = Key('vehicle_multiview.zoom_image');
}

class VehicleMultiViewBoard extends StatelessWidget {
  const VehicleMultiViewBoard({
    required VehicleAsset asset,
    required this.title,
    required this.hint,
    required this.zoomLabel,
    required this.closeLabel,
    super.key,
  })  : _asset = asset,
        assetNo = null,
        vehicleType = null,
        make = null,
        model = null;

  /// Creates the same zoomable reference board from classification fields on
  /// a submitted inspection/approval row, without pretending that row is a
  /// complete [VehicleAsset] or inventing a fleet-row id.
  const VehicleMultiViewBoard.reference({
    required this.assetNo,
    required this.vehicleType,
    required this.title,
    required this.hint,
    required this.zoomLabel,
    required this.closeLabel,
    this.make,
    this.model,
    super.key,
  }) : _asset = null;

  final VehicleAsset? _asset;
  final String? assetNo;
  final String? vehicleType;
  final String? make;
  final String? model;
  final String title;
  final String hint;
  final String zoomLabel;
  final String closeLabel;

  @override
  Widget build(BuildContext context) {
    final VehicleAsset? asset = _asset;
    final String? artwork = asset == null
        ? vehicleMultiViewAssetFor(
            assetNo: assetNo,
            vehicleType: vehicleType,
            make: make,
            model: model,
          )
        : vehicleMultiViewAsset(asset);
    if (artwork == null) return const SizedBox.shrink();

    final TpPalette palette = TpPalette.of(context);
    final TextTheme text = Theme.of(context).textTheme;
    return Semantics(
      button: true,
      label: '$title. $hint. $zoomLabel',
      child: TpCard(
        key: VehicleMultiViewBoardKeys.board,
        padding: EdgeInsets.zero,
        child: InkWell(
          onTap: () => _showZoomedBoard(context, artwork),
          borderRadius: BorderRadius.circular(TpRadius.lg),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: <Widget>[
              Padding(
                padding: const EdgeInsets.fromLTRB(
                  TpSpace.md,
                  TpSpace.md,
                  TpSpace.sm,
                  TpSpace.sm,
                ),
                child: Row(
                  children: <Widget>[
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: <Widget>[
                          Text(
                            title,
                            style: text.titleMedium?.copyWith(
                              color: palette.text,
                              fontWeight: FontWeight.w800,
                            ),
                          ),
                          const SizedBox(height: 2),
                          Text(
                            hint,
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: text.labelSmall?.copyWith(
                              color: palette.textSecondary,
                            ),
                          ),
                        ],
                      ),
                    ),
                    const SizedBox(width: TpSpace.sm),
                    Tooltip(
                      message: zoomLabel,
                      child: Icon(
                        Icons.zoom_out_map_rounded,
                        color: palette.primary,
                      ),
                    ),
                  ],
                ),
              ),
              Divider(height: 1, color: palette.border),
              AspectRatio(
                aspectRatio: 1,
                child: ColoredBox(
                  color: Colors.white,
                  child: Image.asset(
                    artwork,
                    key: VehicleMultiViewBoardKeys.image,
                    fit: BoxFit.contain,
                    filterQuality: FilterQuality.high,
                    semanticLabel: '$title. $hint',
                    errorBuilder: (_, __, ___) => Center(
                      child: Icon(
                        asset == null
                            ? vehicleFallbackIconFor(
                                assetNo: assetNo,
                                vehicleType: vehicleType,
                                make: make,
                                model: model,
                              )
                            : vehicleFallbackIcon(asset),
                        size: 72,
                        color: palette.textMuted,
                      ),
                    ),
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Future<void> _showZoomedBoard(BuildContext context, String artwork) {
    return showDialog<void>(
      context: context,
      useSafeArea: true,
      builder: (BuildContext dialogContext) => Dialog.fullscreen(
        key: VehicleMultiViewBoardKeys.zoomDialog,
        child: Scaffold(
          appBar: AppBar(
            title: Text(title),
            automaticallyImplyLeading: false,
            actions: <Widget>[
              IconButton(
                tooltip: closeLabel,
                onPressed: () => Navigator.of(dialogContext).pop(),
                icon: const Icon(Icons.close_rounded),
              ),
            ],
          ),
          body: ColoredBox(
            color: Colors.white,
            child: InteractiveViewer(
              minScale: 0.8,
              maxScale: 5,
              boundaryMargin: const EdgeInsets.all(80),
              child: Center(
                child: Image.asset(
                  artwork,
                  key: VehicleMultiViewBoardKeys.zoomImage,
                  fit: BoxFit.contain,
                  filterQuality: FilterQuality.high,
                  semanticLabel: '$title. $hint',
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}
