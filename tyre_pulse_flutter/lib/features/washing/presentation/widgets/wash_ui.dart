/// Shared visual pieces for the wash screens: one colour and icon per wash
/// type, the gradient squircle icon tile, the numbered step card and the
/// coloured type chip.
///
/// The gradient tile reuses [TpGemTone] - the same palette and gradient
/// angle as the Home gem tiles - so the wash screen reads as part of the same
/// family. [TpGem] only draws the signature glyph set, which has no glyph for
/// "interior" or "steam", so [WashGem] draws a Material icon on the same tile.
library;

import 'package:flutter/material.dart';
import 'package:tyre_pulse/app/localization/tp_localizations.dart';
import 'package:tyre_pulse/app/theme/tp_colors.dart';
import 'package:tyre_pulse/app/theme/tp_spacing.dart';
import 'package:tyre_pulse/core/design_system/design_system.dart';

/// Icon and colour for one `wash_records.wash_type` value. The colour carries
/// meaning: blue water for the body, violet for the cab, green for a complete
/// wash, amber for engine work, slate for the wheels, red for heat, teal for
/// the dry clean.
final class WashTypeStyle {
  const WashTypeStyle(this.icon, this.tone);

  final IconData icon;
  final TpGemTone tone;

  static WashTypeStyle of(String? type) {
    switch (type) {
      case 'Exterior':
        return const WashTypeStyle(
          Icons.local_car_wash_rounded,
          TpGemTone.blue,
        );
      case 'Interior':
        return const WashTypeStyle(Icons.event_seat_rounded, TpGemTone.violet);
      case 'Full':
        return const WashTypeStyle(Icons.auto_awesome_rounded, TpGemTone.green);
      case 'Engine Bay':
        return const WashTypeStyle(Icons.car_repair_rounded, TpGemTone.amber);
      case 'Undercarriage':
        return const WashTypeStyle(Icons.tire_repair_rounded, TpGemTone.slate);
      case 'Steam':
        return const WashTypeStyle(Icons.air_rounded, TpGemTone.red);
      case 'Waterless':
        return const WashTypeStyle(
          Icons.format_color_reset_rounded,
          TpGemTone.teal,
        );
      default:
        return const WashTypeStyle(
          Icons.local_car_wash_rounded,
          TpGemTone.slate,
        );
    }
  }
}

/// Translated name of a stored wash type. Unknown values are shown as stored.
String washTypeName(AppLocalizations l10n, String type) {
  switch (type) {
    case 'Exterior':
      return l10n.washTypeExterior;
    case 'Interior':
      return l10n.washTypeInterior;
    case 'Full':
      return l10n.washTypeFull;
    case 'Engine Bay':
      return l10n.washTypeEngineBay;
    case 'Undercarriage':
      return l10n.washTypeUndercarriage;
    case 'Steam':
      return l10n.washTypeSteam;
    case 'Waterless':
      return l10n.washTypeWaterless;
    default:
      return type;
  }
}

/// One-line description of a wash type, or null for an unknown value.
String? washTypeDescription(AppLocalizations l10n, String type) {
  switch (type) {
    case 'Exterior':
      return l10n.washTypeExteriorDesc;
    case 'Interior':
      return l10n.washTypeInteriorDesc;
    case 'Full':
      return l10n.washTypeFullDesc;
    case 'Engine Bay':
      return l10n.washTypeEngineBayDesc;
    case 'Undercarriage':
      return l10n.washTypeUndercarriageDesc;
    case 'Steam':
      return l10n.washTypeSteamDesc;
    case 'Waterless':
      return l10n.washTypeWaterlessDesc;
    default:
      return null;
  }
}

/// Tinted background and readable foreground for [tone] on the current
/// theme: a soft wash of the tone with its dark end as text in light mode,
/// a deeper wash with the bright end as text in dark mode.
({Color background, Color foreground}) washToneColors(
  BuildContext context,
  TpGemTone tone,
) {
  final bool dark = Theme.of(context).brightness == Brightness.dark;
  return (
    background: tone.start.withValues(alpha: dark ? 0.22 : 0.13),
    foreground: dark ? tone.start : tone.end,
  );
}

/// A Material icon on the Home gem-tile gradient.
class WashGem extends StatelessWidget {
  const WashGem({
    required this.icon,
    required this.tone,
    this.size = 44,
    super.key,
  });

  final IconData icon;
  final TpGemTone tone;
  final double size;

