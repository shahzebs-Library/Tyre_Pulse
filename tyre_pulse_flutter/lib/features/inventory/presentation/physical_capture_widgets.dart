/// The building blocks of the physical inventory capture view, laid out to
/// the owner-approved phone mockup: a connection pill, the location bar, the
/// matched-item card, a big quantity stepper, a condition chip grid and the
/// labelled photo-evidence slots.
///
/// Colour comes only from [TpPalette]: `primary` is the safety yellow on the
/// night-shift (dark) theme and fleet green on daylight, so the mockup's
/// yellow accent appears where the mockup shows it without a second palette.
library;

import 'dart:async';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:tyre_pulse/app/theme/tp_colors.dart';
import 'package:tyre_pulse/app/theme/tp_spacing.dart';
import 'package:tyre_pulse/features/inventory/domain/physical_capture.dart';
import 'package:tyre_pulse/features/inventory/presentation/inventory_copy.dart';
import 'package:tyre_pulse/features/inventory/presentation/inventory_widgets.dart';

/// Online / offline / "n waiting to send". Pending work always wins: a phone
/// that is online but still holding captures must not read as all clear.
class PiConnectionPill extends StatelessWidget {
  const PiConnectionPill({
    required this.online,
    required this.pending,
    required this.copy,
    this.onTap,
    super.key,
  });

