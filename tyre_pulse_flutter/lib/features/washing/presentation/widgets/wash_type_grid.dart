/// Wash type picker: one coloured tile per `wash_records.wash_type` value,
/// each with its gradient icon, name and a one-line description. The picked
/// tile fills with its own colour and shows a check.
library;

import 'package:flutter/material.dart';
import 'package:tyre_pulse/app/localization/tp_localizations.dart';
import 'package:tyre_pulse/app/theme/tp_colors.dart';
import 'package:tyre_pulse/app/theme/tp_spacing.dart';
import 'package:tyre_pulse/features/washing/presentation/widgets/wash_ui.dart';

class WashTypeGrid extends StatelessWidget {
  const WashTypeGrid({
    required this.types,
    required this.selected,
    required this.onSelected,
    super.key,
  });

  final List<String> types;
  final String? selected;
  final ValueChanged<String> onSelected;

  static ValueKey<String> tileKey(String type) =>
      ValueKey<String>('washing.type.$type');

  @override
  Widget build(BuildContext context) {
    return LayoutBuilder(
      builder: (BuildContext context, BoxConstraints constraints) {
        final int columns = constraints.maxWidth >= 560 ? 3 : 2;
        final double width =
            (constraints.maxWidth - (columns - 1) * TpSpace.sm) / columns;
        return Wrap(
          spacing: TpSpace.sm,
          runSpacing: TpSpace.sm,
          children: <Widget>[
            for (final String type in types)
              SizedBox(
                width: width,
                child: _WashTypeTile(
                  key: tileKey(type),
                  type: type,
                  selected: selected == type,
                  onTap: () => onSelected(type),
                ),
              ),
          ],
        );
      },
    );
  }
}

class _WashTypeTile extends StatelessWidget {
  const _WashTypeTile({
    required this.type,
    required this.selected,
    required this.onTap,
    super.key,
  });

  final String type;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final TpPalette palette = TpPalette.of(context);
    final TextTheme text = Theme.of(context).textTheme;
    final WashTypeStyle style = WashTypeStyle.of(type);
    final ({Color background, Color foreground}) tint =
        washToneColors(context, style.tone);
    final String? description = washTypeDescription(l10n, type);
    final BorderRadius corners = BorderRadius.circular(TpRadius.lg);

    return Semantics(
      button: true,
      selected: selected,
      child: Material(
        color: selected ? tint.background : palette.surface,
        shape: RoundedRectangleBorder(
          borderRadius: corners,
          side: BorderSide(
            color: selected ? tint.foreground : palette.border,
            width: selected ? 2 : 1,
          ),
        ),
        clipBehavior: Clip.antiAlias,
        child: InkWell(
          onTap: onTap,
          child: ConstrainedBox(
            constraints: const BoxConstraints(minHeight: 112),
            child: Padding(
              padding: const EdgeInsets.all(TpSpace.md),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                mainAxisSize: MainAxisSize.min,
                children: <Widget>[
                  Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: <Widget>[
                      WashGem(icon: style.icon, tone: style.tone, size: 40),
                      const Spacer(),
                      AnimatedOpacity(
                        opacity: selected ? 1 : 0,
                        duration: const Duration(milliseconds: 160),
                        child: Container(
                          width: 22,
                          height: 22,
                          decoration: BoxDecoration(
                            color: tint.foreground,
                            shape: BoxShape.circle,
                          ),
                          child: Icon(
                            Icons.check_rounded,
                            size: 16,
                            color: palette.surface,
                          ),
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: TpSpace.sm),
                  Text(
                    washTypeName(l10n, type),
                    style: text.titleSmall?.copyWith(
                      color: selected ? tint.foreground : palette.text,
                      fontWeight: FontWeight.w800,
                    ),
                  ),
                  if (description != null)
                    Text(
                      description,
                      style: text.bodySmall?.copyWith(
                        color: palette.textSecondary,
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
