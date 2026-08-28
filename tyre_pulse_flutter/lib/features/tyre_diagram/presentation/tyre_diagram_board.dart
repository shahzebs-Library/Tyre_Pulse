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
    this.compact = false,
    this.captureMode = false,
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

  /// Uses the approved inspection/approval mock hierarchy: the vehicle map
  /// stays primary while the dashboard stat row and view switcher are hidden.
  final bool compact;

  /// Reproduces the focused inspection-map composition: no dashboard chrome,
  /// visible physical-position labels, FRONT/REAR orientation, and no legend.
  /// Opt-in so detail and approval consumers keep their existing rendering.
  final bool captureMode;

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
        if (!widget.compact) TyreDiagramStatRow(stats: stats),
        if (!widget.compact && stats.total > 0) ...<Widget>[
          const SizedBox(height: TpSpace.lg),
          Center(
            child: TpSegmented<TyreDiagramViewMode>(
              expanded: true,
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
        SizedBox(
          height: widget.captureMode
              ? 0
              : (widget.compact ? TpSpace.sm : TpSpace.lg),
        ),
        switch (_mode) {
          TyreDiagramViewMode.layout => LayoutBuilder(
              builder: (BuildContext context, BoxConstraints constraints) {
                final double available = constraints.maxWidth.isFinite
                    ? constraints.maxWidth
                    : widget.width;
                final double bounded =
                    available < widget.width ? available : widget.width;
                final double diagramWidth = bounded - (TpSpace.lg * 2);
                // The approved inspection and approval mocks keep the whole
                // bird-view vehicle visible above their fixed action bar.
                // Letting the compact board consume the full phone width
                // makes a 4/5-axle pump or mixer taller than the viewport and
                // hides its last joined dual axle behind that bar. The shared
                // diagram remains full-size on asset/detail screens; only the
                // focused capture/review presentation is capped here.
                final double renderedWidth = widget.captureMode
                    ? (available - 112).clamp(152, 190).toDouble()
                    : widget.compact
                        ? diagramWidth.clamp(176, 252).toDouble()
                        : diagramWidth.clamp(220, widget.width).toDouble();
                return Center(
                  child: VehicleTyreDiagram(
                    vehicleType: widget.vehicleType,
                    assetNo: widget.assetNo,
                    positions: widget.positions,
                    tyreData: widget.tyreData,
                    selectedPosition: widget.selectedPosition,
                    onPositionTap: widget.onPositionTap,
                    pending: widget.pending,
                    width: renderedWidth,
                    compact: widget.compact,
                    captureMode: widget.captureMode,
                  ),
                );
              },
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
