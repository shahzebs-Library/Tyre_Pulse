/// The selected vehicle's own picture with its five sides (front, left,
/// rear, right, top) as tappable views. Tapping a side marks it washed and
/// brings it up large; the washer sees exactly which vehicle they are
/// recording.
///
/// Pictures come from the shared resolver
/// (`features/assets/presentation/vehicle_photo_resolver.dart`), the same
/// one asset detail, inspections and accident damage use, so the wash screen
/// never shows a different body from the rest of the app. When the vehicle
/// class has five-view artwork, each side shows its exact pre-sliced image
/// from `assets/vehicle_multiview_views/`. When it only has a single photo,
/// that photo is shown and the sides are plain chips. When the class is
/// unknown, a neutral vehicle icon is shown and says so, rather than
/// borrowing the wrong vehicle.
library;

import 'package:flutter/material.dart';
import 'package:tyre_pulse/app/localization/tp_localizations.dart';
import 'package:tyre_pulse/app/theme/tp_colors.dart';
import 'package:tyre_pulse/app/theme/tp_spacing.dart';
import 'package:tyre_pulse/features/assets/domain/vehicle_asset.dart';
import 'package:tyre_pulse/features/assets/presentation/vehicle_photo_resolver.dart';
import 'package:tyre_pulse/features/washing/domain/wash_areas.dart';

/// Which kind of picture the widget is showing, exposed for tests.
///
/// [sample] is the owner-supplied wash illustration for the vehicle class
/// (`assets/wash_vehicles/`, chosen by `vehicleWashSampleAssetFor` in the
/// shared resolver). Classes with no sample keep their plain real fleet
/// picture ([multiView] or [photo]); a drawn spray overlay was tried and
/// dropped because it did not look clean over dark machinery.
enum WashPictureKind { sample, multiView, photo, fallback }

/// A type-specific special-wash picture from the owner's samples, used only
/// when the picked areas match it (a van's cabin, a loader's undercarriage,
/// a forklift's engine bay or steam). It changes
/// only the picture, never the stored wash type.
String washSampleForAreas(String sample, Set<WashArea> areas) {
  bool has(WashArea a) => areas.contains(a);
  switch (sample) {
    case 'assets/wash_vehicles/hiace_van.png':
      if (has(WashArea.cabin)) {
        return 'assets/wash_vehicles/van_interior_wash.png';
      }
    case 'assets/wash_vehicles/wheel_loader.png':
      if (has(WashArea.undercarriage)) {
        return 'assets/wash_vehicles/loader_mud_flush.png';
      }
    case 'assets/wash_vehicles/forklift.png':
      if (has(WashArea.engineBay) || has(WashArea.steam)) {
        return 'assets/wash_vehicles/forklift_degrease.png';
      }
  }
  return sample;
}

/// Resolves the picture source for a vehicle. [master] wins over the plain
/// [vehicleType] when both exist (it carries make and model).
({WashPictureKind kind, String? boardPath, String? photoPath})
    resolveWashPicture({
  VehicleAsset? master,
  String? assetNo,
  String? vehicleType,
}) {
  final String? board = master != null
      ? vehicleMultiViewAsset(master)
      : vehicleMultiViewAssetFor(assetNo: assetNo, vehicleType: vehicleType);
  final String? sample = vehicleWashSampleAssetFor(
    assetNo: master?.assetNo ?? assetNo,
    vehicleType: master?.vehicleType ?? vehicleType,
    make: master?.make,
    model: master?.model,
  );
  if (sample != null) {
    // The board (if any) still feeds the side thumbnails.
    return (kind: WashPictureKind.sample, boardPath: board, photoPath: sample);
  }
  if (board != null) {
    return (kind: WashPictureKind.multiView, boardPath: board, photoPath: null);
  }
  final String? photo = master != null
      ? vehiclePhotoAsset(master)
      : vehiclePhotoAssetFor(assetNo: assetNo, vehicleType: vehicleType);
  if (photo != null) {
    return (kind: WashPictureKind.photo, boardPath: null, photoPath: photo);
  }
  return (kind: WashPictureKind.fallback, boardPath: null, photoPath: null);
}

/// The exact per-side image for a five-view board, e.g.
/// `assets/vehicle_multiview_views/transit_mixer_3axle_five_view_v1_left.png`.
String washViewImagePath(String boardPath, WashView view) {
  final String stem = boardPath
      .replaceFirst('assets/vehicle_multiview/', '')
      .replaceFirst(RegExp(r'\.png$'), '');
  return 'assets/vehicle_multiview_views/${stem}_${view.name}.png';
}

String washViewName(AppLocalizations l10n, WashView view) => switch (view) {
      WashView.front => l10n.washViewFront,
      WashView.left => l10n.washViewLeft,
      WashView.rear => l10n.washViewRear,
      WashView.right => l10n.washViewRight,
      WashView.top => l10n.washViewTop,
    };

