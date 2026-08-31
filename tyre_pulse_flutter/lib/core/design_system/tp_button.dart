/// The application's buttons.
///
/// Spec section 54: no feature invents its own version of a basic control.
///
/// Sizing is not cosmetic here. [TpSizing.minTouchTarget] is 48 logical pixels
/// and the primary control is 52, because the people using this application are
/// wearing gloves, standing next to a machine, in the sun. A 36 pixel button is
/// a mis-tap, and a mis-tap on this app files something against the wrong
/// vehicle.
library;

import 'package:flutter/material.dart';
import 'package:tyre_pulse/app/theme/tp_colors.dart';
import 'package:tyre_pulse/app/theme/tp_spacing.dart';

/// How much weight a button carries.
enum TpButtonVariant {
  /// The one action this screen exists for. At most one per view.
  primary,

  /// A real action, but not the main one.
  secondary,

  /// Destructive, or something that cannot be undone.
  danger,

  /// Lowest weight. Reads as a link.
  text,
}

/// A button.
class TpButton extends StatelessWidget {
  const TpButton({
    required this.label,
    required this.onPressed,
    this.variant = TpButtonVariant.primary,
    this.icon,
    this.isBusy = false,
    this.isFullWidth = false,
    this.isCompact = false,
    super.key,
  });

  const TpButton.primary({
    required String label,
    required VoidCallback? onPressed,
    IconData? icon,
    bool isBusy = false,
    bool isFullWidth = false,
    bool isCompact = false,
    Key? key,
  }) : this(
          label: label,
          onPressed: onPressed,
          icon: icon,
          isBusy: isBusy,
          isFullWidth: isFullWidth,
          isCompact: isCompact,
          key: key,
        );

  const TpButton.secondary({
    required String label,
    required VoidCallback? onPressed,
    IconData? icon,
    bool isBusy = false,
    bool isFullWidth = false,
    bool isCompact = false,
    Key? key,
  }) : this(
          label: label,
          onPressed: onPressed,
          variant: TpButtonVariant.secondary,
          icon: icon,
          isBusy: isBusy,
          isFullWidth: isFullWidth,
          isCompact: isCompact,
          key: key,
        );

  const TpButton.danger({
    required String label,
    required VoidCallback? onPressed,
    IconData? icon,
    bool isBusy = false,
    bool isFullWidth = false,
    bool isCompact = false,
    Key? key,
  }) : this(
          label: label,
          onPressed: onPressed,
          variant: TpButtonVariant.danger,
          icon: icon,
          isBusy: isBusy,
          isFullWidth: isFullWidth,
          isCompact: isCompact,
          key: key,
        );

  const TpButton.text({
    required String label,
    required VoidCallback? onPressed,
    IconData? icon,
    bool isBusy = false,
    bool isFullWidth = false,
    bool isCompact = false,
    Key? key,
  }) : this(
          label: label,
          onPressed: onPressed,
          variant: TpButtonVariant.text,
          icon: icon,
          isBusy: isBusy,
          isFullWidth: isFullWidth,
          isCompact: isCompact,
          key: key,
        );

  final String label;

  /// Null disables the button.
  ///
  /// A disabled button is honest; a button that does nothing when pressed is
  /// what repository rule 7 forbids.
  final VoidCallback? onPressed;

  final TpButtonVariant variant;
  final IconData? icon;

  /// Shows a small progress indicator in place of the icon and blocks the
  /// press. This is an in-flight ACTION, not a screen state - it is the one
  /// place in this design system where a spinner is the right answer, because
  /// it ends by itself.
  final bool isBusy;

  final bool isFullWidth;

  /// Uses the shorter control height for a dense row. Never drops below
  /// [TpSizing.minTouchTarget].
  final bool isCompact;