  @override
  Widget build(BuildContext context) {
    final BorderRadius corners = BorderRadius.circular(size * 0.31);
    return ExcludeSemantics(
      child: SizedBox(
        width: size,
        height: size,
        child: DecoratedBox(
          decoration: BoxDecoration(
            borderRadius: corners,
            gradient: LinearGradient(
              begin: const Alignment(-0.42, -0.91),
              end: const Alignment(0.42, 0.91),
              colors: <Color>[tone.start, tone.end],
            ),
            boxShadow: <BoxShadow>[
              BoxShadow(
                color: tone.end.withValues(alpha: 0.30),
                blurRadius: size * 0.24,
                offset: Offset(0, size * 0.08),
              ),
            ],
          ),
          child: ClipRRect(
            borderRadius: corners,
            child: Stack(
              alignment: Alignment.center,
              children: <Widget>[
                Positioned(
                  left: 0,
                  right: 0,
                  top: 0,
                  height: size * 0.5,
                  child: const DecoratedBox(
                    decoration: BoxDecoration(
                      gradient: LinearGradient(
                        begin: Alignment.topCenter,
                        end: Alignment.bottomCenter,
                        colors: <Color>[Color(0x47FFFFFF), Color(0x00FFFFFF)],
                      ),
                    ),
                  ),
                ),
                Icon(icon, size: size * 0.54, color: Colors.white),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

enum WashStepState { todo, done, attention }

/// A numbered step: badge, title, a short status on the right, then the
/// step's content.
class WashStepCard extends StatelessWidget {
  const WashStepCard({
    required this.number,
    required this.title,
    required this.state,
    required this.child,
    this.summary,
    this.optionalLabel,
    super.key,
  });

  final int number;
  final String title;
  final WashStepState state;
  final String? summary;
  final String? optionalLabel;
  final Widget child;

  @override
  Widget build(BuildContext context) {
    final TpPalette palette = TpPalette.of(context);
    final TextTheme text = Theme.of(context).textTheme;
    final Color accent = switch (state) {
      WashStepState.done => palette.ok.base,
      WashStepState.attention => palette.warning.base,
      WashStepState.todo => palette.primary,
    };
    return TpCard(
      borderColor: state == WashStepState.attention
          ? palette.warning.base
          : (state == WashStepState.done
              ? palette.ok.base.withValues(alpha: 0.45)
              : null),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        mainAxisSize: MainAxisSize.min,
        children: <Widget>[
          Row(
            children: <Widget>[
              Container(
                width: 30,
                height: 30,
                alignment: Alignment.center,
                decoration: BoxDecoration(
                  shape: BoxShape.circle,
                  color: state == WashStepState.done
                      ? accent
                      : accent.withValues(alpha: 0.14),
                ),
                child: state == WashStepState.done
                    ? Icon(
                        Icons.check_rounded,
                        size: 18,
                        color: palette.ok.onBase,
                      )
                    : Text(
                        '$number',
                        style: text.labelLarge?.copyWith(
                          color: accent,
                          fontWeight: FontWeight.w800,
                        ),
                      ),
              ),
              const SizedBox(width: TpSpace.md),
              Expanded(
                child: Text.rich(
                  TextSpan(
                    text: title,
                    children: <InlineSpan>[
                      if (optionalLabel != null)
                        TextSpan(
                          text: '  $optionalLabel',
                          style: text.labelSmall?.copyWith(
                            color: palette.textMuted,
                            fontWeight: FontWeight.w600,
                          ),
                        ),
                    ],
                  ),
                  style: text.titleSmall?.copyWith(
                    color: palette.text,
                    fontWeight: FontWeight.w800,
                  ),
                ),
              ),
              if (summary != null) ...<Widget>[
                const SizedBox(width: TpSpace.sm),
                Flexible(
                  child: Text(
                    summary!,
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                    textAlign: TextAlign.end,
                    style: text.labelSmall?.copyWith(
                      color: state == WashStepState.attention
                          ? palette.warning.base
                          : palette.textSecondary,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                ),
              ],
            ],
          ),
          const SizedBox(height: TpSpace.md),
          child,
        ],
      ),
    );
  }
}

/// A compact coloured pill naming a wash type.
class WashTypeChip extends StatelessWidget {
  const WashTypeChip({required this.type, super.key});

  final String type;

  @override
  Widget build(BuildContext context) {
    final WashTypeStyle style = WashTypeStyle.of(type);
    final ({Color background, Color foreground}) colors =
        washToneColors(context, style.tone);
    return Container(
      padding: const EdgeInsets.symmetric(
        horizontal: TpSpace.sm,
        vertical: TpSpace.xs,
      ),
      decoration: BoxDecoration(
        color: colors.background,
        borderRadius: BorderRadius.circular(TpRadius.pill),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: <Widget>[
          Icon(style.icon, size: 14, color: colors.foreground),
          const SizedBox(width: TpSpace.xs),
          Flexible(
            child: Text(
              washTypeName(AppLocalizations.of(context), type),
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: Theme.of(context).textTheme.labelSmall?.copyWith(
                    color: colors.foreground,
                    fontWeight: FontWeight.w800,
                  ),
            ),
          ),
        ],
      ),
    );
  }
}

/// A small status pill with an icon (due, up to date, offline...).
class WashBadge extends StatelessWidget {
  const WashBadge({
    required this.label,
    required this.icon,
    required this.colors,
    super.key,
  });

  final String label;
  final IconData icon;
  final TpStatusColors colors;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(
        horizontal: TpSpace.sm,
        vertical: TpSpace.xs,
      ),
      decoration: BoxDecoration(
        color: colors.soft,
        borderRadius: BorderRadius.circular(TpRadius.pill),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: <Widget>[
          Icon(icon, size: 14, color: colors.onSoft),
          const SizedBox(width: TpSpace.xs),
          Flexible(
            child: Text(
              label,
              style: Theme.of(context).textTheme.labelSmall?.copyWith(
                    color: colors.onSoft,
                    fontWeight: FontWeight.w800,
                  ),
            ),
          ),
        ],
      ),
    );
  }
}
