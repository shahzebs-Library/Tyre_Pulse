/// Wash-area chips: one small owner-supplied illustration per part of the
/// vehicle and its name, several to a row. Several can be picked; a picked
/// chip is framed in the brand colour and carries a check.
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
        // Small picture chips: 3 per row on a narrow phone, 4 from about
        // 360dp of content width, more on tablets. Labels wrap and the chip
        // grows, so large text stays readable.
        const double gap = TpSpace.sm;
        final int columns = (constraints.maxWidth / 92).floor().clamp(3, 6);
        final double width =
            (constraints.maxWidth - (columns - 1) * gap) / columns;
        return Wrap(
          spacing: gap,
          runSpacing: gap,
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
    final String name = washAreaName(l10n, area);

    return Semantics(
      button: true,
      selected: selected,
      label: '$name. ${_washAreaDescription(l10n, area)}',
      excludeSemantics: true,
      child: Material(
        color: selected ? palette.primarySoft : palette.surface,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(TpRadius.md),
          side: BorderSide(
            color: selected ? palette.primary : palette.border,
            width: selected ? 2 : 1,
          ),
        ),
        clipBehavior: Clip.antiAlias,
        child: InkWell(
          onTap: onTap,
          child: ConstrainedBox(
            constraints: const BoxConstraints(minHeight: 48),
            child: Padding(
              padding: const EdgeInsets.all(TpSpace.xs),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: <Widget>[
                  Stack(
                    children: <Widget>[
                      // The owner's illustrations are drawn on white; they
                      // sit on a small white card in both themes.
                      AspectRatio(
                        aspectRatio: 1.25,
                        child: Container(
                          width: double.infinity,
                          decoration: BoxDecoration(
                            color: Colors.white,
                            borderRadius: BorderRadius.circular(TpRadius.sm),
                          ),
                          padding: const EdgeInsets.all(2),
                          child: Image.asset(
                            area.assetPath,
                            fit: BoxFit.contain,
                            filterQuality: FilterQuality.medium,
                            errorBuilder: (_, __, ___) => const Icon(
                              Icons.local_car_wash_rounded,
                              color: Colors.black45,
                            ),
                          ),
                        ),
                      ),
                      if (selected)
                        PositionedDirectional(
                          top: 2,
                          end: 2,
                          child: Container(
                            width: 18,
                            height: 18,
                            decoration: BoxDecoration(
                              color: palette.primary,
                              shape: BoxShape.circle,
                            ),
                            child: Icon(
                              Icons.check_rounded,
                              size: 13,
                              color: palette.onPrimary,
                            ),
                          ),
                        ),
                    ],
                  ),
                  const SizedBox(height: 2),
                  Text(
                    name,
                    textAlign: TextAlign.center,
                    style: text.labelSmall?.copyWith(
                      color: selected ? palette.primary : palette.text,
                      fontWeight: FontWeight.w700,
                    ),
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
