/// Wash-area tiles: one drawn illustration per part of the vehicle, name and
/// a one-line description. Several can be picked; a picked tile is framed in
/// the brand colour and carries a check.
library;

import 'package:flutter/material.dart';
import 'package:tyre_pulse/app/localization/tp_localizations.dart';
import 'package:tyre_pulse/app/theme/tp_colors.dart';
import 'package:tyre_pulse/app/theme/tp_spacing.dart';
import 'package:tyre_pulse/features/washing/domain/wash_areas.dart';

class WashAreaGrid extends StatelessWidget {
  const WashAreaGrid({
    required this.areas,
    required this.selected,
    required this.onToggle,
    super.key,
  });

  /// The tiles to offer, in order (see [washAreasForVehicle]).
  final List<WashArea> areas;
  final Set<WashArea> selected;
  final ValueChanged<WashArea> onToggle;

  static ValueKey<String> tileKey(WashArea area) =>
      ValueKey<String>('washing.area.${area.key}');

  @override
  Widget build(BuildContext context) {
    return LayoutBuilder(
      builder: (BuildContext context, BoxConstraints constraints) {
        final int columns = constraints.maxWidth >= 560 ? 3 : 2;
        final double width =
            (constraints.maxWidth - (columns - 1) * TpSpace.sm) / columns;
        return Wrap(
          spacing: TpSpace.sm,
          runSpacing: TpSpace.sm,
          children: <Widget>[
            for (final WashArea area in areas)
              SizedBox(
                width: width,
                child: _WashAreaTile(
                  key: tileKey(area),
                  area: area,
                  selected: selected.contains(area),
                  onTap: () => onToggle(area),
                ),
              ),
          ],
        );
      },
    );
  }
}

/// The localized tile name for [area].
String washAreaName(AppLocalizations l10n, WashArea area) => switch (area) {
      WashArea.exterior => l10n.washAreaExterior,
      WashArea.engineBay => l10n.washAreaEngineBay,
      WashArea.undercarriage => l10n.washAreaUndercarriage,
      WashArea.cabin => l10n.washAreaCabin,
      WashArea.tyresRims => l10n.washAreaTyresRims,
      WashArea.drumHopper => l10n.washAreaDrumHopper,
      WashArea.steam => l10n.washAreaSteam,
    };

String _washAreaDescription(AppLocalizations l10n, WashArea area) =>
    switch (area) {
      WashArea.exterior => l10n.washAreaExteriorDesc,
      WashArea.engineBay => l10n.washAreaEngineBayDesc,
      WashArea.undercarriage => l10n.washAreaUndercarriageDesc,
      WashArea.cabin => l10n.washAreaCabinDesc,
      WashArea.tyresRims => l10n.washAreaTyresRimsDesc,
      WashArea.drumHopper => l10n.washAreaDrumHopperDesc,
      WashArea.steam => l10n.washAreaSteamDesc,
    };

class _WashAreaTile extends StatelessWidget {
  const _WashAreaTile({
    required this.area,
    required this.selected,
    required this.onTap,
    super.key,
  });

  final WashArea area;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final TpPalette palette = TpPalette.of(context);
    final TextTheme text = Theme.of(context).textTheme;
    final BorderRadius corners = BorderRadius.circular(TpRadius.lg);
    final String name = washAreaName(l10n, area);

    return Semantics(
      button: true,
      selected: selected,
      label: name,
      excludeSemantics: true,
      child: Material(
        color: selected ? palette.primarySoft : palette.surface,
        shape: RoundedRectangleBorder(
          borderRadius: corners,
          side: BorderSide(
            color: selected ? palette.primary : palette.border,
            width: selected ? 2 : 1,
          ),
        ),
        clipBehavior: Clip.antiAlias,
        child: InkWell(
          onTap: onTap,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            mainAxisSize: MainAxisSize.min,
            children: <Widget>[
              Stack(
                children: <Widget>[
                  // The illustrations are drawn on transparent white-body
                  // vehicles; a light well keeps them readable in dark mode.
                  Container(
                    height: 96,
                    width: double.infinity,
                    margin: const EdgeInsets.all(TpSpace.xs),
                    decoration: BoxDecoration(
                      color: palette.brightness == Brightness.dark
                          ? palette.surfaceAlt
                          : palette.surfaceSunken,
                      borderRadius: BorderRadius.circular(TpRadius.md),
                    ),
                    padding: const EdgeInsets.all(TpSpace.xs),
                    child: Image.asset(
                      area.assetPath,
                      fit: BoxFit.contain,
                      filterQuality: FilterQuality.medium,
                      errorBuilder: (_, __, ___) => Icon(
                        Icons.local_car_wash_rounded,
                        size: 40,
                        color: palette.textMuted,
                      ),
                    ),
                  ),
                  PositionedDirectional(
                    top: TpSpace.sm,
                    end: TpSpace.sm,
                    child: AnimatedOpacity(
                      opacity: selected ? 1 : 0,
                      duration: const Duration(milliseconds: 160),
                      child: Container(
                        width: 24,
                        height: 24,
                        decoration: BoxDecoration(
                          color: palette.primary,
                          shape: BoxShape.circle,
                        ),
                        child: Icon(
                          Icons.check_rounded,
                          size: 16,
                          color: palette.onPrimary,
                          semanticLabel:
                              selected ? l10n.washAreaSelected : null,
                        ),
                      ),
                    ),
                  ),
                ],
              ),
              Padding(
                padding: const EdgeInsets.fromLTRB(
                  TpSpace.sm,
                  0,
                  TpSpace.sm,
                  TpSpace.sm,
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  mainAxisSize: MainAxisSize.min,
                  children: <Widget>[
                    Text(
                      name,
                      style: text.titleSmall?.copyWith(
                        color: selected ? palette.primary : palette.text,
                        fontWeight: FontWeight.w800,
                      ),
                    ),
                    Text(
                      _washAreaDescription(l10n, area),
                      style: text.bodySmall?.copyWith(
                        color: palette.textSecondary,
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
