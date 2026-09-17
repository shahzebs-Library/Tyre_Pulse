/// Small shared pieces for the M1/M2 mock workspaces (header chips, numbered
/// sections, fact grids, notices). Kept in one file so the two workspaces
/// render the owner's mock vocabulary identically instead of each carrying
/// its own copy of "Not set".
///
/// Copy is tri-lingual inline (en/ar/ur), mirroring the neighbouring
/// role-workspace files; a blank value ALWAYS prints "Not set", never a dash.
library;

import 'package:flutter/material.dart';
import 'package:intl/intl.dart' show DateFormat;
import 'package:tyre_pulse/app/theme/tp_colors.dart';
import 'package:tyre_pulse/app/theme/tp_spacing.dart';
import 'package:tyre_pulse/core/design_system/design_system.dart';

final class WsKitCopy {
  const WsKitCopy(this.context);
  final BuildContext context;

  String t(String en, String ar, String ur) =>
      switch (Localizations.localeOf(context).languageCode) {
        'ar' => ar,
        'ur' => ur,
        _ => en,
      };

  String get notSet => t('Not set', 'غير محدد', 'مقرر نہیں');

  String value(Object? raw) {
    final String text = raw?.toString().trim() ?? '';
    return text.isEmpty ? notSet : text;
  }
}

/// "16 Sep 2026 · 14:35" in the ambient locale. Never invents a time.
String accidentMockDateTime(BuildContext context, DateTime at) {
  final String locale = Localizations.localeOf(context).toLanguageTag();
  final DateTime local = at.toLocal();
  return '${DateFormat('d MMM y', locale).format(local)} · '
      '${DateFormat.Hm(locale).format(local)}';
}

class AccidentMockTitle extends StatelessWidget {
  const AccidentMockTitle(this.text, {super.key});
  final String text;
  @override
  Widget build(BuildContext context) => Text(
        text,
        style: Theme.of(context).textTheme.titleLarge?.copyWith(
              fontWeight: FontWeight.w800,
              color: TpPalette.of(context).text,
            ),
      );
}

class AccidentMockPanel extends StatelessWidget {
  const AccidentMockPanel({required this.child, super.key});
  final Widget child;
  @override
  Widget build(BuildContext context) =>
      TpCard(padding: const EdgeInsets.all(TpSpace.md), child: child);
}

class AccidentMockSection extends StatelessWidget {
  const AccidentMockSection({
    required this.title,
    required this.child,
    this.number,
    this.icon,
    this.subtitle,
    this.sectionKey,
    super.key,
  });
  final String title;
  final String? subtitle;
  final Widget child;
  final int? number;
  final IconData? icon;
  final Key? sectionKey;

  @override
  Widget build(BuildContext context) {
    final TpPalette palette = TpPalette.of(context);
    return Column(
      key: sectionKey,
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: <Widget>[
        Row(
          children: <Widget>[
            if (number != null)
              CircleAvatar(
                radius: 12,
                backgroundColor: palette.primary,
                child: Text(
                  '$number',
                  style: TextStyle(
                    color: palette.onPrimary,
                    fontSize: 13,
                    fontWeight: FontWeight.bold,
                  ),
                ),
              )
            else
              Icon(icon ?? Icons.subject, color: palette.primary, size: 21),
            const SizedBox(width: TpSpace.sm),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: <Widget>[
                  Text(
                    title,
                    style: Theme.of(context)
                        .textTheme
                        .titleSmall
                        ?.copyWith(fontWeight: FontWeight.w800),
                  ),
                  if (subtitle != null)
                    Text(
                      subtitle!,
                      style: Theme.of(context).textTheme.bodySmall,
                    ),
                ],
              ),
            ),
          ],
        ),
        const SizedBox(height: TpSpace.sm),
        AccidentMockPanel(child: child),
      ],
    );
  }
}

/// Label / value pairs; a blank value prints "Not set".
class AccidentMockFacts extends StatelessWidget {
  const AccidentMockFacts({required this.items, super.key});
  final List<(String, String?)> items;

