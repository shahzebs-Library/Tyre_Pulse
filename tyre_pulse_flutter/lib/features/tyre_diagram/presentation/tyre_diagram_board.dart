/// The vehicle tyre-layout board: a Total/OK/Monitor/Critical stat row, a
/// Layout view / List view toggle, and either [VehicleTyreDiagram] or
/// [TyreDiagramListView] underneath - the "Tyre Map / Vehicle Layout"
/// centrepiece, reused wherever a screen already shows a vehicle's tyre
/// positions (the inspection capture wizard, a read-only inspection detail,
/// an approval review).
///
/// Owns its own Layout/List choice - a display preference, not data a
/// caller needs to persist - so every consumer gets both views for free
/// without adding a state field of its own.
library;

import 'package:flutter/material.dart';
import 'package:tyre_pulse/app/localization/tp_localizations.dart';
import 'package:tyre_pulse/app/theme/tp_spacing.dart';
import 'package:tyre_pulse/core/design_system/design_system.dart';
import 'package:tyre_pulse/features/tyre_diagram/domain/tyre_diagram_stats.dart';
import 'package:tyre_pulse/features/tyre_diagram/presentation/tyre_diagram_list_view.dart';
import 'package:tyre_pulse/features/tyre_diagram/presentation/tyre_diagram_pending.dart';
import 'package:tyre_pulse/features/tyre_diagram/presentation/tyre_diagram_stat_row.dart';
import 'package:tyre_pulse/features/tyre_diagram/presentation/vehicle_tyre_diagram.dart';

enum TyreDiagramViewMode { layout, list }

class TyreDiagramBoard extends StatefulWidget {
  const TyreDiagramBoard({
    required this.vehicleType,
    required this.positions,
    required this.tyreData,
    this.assetNo,
    this.selectedPosition,
    this.onPositionTap,
    this.pending = TyreDiagramPending.none,
    this.width = 320,
    super.key,
  });

  final String vehicleType;
  final String? assetNo;
  final List<String> positions;
  final Map<String, Map<String, Object?>> tyreData;
  final String? selectedPosition;
  final ValueChanged<String>? onPositionTap;
  final TyreDiagramPending pending;
  final double width;

  @override
  State<TyreDiagramBoard> createState() => _TyreDiagramBoardState();
}

class _TyreDiagramBoardState extends State<TyreDiagramBoard> {
  TyreDiagramViewMode _mode = TyreDiagramViewMode.layout;

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final TyreDiagramStats stats = computeTyreDiagramStats(
      widget.positions,
      widget.tyreData,
    );

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: <Widget>[
        TyreDiagramStatRow(stats: stats),
        if (stats.total > 0) ...<Widget>[
          const SizedBox(height: TpSpace.lg),
          Center(
            child: TpSegmented<TyreDiagramViewMode>(
              value: _mode,
              options: <TpSegmentedOption<TyreDiagramViewMode>>[
                TpSegmentedOption<TyreDiagramViewMode>(
                  value: TyreDiagramViewMode.layout,
                  label: l10n.tyreDiagramModeLayout,
                  icon: Icons.dashboard_customize_outlined,
                ),
                TpSegmentedOption<TyreDiagramViewMode>(
                  value: TyreDiagramViewMode.list,
                  label: l10n.tyreDiagramModeList,
                  icon: Icons.format_list_bulleted,
                ),
              ],
              onChanged: (TyreDiagramViewMode mode) {
                setState(() => _mode = mode);
              },
            ),
          ),
        ],
        const SizedBox(height: TpSpace.lg),
        switch (_mode) {
          TyreDiagramViewMode.layout => Center(
              child: VehicleTyreDiagram(
                vehicleType: widget.vehicleType,
                assetNo: widget.assetNo,
                positions: widget.positions,
                tyreData: widget.tyreData,
                selectedPosition: widget.selectedPosition,
                onPositionTap: widget.onPositionTap,
                pending: widget.pending,
                width: widget.width,
              ),
            ),
          TyreDiagramViewMode.list => TyreDiagramListView(
              positions: widget.positions,
              tyreData: widget.tyreData,
              selectedPosition: widget.selectedPosition,
              onPositionTap: widget.onPositionTap,
            ),
        },
      ],
    );
  }
}
