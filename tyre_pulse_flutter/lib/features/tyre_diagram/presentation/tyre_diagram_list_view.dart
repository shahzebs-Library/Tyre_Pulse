/// The flat "List view" alternative to the top-down [VehicleTyreDiagram] -
/// one row per position, each showing its status, tread depth and pressure.
///
/// Reads the SAME `Map<String, Map<String, Object?>>` shape every other
/// tyre-diagram consumer reads `tyre_conditions` as - see
/// `tyre_diagram_stats.dart`'s own library comment for why this stays
/// entry-map based rather than depending on any single top-level feature's
/// typed domain model.
library;

import 'package:flutter/material.dart';
import 'package:tyre_pulse/app/localization/tp_direction.dart';
import 'package:tyre_pulse/app/localization/tp_localizations.dart';
import 'package:tyre_pulse/app/theme/tp_colors.dart';
import 'package:tyre_pulse/app/theme/tp_spacing.dart';
import 'package:tyre_pulse/core/design_system/design_system.dart';
import 'package:tyre_pulse/features/tyre_diagram/domain/tyre_condition.dart';
import 'package:tyre_pulse/features/tyre_diagram/presentation/tyre_condition_labels.dart';

class TyreDiagramListView extends StatelessWidget {
  const TyreDiagramListView({
    required this.positions,
    required this.tyreData,
    this.selectedPosition,
    this.onPositionTap,
    super.key,
  });

  /// Position ids/codes, in the order they should be listed - the caller's
  /// own [VehicleTyreDiagram.positions], so the list and the diagram above
  /// it can never disagree about which wheels exist.
  final List<String> positions;

  /// Recorded data, keyed by position exactly as [VehicleTyreDiagram] reads
  /// it.
  final Map<String, Map<String, Object?>> tyreData;

  final String? selectedPosition;
  final ValueChanged<String>? onPositionTap;

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);

    if (positions.isEmpty) {
      return TpEmptyState(
        icon: Icons.format_list_bulleted,
        title: l10n.tyreDiagramListEmptyTitle,
        message: l10n.tyreDiagramListEmptyMessage,
      );
    }

    return Column(
      children: <Widget>[
        for (final String position in positions)
          _TyreDiagramListRow(
            position: position,
            entry: tyreData[position],
            isSelected: position == selectedPosition,
            onTap:
                onPositionTap == null ? null : () => onPositionTap!(position),
          ),
      ],
    );
  }
}

class _TyreDiagramListRow extends StatelessWidget {
  const _TyreDiagramListRow({
    required this.position,
    required this.entry,
    required this.isSelected,
    required this.onTap,
  });

  final String position;
  final Map<String, Object?>? entry;
  final bool isSelected;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final TpPalette palette = TpPalette.of(context);
    final TpStatus status = wheelStatusFor(entry);
    final TyreCondition? condition = wheelConditionFor(entry);
    final TpStatusColors colors = palette.forStatus(status);
    final String? pressure = _numberText(entry, const <String>[
      'pressure_psi',
      'pressure',
    ]);
    final String? tread = _numberText(entry, const <String>[
      'tread_depth_mm',
      'tread_depth',
    ]);

    return TpCard(
      margin: const EdgeInsets.only(bottom: TpSpace.sm),
      onTap: onTap,
      borderColor: isSelected ? palette.focus : null,
      child: Row(
        children: <Widget>[
          Container(
            width: 10,
            height: 10,
            margin: const EdgeInsets.only(right: TpSpace.md),
            decoration: BoxDecoration(
              color: colors.base,
              shape: BoxShape.circle,
            ),
          ),
          Expanded(
            flex: 2,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: <Widget>[
                TpIdentifierText(
                  position,
                  style: Theme.of(context).textTheme.titleSmall,
                ),
                Text(
                  condition == null
                      ? l10n.tyreDiagramListNotRecorded
                      : tyreConditionLabel(l10n, condition),
                  style: Theme.of(context)
                      .textTheme
                      .bodySmall
                      ?.copyWith(color: palette.textMuted),
                ),
              ],
            ),
          ),
          Expanded(
            child: Text(
              tread == null
                  ? l10n.tyreDiagramListNotRecorded
                  : l10n.tyreDiagramListTreadValue(tread),
              textAlign: TextAlign.end,
              style: Theme.of(context).textTheme.bodySmall,
            ),
          ),
          Expanded(
            child: Text(
              pressure == null
                  ? l10n.tyreDiagramListNotRecorded
                  : l10n.tyreDiagramListPressureValue(pressure),
              textAlign: TextAlign.end,
              style: Theme.of(context).textTheme.bodySmall,
            ),
          ),
        ],
      ),
    );
  }

  static String? _numberText(Map<String, Object?>? entry, List<String> keys) {
    if (entry == null) return null;
    for (final String key in keys) {
      final Object? value = entry[key];
      if (value == null) continue;
      if (value is num) {
        return value.isFinite
            ? (value == value.roundToDouble()
                ? value.toInt().toString()
                : value.toString())
            : null;
      }
      final String text = value.toString().trim();
      if (text.isNotEmpty) return text;
    }
    return null;
  }
}
