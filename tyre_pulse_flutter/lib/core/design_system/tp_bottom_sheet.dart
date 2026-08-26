/// Bottom sheets and dialogs.
///
/// Both are RETURNED as futures, never fired and forgotten. `unawaited_futures`
/// is an analyser ERROR in this project (spec section 57), which means a caller
/// has to decide what to do with the answer instead of losing it.
library;

import 'package:flutter/material.dart';
import 'package:tyre_pulse/app/localization/tp_localizations.dart';
import 'package:tyre_pulse/app/theme/tp_colors.dart';
import 'package:tyre_pulse/app/theme/tp_spacing.dart';
import 'package:tyre_pulse/core/design_system/tp_button.dart';

/// A modal sheet.
///
/// Deliberately NOT a route. Artifact 03 section 7.10: promoting an in-page
/// modal to a route changes what Back means on the screen underneath it, and
/// the production suite pins one of these as a modal for exactly that reason -
/// "if it ever starts navigating on close it will pop a screen the user never
/// pushed".
abstract final class TpBottomSheet {
  static Future<T?> show<T>({
    required BuildContext context,
    required WidgetBuilder builder,
    String? title,
    bool isDismissible = true,
    bool isScrollControlled = true,
  }) {
    final TpPalette palette = TpPalette.of(context);

    return showModalBottomSheet<T>(
      context: context,
      isDismissible: isDismissible,
      enableDrag: isDismissible,
      isScrollControlled: isScrollControlled,
      backgroundColor: palette.surface,
      barrierColor: palette.overlay,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(
          top: Radius.circular(TpRadius.xl),
        ),
      ),
      builder: (BuildContext sheetContext) {
        return SafeArea(
          child: Padding(
            padding: EdgeInsets.only(
              bottom: MediaQuery.viewInsetsOf(sheetContext).bottom,
            ),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: <Widget>[
                const SizedBox(height: TpSpace.md),
                Center(
                  child: SizedBox(
                    width: 40,
                    height: 4,
                    child: DecoratedBox(
                      decoration: BoxDecoration(
                        color: palette.borderStrong,
                        borderRadius: BorderRadius.circular(TpRadius.pill),
                      ),
                    ),
                  ),
                ),
                if (title != null) ...<Widget>[
                  const SizedBox(height: TpSpace.lg),
                  Padding(
                    padding: const EdgeInsets.symmetric(
                      horizontal: TpSpace.xl,
                    ),
                    child: Text(
                      title,
                      style: Theme.of(sheetContext).textTheme.titleLarge,
                    ),
                  ),
                ],
                const SizedBox(height: TpSpace.lg),
                Flexible(child: builder(sheetContext)),
                const SizedBox(height: TpSpace.lg),
              ],
            ),
          ),
        );
      },
    );
  }
}

/// Modal dialogs.
abstract final class TpDialog {
  /// Asks a yes or no question.
  ///
  /// Resolves to false when the dialog is dismissed without a choice, so a
  /// caller can never read a dismissal as consent.
  static Future<bool> confirm({
    required BuildContext context,
    required String title,
    required String message,
    String? confirmLabel,
    String? cancelLabel,
    bool isDestructive = false,
  }) async {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final TpPalette palette = TpPalette.of(context);

    final bool? answer = await showDialog<bool>(
      context: context,
      barrierColor: palette.overlay,
      builder: (BuildContext dialogContext) {
        return AlertDialog(
          backgroundColor: palette.surface,
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(TpRadius.lg),
          ),
          title: Text(
            title,
            style: Theme.of(dialogContext).textTheme.titleLarge,
          ),
          content: Text(
            message,
            style: Theme.of(dialogContext).textTheme.bodyMedium,
          ),
          actionsPadding: const EdgeInsets.fromLTRB(
            TpSpace.lg,
            0,
            TpSpace.lg,
            TpSpace.lg,
          ),
          actions: <Widget>[
            TpButton.text(
              label: cancelLabel ?? l10n.actionCancel,
              onPressed: () => Navigator.of(dialogContext).pop(false),
            ),
            if (isDestructive)
              TpButton.danger(
                label: confirmLabel ?? l10n.actionClose,
                onPressed: () => Navigator.of(dialogContext).pop(true),
              )
            else
              TpButton.primary(
                label: confirmLabel ?? l10n.actionClose,
                onPressed: () => Navigator.of(dialogContext).pop(true),
              ),
          ],
        );
      },
    );

    return answer ?? false;
  }
}
