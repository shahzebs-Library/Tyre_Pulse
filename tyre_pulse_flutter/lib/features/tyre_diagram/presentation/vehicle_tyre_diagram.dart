/// The interactive top-down vehicle tyre diagram - the Phase 4 deliverable.
///
/// A faithful port of `mobile/components/VehicleTyreDiagram.tsx`'s BEHAVIOUR
/// (resolver, position matching, six per-slot states, RTL rules), rendered
/// with Flutter primitives instead of `react-native-svg`. See
/// `tyre_body_painter.dart`'s library comment for the one deliberate,
/// clearly-flagged gap (a provisional silhouette in place of the
/// production hand-authored gradient artwork), and
/// `docs/flutter-migration/07-tyre-layout-parity-tests.md` section 7 for
/// every other rendering decision this file makes.
///
/// STATELESS AND FULLY CONTROLLED, matching the RN source: [selectedPosition]
/// and [onPositionTap] are owned by the caller, not this widget.
library;

import 'package:flutter/material.dart';
import 'package:tyre_pulse/app/localization/tp_localizations.dart';
import 'package:tyre_pulse/app/theme/tp_colors.dart';
import 'package:tyre_pulse/app/theme/tp_spacing.dart';
import 'package:tyre_pulse/core/design_system/design_system.dart';
import 'package:tyre_pulse/features/tyre_diagram/domain/tyre_completeness.dart';
import 'package:tyre_pulse/features/tyre_diagram/domain/tyre_condition.dart';
import 'package:tyre_pulse/features/tyre_diagram/domain/tyre_diagram_layouts.dart';
import 'package:tyre_pulse/features/tyre_diagram/domain/tyre_position_matcher.dart';
import 'package:tyre_pulse/features/tyre_diagram/domain/tyre_slot.dart';
import 'package:tyre_pulse/features/tyre_diagram/presentation/tyre_body_painter.dart';
import 'package:tyre_pulse/features/tyre_diagram/presentation/tyre_condition_labels.dart';
import 'package:tyre_pulse/features/tyre_diagram/presentation/tyre_diagram_geometry.dart';
import 'package:tyre_pulse/features/tyre_diagram/presentation/tyre_diagram_pending.dart';
import 'package:tyre_pulse/features/tyre_diagram/presentation/tyre_wheel_painter.dart';

