/// The search field.
///
/// Owns a controller when the caller does not supply one, and DISPOSES only the
/// one it created. Disposing a controller the caller owns is how a search box
/// starts throwing "used after being disposed" on the second visit to a screen.
/// Spec section 55 lists controller disposal as a device-support requirement,
/// not a tidiness one.
///
/// DEBOUNCING IS NOT DONE HERE. It belongs to the caller, because only the
/// caller knows whether its query hits the local database (cheap, no debounce
/// needed) or the network (expensive). The production web application shipped a
/// grid that issued one query PER KEYSTROKE against eleven thousand rows; the
/// fix was at the call site.
library;

import 'package:flutter/material.dart';
import 'package:tyre_pulse/app/localization/tp_localizations.dart';
import 'package:tyre_pulse/app/theme/tp_colors.dart';
import 'package:tyre_pulse/app/theme/tp_spacing.dart';

class TpSearchField extends StatefulWidget {
  const TpSearchField({
    this.controller,
    this.hint,
    this.onChanged,
    this.onSubmitted,
    this.autofocus = false,
    this.enabled = true,
    super.key,
  });

  final TextEditingController? controller;
  final String? hint;
  final ValueChanged<String>? onChanged;
  final ValueChanged<String>? onSubmitted;
  final bool autofocus;
  final bool enabled;

  @override
  State<TpSearchField> createState() => _TpSearchFieldState();
}

class _TpSearchFieldState extends State<TpSearchField> {
  TextEditingController? _owned;

  TextEditingController get _controller {
    final TextEditingController? provided = widget.controller;
    if (provided != null) return provided;
    return _owned ??= TextEditingController();
  }

  @override
  void dispose() {
    _owned?.dispose();
    super.dispose();
  }

  void _handleChanged(String value) {
    // Rebuild so the clear button appears or disappears. Cheap: this widget
    // has no children beyond the field itself.
    setState(() {});
    widget.onChanged?.call(value);
  }

  void _clear() {
    _controller.clear();
    setState(() {});
    widget.onChanged?.call('');
  }

  @override
  Widget build(BuildContext context) {
    final TpPalette palette = TpPalette.of(context);
    final AppLocalizations l10n = AppLocalizations.of(context);
    final bool hasText = _controller.text.isNotEmpty;

    return TextField(
      controller: _controller,
      enabled: widget.enabled,
      autofocus: widget.autofocus,
      textInputAction: TextInputAction.search,
      onChanged: _handleChanged,
      onSubmitted: widget.onSubmitted,
      style: Theme.of(context).textTheme.bodyLarge,
      decoration: InputDecoration(
        hintText: widget.hint ?? l10n.searchHint,
        filled: true,
        fillColor: palette.surface,
        prefixIcon: const Icon(Icons.search, size: TpSizing.iconMd),
        suffixIcon: hasText
            ? IconButton(
                icon: const Icon(Icons.close, size: TpSizing.iconMd),
                tooltip: l10n.actionClear,
                onPressed: _clear,
              )
            : null,
        contentPadding: const EdgeInsets.symmetric(
          horizontal: TpSpace.lg,
          vertical: TpSpace.md,
        ),
        enabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(TpRadius.md),
          borderSide: BorderSide(
            color: palette.borderStrong,
            width: TpBorderWidth.hairline,
          ),
        ),
        focusedBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(TpRadius.md),
          borderSide: BorderSide(
            color: palette.focus,
            width: TpBorderWidth.strong,
          ),
        ),
        disabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(TpRadius.md),
          borderSide: BorderSide(
            color: palette.border,
            width: TpBorderWidth.hairline,
          ),
        ),
      ),
    );
  }
}
