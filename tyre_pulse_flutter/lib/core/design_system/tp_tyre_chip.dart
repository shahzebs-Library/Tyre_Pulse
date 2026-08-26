/// A tyre, as a chip.
///
/// The position identifier is drawn through [TpIdentifierText], which pins it
/// left to right and isolates it. Spec section 52 and repository rule 10: `RR2`
/// rendering as `2RR` under an Arabic locale is not a cosmetic problem, it
/// names a different wheel.
///
/// STUB. [TpTyreChipData] is a view model defined here because the tyre domain
/// model does not exist yet. When it does, this widget should take that model
/// and this class should be deleted, not kept as a parallel shape.
library;

import 'package:flutter/material.dart';
import 'package:tyre_pulse/app/localization/tp_direction.dart';
import 'package:tyre_pulse/app/theme/tp_colors.dart';
import 'package:tyre_pulse/app/theme/tp_spacing.dart';
import 'package:tyre_pulse/app/theme/tp_typography.dart';

/// What the chip needs to draw a tyre.
@immutable
class TpTyreChipData {
  const TpTyreChipData({
    required this.position,
    this.serial,
    this.status = TpStatus.unknown,
    this.detail,
  });

  /// A tyre position identifier such as `LHF1` or `RHCO`. Never translated,
  /// never reordered, never reformatted.
  final String position;

  final String? serial;

  /// Defaults to [TpStatus.unknown] deliberately: a tyre nobody has assessed
  /// must not default to looking healthy.
  final TpStatus status;

  /// A short reading: pressure, tread depth, already formatted with its unit.
  final String? detail;
}

class TpTyreChip extends StatelessWidget {
  const TpTyreChip({required this.data, this.onTap, this.isSelected = false, super.key});

  final TpTyreChipData data;
  final VoidCallback? onTap;
  final bool isSelected;

  @override
  Widget build(BuildContext context) {
    final TpPalette palette = TpPalette.of(context);
    final TpStatusColors colors = palette.forStatus(data.status);

    final Widget body = DecoratedBox(
      decoration: BoxDecoration(
        color: colors.soft,
        borderRadius: BorderRadius.circular(TpRadius.md),
        border: Border.all(
          color: isSelected ? palette.focus : colors.base,
          width: isSelected ? TpBorderWidth.strong : TpBorderWidth.hairline,
        ),
      ),
      child: ConstrainedBox(
        constraints: const BoxConstraints(
          minWidth: TpSizing.minTouchTarget,
          minHeight: TpSizing.minTouchTarget,
        ),
        child: Padding(
          padding: const EdgeInsets.symmetric(
            horizontal: TpSpace.md,
            vertical: TpSpace.sm,
          ),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.center,
            mainAxisAlignment: MainAxisAlignment.center,
            children: <Widget>[
              TpIdentifierText(
                data.position,
                style: TpTypography.identifier(palette).copyWith(
                  color: colors.onSoft,
                ),
              ),
              if (data.detail != null)
                Text(
                  data.detail!,
                  style: Theme.of(context).textTheme.labelSmall?.copyWith(
                        color: colors.onSoft,
                      ),
                ),
            ],
          ),
        ),
      ),
    );

    if (onTap == null) return body;
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(TpRadius.md),
      child: body,
    );
  }
}
