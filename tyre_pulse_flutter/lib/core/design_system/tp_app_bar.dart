/// The application bar.
///
/// The Back control lives here, and it goes through [backTo] like everything
/// else. Repository rule 15 and spec section 5: a Back control can never be a
/// dead press.
///
/// The chevron MIRRORS under a right-to-left locale. Spec section 52 lists the
/// back icon explicitly, and the production `BackButton` already takes `isRTL`
/// and flips the glyph. The direction is read from the ambient locale rather
/// than passed in, so no screen can forget.
library;

import 'package:flutter/material.dart';
import 'package:tyre_pulse/app/localization/tp_direction.dart';
import 'package:tyre_pulse/app/localization/tp_localizations.dart';
import 'package:tyre_pulse/app/router/back_navigation.dart';
import 'package:tyre_pulse/app/router/tp_back.dart';
import 'package:tyre_pulse/app/theme/tp_colors.dart';
import 'package:tyre_pulse/app/theme/tp_spacing.dart';

class TpAppBar extends StatelessWidget implements PreferredSizeWidget {
  const TpAppBar({
    required this.title,
    this.subtitle,
    this.actions,
    this.backFallback,
    this.onBack,
    this.showBack = true,
    this.bottom,
    super.key,
  });

  final String title;

  /// A second line: the asset, the site, the document number.
  final String? subtitle;

  final List<Widget>? actions;

  /// Where Back goes when there is no history to pop.
  ///
  /// Null means Home. Pass the screen's real parent - `TpBackFallbacks` holds
  /// the ported table.
  final String? backFallback;

  /// Overrides Back entirely. Use for a screen that must confirm before
  /// leaving; call [TpBack.pop] yourself once confirmed, so the rule still runs
  /// in exactly one place.
  final VoidCallback? onBack;

  final bool showBack;

  final PreferredSizeWidget? bottom;

  @override
  Size get preferredSize => Size.fromHeight(
        kToolbarHeight +
            (subtitle == null ? 0 : TpSpace.lg) +
            (bottom?.preferredSize.height ?? 0),
      );

  @override
  Widget build(BuildContext context) {
    final TpPalette palette = TpPalette.of(context);
    final AppLocalizations l10n = AppLocalizations.of(context);
    final TextTheme text = Theme.of(context).textTheme;
    final bool isRtl = TpDirection.isRtl(context);

    return AppBar(
      backgroundColor: palette.surface,
      foregroundColor: palette.text,
      surfaceTintColor: Colors.transparent,
      elevation: 0,
      // A hairline rather than a shadow. See TpCard for why.
      shape: Border(
        bottom: BorderSide(
          color: palette.border,
          width: TpBorderWidth.hairline,
        ),
      ),
      automaticallyImplyLeading: false,
      titleSpacing: showBack ? 0 : TpSpace.lg,
      leading: showBack
          ? IconButton(
              // Mirrors under RTL. Flutter does not flip arrow_back for us.
              icon: Icon(
                isRtl
                    ? Icons.arrow_forward_ios_rounded
                    : Icons.arrow_back_ios_new_rounded,
                color: palette.text,
              ),
              tooltip: l10n.actionBack,
              onPressed: onBack ?? () => _defaultBack(context),
            )
          : null,
      title: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisSize: MainAxisSize.min,
        children: <Widget>[
          Text(
            title,
            style: text.titleLarge,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
          ),
          if (subtitle != null)
            Text(
              subtitle!,
              style: text.labelSmall,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
            ),
        ],
      ),
      actions: actions,
      bottom: bottom,
    );
  }

  void _defaultBack(BuildContext context) {
    // The fallback default lives on `backTo` and nowhere else. Naming Home
    // again here would be a second place that decides where Back goes, which
    // is the drift this design system exists to prevent.
    final String? fallback = backFallback;
    if (fallback == null) {
      backTo(TpBack.of(context));
    } else {
      backTo(TpBack.of(context), fallback: fallback);
    }
    // No outcome handling on purpose. `backTo` has already acted, and
    // `unavailable` means there was no router at all - which happens only in a
    // test harness. A Back control that throws is worse than one that reports
    // it could not act.
  }
}
