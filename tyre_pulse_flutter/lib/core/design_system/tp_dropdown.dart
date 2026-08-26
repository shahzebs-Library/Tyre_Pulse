/// A single-choice picker.
///
/// Built on `DropdownButton` rather than `DropdownButtonFormField` on purpose:
/// the form field variant has been renaming its value parameter across Flutter
/// releases, and a design system control should not stop compiling because of
/// a rename in a widget it only wraps.
library;

import 'package:flutter/material.dart';
import 'package:tyre_pulse/app/localization/tp_localizations.dart';
import 'package:tyre_pulse/app/theme/tp_colors.dart';
import 'package:tyre_pulse/app/theme/tp_spacing.dart';

/// One option.
@immutable
class TpDropdownItem<T> {
  const TpDropdownItem({required this.value, required this.label, this.icon});

  final T value;

  /// Already localised by the caller. This widget does not translate values:
  /// most of them are fleet data, not interface text.
  final String label;

  final IconData? icon;
}

/// A labelled dropdown.
class TpDropdown<T> extends StatelessWidget {
  const TpDropdown({
    required this.label,
    required this.value,
    required this.items,
    required this.onChanged,
    this.hint,
    this.errorText,
    this.isRequired = false,
    this.enabled = true,
    super.key,
  });

  final String label;

  /// Null means nothing chosen yet, and the hint is shown.
  final T? value;

  final List<TpDropdownItem<T>> items;

  /// Null disables the control. A dropdown that opens and cannot change
  /// anything is what repository rule 7 forbids.
  final ValueChanged<T?>? onChanged;

  final String? hint;
  final String? errorText;
  final bool isRequired;
  final bool enabled;

  @override
  Widget build(BuildContext context) {
    final TpPalette palette = TpPalette.of(context);
    final AppLocalizations l10n = AppLocalizations.of(context);
    final TextTheme text = Theme.of(context).textTheme;
    final bool hasError = errorText != null;
    final bool isEnabled = enabled && onChanged != null && items.isNotEmpty;

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
        DecoratedBox(
          decoration: BoxDecoration(
            color: isEnabled ? palette.surface : palette.surfaceAlt,
            borderRadius: BorderRadius.circular(TpRadius.md),
            border: Border.all(
              color: hasError ? palette.critical.base : palette.borderStrong,
              width: TpBorderWidth.hairline,
            ),
          ),
          child: ConstrainedBox(
            constraints: const BoxConstraints(
              minHeight: TpSizing.minTouchTarget,
            ),
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: TpSpace.lg),
              child: DropdownButtonHideUnderline(
                child: DropdownButton<T>(
                  value: value,
                  isExpanded: true,
                  onChanged: isEnabled ? onChanged : null,
                  hint: Text(
                    hint ?? l10n.dropdownHint,
                    style: text.bodyLarge?.copyWith(color: palette.textMuted),
                  ),
                  style: text.bodyLarge,
                  iconEnabledColor: palette.textSecondary,
                  dropdownColor: palette.surface,
                  items: items
                      .map(
                        (TpDropdownItem<T> item) => DropdownMenuItem<T>(
                          value: item.value,
                          child: Row(
                            children: <Widget>[
                              if (item.icon != null) ...<Widget>[
                                Icon(item.icon, size: TpSizing.iconMd),
                                const SizedBox(width: TpSpace.sm),
                              ],
                              Expanded(
                                child: Text(
                                  item.label,
                                  maxLines: 1,
                                  overflow: TextOverflow.ellipsis,
                                ),
                              ),
                            ],
                          ),
                        ),
                      )
                      .toList(),
                ),
              ),
            ),
          ),
        ),
        if (hasError) ...<Widget>[
          const SizedBox(height: TpSpace.xs),
          Text(
            errorText!,
            style: text.labelSmall?.copyWith(color: palette.critical.base),
          ),
        ],
      ],
    );
  }
}
