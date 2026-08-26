/// A single headline figure.
///
/// Spec section 32, which is the reason this widget has three constructors
/// instead of one:
///
/// > Every card must come from actual data. If data does not exist, show `-`,
/// > `Unavailable` or `Not configured` rather than `0` when zero would falsely
/// > imply measured data.
///
/// The Kotlin rebuild put invented KPIs on its home screen. A zero that nobody
/// measured is the quiet version of that: it looks like a fact, it is not one,
/// and a fleet manager acts on it.
///
/// So there is no way to pass a placeholder through the normal path.
/// [TpStatCard.count] and [TpStatCard.text] carry a real value;
/// [TpStatCard.unavailable] carries no value at all and renders a dash with the
/// word Unavailable and a dashed border. The two are structurally different
/// widgets in the tree, which a test can prove.
library;

import 'package:flutter/material.dart';
import 'package:tyre_pulse/app/localization/tp_localizations.dart';
import 'package:tyre_pulse/app/theme/tp_colors.dart';
import 'package:tyre_pulse/app/theme/tp_spacing.dart';
import 'package:tyre_pulse/core/design_system/tp_card.dart';

/// Keys that separate a measured figure from an unmeasured one.
abstract final class TpStatCardKeys {
  /// A real, measured value. Including a real zero.
  static const Key value = Key('tp.stat.value');

  /// No value was measured.
  static const Key unavailable = Key('tp.stat.unavailable');
}

class TpStatCard extends StatelessWidget {
  /// A measured count. A real zero is legitimate here and renders as `0`.
  const TpStatCard.count({
    required this.label,
    required int count,
    this.caption,
    this.status,
    this.icon,
    this.onTap,
    super.key,
  })  : _count = count,
        _text = null,
        _isUnavailable = false;

  /// A measured value that is not a plain count - a percentage, a distance.
  /// The caller formats it, because only the caller knows the unit and the
  /// locale.
  const TpStatCard.text({
    required this.label,
    required String value,
    this.caption,
    this.status,
    this.icon,
    this.onTap,
    super.key,
  })  : _count = null,
        _text = value,
        _isUnavailable = false;

  /// Nothing was measured.
  ///
  /// [caption] should say WHY when that is known - "no meter readings", "not
  /// set up for this site" - because "Unavailable" on its own invites somebody
  /// to report a bug against working software.
  const TpStatCard.unavailable({
    required this.label,
    this.caption,
    this.icon,
    this.onTap,
    super.key,
  })  : _count = null,
        _text = null,
        _isUnavailable = true,
        status = TpStatus.unknown;

  final String label;

  /// A short line under the value.
  final String? caption;

  /// Tints the value. Null leaves it in ordinary ink.
  final TpStatus? status;

  final IconData? icon;
  final VoidCallback? onTap;

  final int? _count;
  final String? _text;
  final bool _isUnavailable;

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final TpPalette palette = TpPalette.of(context);
    final TextTheme text = Theme.of(context).textTheme;

    final TpStatus tone = status ?? TpStatus.neutral;
    final Color valueColor = _isUnavailable
        ? palette.unknown.onSoft
        : (status == null ? palette.text : palette.forStatus(tone).onSoft);

    final String displayValue = _isUnavailable
        ? l10n.valueNotMeasured
        : (_count?.toString() ?? _text ?? l10n.valueNotMeasured);

    final String? displayCaption =
        _isUnavailable ? (caption ?? l10n.valueUnavailable) : caption;

    return TpCard(
      key: _isUnavailable ? TpStatCardKeys.unavailable : TpStatCardKeys.value,
      onTap: onTap,
      isDashed: _isUnavailable,
      padding: const EdgeInsets.all(TpSpace.lg),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisSize: MainAxisSize.min,
        children: <Widget>[
          Row(
            children: <Widget>[
              if (icon != null) ...<Widget>[
                Icon(icon, size: TpSizing.iconSm, color: palette.textMuted),
                const SizedBox(width: TpSpace.xs),
              ],
              Expanded(
                child: Text(
                  label,
                  style: text.labelMedium,
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                ),
              ),
            ],
          ),
          const SizedBox(height: TpSpace.sm),
          Text(
            displayValue,
            style: text.headlineMedium?.copyWith(color: valueColor),
          ),
          if (displayCaption != null) ...<Widget>[
            const SizedBox(height: TpSpace.xs),
            Text(
              displayCaption,
              style: text.labelSmall,
              maxLines: 2,
              overflow: TextOverflow.ellipsis,
            ),
          ],
        ],
      ),
    );
  }
}
