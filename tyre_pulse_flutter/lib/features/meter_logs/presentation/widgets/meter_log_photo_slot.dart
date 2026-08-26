/// One gauge-photo slot on the meter-log review step (the odometer slot, or
/// the optional engine-hours slot).
///
/// The preview technique - `Image(image: FileImage(File(localPath)))` over a
/// locally captured photo - mirrors `_PhotoPreview` in
/// `features/inspections/presentation/widgets/tyre_position_editor_sheet
/// .dart`; the Camera/Gallery button pair mirrors that same file's two
/// `TpButton.secondary` calls beside a photo slot. This feature keeps its
/// own copy rather than importing either, for the same top-level-feature
/// -independence reason `meter_log_signature_pad.dart`'s own library comment
/// gives.
library;

import 'dart:io';

import 'package:flutter/material.dart';
import 'package:tyre_pulse/app/theme/tp_colors.dart';
import 'package:tyre_pulse/app/theme/tp_spacing.dart';
import 'package:tyre_pulse/core/design_system/design_system.dart';
import 'package:tyre_pulse/features/meter_logs/data/meter_log_photo_capture.dart';

class MeterLogPhotoSlot extends StatelessWidget {
  const MeterLogPhotoSlot({
    required this.label,
    required this.localPath,
    required this.isCapturing,
    required this.onCapture,
    required this.cameraLabel,
    required this.galleryLabel,
    required this.noneLabel,
    super.key,
  });

  final String label;
  final String? localPath;
  final bool isCapturing;

  /// Re-tapping Camera or Gallery REPLACES [localPath], mirroring the
  /// reference review step exactly (it offers no separate "remove" action
  /// either) - so there is no `onRemove` here.
  final ValueChanged<MeterLogPhotoSource> onCapture;
  final String cameraLabel;
  final String galleryLabel;
  final String noneLabel;

  @override
  Widget build(BuildContext context) {
    final TpPalette palette = TpPalette.of(context);
    final String? path = localPath;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: <Widget>[
        Text(label, style: Theme.of(context).textTheme.labelMedium),
        const SizedBox(height: TpSpace.sm),
        if (path != null)
          ClipRRect(
            borderRadius: BorderRadius.circular(TpRadius.md),
            child: Image(
              image: FileImage(File(path)),
              height: 140,
              width: double.infinity,
              fit: BoxFit.cover,
              errorBuilder: (context, error, stack) => const SizedBox.shrink(),
            ),
          )
        else
          Text(
            noneLabel,
            style: Theme.of(context).textTheme.bodySmall
                ?.copyWith(color: palette.textMuted),
          ),
        const SizedBox(height: TpSpace.sm),
        Row(
          children: <Widget>[
            Expanded(
              child: TpButton.secondary(
                label: cameraLabel,
                icon: Icons.camera_alt_outlined,
                isBusy: isCapturing,
                onPressed: isCapturing
                    ? null
                    : () => onCapture(MeterLogPhotoSource.camera),
              ),
            ),
            const SizedBox(width: TpSpace.md),
            Expanded(
              child: TpButton.secondary(
                label: galleryLabel,
                icon: Icons.photo_library_outlined,
                isBusy: isCapturing,
                onPressed: isCapturing
                    ? null
                    : () => onCapture(MeterLogPhotoSource.gallery),
              ),
            ),
          ],
        ),
      ],
    );
  }
}