  @override
  Widget build(BuildContext context) {
    final TpPalette palette = TpPalette.of(context);
    final double height =
        isCompact ? TpSizing.controlHeightCompact : TpSizing.controlHeight;
    final Size minimumSize = Size(
      isFullWidth ? double.infinity : 0,
      height < TpSizing.minTouchTarget ? TpSizing.minTouchTarget : height,
    );

    final TextStyle textStyle = Theme.of(context).textTheme.labelLarge ??
        const TextStyle(fontWeight: FontWeight.w700);

    final Widget content = _Content(
      label: label,
      icon: icon,
      isBusy: isBusy,
      foreground: _foreground(palette),
    );

    final RoundedRectangleBorder shape = RoundedRectangleBorder(
      borderRadius: BorderRadius.circular(TpRadius.md),
    );
    final EdgeInsets padding = EdgeInsets.symmetric(
      horizontal: isCompact ? TpSpace.md : TpSpace.lg,
    );
    final VoidCallback? handler = isBusy ? null : onPressed;

    switch (variant) {
      case TpButtonVariant.primary:
        return FilledButton(
          onPressed: handler,
          style: FilledButton.styleFrom(
            backgroundColor: palette.primary,
            foregroundColor: palette.onPrimary,
            minimumSize: minimumSize,
            padding: padding,
            shape: shape,
            textStyle: textStyle,
          ),
          child: content,
        );
      case TpButtonVariant.danger:
        return FilledButton(
          onPressed: handler,
          style: FilledButton.styleFrom(
            backgroundColor: palette.critical.base,
            foregroundColor: palette.critical.onBase,
            minimumSize: minimumSize,
            padding: padding,
            shape: shape,
            textStyle: textStyle,
          ),
          child: content,
        );
      case TpButtonVariant.secondary:
        return OutlinedButton(
          onPressed: handler,
          style: OutlinedButton.styleFrom(
            foregroundColor: palette.primary,
            minimumSize: minimumSize,
            padding: padding,
            shape: shape,
            textStyle: textStyle,
            side: BorderSide(
              color: palette.primary,
              width: TpBorderWidth.hairline,
            ),
          ),
          child: content,
        );
      case TpButtonVariant.text:
        return TextButton(
          onPressed: handler,
          style: TextButton.styleFrom(
            foregroundColor: palette.primary,
            minimumSize: Size(
              isFullWidth ? double.infinity : 0,
              TpSizing.minTouchTarget,
            ),
            padding: padding,
            shape: shape,
            textStyle: textStyle,
          ),
          child: content,
        );
    }
  }

  Color _foreground(TpPalette palette) {
    return switch (variant) {
      TpButtonVariant.primary => palette.onPrimary,
      TpButtonVariant.danger => palette.critical.onBase,
      TpButtonVariant.secondary => palette.primary,
      TpButtonVariant.text => palette.primary,
    };
  }
}

class _Content extends StatelessWidget {
  const _Content({
    required this.label,
    required this.icon,
    required this.isBusy,
    required this.foreground,
  });

  final String label;
  final IconData? icon;
  final bool isBusy;
  final Color foreground;

  @override
  Widget build(BuildContext context) {
    final List<Widget> children = <Widget>[];

    if (isBusy) {
      children.add(
        SizedBox(
          width: TpSizing.iconSm,
          height: TpSizing.iconSm,
          child: CircularProgressIndicator(
            strokeWidth: 2,
            valueColor: AlwaysStoppedAnimation<Color>(foreground),
          ),
        ),
      );
      children.add(const SizedBox(width: TpSpace.sm));
    } else if (icon != null) {
      children.add(Icon(icon, size: TpSizing.iconMd));
      children.add(const SizedBox(width: TpSpace.sm));
    }

    children.add(
      Flexible(
        child: Text(label, maxLines: 1, overflow: TextOverflow.ellipsis),
      ),
    );

    return Row(
      mainAxisSize: MainAxisSize.min,
      mainAxisAlignment: MainAxisAlignment.center,
      children: children,
    );
  }
}