/// The interactive tyre diagram for one vehicle.
class VehicleTyreDiagram extends StatelessWidget {
  const VehicleTyreDiagram({
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

  /// The fleet's `vehicle_type` value, exactly as stored. Fleet data, never
  /// translated - shown verbatim in the caption and the tyreless/empty
  /// states.
  final String vehicleType;

  /// Used only when [vehicleType] identifies nothing (a junk catch-all type
  /// in the register) - see [resolveVehicleType].
  final String? assetNo;

  /// The position ids/codes to render. Pass [diagramPositions]'s own output
  /// for the normal case; an inspection detail screen reading an older
  /// record may pass whatever vocabulary that record was written under -
  /// [matchPositionsToLayout] accepts either.
  final List<String> positions;

  /// Recorded data, keyed by position id/code exactly as it was stored.
  /// Looked up by BOTH [MatchedTyreSlot.positionId] and
  /// [MatchedTyreSlot.id] (artifact section 7.4's double lookup), so an
  /// older record stored under the layout's internal id still lights its
  /// wheel even when the caller only ever intended [positions] to carry the
  /// canonical code.
  final Map<String, Map<String, Object?>> tyreData;

  final String? selectedPosition;
  final ValueChanged<String>? onPositionTap;

  /// Which wheels still need details. Purely additive - the default (no
  /// wheel pending) changes nothing else about the render.
  final TyreDiagramPending pending;

  /// Rendered width, in logical pixels. Height is derived from the
  /// resolved layout's `viewH`.
  final double width;

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final TpPalette palette = TpPalette.of(context);

    if (isTyrelessEquipment(vehicleType)) {
      return _EmptyDiagramState(
        icon: Icons.factory_outlined,
        title: vehicleType,
        message: l10n.tyreDiagramTyrelessMessage,
      );
    }
    if (positions.isEmpty) {
      return _EmptyDiagramState(
        icon: Icons.tire_repair_outlined,
        title: vehicleType,
        message: l10n.tyreDiagramEmptyMessage,
      );
    }

    final String resolvedKey = resolveVehicleType(vehicleType, assetNo);
    final DiagramLayout layout =
        kTyreDiagramLayouts[resolvedKey] ?? kTyreDiagramLayouts['Pickup']!;
    final List<MatchedTyreSlot> tyres = matchPositionsToLayout(
      layout,
      positions,
    );
    final TyreDiagramViewport viewport = TyreDiagramViewport(
      width: width,
      viewH: layout.viewH,
    );
    final Set<String> pendingKeys = pending.resolveKeys();

    final List<_ResolvedWheel> resolved = <_ResolvedWheel>[
      for (final MatchedTyreSlot tyre in tyres)
        _resolveWheel(layout, tyre, pendingKeys),
    ];

    final List<_ResolvedWheel> pendingOnScreen = <_ResolvedWheel>[
      for (final _ResolvedWheel wheel in resolved)
        if (wheel.isOutstanding) wheel,
    ];

    return TpCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.center,
        mainAxisSize: MainAxisSize.min,
        children: <Widget>[
          Row(
            mainAxisSize: MainAxisSize.min,
            children: <Widget>[
              Icon(Icons.arrow_upward, size: 13, color: palette.textMuted),
              const SizedBox(width: TpSpace.xs),
              Text(
                l10n.tyreDiagramFrontLabel,
                style: Theme.of(context).textTheme.labelSmall,
              ),
            ],
          ),
          const SizedBox(height: TpSpace.xs),
          Text(
            '$vehicleType · ${l10n.tyreDiagramTyreCount(tyres.length)}',
            style: Theme.of(context).textTheme.titleMedium,
            textAlign: TextAlign.center,
          ),
          const SizedBox(height: 2),
          Text(
            l10n.tyreDiagramTapHint,
            style: Theme.of(context).textTheme.bodyMedium,
            textAlign: TextAlign.center,
          ),
          if (pendingOnScreen.isNotEmpty) ...<Widget>[
            const SizedBox(height: TpSpace.sm),
            Text(
              l10n.tyreDiagramPendingLeadIn(pendingOnScreen.length),
              style: Theme.of(context).textTheme.labelMedium
                  ?.copyWith(color: palette.warning.base),
              textAlign: TextAlign.center,
            ),
            const SizedBox(height: TpSpace.xs),
            Wrap(
              alignment: WrapAlignment.center,
              spacing: TpSpace.xs,
              runSpacing: TpSpace.xs,
              children: <Widget>[
                for (final _ResolvedWheel wheel in pendingOnScreen)
                  TpTyreChip(
                    data: TpTyreChipData(
                      position: wheel.code,
                      status: TpStatus.warning,
                    ),
                    isSelected: wheel.tyre.positionId == selectedPosition,
                    onTap: onPositionTap == null
                        ? null
                        : () => onPositionTap!(wheel.tyre.positionId),
                  ),
              ],
            ),
          ],
          const SizedBox(height: TpSpace.md),
          Directionality(
            textDirection: TextDirection.ltr,
            child: SizedBox(
              width: viewport.width,
              height: viewport.height,
              child: Stack(
                children: <Widget>[
                  CustomPaint(
                    size: Size(viewport.width, viewport.height),
                    painter: TyreBodyPainter(
                      bodyKey: layout.bodyKey,
                      viewport: viewport,
                      palette: palette,
                    ),
                  ),
                  CustomPaint(
                    size: Size(viewport.width, viewport.height),
                    painter: TyreWheelPainter(
                      wheels: <TyreWheelPaintData>[
                        for (final _ResolvedWheel wheel in resolved)
                          wheel.paintData(
                            isSelected:
                                wheel.tyre.positionId == selectedPosition,
                          ),
                      ],
                      viewport: viewport,
                      palette: palette,
                    ),
                  ),
                  for (final _ResolvedWheel wheel in resolved)
                    _WheelHitTarget(
                      wheel: wheel,
                      viewport: viewport,
                      isSelected: wheel.tyre.positionId == selectedPosition,
                      label: tyreDiagramAccessibilityLabel(
                        l10n,
                        code: wheel.code,
                        condition: wheel.condition,
                        pressureText: wheel.pressureText,
                      ),
                      onTap: onPositionTap == null
                          ? null
                          : () => onPositionTap!(wheel.tyre.positionId),
                    ),
                ],
              ),
            ),
          ),
          const SizedBox(height: TpSpace.md),
          _ConditionLegend(l10n: l10n),
        ],
      ),
    );
  }

  _ResolvedWheel _resolveWheel(
    DiagramLayout layout,
    MatchedTyreSlot tyre,
    Set<String> pendingKeys,
  ) {
    // Section 7.4's double lookup: an older record may still be stored
    // under the layout's internal id even when the caller's position list
    // carries the canonical code (or vice versa).
    final Map<String, Object?>? entry =
        tyreData[tyre.positionId] ?? tyreData[tyre.id];
    final TyreCondition condition = entry == null
        ? TyreCondition.good
        : normaliseCondition(entry['condition']?.toString());
    final TpStatus status = entry == null
        ? TpStatus.unknown
        : tyreConditionStatus(condition);
    // "Has evidence" (and the pressure reading that goes with it) is
    // answered ONCE, by the completeness engine's own rule, and read from a
    // SINGLE classification call - never a second, weaker truthiness check
    // inside this widget. Section 7.2 names the RN source's own inline
    // `!!d.serial_number || ...` as exactly the bug this avoids: it would
    // treat a numeric `0` pressure as absent.
    final EntryClassification? classification = entry == null
        ? null
        : classifyEntry(entry);
    final bool isRecorded =
        classification != null && classification.state != TyreSlotState.blank;
    final bool isOutstanding =
        pendingKeys.contains(keyOf(tyre.positionId)) ||
        pendingKeys.contains(keyOf(tyre.id));
    final String code = legacyPositionCode(layout.key, tyre.id);

    return _ResolvedWheel(
      tyre: tyre,
      code: code,
      condition: condition,
      status: status,
      isRecorded: isRecorded,
      isOutstanding: isOutstanding,
      pressureText: classification?.pressure?.toString(),
    );
  }
}