class WashVehicleViews extends StatefulWidget {
  const WashVehicleViews({
    required this.master,
    required this.assetNo,
    required this.vehicleType,
    required this.selected,
    required this.onToggle,
    required this.onSetAll,
    this.areas = const <WashArea>{},
    super.key,
  });

  /// The picked areas; they can swap in a special-wash picture.
  final Set<WashArea> areas;

  final VehicleAsset? master;
  final String? assetNo;
  final String? vehicleType;
  final Set<WashView> selected;
  final ValueChanged<WashView> onToggle;

  /// `true` marks every side, `false` clears them.
  final ValueChanged<bool> onSetAll;

  static ValueKey<String> viewKey(WashView view) =>
      ValueKey<String>('washing.view.${view.name}');
  static const ValueKey<String> allSides = ValueKey<String>('washing.view.all');
  static ValueKey<String> pictureKey(WashPictureKind kind) =>
      ValueKey<String>('washing.vehiclePicture.${kind.name}');

  @override
  State<WashVehicleViews> createState() => _WashVehicleViewsState();
}

class _WashVehicleViewsState extends State<WashVehicleViews> {
  WashView _focus = WashView.left;

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final TpPalette palette = TpPalette.of(context);
    final TextTheme text = Theme.of(context).textTheme;
    final hasVehicle = (widget.assetNo ?? '').trim().isNotEmpty;
    final picture = resolveWashPicture(
      master: widget.master,
      assetNo: widget.assetNo,
      vehicleType: widget.vehicleType,
    );
    final bool allMarked = widget.selected.length == WashView.values.length;
    final IconData fallbackIcon = widget.master != null
        ? vehicleFallbackIcon(widget.master!)
        : vehicleFallbackIconFor(
            assetNo: widget.assetNo,
            vehicleType: widget.vehicleType,
          );

    Widget fallback(String message) => Column(
          mainAxisSize: MainAxisSize.min,
          children: <Widget>[
            Icon(fallbackIcon, size: 64, color: palette.textMuted),
            const SizedBox(height: TpSpace.sm),
            Text(
              message,
              textAlign: TextAlign.center,
              style: text.bodySmall?.copyWith(color: palette.textSecondary),
            ),
          ],
        );

    final Widget big = switch (picture.kind) {
      WashPictureKind.sample => Image.asset(
          washSampleForAreas(picture.photoPath!, widget.areas),
          key: const ValueKey<String>('washing.vehiclePicture.image'),
          fit: BoxFit.contain,
          filterQuality: FilterQuality.medium,
          errorBuilder: (_, __, ___) => fallback(l10n.washVehiclePictureNone),
        ),
      WashPictureKind.multiView => Image.asset(
          washViewImagePath(picture.boardPath!, _focus),
          fit: BoxFit.contain,
          filterQuality: FilterQuality.medium,
          errorBuilder: (_, __, ___) => fallback(l10n.washVehiclePictureNone),
        ),
      WashPictureKind.photo => Image.asset(
          picture.photoPath!,
          fit: BoxFit.contain,
          filterQuality: FilterQuality.medium,
          errorBuilder: (_, __, ___) => fallback(l10n.washVehiclePictureNone),
        ),
      WashPictureKind.fallback => fallback(
          hasVehicle
              ? l10n.washVehiclePictureNone
              : l10n.washVehiclePicturePending,
        ),
    };
    final bool focusMarked = picture.kind == WashPictureKind.multiView &&
        widget.selected.contains(_focus);

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      mainAxisSize: MainAxisSize.min,
      children: <Widget>[
        Container(
          key: WashVehicleViews.pictureKey(picture.kind),
          // The vehicle picture is the main picture of the screen, so it
          // gets a moderate fixed height; everything else is compact.
          height: picture.kind == WashPictureKind.fallback ? null : 176,
          constraints: const BoxConstraints(minHeight: 140),
          alignment: Alignment.center,
          decoration: BoxDecoration(
            // The fleet pictures are shot on white; a white card makes the
            // photo fill the frame instead of floating as a white square.
            color: picture.kind == WashPictureKind.fallback
                ? palette.surfaceAlt
                : Colors.white,
            borderRadius: BorderRadius.circular(TpRadius.lg),
            border: Border.all(
              color: focusMarked ? palette.primary : palette.border,
              width: focusMarked ? 2 : 1,
            ),
          ),
          padding: const EdgeInsets.all(TpSpace.sm),
          child: picture.kind == WashPictureKind.fallback
              ? Padding(
                  padding: const EdgeInsets.symmetric(vertical: TpSpace.md),
                  child: big,
                )
              : Stack(
                  children: <Widget>[
                    Positioned.fill(child: Center(child: big)),
                    if (picture.kind == WashPictureKind.multiView)
                      PositionedDirectional(
                        bottom: 0,
                        start: 0,
                        child: _Pill(
                          label: washViewName(l10n, _focus),
                          icon: focusMarked
                              ? Icons.water_drop_rounded
                              : Icons.visibility_outlined,
                          highlighted: focusMarked,
                        ),
                      ),
                  ],
                ),
        ),
        const SizedBox(height: TpSpace.sm),
        Wrap(
          spacing: TpSpace.sm,
          runSpacing: TpSpace.xs,
          alignment: WrapAlignment.spaceBetween,
          crossAxisAlignment: WrapCrossAlignment.center,
          children: <Widget>[
            Text(
              widget.selected.isEmpty
                  ? l10n.washViewsTitle
                  : l10n.washViewsCount(
                      widget.selected.length,
                      WashView.values.length,
                    ),
              style: text.labelLarge?.copyWith(fontWeight: FontWeight.w700),
            ),
            FilterChip(
              key: WashVehicleViews.allSides,
              label: Text(l10n.washViewsAll),
              selected: allMarked,
              onSelected: (bool v) => widget.onSetAll(v),
            ),
          ],
        ),
        const SizedBox(height: TpSpace.xs),
        Wrap(
          spacing: TpSpace.sm,
          runSpacing: TpSpace.sm,
          children: <Widget>[
            for (final WashView view in WashView.values)
              _ViewChip(
                key: WashVehicleViews.viewKey(view),
                label: washViewName(l10n, view),
                imagePath: picture.boardPath != null
                    ? washViewImagePath(picture.boardPath!, view)
                    : null,
                selected: widget.selected.contains(view),
                focused:
                    picture.kind == WashPictureKind.multiView && view == _focus,
                onTap: () {
                  setState(() => _focus = view);
                  widget.onToggle(view);
                },
              ),
          ],
        ),
      ],
    );
  }
}

