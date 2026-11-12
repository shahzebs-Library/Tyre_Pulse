/// Small shared presentation helpers for the handover screens.
library;

import 'package:flutter/material.dart';
import 'package:tyre_pulse/app/localization/tp_localizations.dart';
import 'package:tyre_pulse/app/theme/tp_colors.dart';
import 'package:tyre_pulse/app/theme/tp_spacing.dart';
import 'package:tyre_pulse/core/design_system/design_system.dart';
import 'package:tyre_pulse/core/errors/app_error.dart';
import 'package:tyre_pulse/core/network/supabase_error_mapper.dart';

/// A single-button acknowledgement dialog, styled like `TpDialog.confirm`.
/// There is no shared design-system primitive for a pure info message, so the
/// styling constants are matched here rather than duplicated with a drifting
/// set - the same approach the inspection approval screen takes.
Future<void> showHandoverInfoDialog(
  BuildContext context, {
  required String title,
  required String message,
}) {
  final AppLocalizations l10n = AppLocalizations.of(context);
  final TpPalette palette = TpPalette.of(context);
  return showDialog<void>(
    context: context,
    barrierColor: palette.overlay,
    builder: (BuildContext dialogContext) {
      return AlertDialog(
        backgroundColor: palette.surface,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(TpRadius.lg),
        ),
        title: Text(title, style: Theme.of(dialogContext).textTheme.titleLarge),
        content:
            Text(message, style: Theme.of(dialogContext).textTheme.bodyMedium),
        actionsPadding: const EdgeInsets.fromLTRB(
          TpSpace.lg,
          0,
          TpSpace.lg,
          TpSpace.lg,
        ),
        actions: <Widget>[
          TpButton.primary(
            label: l10n.actionClose,
            onPressed: () => Navigator.of(dialogContext).pop(),
          ),
        ],
      );
    },
  );
}

/// Any [AppError]/[SupabaseFailure] already carries a user-safe message;
/// anything else falls back to [fallbackMessage] rather than a raw driver
/// message.
AppError handoverAsAppError(Object error, String fallbackMessage) {
  if (error is AppError) return error;
  if (error is SupabaseFailure) return error.error;
  return AppError(
    kind: AppErrorKind.unknown,
    message: fallbackMessage,
    technical: error.toString(),
    cause: error,
    isRetryable: true,
  );
}

/// `YYYY-MM-DD HH:mm` in the device's local time zone, numeric rather than
/// locale month names (mirrors the inspection screens' own choice).
String? formatHandoverDateTime(Object? value) {
  final DateTime? parsed = switch (value) {
    final DateTime d => d,
    final String s when s.isNotEmpty => DateTime.tryParse(s),
    _ => null,
  };
  if (parsed == null) return null;
  final DateTime local = parsed.toLocal();
  String two(int v) => v.toString().padLeft(2, '0');
  return '${local.year.toString().padLeft(4, '0')}-${two(local.month)}-'
      '${two(local.day)} ${two(local.hour)}:${two(local.minute)}';
}