  @override
  Widget build(BuildContext context) => LayoutBuilder(
        builder: (BuildContext context, BoxConstraints constraints) {
          final int columns = constraints.maxWidth >= 500 ? 2 : 1;
          final double width =
              (constraints.maxWidth - (columns - 1) * TpSpace.lg) / columns;
          return Wrap(
            spacing: TpSpace.lg,
            runSpacing: TpSpace.sm,
            children: <Widget>[
              for (final (String, String?) item in items)
                SizedBox(
                  width: width,
                  child: Padding(
                    padding: const EdgeInsets.symmetric(vertical: 5),
                    child: Row(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: <Widget>[
                        Expanded(
                          child: Text(
                            item.$1,
                            style: Theme.of(context).textTheme.bodySmall,
                          ),
                        ),
                        const SizedBox(width: TpSpace.sm),
                        Expanded(
                          child: Text(
                            WsKitCopy(context).value(item.$2),
                            style: Theme.of(context)
                                .textTheme
                                .bodyMedium
                                ?.copyWith(fontWeight: FontWeight.w600),
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
            ],
          );
        },
      );
}

class AccidentMockNotice extends StatelessWidget {
  const AccidentMockNotice({
    required this.text,
    this.tone = TpStatus.warning,
    this.title,
    super.key,
  });
  final String text;
  final String? title;
  final TpStatus tone;

  @override
  Widget build(BuildContext context) {
    final TpStatusColors colors = TpPalette.of(context).forStatus(tone);
    return Container(
      padding: const EdgeInsets.all(TpSpace.md),
      decoration: BoxDecoration(
        color: colors.soft,
        border: Border.all(color: colors.base),
        borderRadius: BorderRadius.circular(TpRadius.sm),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Icon(
            tone == TpStatus.warning || tone == TpStatus.critical
                ? Icons.warning_amber_rounded
                : Icons.info_outline,
            color: colors.base,
          ),
          const SizedBox(width: TpSpace.sm),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                if (title != null)
                  Text(
                    title!,
                    style: const TextStyle(fontWeight: FontWeight.w800),
                  ),
                Text(text),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

/// One header chip: a small label over a bold value with a status tint.
class AccidentMockChip extends StatelessWidget {
  const AccidentMockChip({
    required this.label,
    required this.value,
    this.tone = TpStatus.neutral,
    super.key,
  });
  final String label;
  final String value;
  final TpStatus tone;

  @override
  Widget build(BuildContext context) {
    final TpStatusColors colors = TpPalette.of(context).forStatus(tone);
    return Container(
      constraints: const BoxConstraints(minWidth: 132),
      padding: const EdgeInsets.symmetric(
        horizontal: TpSpace.md,
        vertical: TpSpace.sm,
      ),
      decoration: BoxDecoration(
        color: colors.soft,
        border: Border.all(color: colors.base),
        borderRadius: BorderRadius.circular(TpRadius.md),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisSize: MainAxisSize.min,
        children: <Widget>[
          Text(label, style: Theme.of(context).textTheme.labelSmall),
          Text(
            value,
            style: Theme.of(context)
                .textTheme
                .bodyMedium
                ?.copyWith(fontWeight: FontWeight.w800, color: colors.onSoft),
          ),
        ],
      ),
    );
  }
}

class AccidentMockActions extends StatelessWidget {
  const AccidentMockActions({required this.actions, super.key});
  final List<(String, IconData, VoidCallback?)> actions;
  @override
  Widget build(BuildContext context) => Wrap(
        spacing: TpSpace.sm,
        runSpacing: TpSpace.sm,
        children: <Widget>[
          for (final (String, IconData, VoidCallback?) action in actions)
            OutlinedButton.icon(
              onPressed: action.$3,
              icon: Icon(action.$2),
              label: Text(action.$1),
            ),
        ],
      );
}

/// Bulleted list with a "N items" count, for documents sent / accessories.
class AccidentMockCountedList extends StatelessWidget {
  const AccidentMockCountedList({
    required this.label,
    required this.items,
    required this.unit,
    super.key,
  });
  final String label;
  final List<String> items;

  /// e.g. "documents" or "items" - printed after the count.
  final String unit;

  @override
  Widget build(BuildContext context) {
    final WsKitCopy c = WsKitCopy(context);
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 5),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Row(
            children: <Widget>[
              Expanded(
                child: Text(
                  label,
                  style: Theme.of(context).textTheme.bodySmall,
                ),
              ),
              Text(
                items.isEmpty ? c.notSet : '${items.length} $unit',
                style: const TextStyle(fontWeight: FontWeight.w700),
              ),
            ],
          ),
          for (final String item in items)
            Padding(
              padding: const EdgeInsetsDirectional.only(start: TpSpace.md),
              child: Text('• $item'),
            ),
        ],
      ),
    );
  }
}
