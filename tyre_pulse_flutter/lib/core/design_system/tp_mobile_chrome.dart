/// Shared building blocks for the approved Tyre Pulse mobile screen family.
///
/// These widgets own the repeated brand lockup, sync state, outlined action
/// row and two-button action rail visible throughout the field and fleet
/// flows. Features pass real labels and callbacks; no control rendered here
/// can be a dead press.
library;

import 'package:flutter/material.dart';
import 'package:tyre_pulse/app/theme/tp_colors.dart';
import 'package:tyre_pulse/app/theme/tp_spacing.dart';
import 'package:tyre_pulse/core/design_system/tp_button.dart';

class TpBrandLockup extends StatelessWidget {
  const TpBrandLockup({this.compact = false, super.key});

  final bool compact;

  @override
  Widget build(BuildContext context) {
    final TpPalette palette = TpPalette.of(context);
    return Semantics(
      label: 'Tyre Pulse',
      image: true,
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: <Widget>[
          Image.asset(
            'assets/login/figma_brand_pulse.png',
            width: compact ? 42 : 48,
            height: compact ? 24 : 28,
            fit: BoxFit.contain,
            excludeFromSemantics: true,
          ),
          const SizedBox(width: 5),
          Text(
            'TYRE\nPULSE',
            style: TextStyle(
              color: palette.text,
              fontSize: compact ? 13 : 15,
              height: .84,
              fontWeight: FontWeight.w900,
              letterSpacing: .8,
            ),
          ),
        ],
      ),
    );
  }
}

class TpSyncLabel extends StatelessWidget {
  const TpSyncLabel({required this.label, this.isPending = false, super.key});

  final String label;
  final bool isPending;

  @override
  Widget build(BuildContext context) {
    final TpPalette palette = TpPalette.of(context);
    final TpStatusColors tone = palette.forStatus(
      isPending ? TpStatus.warning : TpStatus.ok,
    );
    return Semantics(
      label: label,
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: <Widget>[
          Icon(
            isPending ? Icons.cloud_upload_outlined : Icons.cloud_done_outlined,
            size: TpSizing.iconLg,
            color: tone.base,
          ),
          const SizedBox(width: TpSpace.xs),
          Text(
            label,
            style: Theme.of(context).textTheme.labelLarge?.copyWith(
                  color: tone.base,
                ),
          ),
        ],
      ),
    );
  }
}

class TpActionRow extends StatelessWidget {
  const TpActionRow({
    required this.label,
    this.value,
    this.icon,
    this.trailing,
    this.onTap,
    this.tone,
    this.showDivider = true,
    super.key,
  });

  final String label;
  final String? value;
  final IconData? icon;
  final Widget? trailing;
  final VoidCallback? onTap;
  final TpStatus? tone;
  final bool showDivider;

  @override
  Widget build(BuildContext context) {
    final TpPalette palette = TpPalette.of(context);
    final Color ink =
        tone == null ? palette.text : palette.forStatus(tone!).base;
    final Widget row = Container(
      constraints: const BoxConstraints(minHeight: TpSizing.minTouchTarget),
      padding: const EdgeInsets.symmetric(
        horizontal: TpSpace.md,
        vertical: TpSpace.sm,
      ),
      decoration: BoxDecoration(
        border: showDivider
            ? Border(bottom: BorderSide(color: palette.border))
            : null,
      ),
      child: Row(
        children: <Widget>[
          if (icon != null) ...<Widget>[
            Icon(icon, size: TpSizing.iconMd, color: ink),
            const SizedBox(width: TpSpace.sm),
          ],
          Expanded(
            child: Text(
              label,
              maxLines: 2,
              overflow: TextOverflow.ellipsis,
              style: Theme.of(context).textTheme.bodyLarge?.copyWith(
                    color: ink,
                  ),
            ),
          ),
          if (value != null) ...<Widget>[
            const SizedBox(width: TpSpace.sm),
            Flexible(
              child: Text(
                value!,
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
                textAlign: TextAlign.end,
                style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                      color: ink,
                    ),
              ),
            ),
          ],
          if (trailing != null) ...<Widget>[
            const SizedBox(width: TpSpace.sm),
            trailing!,
          ] else if (onTap != null) ...<Widget>[
            const SizedBox(width: TpSpace.xs),
            Icon(
              Directionality.of(context) == TextDirection.rtl
                  ? Icons.chevron_left_rounded
                  : Icons.chevron_right_rounded,
              color: palette.text,
            ),
          ],
        ],
      ),
    );
    if (onTap == null) return row;
    return Semantics(
      button: true,
      child: InkWell(onTap: onTap, child: row),
    );
  }
}

class TpBottomActionRail extends StatelessWidget {
  const TpBottomActionRail({
    required this.secondaryLabel,
    required this.primaryLabel,
    required this.onSecondary,
    required this.onPrimary,
    this.secondaryIcon,
    this.primaryIcon,
    this.primaryBusy = false,
    this.secondaryKey,
    this.primaryKey,
    super.key,
  });

  final String secondaryLabel;
  final String primaryLabel;
  final VoidCallback? onSecondary;
  final VoidCallback? onPrimary;
  final IconData? secondaryIcon;
  final IconData? primaryIcon;
  final bool primaryBusy;
  final Key? secondaryKey;
  final Key? primaryKey;

  @override
  Widget build(BuildContext context) {
    final TpPalette palette = TpPalette.of(context);
    return SafeArea(
      top: false,
      child: Container(
        padding: const EdgeInsets.fromLTRB(
          TpSpace.lg,
          TpSpace.sm,
          TpSpace.lg,
          TpSpace.sm,
        ),
        decoration: BoxDecoration(
          color: palette.surface,
          border: Border(top: BorderSide(color: palette.border)),
        ),
        child: Row(
          children: <Widget>[
            Expanded(
              child: TpButton.secondary(
                key: secondaryKey,
                label: secondaryLabel,
                icon: secondaryIcon,
                onPressed: onSecondary,
              ),
            ),
            const SizedBox(width: TpSpace.md),
            Expanded(
              child: TpButton.primary(
                key: primaryKey,
                label: primaryLabel,
                icon: primaryIcon,
                isBusy: primaryBusy,
                onPressed: onPrimary,
              ),
            ),
          ],
        ),
      ),
    );
  }
}