  /// Null while the first connectivity check has not answered.
  final bool? online;
  final int pending;
  final InventoryCopy copy;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final TpPalette p = TpPalette.of(context);
    final (TpStatusColors c, IconData icon, String text) = pending > 0
        ? (
            p.warning,
            Icons.cloud_upload_outlined,
            copy.count('pi_pendingN', pending),
          )
        : online == false
            ? (p.neutral, Icons.cloud_off_outlined, copy('pi_offline'))
            : (p.ok, Icons.circle, copy('pi_online'));
    return Material(
      color: c.soft,
      shape: const StadiumBorder(),
      child: InkWell(
        customBorder: const StadiumBorder(),
        onTap: onTap,
        child: ConstrainedBox(
          constraints: const BoxConstraints(minHeight: TpSizing.minTouchTarget),
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: TpSpace.md),
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: <Widget>[
                Icon(
                  icon,
                  size: icon == Icons.circle ? 10 : TpSizing.iconSm,
                  color: c.base,
                ),
                const SizedBox(width: TpSpace.xs),
                Flexible(
                  child: Text(
                    text,
                    style: TextStyle(
                      color: c.onSoft,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

/// The accent-outlined "Store · Bin" bar. Tapping it opens the bin picker.
class PiLocationBar extends StatelessWidget {
  const PiLocationBar({
    required this.parts,
    required this.placeholder,
    required this.semanticLabel,
    required this.onTap,
    super.key,
  });

  /// Store, bin and hint, already in reading order. Blank parts are skipped.
  final List<String?> parts;

  /// Shown after the store when no bin is chosen yet.
  final String placeholder;
  final String semanticLabel;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final TpPalette p = TpPalette.of(context);
    final List<String> shown = <String>[
      for (final String? s in parts)
        if (s != null && s.trim().isNotEmpty) s.trim(),
    ];
    return Semantics(
      button: true,
      label: semanticLabel,
      child: Material(
        color: p.surface,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(TpRadius.md),
          side: BorderSide(color: p.primary, width: TpBorderWidth.strong),
        ),
        child: InkWell(
          borderRadius: BorderRadius.circular(TpRadius.md),
          onTap: onTap,
          child: ConstrainedBox(
            constraints: const BoxConstraints(minHeight: 56),
            child: Padding(
              padding: const EdgeInsets.symmetric(
                horizontal: TpSpace.md,
                vertical: TpSpace.sm,
              ),
              child: Row(
                children: <Widget>[
                  Icon(Icons.location_on_outlined, color: p.primary),
                  const SizedBox(width: TpSpace.sm),
                  Expanded(
                    child: Text.rich(
                      TextSpan(
                        children: <InlineSpan>[
                          TextSpan(
                            text: shown.join(' · '),
                            style: TextStyle(
                              color: p.text,
                              fontWeight: FontWeight.w700,
                            ),
                          ),
                          if (shown.length < 2)
                            TextSpan(
                              text: '${shown.isEmpty ? '' : ' · '}'
                                  '$placeholder',
                              style: TextStyle(color: p.textMuted),
                            ),
                        ],
                      ),
                      maxLines: 3,
                      overflow: TextOverflow.ellipsis,
                    ),
                  ),
                  Icon(Icons.unfold_more_rounded, color: p.textMuted),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}

/// "Genuine OEM" (accent) or "Aftermarket" (green) or "Not verified".
class PiClassificationBadge extends StatelessWidget {
  const PiClassificationBadge({
    required this.classification,
    required this.copy,
    super.key,
  });

  final String classification;
  final InventoryCopy copy;

  @override
  Widget build(BuildContext context) {
    final TpPalette p = TpPalette.of(context);
    final (Color bg, Color fg, String text) = switch (classification) {
      'genuine' => (p.primary, p.onPrimary, copy('pi_clsPick_genuine')),
      'oes' => (p.primary, p.onPrimary, copy.label('pi_cls_', 'oes')),
      'aftermarket' => (p.ok.base, p.ok.onBase, copy('pi_clsPick_aftermarket')),
      _ => (p.unknown.soft, p.unknown.onSoft, copy.label('pi_cls_', 'unknown')),
    };
    return DecoratedBox(
      decoration: BoxDecoration(
        color: bg,
        borderRadius: BorderRadius.circular(TpRadius.pill),
      ),
      child: Padding(
        padding: const EdgeInsets.symmetric(
          horizontal: TpSpace.sm,
          vertical: TpSpace.xs,
        ),
        child: Text(
          text,
          style: TextStyle(
            color: fg,
            fontWeight: FontWeight.w700,
            fontSize: 12,
          ),
        ),
      ),
    );
  }
}

/// The matched material: image placeholder (the catalog carries no product
/// photo, so none is invented), its name, the classification badge and a
/// clear action.
class PiMatchedItemCard extends StatelessWidget {
  const PiMatchedItemCard({
    required this.pick,
    required this.copy,
    required this.onClear,
    super.key,
  });

  final MaterialPick pick;
  final InventoryCopy copy;
  final VoidCallback onClear;

  @override
  Widget build(BuildContext context) {
    final TpPalette p = TpPalette.of(context);
    return Material(
      color: p.surfaceAlt,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(TpRadius.lg),
        side: BorderSide(color: p.border),
      ),
      child: Padding(
        padding: const EdgeInsets.all(TpSpace.md),
        child: Row(
          children: <Widget>[
            Container(
              width: 56,
              height: 56,
              decoration: BoxDecoration(
                color: p.surfaceSunken,
                borderRadius: BorderRadius.circular(TpRadius.md),
              ),
              child: Icon(Icons.inventory_2_outlined, color: p.textMuted),
            ),
            const SizedBox(width: TpSpace.md),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: <Widget>[
                  Text(
                    pick.label,
                    style: TextStyle(
                      color: p.text,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                  const SizedBox(height: TpSpace.xs),
                  PiClassificationBadge(
                    classification: pick.classification ?? 'unknown',
                    copy: copy,
                  ),
                ],
              ),
            ),
            SizedBox(
              width: TpSizing.minTouchTarget,
              height: TpSizing.minTouchTarget,
              child: IconButton(
                key: const Key('pi.picked.clear'),
                tooltip: copy('pi_change'),
                icon: const Icon(Icons.close),
                onPressed: onClear,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// A field label with the required marker drawn only for truly required
/// fields (a false asterisk would block nothing and mislead).
class PiFieldLabel extends StatelessWidget {
  const PiFieldLabel(this.text, {this.required = false, super.key});

  final String text;
  final bool required;

  @override
  Widget build(BuildContext context) {
    final TpPalette p = TpPalette.of(context);
    return Padding(
      padding: const EdgeInsets.only(bottom: TpSpace.sm),
      child: Text.rich(
        TextSpan(
          text: text,
          style: TextStyle(color: p.textSecondary, fontWeight: FontWeight.w600),
          children: <InlineSpan>[
            if (required)
              TextSpan(
                text: ' *',
                style: TextStyle(color: p.critical.base),
              ),
          ],
        ),
      ),
    );
  }
}

/// Big accent minus / plus with the quantity field between. A long press
/// steps by 10. Never goes below zero; zero is a real count.
class PiQtyStepper extends StatelessWidget {
  const PiQtyStepper({
    required this.controller,
    required this.copy,
    required this.onChanged,
    super.key,
  });

  final TextEditingController controller;
  final InventoryCopy copy;

  /// Called after the stepper or the keyboard changed the value.
  final VoidCallback onChanged;

  static String format(num v) => v == v.roundToDouble() ? '${v.toInt()}' : '$v';

  void _bump(num delta) {
    final num next = (parseQty(controller.text) ?? 0) + delta;
    unawaited(HapticFeedback.selectionClick());
    controller.text = format(next < 0 ? 0 : next);
    onChanged();
  }

  Widget _button(
    BuildContext context,
    IconData icon,
    num delta,
    String key,
    String tooltip,
  ) {
    final TpPalette p = TpPalette.of(context);
    return SizedBox(
      width: inventoryTouchTarget,
      height: inventoryTouchTarget,
      child: Tooltip(
        message: tooltip,
        child: Material(
          color: p.primary,
          borderRadius: BorderRadius.circular(TpRadius.md),
          child: InkWell(
            key: Key(key),
            borderRadius: BorderRadius.circular(TpRadius.md),
            onTap: () => _bump(delta),
            onLongPress: () => _bump(delta * 10),
            child: Icon(icon, color: p.onPrimary, size: 28),
          ),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Row(
      children: <Widget>[
        _button(
          context,
          Icons.remove_rounded,
          -1,
          'pi.qty.minus',
          copy('pi_qtyMinus'),
        ),
        const SizedBox(width: TpSpace.sm),
        Expanded(
          child: TextField(
            key: const Key('pi.qty'),
            controller: controller,
            onChanged: (_) => onChanged(),
            textAlign: TextAlign.center,
            style: Theme.of(context).textTheme.headlineSmall,
            keyboardType: const TextInputType.numberWithOptions(decimal: true),
            decoration: InputDecoration(
              hintText: '0',
              semanticCounterText: copy('pi_qty'),
            ),
          ),
        ),
        const SizedBox(width: TpSpace.sm),
        _button(
          context,
          Icons.add_rounded,
          1,
          'pi.qty.plus',
          copy('pi_qtyPlus'),
        ),
      ],
    );
  }
}

/// Condition as a chip grid; the selected chip is filled with the accent and
/// carries a check.
class PiChoiceChips extends StatelessWidget {
  const PiChoiceChips({
    required this.values,
    required this.selected,
    required this.labelOf,
    required this.onSelected,
    this.keyPrefix = 'pi.cond.',
    super.key,
  });

  final List<String> values;
  final String selected;
  final String Function(String value) labelOf;
  final ValueChanged<String> onSelected;
  final String keyPrefix;

  @override
  Widget build(BuildContext context) {
    final TpPalette p = TpPalette.of(context);
    return Wrap(
      spacing: TpSpace.sm,
      runSpacing: TpSpace.sm,
      children: <Widget>[
        for (final String v in values)
          Semantics(
            selected: v == selected,
            button: true,
            child: Material(
              key: Key('$keyPrefix$v'),
              color: v == selected ? p.primary : p.surface,
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(TpRadius.md),
                side: BorderSide(
                  color: v == selected ? p.primary : p.controlBorder,
                ),
              ),
              child: InkWell(
                borderRadius: BorderRadius.circular(TpRadius.md),
                onTap: () => onSelected(v),
                child: ConstrainedBox(
                  constraints: const BoxConstraints(
                    minHeight: TpSizing.minTouchTarget,
                    minWidth: 88,
                  ),
                  child: Padding(
                    padding: const EdgeInsets.symmetric(
                      horizontal: TpSpace.md,
                      vertical: TpSpace.sm,
                    ),
                    child: Row(
                      mainAxisSize: MainAxisSize.min,
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: <Widget>[
                        if (v == selected) ...<Widget>[
                          Icon(Icons.check, size: 18, color: p.onPrimary),
                          const SizedBox(width: TpSpace.xs),
                        ],
                        Flexible(
                          child: Text(
                            labelOf(v),
                            style: TextStyle(
                              color: v == selected ? p.onPrimary : p.text,
                              fontWeight: FontWeight.w600,
                            ),
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
              ),
            ),
          ),
      ],
    );
  }
}

/// One labelled photo-evidence slot: empty shows a camera tile, filled shows
/// the thumbnail with a remove button.
class PiPhotoSlot extends StatelessWidget {
  const PiPhotoSlot({
    required this.role,
    required this.label,
    required this.path,
    required this.removeLabel,
    required this.onCapture,
    required this.onRemove,
    super.key,
  });

  final String role;
  final String label;
  final String? path;
  final String removeLabel;
  final VoidCallback? onCapture;
  final VoidCallback onRemove;

  @override
  Widget build(BuildContext context) {
    final TpPalette p = TpPalette.of(context);
    final String? file = path;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: <Widget>[
        AspectRatio(
          aspectRatio: 1,
          child: Stack(
            fit: StackFit.expand,
            children: <Widget>[
              Material(
                color: p.surfaceAlt,
                clipBehavior: Clip.antiAlias,
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(TpRadius.md),
                  side: BorderSide(
                    color: file == null ? p.controlBorder : p.primary,
                  ),
                ),
                child: InkWell(
                  key: Key('pi.photo.$role'),
                  onTap: file == null ? onCapture : null,
                  child: file == null
                      ? Center(
                          child: Icon(
                            Icons.add_a_photo_outlined,
                            color: p.primary,
                            size: 28,
                          ),
                        )
                      : Image.file(
                          File(file),
                          fit: BoxFit.cover,
                          cacheWidth: 300,
                          errorBuilder: (_, __, ___) => Icon(
                            Icons.image_outlined,
                            color: p.textMuted,
                          ),
                        ),
                ),
              ),
              if (file != null)
                PositionedDirectional(
                  top: 0,
                  end: 0,
                  child: SizedBox(
                    width: TpSizing.minTouchTarget,
                    height: TpSizing.minTouchTarget,
                    child: IconButton(
                      key: Key('pi.photo.$role.remove'),
                      tooltip: removeLabel,
                      style: IconButton.styleFrom(
                        backgroundColor: p.overlay,
                        foregroundColor: p.textInverse,
                      ),
                      icon: const Icon(Icons.close, size: 18),
                      onPressed: onRemove,
                    ),
                  ),
                ),
            ],
          ),
        ),
        const SizedBox(height: TpSpace.xs),
        Text(
          label,
          textAlign: TextAlign.center,
          style: TextStyle(color: p.textSecondary, fontSize: 12),
        ),
      ],
    );
  }
}
