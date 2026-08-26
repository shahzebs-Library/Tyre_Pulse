/// Text entry.
///
/// The label sits ABOVE the field rather than floating inside it. Two reasons,
/// both field reasons: a floating label is small and low contrast at the moment
/// it matters most, and a label that moves when focus arrives is one more thing
/// to read in the sun. It also keeps the label readable under a right-to-left
/// locale without any special handling.
library;

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:tyre_pulse/app/localization/tp_localizations.dart';
import 'package:tyre_pulse/app/theme/tp_colors.dart';
import 'package:tyre_pulse/app/theme/tp_spacing.dart';

/// A labelled text field.
class TpInput extends StatelessWidget {
  const TpInput({
    required this.label,
    this.controller,
    this.hint,
    this.errorText,
    this.helperText,
    this.isRequired = false,
    this.enabled = true,
    this.obscureText = false,
    this.maxLines = 1,
    this.maxLength,
    this.keyboardType,
    this.textInputAction,
    this.textCapitalization = TextCapitalization.none,
    this.inputFormatters,
    this.prefixIcon,
    this.suffix,
    this.autofocus = false,
    this.onChanged,
    this.onSubmitted,
    super.key,
  });

  final String label;
  final TextEditingController? controller;
  final String? hint;

  /// Non-null puts the field into its error appearance and shows the message.
  final String? errorText;

  final String? helperText;
  final bool isRequired;
  final bool enabled;
  final bool obscureText;
  final int maxLines;
  final int? maxLength;
  final TextInputType? keyboardType;
  final TextInputAction? textInputAction;
  final TextCapitalization textCapitalization;
  final List<TextInputFormatter>? inputFormatters;
  final IconData? prefixIcon;
  final Widget? suffix;
  final bool autofocus;
  final ValueChanged<String>? onChanged;
  final ValueChanged<String>? onSubmitted;

  @override
  Widget build(BuildContext context) {
    final TpPalette palette = TpPalette.of(context);
    final AppLocalizations l10n = AppLocalizations.of(context);
    final TextTheme text = Theme.of(context).textTheme;
    final bool hasError = errorText != null;

    OutlineInputBorder borderWith(Color color, double width) {
      return OutlineInputBorder(
        borderRadius: BorderRadius.circular(TpRadius.md),
        borderSide: BorderSide(color: color, width: width),
      );
    }

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      mainAxisSize: MainAxisSize.min,
      children: <Widget>[
        Row(
          children: <Widget>[
            Flexible(child: Text(label, style: text.labelMedium)),
            if (isRequired) ...<Widget>[
              const SizedBox(width: TpSpace.xs),
              Text(
                l10n.fieldRequired,
                style: text.labelSmall?.copyWith(color: palette.critical.base),
              ),
            ],
          ],
        ),
        const SizedBox(height: TpSpace.xs),
        TextField(
          controller: controller,
          enabled: enabled,
          obscureText: obscureText,
          maxLines: obscureText ? 1 : maxLines,
          maxLength: maxLength,
          keyboardType: keyboardType,
          textInputAction: textInputAction,
          textCapitalization: textCapitalization,
          inputFormatters: inputFormatters,
          autofocus: autofocus,
          onChanged: onChanged,
          onSubmitted: onSubmitted,
          style: text.bodyLarge,
          decoration: InputDecoration(
            hintText: hint,
            errorText: errorText,
            helperText: helperText,
            filled: true,
            fillColor: enabled ? palette.surface : palette.surfaceAlt,
            prefixIcon: prefixIcon == null
                ? null
                : Icon(prefixIcon, size: TpSizing.iconMd),
            suffixIcon: suffix,
            contentPadding: const EdgeInsets.symmetric(
              horizontal: TpSpace.lg,
              vertical: TpSpace.md,
            ),
            enabledBorder: borderWith(
              hasError ? palette.critical.base : palette.borderStrong,
              TpBorderWidth.hairline,
            ),
            focusedBorder: borderWith(palette.focus, TpBorderWidth.strong),
            errorBorder: borderWith(
              palette.critical.base,
              TpBorderWidth.hairline,
            ),
            focusedErrorBorder: borderWith(
              palette.critical.base,
              TpBorderWidth.strong,
            ),
            disabledBorder: borderWith(palette.border, TpBorderWidth.hairline),
          ),
        ),
      ],
    );
  }
}
