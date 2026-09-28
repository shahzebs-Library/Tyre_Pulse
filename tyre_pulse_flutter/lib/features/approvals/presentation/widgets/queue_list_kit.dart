/// The list vocabulary of the approved mock family (07 home "Today's work",
/// 18 maintenance "Priority work queue", 19 profile), shared by the tab
/// landing lists that have no mock of their own: the inspection and
/// checklist approval queues and the accident register.
///
/// What it draws, and only that:
///
/// * [QueueSectionHeader] - an open, borderless section title with an
///   optional bold green text action (the mock's "View all").
/// * [QueueListRow] - a compact row that stacks into one grouped card per
///   section: pastel ringed circle icon, the uppercase status tags on the
///   first line, a bold title with the time trailing it, secondary
///   detail lines, a directional chevron and an inset hairline divider.
/// * [QueueStatusTag] - the coloured uppercase tag ("DRAFT", "CRITICAL"),
///   with a status dot.
/// * [QueueFilterChip] - a quiet outlined filter pill, filled green only
///   when selected, so filters sit under the search box without shouting.
///
/// Every value is supplied by the caller from data it already loaded; no
/// widget here reads a repository, invents a figure or renders a control
/// without a real callback. Colours come from [TpPalette] only, so dark
/// mode and the status hues follow the theme, and all paddings are
/// directional, so RTL mirrors without special cases.
library;

import 'package:flutter/material.dart';
import 'package:tyre_pulse/app/theme/tp_colors.dart';
import 'package:tyre_pulse/app/theme/tp_spacing.dart';

/// The one shadow tint this kit uses: a faint navy lift on the light
/// theme, a plain dark drop on the dark theme (a light-ink shadow would
/// glow rather than lift).
Color queueShadowColor(BuildContext context) {
  final TpPalette palette = TpPalette.of(context);
  return palette.brightness == Brightness.dark
      ? Colors.black.withValues(alpha: 0.45)
      : palette.text.withValues(alpha: 0.08);
}

/// An open section heading - bold title, optional green text action.
class QueueSectionHeader extends StatelessWidget {
  const QueueSectionHeader({
    required this.title,
    this.actionLabel,
    this.onAction,
    this.padding = const EdgeInsetsDirectional.fromSTEB(
      TpSpace.lg,
      TpSpace.lg,
      TpSpace.sm,
      TpSpace.xs,
    ),
    super.key,
  });

  final String title;

  /// Rendered only when [onAction] is also supplied - a label with nothing
  /// behind it would be a control that does nothing (AGENTS.md rule 7).
  final String? actionLabel;
  final VoidCallback? onAction;
  final EdgeInsetsGeometry padding;

  @override
  Widget build(BuildContext context) {
    final TpPalette palette = TpPalette.of(context);
    return Padding(
      padding: padding,
      child: Row(
        children: <Widget>[
          Expanded(
            child: Semantics(
              header: true,
              child: Text(
                title,
                style: Theme.of(context).textTheme.titleMedium?.copyWith(
                      color: palette.text,
                      fontWeight: FontWeight.w800,
                    ),
              ),
            ),
          ),
          if (actionLabel != null && onAction != null)
            TextButton(
              onPressed: onAction,
              style: TextButton.styleFrom(
                visualDensity: VisualDensity.compact,
                foregroundColor: palette.primary,
              ),
              child: Text(
                actionLabel!,
                style: const TextStyle(fontWeight: FontWeight.w800),
              ),
            ),
        ],
      ),
    );
  }
}

/// The mock's coloured uppercase status tag.
class QueueStatusTag extends StatelessWidget {
  const QueueStatusTag({required this.label, required this.status, super.key});

  final String label;
  final TpStatus status;

