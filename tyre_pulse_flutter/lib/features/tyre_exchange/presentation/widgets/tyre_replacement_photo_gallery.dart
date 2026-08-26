/// The tyre-replacement photo gallery: up to
/// [TyreReplacementPhotoCapture.maxPhotos] thumbnails in a wrap, each
/// removable, plus an "Add photo" tile that disappears once the cap is
/// reached.
///
/// A close mirror of `features/washing/presentation/widgets/
/// wash_photo_gallery.dart` - see that file's own library comment for why
/// this is a feature-owned composite rather than a shared design-system
/// control (spec section 54 governs BASIC controls only). The single-photo
/// preview technique mirrors `meter_log_photo_slot.dart`'s own `Image(image:
/// FileImage(...))` pattern.
library;

import 'dart:io';

import 'package:flutter/material.dart';
import 'package:tyre_pulse/app/localization/tp_localizations.dart';
import 'package:tyre_pulse/app/theme/tp_colors.dart';
import 'package:tyre_pulse/app/theme/tp_spacing.dart';
import 'package:tyre_pulse/features/tyre_exchange/data/tyre_replacement_photo_capture.dart';

class TyreReplacementPhotoGallery extends StatelessWidget {
  const TyreReplacementPhotoGallery({
    required this.localPaths,
    required this.isCapturing,
    required this.onAdd,
    required this.onRemove,
    required this.addLabel,
    super.key,
  });

  final List<String> localPaths;
  final bool isCapturing;
  final ValueChanged<TyreReplacementPhotoSource> onAdd;
  final ValueChanged<int> onRemove;
  final String addLabel;

  @override
  Widget build(BuildContext context) {
    final bool canAddMore =
        localPaths.length < TyreReplacementPhotoCapture.maxPhotos;

    return Wrap(
      spacing: TpSpace.sm,
      runSpacing: TpSpace.sm,
      children: <Widget>[
        for (int i = 0; i < localPaths.length; i++)
          _TyrePhotoTile(localPath: localPaths[i], onRemove: () => onRemove(i)),
        if (canAddMore)
          _AddPhotoTile(
            label: addLabel,
            isBusy: isCapturing,
            onTap: () => _showSourcePicker(context),
          ),
      ],
    );
  }

  Future<void> _showSourcePicker(BuildContext context) async {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final TyreReplacementPhotoSource? source =
        await showModalBottomSheet<TyreReplacementPhotoSource>(
      context: context,
      builder: (BuildContext sheetContext) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: <Widget>[
            ListTile(
              leading: const Icon(Icons.camera_alt_outlined),
              title: Text(l10n.tyreReplacePhotoCamera),
              onTap: () => Navigator.of(sheetContext)
                  .pop(TyreReplacementPhotoSource.camera),
            ),
            ListTile(
              leading: const Icon(Icons.photo_library_outlined),
              title: Text(l10n.tyreReplacePhotoGallery),
              onTap: () => Navigator.of(sheetContext)
                  .pop(TyreReplacementPhotoSource.gallery),
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

class _TyrePhotoTile extends StatelessWidget {
  const _TyrePhotoTile({required this.localPath, required this.onRemove});

  final String localPath;
  final VoidCallback onRemove;

  static const double _size = 96;

  @override
  Widget build(BuildContext context) {
    return SizedBox(
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
          Positioned(
            top: 2,
            right: 2,
            child: GestureDetector(
              onTap: onRemove,
              child: const DecoratedBox(
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

  static const double _size = 96;

  @override
  Widget build(BuildContext context) {
    final TpPalette palette = TpPalette.of(context);
    return SizedBox(
      width: _size,
      height: _size,
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
