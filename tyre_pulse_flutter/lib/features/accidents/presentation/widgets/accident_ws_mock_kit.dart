/// Small shared pieces for the M1/M2 mock workspaces (header chips, numbered
/// sections, fact grids, notices). Kept in one file so the two workspaces
/// render the owner's mock vocabulary identically instead of each carrying
/// its own copy of "Not set".
///
/// Copy comes from the ARB catalogs (en/ar/ur) through [WsKitCopy.l10n];
/// a blank value ALWAYS prints "Not set", never a dash.
library;

import 'package:flutter/material.dart';
import 'package:intl/intl.dart' show DateFormat;
import 'package:tyre_pulse/app/localization/tp_localizations.dart';
import 'package:tyre_pulse/app/theme/tp_colors.dart';
import 'package:tyre_pulse/app/theme/tp_spacing.dart';
import 'package:tyre_pulse/core/design_system/design_system.dart';

final class WsKitCopy {
  const WsKitCopy(this.context);
  final BuildContext context;

  /// Every workspace string lives in the ARB catalogs (en/ar/ur).
  AppLocalizations get l10n => AppLocalizations.of(context);

  String get notSet => l10n.accNotSet;

  String value(Object? raw) {
    final String text = raw?.toString().trim() ?? '';
    return text.isEmpty ? notSet : text;
  }
}

/// "16 Sep 2026 · 14:35" in the ambient locale. Never invents a time.
String accidentMockDateTime(BuildContext context, DateTime at) {
  final String locale = Localizations.localeOf(context).toLanguageTag();
  final DateTime local = at.toLocal();
  return '${DateFormat('d MMM y', locale).format(local)} · '
      '${DateFormat.Hm(locale).format(local)}';
}

class AccidentMockTitle extends StatelessWidget {
  const AccidentMockTitle(this.text, {super.key});
  final String text;
  @override
  Widget build(BuildContext context) => Text(
        text,
        style: Theme.of(context).textTheme.titleLarge?.copyWith(
              fontWeight: FontWeight.w800,
              color: TpPalette.of(context).text,
            ),
      );
}

class AccidentMockPanel extends StatelessWidget {
  const AccidentMockPanel({required this.child, super.key});
  final Widget child;
  @override
  Widget build(BuildContext context) => TpCard(
        padding: const EdgeInsets.all(TpSpace.md),
        // Checklist and toggle rows paint ink on the nearest Material; the
        // card surface must not be the thing they paint through.
        child: Material(type: MaterialType.transparency, child: child),
      );
}

class AccidentMockSection extends StatelessWidget {
  const AccidentMockSection({
    required this.title,
    required this.child,
    this.number,
    this.icon,
    this.subtitle,
    this.sectionKey,
    super.key,
  });
  final String title;
  final String? subtitle;
  final Widget child;
  final int? number;
  final IconData? icon;
  final Key? sectionKey;

  @override
  Widget build(BuildContext context) {
    final TpPalette palette = TpPalette.of(context);
    return Column(
      key: sectionKey,
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: <Widget>[
        Row(
          children: <Widget>[
            if (number != null)
              CircleAvatar(
                radius: 12,
                backgroundColor: palette.primary,
                child: Text(
                  '$number',
                  style: TextStyle(
                    color: palette.onPrimary,
                    fontSize: 13,
                    fontWeight: FontWeight.bold,
                  ),
                ),
              )
            else
              Icon(icon ?? Icons.subject, color: palette.primary, size: 21),
            const SizedBox(width: TpSpace.sm),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: <Widget>[
                  Text(
                    title,
                    style: Theme.of(context)
                        .textTheme
                        .titleSmall
                        ?.copyWith(fontWeight: FontWeight.w800),
                  ),
                  if (subtitle != null)
                    Text(
                      subtitle!,
                      style: Theme.of(context).textTheme.bodySmall,
                    ),
                ],
              ),
            ),
          ],
        ),
        const SizedBox(height: TpSpace.sm),
        AccidentMockPanel(child: child),
      ],
    );
  }
}