class _Pill extends StatelessWidget {
  const _Pill({
    required this.label,
    required this.icon,
    required this.highlighted,
  });

  final String label;
  final IconData icon;
  final bool highlighted;

  @override
  Widget build(BuildContext context) {
    final TpPalette palette = TpPalette.of(context);
    final Color fg = highlighted ? palette.onPrimary : palette.text;
    return Container(
      padding: const EdgeInsets.symmetric(
        horizontal: TpSpace.sm,
        vertical: TpSpace.xs,
      ),
      decoration: BoxDecoration(
        color: highlighted ? palette.primary : palette.surface,
        borderRadius: BorderRadius.circular(TpRadius.pill),
        border: Border.all(color: palette.border),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: <Widget>[
          Icon(icon, size: 14, color: fg),
          const SizedBox(width: TpSpace.xs),
          Flexible(
            child: Text(
              label,
              style: Theme.of(context).textTheme.labelSmall?.copyWith(
                    color: fg,
                    fontWeight: FontWeight.w700,
                  ),
            ),
          ),
        ],
      ),
    );
  }
}

class _ViewChip extends StatelessWidget {
  const _ViewChip({
    required this.label,
    required this.imagePath,
    required this.selected,
    required this.focused,
    required this.onTap,
    super.key,
  });

  final String label;
  final String? imagePath;
  final bool selected;
  final bool focused;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final TpPalette palette = TpPalette.of(context);
    final TextTheme text = Theme.of(context).textTheme;
    final BorderRadius corners = BorderRadius.circular(TpRadius.md);
    return Semantics(
      button: true,
      selected: selected,
      label: label,
      excludeSemantics: true,
      child: Material(
        color: selected ? palette.primarySoft : palette.surface,
        shape: RoundedRectangleBorder(
          borderRadius: corners,
          side: BorderSide(
            color: selected
                ? palette.primary
                : (focused ? palette.borderStrong : palette.border),
            width: selected || focused ? 2 : 1,
          ),
        ),
        clipBehavior: Clip.antiAlias,
        child: InkWell(
          onTap: onTap,
          child: ConstrainedBox(
            constraints: const BoxConstraints(minWidth: 64, minHeight: 48),
            child: Padding(
              padding: const EdgeInsets.all(TpSpace.xs),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: <Widget>[
                  if (imagePath != null)
                    SizedBox(
                      width: 52,
                      height: 40,
                      child: Image.asset(
                        imagePath!,
                        fit: BoxFit.contain,
                        filterQuality: FilterQuality.low,
                        cacheWidth: 160,
                        errorBuilder: (_, __, ___) => const SizedBox.shrink(),
                      ),
                    ),
                  Row(
                    mainAxisSize: MainAxisSize.min,
                    children: <Widget>[
                      Icon(
                        selected
                            ? Icons.check_circle_rounded
                            : Icons.radio_button_unchecked_rounded,
                        size: 16,
                        color: selected ? palette.primary : palette.textMuted,
                      ),
                      const SizedBox(width: TpSpace.xs),
                      Flexible(
                        child: Text(
                          label,
                          style: text.labelMedium?.copyWith(
                            color: selected ? palette.primary : palette.text,
                            fontWeight: FontWeight.w700,
                          ),
                        ),
                      ),
                    ],
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}
