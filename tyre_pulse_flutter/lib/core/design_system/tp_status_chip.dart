/// A small status badge.
///
/// [TpStatus.unknown] is drawn with a DASHED outline as well as its own hue,
/// because spec section 32's rule is a readability rule, not a colour rule: a
/// value that was never measured must be distinguishable from one that came
/// back clean, including by somebody who cannot tell the two hues apart.
library;

import 'package:flutter/material.dart';
import 'package:tyre_pulse/app/localization/tp_localizations.dart';
import 'package:tyre_pulse/app/theme/tp_colors.dart';
import 'package:tyre_pulse/app/theme/tp_spacing.dart';

class TpStatusChip extends StatelessWidget {
  const TpStatusChip({
    required this.status,
    this.label,
    this.icon,
    this.isCompact = false,
    super.key,
  });

  final TpStatus status;

  /// Overrides the default wording. The default is the status name in the
  /// user's language, so a chip is never blank.
  final String? label;

  final IconData? icon;
  final bool isCompact;

  @override
  Widget build(BuildContext context) {
    final TpPalette palette = TpPalette.of(context);
    final TpStatusColors colors = palette.forStatus(status);
    final AppLocalizations l10n = AppLocalizations.of(context);
    final bool isUnknown = status == TpStatus.unknown;

    final String text = label ?? _defaultLabel(l10n, status);

    return DecoratedBox(
      decoration: BoxDecoration(
        color: colors.soft,
        borderRadius: BorderRadius.circular(TpRadius.pill),
        border: Border.all(
          color: colors.base,
          width: TpBorderWidth.hairline,
          // A dashed border cannot be expressed by BoxDecoration, so the
          // "never measured" case is additionally marked with a leading glyph.
          // Two signals, neither of which is colour alone.
        ),
      ),
      child: Padding(
        padding: EdgeInsets.symmetric(
          horizontal: isCompact ? TpSpace.sm : TpSpace.md,
          vertical: isCompact ? 2 : TpSpace.xs,
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: <Widget>[
            if (icon != null || isUnknown) ...<Widget>[
              Icon(
                icon ?? Icons.remove,
                size: TpSizing.iconSm,
                color: colors.onSoft,
              ),
              const SizedBox(width: TpSpace.xs),
            ],
            // A chip is a single line by definition. When a host hands it a
            // width narrower than its label (a Wrap on a 400px phone, a
            // ListTile trailing slot) it trims with an ellipsis instead of
            // painting an overflow stripe across the card.
            Flexible(
              child: Text(
                text,
                maxLines: 1,
                softWrap: false,
                overflow: TextOverflow.ellipsis,
                style: Theme.of(context)
                    .textTheme
                    .labelMedium
                    ?.copyWith(color: colors.onSoft),
              ),
            ),
          ],
        ),
      ),
    );
  }

  static String _defaultLabel(AppLocalizations l10n, TpStatus status) {
    return switch (status) {
      TpStatus.ok => l10n.statusOk,
      TpStatus.warning => l10n.statusWarning,
      TpStatus.critical => l10n.statusCritical,
      TpStatus.info => l10n.statusInfo,
      TpStatus.neutral => l10n.statusNeutral,
      TpStatus.unknown => l10n.statusUnknown,
    };
  }
}
