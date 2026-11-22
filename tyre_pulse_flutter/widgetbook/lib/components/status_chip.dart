import 'package:flutter/material.dart';
import 'package:tyre_pulse/app/theme/tp_colors.dart';
import 'package:tyre_pulse/core/design_system/design_system.dart';
import 'package:widgetbook/widgetbook.dart';
import 'package:widgetbook_annotation/widgetbook_annotation.dart' as widgetbook;

@widgetbook.UseCase(name: 'All states', type: TpStatusChip)
Widget statusChips(BuildContext context) {
  final bool compact = context.knobs.boolean(
    label: 'Compact',
    initialValue: false,
  );
  return Padding(
    padding: const EdgeInsets.all(16),
    child: Wrap(
      spacing: 8,
      runSpacing: 8,
      children: <Widget>[
        for (final TpStatus s in TpStatus.values)
          TpStatusChip(status: s, label: s.name, isCompact: compact),
      ],
    ),
  );
}
