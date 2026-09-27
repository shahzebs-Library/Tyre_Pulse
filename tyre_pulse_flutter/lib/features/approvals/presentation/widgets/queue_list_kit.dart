/// The list vocabulary of the approved mock family (07 home "Today's work",
/// 18 maintenance "Priority work queue", 19 profile), shared by the tab
/// landing lists that have no mock of their own: the inspection and
/// checklist approval queues and the accident register.
///
/// What it draws, and only that:
///
/// * [QueueSectionHeader] - an open, borderless section title with an
///   optional bold green text action (the mock's "View all").
/// * [QueueListRow] - a compact full-bleed row: pastel circle icon, an
///   uppercase status tag and trailing time on the first line, a bold
///   title, one or more secondary detail lines, a directional chevron and a
///   hairline divider running edge to edge.
/// * [QueueStatusTag] - the coloured uppercase tag ("DRAFT", "CRITICAL").
/// * [QueueFilterChip] - a quiet outlined filter pill, filled only when
///   selected, so filters sit under the search box without shouting.
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
        padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 3),
        decoration: BoxDecoration(
          color: tone.soft,
          borderRadius: BorderRadius.circular(4),
        ),
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
    );
  }
}

/// A quiet filter pill: outlined at rest, softly filled when selected.
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
        color: selected ? palette.primarySoft : palette.surface,
        shape: StadiumBorder(
          side: BorderSide(
            color: selected ? palette.primary : palette.border,
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
                      color: palette.primary,
                    ),
                    const SizedBox(width: TpSpace.xs),
                  ],
                  Text(
                    label,
                    style: Theme.of(context).textTheme.labelLarge?.copyWith(
                          color: selected ? palette.primary : palette.text,
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
  final bool showDivider;

  @override
  Widget build(BuildContext context) {
    final TpPalette palette = TpPalette.of(context);
    final TpStatusColors tone = palette.forStatus(status);
    final TextTheme text = Theme.of(context).textTheme;
    final bool rtl = Directionality.of(context) == TextDirection.rtl;
    final List<String> lines = <String>[
      for (final String line in details)
        if (line.trim().isNotEmpty) line.trim(),
    ];

    final Widget content = Container(
      decoration: BoxDecoration(
        color: palette.surface,
        border: showDivider
            ? Border(bottom: BorderSide(color: palette.border))
            : null,
      ),
      padding: const EdgeInsetsDirectional.fromSTEB(
        TpSpace.lg,
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
            decoration: BoxDecoration(color: tone.soft, shape: BoxShape.circle),
            child: Icon(icon, color: tone.base, size: 22),
          ),
          const SizedBox(width: TpSpace.md),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: <Widget>[
                if (tags.isNotEmpty || time != null) ...<Widget>[
                  Row(
                    children: <Widget>[
                      Expanded(
                        child: Wrap(
                          spacing: TpSpace.xs,
                          runSpacing: TpSpace.xs,
                          crossAxisAlignment: WrapCrossAlignment.center,
                          children: tags,
                        ),
                      ),
                      if (time != null) ...<Widget>[
                        const SizedBox(width: TpSpace.sm),
                        Text(
                          time!,
                          maxLines: 1,
                          style: text.labelSmall?.copyWith(
                            color: palette.textSecondary,
                          ),
                        ),
                      ],
                    ],
                  ),
                  const SizedBox(height: 6),
                ],
                Text(
                  title,
                  key: titleKey,
                  maxLines: titleMaxLines,
                  overflow:
                      titleMaxLines == null ? null : TextOverflow.ellipsis,
                  style: text.titleSmall?.copyWith(
                    color: palette.text,
                    fontWeight: FontWeight.w800,
                  ),
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
                color: palette.text,
              ),
            ),
          ],
        ],
      ),
    );

    if (onTap == null) return content;
    return Semantics(
      button: true,
      child: Material(
        color: Colors.transparent,
        child: InkWell(onTap: onTap, child: content),
      ),
    );
  }
}