  @override
  Widget build(BuildContext context) {
    final TpStatusColors tone = TpPalette.of(context).forStatus(status);
    return Semantics(
      label: label,
      excludeSemantics: true,
      child: Container(
        padding: const EdgeInsetsDirectional.fromSTEB(7, 3, 9, 3),
        decoration: BoxDecoration(
          color: tone.soft,
          borderRadius: BorderRadius.circular(TpRadius.sm),
          border: Border.all(color: tone.base.withValues(alpha: 0.22)),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: <Widget>[
            Container(
              width: 6,
              height: 6,
              decoration: BoxDecoration(
                color: tone.base,
                shape: BoxShape.circle,
              ),
            ),
            const SizedBox(width: 5),
            Flexible(
              child: Text(
                label.toUpperCase(),
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: Theme.of(context).textTheme.labelSmall?.copyWith(
                      color: tone.onSoft,
                      fontWeight: FontWeight.w800,
                      letterSpacing: 0.3,
                    ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// A quiet filter pill: outlined at rest, filled with the brand green when
/// selected. The check mark stays so selection never rests on colour alone.
class QueueFilterChip extends StatelessWidget {
  const QueueFilterChip({
    required this.label,
    required this.selected,
    required this.onSelected,
    super.key,
  });

  final String label;
  final bool selected;
  final VoidCallback onSelected;

  @override
  Widget build(BuildContext context) {
    final TpPalette palette = TpPalette.of(context);
    return Semantics(
      button: true,
      selected: selected,
      child: Material(
        color: selected ? palette.primary : palette.surface,
        elevation: selected ? 1.5 : 0,
        shadowColor: queueShadowColor(context),
        shape: StadiumBorder(
          side: BorderSide(
            color: selected ? palette.primary : palette.borderStrong,
          ),
        ),
        clipBehavior: Clip.antiAlias,
        child: InkWell(
          onTap: onSelected,
          child: ConstrainedBox(
            constraints: const BoxConstraints(minHeight: 36),
            child: Padding(
              padding: const EdgeInsets.symmetric(
                horizontal: TpSpace.md,
                vertical: 6,
              ),
              child: Row(
                mainAxisSize: MainAxisSize.min,
                children: <Widget>[
                  if (selected) ...<Widget>[
                    Icon(
                      Icons.check_rounded,
                      size: TpSizing.iconSm,
                      color: palette.onPrimary,
                    ),
                    const SizedBox(width: TpSpace.xs),
                  ],
                  Text(
                    label,
                    style: Theme.of(context).textTheme.labelLarge?.copyWith(
                          color: selected
                              ? palette.onPrimary
                              : palette.textSecondary,
                          fontWeight:
                              selected ? FontWeight.w800 : FontWeight.w600,
                        ),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}

/// A compact full-bleed list row in the mock's "Today's work" shape.
class QueueListRow extends StatelessWidget {
  const QueueListRow({
    required this.icon,
    required this.status,
    required this.title,
    this.tags = const <Widget>[],
    this.time,
    this.details = const <String>[],
    this.titleKey,
    this.titleMaxLines,
    this.onTap,
    this.showDivider = true,
    this.isFirst = false,
    super.key,
  });

  final IconData icon;

  /// Tints the leading circle; the tags carry their own status.
  final TpStatus status;
  final String title;

  /// Usually one [QueueStatusTag]; a second one is allowed when the row has
  /// two independent real facts (for example severity and case status).
  final List<Widget> tags;

  /// Trailing top-line time or date, already formatted by the caller.
  final String? time;

  /// Secondary lines, each already joined by the caller. Blank entries are
  /// skipped so a missing column never leaves an empty gap.
  final List<String> details;
  final Key? titleKey;

  /// `null` lets a long asset name wrap rather than be cut - the approvals
  /// queue pins that behaviour in its responsive test.
  final int? titleMaxLines;
  final VoidCallback? onTap;

  /// `false` marks this row as the last of its group: the grouped card's
  /// bottom corners round and no divider is drawn under it.
  final bool showDivider;

  /// The first row of a group rounds the card's top corners.
  final bool isFirst;

  @override
  Widget build(BuildContext context) {
    final TpPalette palette = TpPalette.of(context);
    final TpStatusColors tone = palette.forStatus(status);
    final bool isLast = !showDivider;
    const Radius corner = Radius.circular(TpRadius.lg);
    final TextTheme text = Theme.of(context).textTheme;
    final bool rtl = Directionality.of(context) == TextDirection.rtl;
    final List<String> lines = <String>[
      for (final String line in details)
        if (line.trim().isNotEmpty) line.trim(),
    ];

    final Widget content = Padding(
      padding: const EdgeInsetsDirectional.fromSTEB(
        TpSpace.md,
        TpSpace.md,
        TpSpace.sm,
        TpSpace.md,
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Container(
            width: 44,
            height: 44,
            decoration: BoxDecoration(
              color: tone.soft,
              shape: BoxShape.circle,
              border: Border.all(color: tone.base.withValues(alpha: 0.18)),
            ),
            child: Icon(icon, color: tone.base, size: 22),
          ),
          const SizedBox(width: TpSpace.md),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: <Widget>[
                // Tags get the full width of the first line so two real
                // facts (status and severity) sit side by side; the time
                // moves to the title line's trailing edge.
                if (tags.isNotEmpty) ...<Widget>[
                  Wrap(
                    spacing: TpSpace.xs,
                    runSpacing: TpSpace.xs,
                    crossAxisAlignment: WrapCrossAlignment.center,
                    children: tags,
                  ),
                  const SizedBox(height: 6),
                ],
                Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: <Widget>[
                    Expanded(
                      child: Text(
                        title,
                        key: titleKey,
                        maxLines: titleMaxLines,
                        overflow: titleMaxLines == null
                            ? null
                            : TextOverflow.ellipsis,
                        style: text.titleSmall?.copyWith(
                          color: palette.text,
                          fontWeight: FontWeight.w800,
                        ),
                      ),
                    ),
                    if (time != null) ...<Widget>[
                      const SizedBox(width: TpSpace.sm),
                      Padding(
                        padding: const EdgeInsets.only(top: 2),
                        child: Text(
                          time!,
                          maxLines: 1,
                          style: text.labelSmall?.copyWith(
                            color: palette.textMuted,
                            fontWeight: FontWeight.w600,
                          ),
                        ),
                      ),
                    ],
                  ],
                ),
                for (final String line in lines) ...<Widget>[
                  const SizedBox(height: 3),
                  Text(
                    line,
                    style: text.bodySmall?.copyWith(
                      color: palette.textSecondary,
                    ),
                  ),
                ],
              ],
            ),
          ),
          if (onTap != null) ...<Widget>[
            const SizedBox(width: TpSpace.xs),
            Padding(
              padding: const EdgeInsets.only(top: 12),
              child: Icon(
                rtl ? Icons.chevron_left : Icons.chevron_right,
                color: palette.textMuted,
              ),
            ),
          ],
        ],
      ),
    );

    // One grouped card per section, built from its rows: the hairline
    // frame is the card's border (spec section 53 - legible in direct
    // sun), the rounded ends and a soft lift under the last row give it
    // the mock's quiet depth without a shadow line at every join.
    final BorderRadius outerRadius = BorderRadius.vertical(
      top: isFirst ? corner : Radius.zero,
      bottom: isLast ? corner : Radius.zero,
    );
    final BorderRadius innerRadius = BorderRadius.vertical(
      top: isFirst ? const Radius.circular(TpRadius.lg - 1) : Radius.zero,
      bottom: isLast ? const Radius.circular(TpRadius.lg - 1) : Radius.zero,
    );
    final Widget body = Column(
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: <Widget>[
        content,
        if (showDivider)
          Padding(
            padding: const EdgeInsetsDirectional.only(
              start: TpSpace.md + 44 + TpSpace.md,
            ),
            child: Divider(height: 1, thickness: 1, color: palette.border),
          ),
      ],
    );

    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: TpSpace.lg),
      child: DecoratedBox(
        decoration: BoxDecoration(
          color: palette.border,
          borderRadius: outerRadius,
          boxShadow: isLast
              ? <BoxShadow>[
                  BoxShadow(
                    color: queueShadowColor(context),
                    offset: const Offset(0, 6),
                    blurRadius: 12,
                    spreadRadius: -4,
                  ),
                ]
              : null,
        ),
        child: Padding(
          padding: EdgeInsets.fromLTRB(1, isFirst ? 1 : 0, 1, isLast ? 1 : 0),
          child: Material(
            color: palette.surface,
            borderRadius: innerRadius,
            clipBehavior: Clip.antiAlias,
            child: onTap == null
                ? body
                : Semantics(
                    button: true,
                    child: InkWell(onTap: onTap, child: body),
                  ),
          ),
        ),
      ),
    );
  }
}

/// A soft brand-green lift under the one primary action of a list landing
/// (the mock family's "New inspection" / "Create work order" bar). Purely
/// decorative: [child] keeps its own semantics, keys and callback.
class QueuePrimaryLift extends StatelessWidget {
  const QueuePrimaryLift({required this.child, super.key});

  final Widget child;

  @override
  Widget build(BuildContext context) {
    final TpPalette palette = TpPalette.of(context);
    return DecoratedBox(
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(TpRadius.md),
        boxShadow: <BoxShadow>[
          BoxShadow(
            color: palette.primary.withValues(
              alpha: palette.brightness == Brightness.dark ? 0.35 : 0.28,
            ),
            offset: const Offset(0, 6),
            blurRadius: 16,
            spreadRadius: -4,
          ),
        ],
      ),
      child: child,
    );
  }
}
