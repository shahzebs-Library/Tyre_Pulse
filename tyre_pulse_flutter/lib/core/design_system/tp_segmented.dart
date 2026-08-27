/// A small segmented choice control - "Layout view / List view" and any
/// other two-or-three-way toggle a screen needs.
///
/// Spec section 54: no feature invents its own version of a basic control.
/// Built on plain [InkWell]s rather than [SegmentedButton] so its visual
/// weight matches this design system's own [TpCard]/[TpButton] language
/// (hairline border, no drop shadow) instead of Material 3's default chip
/// styling.
library;

import 'package:flutter/material.dart';
import 'package:tyre_pulse/app/theme/tp_colors.dart';
import 'package:tyre_pulse/app/theme/tp_spacing.dart';

/// One option in a [TpSegmented] control.
@immutable
class TpSegmentedOption<T> {
  const TpSegmentedOption({
    required this.value,
    required this.label,
    this.icon,
  });

  final T value;

  /// Already localised by the caller.
  final String label;

  final IconData? icon;
}

/// A row of mutually-exclusive options, styled as one pill-shaped control.
class TpSegmented<T> extends StatelessWidget {
  const TpSegmented({
    required this.options,
    required this.value,
    required this.onChanged,
    super.key,
  });

  final List<TpSegmentedOption<T>> options;
  final T value;

  /// Null disables every segment - a disabled control is honest (see
  /// [TpButton]'s own doc comment); this design system never renders a
  /// segment that looks tappable and silently does nothing.
  final ValueChanged<T>? onChanged;

  @override
  Widget build(BuildContext context) {
    final TpPalette palette = TpPalette.of(context);
    final TextTheme text = Theme.of(context).textTheme;

    return DecoratedBox(
      decoration: BoxDecoration(
        color: palette.surfaceAlt,
        borderRadius: BorderRadius.circular(TpRadius.pill),
        border: Border.all(
          color: palette.border,
          width: TpBorderWidth.hairline,
        ),
      ),
      child: Padding(
        padding: const EdgeInsets.all(3),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: <Widget>[
            for (final TpSegmentedOption<T> option in options)
              _Segment<T>(
                option: option,
                isSelected: option.value == value,
                palette: palette,
                textStyle: text.labelMedium,
                onTap:
                    onChanged == null ? null : () => onChanged!(option.value),
              ),
          ],
        ),
      ),
    );
  }
}

class _Segment<T> extends StatelessWidget {
  const _Segment({
    required this.option,
    required this.isSelected,
    required this.palette,
    required this.textStyle,
    required this.onTap,
  });

  final TpSegmentedOption<T> option;
  final bool isSelected;
  final TpPalette palette;
  final TextStyle? textStyle;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final Color foreground = isSelected ? palette.onPrimary : palette.text;

    return ConstrainedBox(
      constraints: const BoxConstraints(minHeight: TpSizing.minTouchTarget - 6),
      child: Material(
        color: isSelected ? palette.primary : Colors.transparent,
        borderRadius: BorderRadius.circular(TpRadius.pill),
        child: InkWell(
          onTap: onTap,
          borderRadius: BorderRadius.circular(TpRadius.pill),
          child: Padding(
            padding: const EdgeInsets.symmetric(
              horizontal: TpSpace.lg,
              vertical: TpSpace.sm,
            ),
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: <Widget>[
                if (option.icon != null) ...<Widget>[
                  Icon(option.icon, size: TpSizing.iconSm, color: foreground),
                  const SizedBox(width: TpSpace.xs),
                ],
                Text(
                  option.label,
                  style: textStyle?.copyWith(
                    color: foreground,
                    fontWeight: FontWeight.w700,
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