/// One wheel's resolved presentation state, computed once per build so the
/// painter and the hit-target/accessibility layer never disagree about it.
class _ResolvedWheel {
  const _ResolvedWheel({
    required this.tyre,
    required this.code,
    required this.condition,
    required this.status,
    required this.isRecorded,
    required this.isOutstanding,
    required this.pressureText,
  });

  final MatchedTyreSlot tyre;
  final String code;
  final TyreCondition condition;
  final TpStatus status;
  final bool isRecorded;
  final bool isOutstanding;
  final String? pressureText;

  TyreWheelPaintData paintData({bool isSelected = false}) => TyreWheelPaintData(
    svgX: tyre.x,
    svgY: tyre.y,
    svgW: tyre.w,
    svgH: tyre.h,
    status: status,
    isSelected: isSelected,
    isOutstanding: isOutstanding,
    isRecorded: isRecorded,
  );
}

class _WheelHitTarget extends StatelessWidget {
  const _WheelHitTarget({
    required this.wheel,
    required this.viewport,
    required this.isSelected,
    required this.label,
    required this.onTap,
  });

  final _ResolvedWheel wheel;
  final TyreDiagramViewport viewport;
  final bool isSelected;
  final String label;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final Rect rect = viewport.hitRect(
      wheel.tyre.x,
      wheel.tyre.y,
      wheel.tyre.w,
      wheel.tyre.h,
    );
    return Positioned.fromRect(
      rect: rect,
      child: Semantics(
        label: label,
        selected: isSelected,
        button: onTap != null,
        child: GestureDetector(
          onTap: onTap,
          behavior: HitTestBehavior.opaque,
          child: const SizedBox.expand(),
        ),
      ),
    );
  }
}

class _ConditionLegend extends StatelessWidget {
  const _ConditionLegend({required this.l10n});

  final AppLocalizations l10n;

  static const List<TyreCondition> _kOrder = <TyreCondition>[
    TyreCondition.good,
    TyreCondition.worn,
    TyreCondition.damaged,
    TyreCondition.puncture,
    TyreCondition.flat,
    TyreCondition.missing,
  ];

  @override
  Widget build(BuildContext context) {
    return Wrap(
      alignment: WrapAlignment.center,
      spacing: TpSpace.xs,
      runSpacing: TpSpace.xs,
      children: <Widget>[
        for (final TyreCondition condition in _kOrder)
          TpStatusChip(
            status: tyreConditionStatus(condition),
            label: tyreConditionLabel(l10n, condition),
            isCompact: true,
          ),
      ],
    );
  }
}

class _EmptyDiagramState extends StatelessWidget {
  const _EmptyDiagramState({
    required this.icon,
    required this.title,
    required this.message,
  });

  final IconData icon;

  /// Fleet data - the raw vehicle type - never translated.
  final String title;

  final String message;

  @override
  Widget build(BuildContext context) {
    final TpPalette palette = TpPalette.of(context);
    return TpCard(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: <Widget>[
          Icon(icon, size: TpSizing.iconState, color: palette.textMuted),
          const SizedBox(height: TpSpace.md),
          Text(
            title,
            style: Theme.of(context).textTheme.titleLarge,
            textAlign: TextAlign.center,
          ),
          const SizedBox(height: TpSpace.xs),
          Text(
            message,
            style: Theme.of(context).textTheme.bodyMedium,
            textAlign: TextAlign.center,
          ),
        ],
      ),
    );
  }
}