/// Label / value pairs; a blank value prints "Not set".
class AccidentMockFacts extends StatelessWidget {
  const AccidentMockFacts({required this.items, super.key});
  final List<(String, String?)> items;

  @override
  Widget build(BuildContext context) => LayoutBuilder(
        builder: (BuildContext context, BoxConstraints constraints) {
          final int columns = constraints.maxWidth >= 500 ? 2 : 1;
          final double width =
              (constraints.maxWidth - (columns - 1) * TpSpace.lg) / columns;
          return Wrap(
            spacing: TpSpace.lg,
            runSpacing: TpSpace.sm,
            children: <Widget>[
              for (final (String, String?) item in items)
                SizedBox(
                  width: width,
                  child: Padding(
                    padding: const EdgeInsets.symmetric(vertical: 5),
                    child: Row(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: <Widget>[
                        Expanded(
                          child: Text(
                            item.$1,
                            style: Theme.of(context).textTheme.bodySmall,
                          ),
                        ),
                        const SizedBox(width: TpSpace.sm),
                        Expanded(
                          child: Text(
                            WsKitCopy(context).value(item.$2),
                            style: Theme.of(context)
                                .textTheme
                                .bodyMedium
                                ?.copyWith(fontWeight: FontWeight.w600),
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
            ],
          );
        },
      );
}

class AccidentMockNotice extends StatelessWidget {
  const AccidentMockNotice({
    required this.text,
    this.tone = TpStatus.warning,
    this.title,
    super.key,
  });
  final String text;
  final String? title;
  final TpStatus tone;

  @override
  Widget build(BuildContext context) {
    final TpStatusColors colors = TpPalette.of(context).forStatus(tone);
    return Container(
      padding: const EdgeInsets.all(TpSpace.md),
      decoration: BoxDecoration(
        color: colors.soft,
        border: Border.all(color: colors.base),
        borderRadius: BorderRadius.circular(TpRadius.sm),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Icon(
            tone == TpStatus.warning || tone == TpStatus.critical
                ? Icons.warning_amber_rounded
                : Icons.info_outline,
            color: colors.base,
          ),
          const SizedBox(width: TpSpace.sm),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                if (title != null)
                  Text(
                    title!,
                    style: const TextStyle(fontWeight: FontWeight.w800),
                  ),
                Text(text),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

/// One header chip: a small label over a bold value with a status tint.
class AccidentMockChip extends StatelessWidget {
  const AccidentMockChip({
    required this.label,
    required this.value,
    this.tone = TpStatus.neutral,
    this.icon,
    super.key,
  });
  final String label;
  final String value;
  final TpStatus tone;

  /// Optional leading glyph, as on the mock's header strip.
  final IconData? icon;

  @override
  Widget build(BuildContext context) {
    final TpStatusColors colors = TpPalette.of(context).forStatus(tone);
    return Container(
      constraints: const BoxConstraints(minWidth: 132),
      padding: const EdgeInsets.symmetric(
        horizontal: TpSpace.md,
        vertical: TpSpace.sm,
      ),
      decoration: BoxDecoration(
        color: colors.soft,
        border: Border.all(color: colors.base),
        borderRadius: BorderRadius.circular(TpRadius.md),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: <Widget>[
          if (icon != null) ...<Widget>[
            Icon(icon, size: TpSizing.iconMd, color: colors.base),
            const SizedBox(width: TpSpace.sm),
          ],
          Flexible(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: <Widget>[
                Text(label, style: Theme.of(context).textTheme.labelSmall),
                Text(
                  value,
                  style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                        fontWeight: FontWeight.w800,
                        color: colors.onSoft,
                      ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class AccidentMockActions extends StatelessWidget {
  const AccidentMockActions({
    required this.actions,
    this.emphasiseLast = false,
    super.key,
  });
  final List<(String, IconData, VoidCallback?)> actions;

  /// The mock's footer pairs an outlined action with one filled primary
  /// action on the end; set this to draw the last action filled.
  final bool emphasiseLast;

  @override
  Widget build(BuildContext context) {
    Widget button(int i) {
      final (String, IconData, VoidCallback?) action = actions[i];
      if (emphasiseLast && i == actions.length - 1) {
        return FilledButton.icon(
          onPressed: action.$3,
          icon: Icon(action.$2),
          label: Text(action.$1),
        );
      }
      return OutlinedButton.icon(
        onPressed: action.$3,
        icon: Icon(action.$2),
        label: Text(action.$1),
      );
    }

    if (emphasiseLast) {
      return Row(
        children: <Widget>[
          for (int i = 0; i < actions.length; i++) ...<Widget>[
            if (i > 0) const SizedBox(width: TpSpace.sm),
            Expanded(child: button(i)),
          ],
        ],
      );
    }
    return Wrap(
      spacing: TpSpace.sm,
      runSpacing: TpSpace.sm,
      children: <Widget>[
        for (int i = 0; i < actions.length; i++) button(i),
      ],
    );
  }
}

/// Bulleted list with a "N items" count, for documents sent / accessories.
class AccidentMockCountedList extends StatelessWidget {
  const AccidentMockCountedList({
    required this.label,
    required this.items,
    required this.unit,
    super.key,
  });
  final String label;
  final List<String> items;

  /// e.g. "documents" or "items" - printed after the count.
  final String unit;

  @override
  Widget build(BuildContext context) {
    final WsKitCopy c = WsKitCopy(context);
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 5),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Row(
            children: <Widget>[
              Expanded(
                child: Text(
                  label,
                  style: Theme.of(context).textTheme.bodySmall,
                ),
              ),
              Text(
                items.isEmpty ? c.notSet : '${items.length} $unit',
                style: const TextStyle(fontWeight: FontWeight.w700),
              ),
            ],
          ),
          for (final String item in items)
            Padding(
              padding: const EdgeInsetsDirectional.only(start: TpSpace.md),
              child: Text('• $item'),
            ),
        ],
      ),
    );
  }
}

/// One "dot + label" status, as the mock prints severity and case state
/// under the case headline ("● Major accident | ● Open"). The words always
/// carry the meaning; the dot only repeats it.
class AccidentMockDotStatus extends StatelessWidget {
  const AccidentMockDotStatus({
    required this.label,
    required this.tone,
    super.key,
  });
  final String label;
  final TpStatus tone;

  @override
  Widget build(BuildContext context) {
    final TpStatusColors colors = TpPalette.of(context).forStatus(tone);
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: <Widget>[
        ExcludeSemantics(
          child: Container(
            width: 10,
            height: 10,
            decoration: BoxDecoration(
              color: colors.base,
              shape: BoxShape.circle,
            ),
          ),
        ),
        const SizedBox(width: TpSpace.sm),
        Flexible(
          child: Text(
            label,
            style: Theme.of(context)
                .textTheme
                .bodyMedium
                ?.copyWith(fontWeight: FontWeight.w700),
          ),
        ),
      ],
    );
  }
}

/// An outlined action tinted by [tone] (the mock's amber "Request missing
/// document" beside the green outlined send action). Always 48dp tall.
class AccidentMockToneButton extends StatelessWidget {
  const AccidentMockToneButton({
    required this.label,
    required this.icon,
    required this.onPressed,
    this.tone = TpStatus.warning,
    this.isBusy = false,
    this.isFullWidth = false,
    super.key,
  });
  final String label;
  final IconData icon;
  final VoidCallback? onPressed;
  final TpStatus tone;
  final bool isBusy;
  final bool isFullWidth;

  @override
  Widget build(BuildContext context) {
    final TpPalette palette = TpPalette.of(context);
    final Color color =
        tone == TpStatus.ok ? palette.primary : palette.forStatus(tone).onSoft;
    final Widget button = OutlinedButton.icon(
      onPressed: isBusy ? null : onPressed,
      style: OutlinedButton.styleFrom(
        foregroundColor: color,
        minimumSize:
            const Size(TpSizing.minTouchTarget, TpSizing.minTouchTarget),
        side: BorderSide(
          color: onPressed == null ? palette.border : color,
        ),
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(TpRadius.md),
        ),
      ),
      icon: isBusy
          ? const SizedBox.square(
              dimension: TpSizing.iconMd,
              child: CircularProgressIndicator(strokeWidth: 2),
            )
          : Icon(icon, size: TpSizing.iconMd),
      label: Text(label, textAlign: TextAlign.center),
    );
    return isFullWidth
        ? SizedBox(width: double.infinity, child: button)
        : button;
  }
}

/// A selectable icon tile (the mock's "Who was at fault?" / "Who will pay?"
/// grids). Selected tiles get a primary border and a check badge; the
/// selection is also announced, so colour is never the only signal.
class AccidentMockChoiceTile extends StatelessWidget {
  const AccidentMockChoiceTile({
    required this.label,
    required this.icon,
    required this.selected,
    required this.onTap,
    this.iconColor,
    super.key,
  });
  final String label;
  final IconData icon;
  final bool selected;
  final VoidCallback? onTap;
  final Color? iconColor;

  @override
  Widget build(BuildContext context) {
    final TpPalette palette = TpPalette.of(context);
    return Semantics(
      button: true,
      selected: selected,
      enabled: onTap != null,
      label: label,
      excludeSemantics: true,
      child: Stack(
        clipBehavior: Clip.none,
        children: <Widget>[
          Material(
            color: selected ? palette.primarySoft : palette.surface,
            shape: RoundedRectangleBorder(
              side: BorderSide(
                color: selected ? palette.primary : palette.border,
                width: selected ? TpBorderWidth.strong : TpBorderWidth.hairline,
              ),
              borderRadius: BorderRadius.circular(TpRadius.md),
            ),
            child: InkWell(
              onTap: onTap,
              borderRadius: BorderRadius.circular(TpRadius.md),
              child: ConstrainedBox(
                constraints: const BoxConstraints(minHeight: 84),
                child: Padding(
                  padding: const EdgeInsets.symmetric(
                    horizontal: TpSpace.xs,
                    vertical: TpSpace.sm,
                  ),
                  child: Column(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: <Widget>[
                      Icon(
                        icon,
                        size: TpSizing.iconLg,
                        color: iconColor ?? palette.primary,
                      ),
                      const SizedBox(height: TpSpace.xs),
                      Text(
                        label,
                        textAlign: TextAlign.center,
                        style: Theme.of(context).textTheme.bodySmall?.copyWith(
                              fontWeight: FontWeight.w600,
                              color: palette.text,
                            ),
                      ),
                    ],
                  ),
                ),
              ),
            ),
          ),
          if (selected)
            PositionedDirectional(
              top: -6,
              end: -6,
              child: CircleAvatar(
                radius: 10,
                backgroundColor: palette.primary,
                child: Icon(
                  Icons.check_rounded,
                  size: 14,
                  color: palette.onPrimary,
                ),
              ),
            ),
        ],
      ),
    );
  }
}

/// Lays [children] out as an even grid whose column count follows the
/// available width (never narrower than [minTileWidth]).
class AccidentMockTileGrid extends StatelessWidget {
  const AccidentMockTileGrid({
    required this.children,
    this.minTileWidth = 96,
    this.maxColumns = 6,
    super.key,
  });
  final List<Widget> children;
  final double minTileWidth;
  final int maxColumns;

  @override
  Widget build(BuildContext context) => LayoutBuilder(
        builder: (BuildContext context, BoxConstraints constraints) {
          const double gap = TpSpace.sm;
          final int fit =
              ((constraints.maxWidth + gap) / (minTileWidth + gap)).floor();
          final int columns = fit.clamp(1, maxColumns);
          final double width =
              (constraints.maxWidth - (columns - 1) * gap) / columns;
          return Wrap(
            spacing: gap,
            runSpacing: TpSpace.md,
            children: <Widget>[
              for (final Widget child in children)
                SizedBox(width: width, child: child),
            ],
          );
        },
      );
}
