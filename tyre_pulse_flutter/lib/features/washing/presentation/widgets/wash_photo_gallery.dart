/// The wash-record photo gallery: up to [WashPhotoCapture.maxPhotos]
/// thumbnails in a wrap, each removable, plus an "Add photo" tile that
/// disappears once the cap is reached.
///
/// There is no shared design-system multi-photo grid to reuse (spec section
/// 54 governs BASIC controls; a multi-photo gallery bound to this feature's
/// own capture pipeline is a composite, the same category as
/// `TpTyreChipData`/its chip widget in `tp_tyre_chip.dart`, which is
/// similarly a feature-shaped composite built from primitives rather than a
/// shared control). The single-photo preview technique inside each tile
/// mirrors `meter_log_photo_slot.dart`'s own `Image(image: FileImage(...))`
/// pattern.
library;

import 'dart:io';

import 'package:flutter/material.dart';
import 'package:tyre_pulse/app/localization/tp_localizations.dart';
import 'package:tyre_pulse/app/theme/tp_colors.dart';
import 'package:tyre_pulse/app/theme/tp_spacing.dart';
import 'package:tyre_pulse/core/design_system/design_system.dart';
import 'package:tyre_pulse/features/washing/data/wash_photo_capture.dart';

class WashPhotoGallery extends StatelessWidget {
  const WashPhotoGallery({
    required this.localPaths,
    required this.isCapturing,
    required this.onAdd,
    required this.onRemove,
    required this.addLabel,
    this.canAdd = true,
    this.cameraOnly = false,
    this.stamps,
    super.key,
  });

  /// True skips the camera/gallery choice and opens the camera directly.
  /// Wash evidence must be taken on site at the time of the wash, so the
  /// wash screen turns the gallery off.
  final bool cameraOnly;

  /// Optional one-line stamp under each thumbnail (time and place).
  final List<String?>? stamps;

  /// False hides the "Add photo" tile - used when the before and after
  /// galleries together have reached [WashPhotoCapture.maxPhotos].
  final bool canAdd;

  final List<String> localPaths;
  final bool isCapturing;
  final ValueChanged<WashPhotoSource> onAdd;
  final ValueChanged<int> onRemove;
  final String addLabel;

  @override
  Widget build(BuildContext context) {
    final bool canAddMore =
        canAdd && localPaths.length < WashPhotoCapture.maxPhotos;

    return Wrap(
      spacing: TpSpace.sm,
      runSpacing: TpSpace.sm,
      children: <Widget>[
        for (int i = 0; i < localPaths.length; i++)
          _WashPhotoTile(
            localPath: localPaths[i],
            stamp: stamps != null && i < stamps!.length ? stamps![i] : null,
            onRemove: () => onRemove(i),
          ),
        if (canAddMore)
          _AddPhotoTile(
            label: addLabel,
            isBusy: isCapturing,
            onTap: cameraOnly
                ? () => onAdd(WashPhotoSource.camera)
                : () => _showSourcePicker(context),
          ),
      ],
    );
  }

  Future<void> _showSourcePicker(BuildContext context) async {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final WashPhotoSource? source = await showModalBottomSheet<WashPhotoSource>(
      context: context,
      builder: (BuildContext sheetContext) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: <Widget>[
            ListTile(
              leading: const Icon(Icons.camera_alt_outlined),
              title: Text(l10n.washPhotoCamera),
              onTap: () =>
                  Navigator.of(sheetContext).pop(WashPhotoSource.camera),
            ),
            ListTile(
              leading: const Icon(Icons.photo_library_outlined),
              title: Text(l10n.washPhotoGallery),
              onTap: () =>
                  Navigator.of(sheetContext).pop(WashPhotoSource.gallery),
            ),
          ],
        ),
      ),
    );
    if (source != null) {
      onAdd(source);
    }
  }
}

class _WashPhotoTile extends StatelessWidget {
  const _WashPhotoTile({
    required this.localPath,
    required this.onRemove,
    this.stamp,
  });

  final String localPath;
  final String? stamp;
  final VoidCallback onRemove;

  static const double _size = 72;

  @override
  Widget build(BuildContext context) {
    final Widget thumb = SizedBox(
      width: _size,
      height: _size,
      child: Stack(
        children: <Widget>[
          ClipRRect(
            borderRadius: BorderRadius.circular(TpRadius.md),
            child: Image(
              image: FileImage(File(localPath)),
              width: _size,
              height: _size,
              fit: BoxFit.cover,
              errorBuilder: (context, error, stack) => const SizedBox.shrink(),
            ),
          ),
          PositionedDirectional(
            top: 0,
            end: 0,
            child: GestureDetector(
              behavior: HitTestBehavior.opaque,
              onTap: onRemove,
              child: const Padding(
                padding: EdgeInsets.all(4),
                child: DecoratedBox(
                  decoration: BoxDecoration(
                    color: Colors.black54,
                    shape: BoxShape.circle,
                  ),
                  child: Padding(
                    padding: EdgeInsets.all(2),
                    child: Icon(
                      Icons.close,
                      size: TpSizing.iconSm,
                      color: Colors.white,
                    ),
                  ),
                ),
              ),
            ),
          ),
        ],
      ),
    );
    if (stamp == null) return thumb;
    return SizedBox(
      width: _size + 56,
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: <Widget>[
          thumb,
          const SizedBox(height: 2),
          Text(
            stamp!,
            textAlign: TextAlign.center,
            style: Theme.of(context).textTheme.labelSmall?.copyWith(
                  color: TpPalette.of(context).textSecondary,
                ),
          ),
        ],
      ),
    );
  }
}

class _AddPhotoTile extends StatelessWidget {
  const _AddPhotoTile({
    required this.label,
    required this.isBusy,
    required this.onTap,
  });

  final String label;
  final bool isBusy;
  final VoidCallback onTap;

  static const double _size = 72;

  @override
  Widget build(BuildContext context) {
    final TpPalette palette = TpPalette.of(context);
    return SizedBox(
      width: _size,
      // The label grows with the text size (two lines at most).
      height: tpTextScaledExtent(context, base: _size, textHeight: 32),
      child: DecoratedBox(
        decoration: BoxDecoration(
          color: palette.surfaceAlt,
          borderRadius: BorderRadius.circular(TpRadius.md),
          border: Border.all(color: palette.borderStrong),
        ),
        child: InkWell(
          borderRadius: BorderRadius.circular(TpRadius.md),
          onTap: isBusy ? null : onTap,
          child: Center(
            child: isBusy
                ? const SizedBox(
                    width: 20,
                    height: 20,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  )
                : Column(
                    mainAxisSize: MainAxisSize.min,
                    children: <Widget>[
                      Icon(
                        Icons.add_a_photo_outlined,
                        color: palette.textSecondary,
                      ),
                      const SizedBox(height: 2),
                      Text(
                        label,
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                        textAlign: TextAlign.center,
                        style: Theme.of(context).textTheme.labelSmall,
                      ),
                    ],
                  ),
          ),
        ),
      ),
    );
  }
}
