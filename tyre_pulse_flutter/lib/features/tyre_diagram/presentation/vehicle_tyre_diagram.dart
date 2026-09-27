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

import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:flutter_svg/flutter_svg.dart';
import 'package:tyre_pulse/app/localization/tp_direction.dart';
import 'package:tyre_pulse/app/localization/tp_localizations.dart';
import 'package:tyre_pulse/app/theme/tp_colors.dart';
import 'package:tyre_pulse/app/theme/tp_spacing.dart';
import 'package:tyre_pulse/core/design_system/design_system.dart';
import 'package:tyre_pulse/features/tyre_diagram/domain/tyre_completeness.dart';
import 'package:tyre_pulse/features/tyre_diagram/domain/tyre_condition.dart';
import 'package:tyre_pulse/features/tyre_diagram/domain/tyre_diagram_layouts.dart';
import 'package:tyre_pulse/features/tyre_diagram/domain/tyre_position_matcher.dart';
import 'package:tyre_pulse/features/tyre_diagram/domain/tyre_position_struct.dart';
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
    this.compact = false,
    this.captureMode = false,
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

  /// Focused inspection/approval presentation matching the approved mock.
  final bool compact;

  /// Focused inspection capture presentation. The real vehicle artwork and
  /// authored wheel geometry stay unchanged; only the surrounding hierarchy
  /// gains FRONT/REAR orientation and visible inner/outer position labels.
  final bool captureMode;

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
    final Map<String, Rect> hitRects = buildTyreHitRects(
      layout: layout,
      viewport: viewport,
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
    _ResolvedWheel? selectedWheel;
    for (final _ResolvedWheel wheel in resolved) {
      if (wheel.tyre.positionId == selectedPosition ||
          wheel.tyre.id == selectedPosition) {
        selectedWheel = wheel;
        break;
      }
    }

    final Widget diagramCanvas = captureMode
        ? _FigmaTyreCaptureStage(
            layout: layout,
            wheels: resolved,
            width: width,
            selectedPosition: selectedPosition,
            onPositionTap: onPositionTap,
          )
        : _diagramCanvas(
            context: context,
            layout: layout,
            viewport: viewport,
            hitRects: hitRects,
            wheels: resolved,
            showPositionLabels: false,
          );

    if (captureMode) {
      return Column(
        crossAxisAlignment: CrossAxisAlignment.center,
        mainAxisSize: MainAxisSize.min,
        children: <Widget>[
          _CaptureOrientationPill(
            label: l10n.tyreDiagramFrontLabel,
            icon: Icons.keyboard_double_arrow_up_rounded,
          ),
          const SizedBox(height: TpSpace.sm),
          diagramCanvas,
          const SizedBox(height: TpSpace.sm),
          _CaptureOrientationPill(
            label: l10n.inspectionRearLabel,
            icon: Icons.keyboard_double_arrow_down_rounded,
          ),
        ],
      );
    }

    return TpCard(
      padding: EdgeInsets.all(compact ? TpSpace.sm : TpSpace.lg),
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
          if (!compact) ...<Widget>[
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
          ],
          if (!compact && pendingOnScreen.isNotEmpty) ...<Widget>[
            const SizedBox(height: TpSpace.sm),
            Text(
              l10n.tyreDiagramPendingLeadIn(pendingOnScreen.length),
              style: Theme.of(context)
                  .textTheme
                  .labelMedium
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
          diagramCanvas,
          const SizedBox(height: TpSpace.md),
          if (selectedWheel != null) ...<Widget>[
            _SelectedTyreSummary(wheel: selectedWheel, l10n: l10n),
            const SizedBox(height: TpSpace.md),
          ],
          _ConditionLegend(l10n: l10n, compact: compact),
        ],
      ),
    );
  }

  Widget _diagramCanvas({
    required BuildContext context,
    required DiagramLayout layout,
    required TyreDiagramViewport viewport,
    required Map<String, Rect> hitRects,
    required List<_ResolvedWheel> wheels,
    required bool showPositionLabels,
  }) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final TpPalette palette = TpPalette.of(context);
    final double gutter = showPositionLabels ? 56 : 0;

    return Directionality(
      textDirection: TextDirection.ltr,
      child: SizedBox(
        width: viewport.width + (gutter * 2),
        height: viewport.height,
        child: Stack(
          clipBehavior: Clip.none,
          children: <Widget>[
            Positioned(
              left: gutter,
              top: 0,
              width: viewport.width,
              height: viewport.height,
              child: Stack(
                children: <Widget>[
                  TyreDiagramBody(
                    bodyKey: layout.bodyKey,
                    viewport: viewport,
                  ),
                  CustomPaint(
                    size: Size(viewport.width, viewport.height),
                    painter: TyreWheelPainter(
                      wheels: <TyreWheelPaintData>[
                        for (final _ResolvedWheel wheel in wheels)
                          wheel.paintData(
                            isSelected:
                                wheel.tyre.positionId == selectedPosition,
                          ),
                      ],
                      viewport: viewport,
                      palette: palette,
                    ),
                  ),
                  for (final _ResolvedWheel wheel in wheels)
                    _WheelHitTarget(
                      wheel: wheel,
                      rect: hitRects[wheel.tyre.id]!,
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
            if (showPositionLabels)
              for (final _ResolvedWheel wheel in wheels)
                _CapturePositionLabel(
                  label: wheel.code,
                  position: parsePositionStruct(wheel.tyre.id),
                  wheelRect: hitRects[wheel.tyre.id]!,
                  diagramLeft: gutter,
                  diagramWidth: viewport.width,
                  viewportHeight: viewport.height,
                ),
          ],
        ),
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
    // An unchecked seeded Good value is not a result. Keep the condition
    // nullable so paint, the selected summary and screen-reader semantics all
    // agree that the wheel is not measured until there is deliberate evidence.
    final TyreCondition? condition = wheelConditionFor(entry);
    final TpStatus status = wheelStatusFor(entry);
    // "Has evidence" (and the pressure reading that goes with it) is
    // answered ONCE, by the completeness engine's own rule, and read from a
    // SINGLE classification call - never a second, weaker truthiness check
    // inside this widget. Section 7.2 names the RN source's own inline
    // `!!d.serial_number || ...` as exactly the bug this avoids: it would
    // treat a numeric `0` pressure as absent.
    final EntryClassification? classification =
        entry == null ? null : classifyEntry(entry);
    final bool isRecorded =
        classification != null && classification.state != TyreSlotState.blank;
    final bool isOutstanding = pendingKeys.contains(keyOf(tyre.positionId)) ||
        pendingKeys.contains(keyOf(tyre.id));
    final String code = legacyPositionCode(layout.key, tyre.id);
    final String? serial = _entryText(
      entry,
      const <String>[
        'serial_number',
        'serial_no',
        'serial',
        'installed_serial',
      ],
    );

    // Display values are shown ONLY when actually recorded, exactly as
    // stored (psi, mm) - never converted, rounded to a target or defaulted.
    final Object? tread = entry?['tread_depth_mm'] ?? entry?['tread_depth'];

    return _ResolvedWheel(
      tyre: tyre,
      code: code,
      serial: serial,
      condition: condition,
      status: status,
      isRecorded: isRecorded,
      isOutstanding: isOutstanding,
      pressureText: classification?.pressure?.toString(),
      pressureDisplay: _formatReading(classification?.pressure),
      treadDisplay: isRecorded ? _formatReading(tread) : null,
    );
  }
}

/// Formats a stored reading for display without changing its value: a whole
/// number drops its `.0`, anything else keeps one decimal. A blank or
/// unreadable value is `null` (not recorded), never `0`.
String? _formatReading(Object? value) {
  if (value == null) return null;
  final double? number = value is num
      ? value.toDouble()
      : double.tryParse(value.toString().trim());
  if (number == null) {
    final String text = value.toString().trim();
    return text.isEmpty ? null : text;
  }
  return number == number.roundToDouble()
      ? number.toInt().toString()
      : number.toStringAsFixed(1);
}

String? _entryText(Map<String, Object?>? entry, List<String> keys) {
  for (final String key in keys) {
    final String value = entry?[key]?.toString().trim() ?? '';
    if (value.isNotEmpty) return value;
  }
  return null;
}

/// Geometry of the focused capture stage, shared by the stage and its tests.
///
/// Every tyre gets its OWN row: a dual axle's Outer and Inner wheels are two
/// stacked, full-height cards rather than two half-width cards side by side,
/// so a 14-position pump stays readable at a 360dp handset width. The stage
/// grows with the side that has the most rows instead of shrinking cards
/// below a readable size.
@visibleForTesting
abstract final class TyreCaptureStageMetrics {
  /// The position code drawn above each card.
  static const double labelHeight = 12;
  static const double labelGap = 2;

  /// Card height. Never below [TpSizing.minTouchTarget].
  static const double cardHeight = 48;
  static const double slotExtent = labelHeight + labelGap + cardHeight;

  /// Gap between the rows of ONE physical axle (a dual's Outer and Inner).
  static const double rowGap = 4;

  /// Gap between two physical axles.
  static const double groupGap = 8;
  static const double inset = 12;
  static const double minLeader = 18;
  static const double knobSize = 16;

  static double cardWidthFor(double stageWidth) =>
      (stageWidth * 0.2).clamp(62, 74).toDouble();

  static double groupHeight(int rows) =>
      rows <= 0 ? 0 : (rows * slotExtent) + ((rows - 1) * rowGap);

  /// The height one side needs to show every row without overlap.
  static double requiredHeight(List<int> rowsPerGroup) {
    if (rowsPerGroup.isEmpty) return 0;
    double total = inset * 2;
    for (final int rows in rowsPerGroup) {
      total += groupHeight(rows);
    }
    return total + ((rowsPerGroup.length - 1) * groupGap);
  }
}

class _FigmaTyreCaptureStage extends StatelessWidget {
  const _FigmaTyreCaptureStage({
    required this.layout,
    required this.wheels,
    required this.width,
    required this.selectedPosition,
    required this.onPositionTap,
  });

  final DiagramLayout layout;
  final List<_ResolvedWheel> wheels;
  final double width;
  final String? selectedPosition;
  final ValueChanged<String>? onPositionTap;

  @override
  Widget build(BuildContext context) {
    final TpPalette palette = TpPalette.of(context);
    // The stage is laid out physically (vehicle left is screen left), so it
    // is pinned LTR below. Card text still follows the reader's direction.
    final TextDirection readingDirection = Directionality.of(context);
    final bool tall = layout.viewH >= 360;
    final double cardWidth = TyreCaptureStageMetrics.cardWidthFor(width);
    final double photoWidth =
        (width - ((cardWidth + TyreCaptureStageMetrics.minLeader) * 2))
            .clamp(width * 0.28, width * 0.5)
            .toDouble();
    final double photoLeft = (width - photoWidth) / 2;
    final TyreDiagramPhotoSpec? photo = tyreDiagramVehiclePhotoSpec(
      layout.bodyKey,
    );

    final List<_ResolvedWheel> left = <_ResolvedWheel>[];
    final List<_ResolvedWheel> right = <_ResolvedWheel>[];
    for (final _ResolvedWheel wheel in wheels) {
      final PositionStruct position = parsePositionStruct(wheel.tyre.id);
      if (position.side == PositionSide.right) {
        right.add(wheel);
      } else if (position.side == PositionSide.left) {
        left.add(wheel);
      } else if (wheel.tyre.x < 100) {
        left.add(wheel);
      } else {
        right.add(wheel);
      }
    }
    final List<_CaptureAxleGroup> leftAxles = _groupByPhysicalAxle(left);
    final List<_CaptureAxleGroup> rightAxles = _groupByPhysicalAxle(right);
    final double stageHeight = math.max(
      tall ? 430.0 : 324.0,
      math.max(
        TyreCaptureStageMetrics.requiredHeight(<int>[
          for (final _CaptureAxleGroup group in leftAxles) group.wheels.length,
        ]),
        TyreCaptureStageMetrics.requiredHeight(<int>[
          for (final _CaptureAxleGroup group in rightAxles) group.wheels.length,
        ]),
      ),
    );

    double firstCentre = double.infinity;
    double lastCentre = double.negativeInfinity;
    for (final _ResolvedWheel wheel in wheels) {
      final double centre = wheel.tyre.y + (wheel.tyre.h / 2);
      if (centre < firstCentre) firstCentre = centre;
      if (centre > lastCentre) lastCentre = centre;
    }
    // The vertical band the artwork really occupies. A contain-fitted photo
    // (or the SVG body) narrower than the stage is letterboxed, so cards are
    // aimed at the vehicle itself rather than at the empty space around it.
    const double photoPad = 3;
    final double innerHeight = stageHeight - (photoPad * 2);
    final double? artAspect = photo == null
        ? kDiagramViewWidth / (layout.viewH - (kDiagramViewMinY * 2))
        : photo.fit == BoxFit.contain
            ? photo.aspectRatio
            : null;
    final double bandHeight = artAspect == null || artAspect <= 0
        ? innerHeight
        : math.min(innerHeight, photoWidth / artAspect);
    final double bandTop = photoPad + ((innerHeight - bandHeight) / 2);

    // Where an axle centre lands on the stage. A photo that declares where
    // its own first and last axles sit is followed exactly, so each leader
    // line points at the photographed wheel; the SVG body shares the
    // layout's own coordinates; otherwise the authored layout fraction is
    // the best available estimate.
    double targetY(double layoutCentre) {
      final double? front = photo?.frontAxleFraction;
      final double? rear = photo?.rearAxleFraction;
      if (front != null && rear != null && lastCentre - firstCentre >= 1) {
        final double t =
            (layoutCentre - firstCentre) / (lastCentre - firstCentre);
        return bandTop + ((front + ((rear - front) * t)) * bandHeight);
      }
      final double fraction = photo == null
          ? (layoutCentre - kDiagramViewMinY) /
              (layout.viewH - (kDiagramViewMinY * 2))
          : layoutCentre / layout.viewH;
      return bandTop + (fraction * bandHeight);
    }

    final List<double> leftTops = _topsForGroups(
      leftAxles,
      targetY: targetY,
      stageHeight: stageHeight,
    );
    final List<double> rightTops = _topsForGroups(
      rightAxles,
      targetY: targetY,
      stageHeight: stageHeight,
    );

    List<Widget> side({
      required List<_CaptureAxleGroup> groups,
      required List<double> tops,
      required bool onLeft,
    }) {
      final String sideKey = onLeft ? 'left' : 'right';
      final double leaderLeft = onLeft ? cardWidth : photoLeft + photoWidth;
      final double leaderWidth = onLeft
          ? photoLeft - cardWidth
          : width - cardWidth - photoLeft - photoWidth;
      return <Widget>[
        for (int i = 0; i < groups.length; i++) ...<Widget>[
          for (int row = 0; row < groups[i].wheels.length; row++)
            Positioned(
              left: leaderLeft,
              top: tops[i] +
                  (row *
                      (TyreCaptureStageMetrics.slotExtent +
                          TyreCaptureStageMetrics.rowGap)) +
                  TyreCaptureStageMetrics.labelHeight +
                  TyreCaptureStageMetrics.labelGap +
                  ((TyreCaptureStageMetrics.cardHeight -
                          TyreCaptureStageMetrics.knobSize) /
                      2),
              width: leaderWidth < 0 ? 0 : leaderWidth,
              height: TyreCaptureStageMetrics.knobSize,
              child: _CaptureLeader(
                wheel: groups[i].wheels[row],
                vehicleOnRight: onLeft,
              ),
            ),
          Positioned(
            left: onLeft ? 0 : null,
            right: onLeft ? null : 0,
            top: tops[i],
            width: cardWidth,
            height: TyreCaptureStageMetrics.groupHeight(
              groups[i].wheels.length,
            ),
            child: _CaptureAxleControls(
              key: ValueKey<String>('tyre.diagram.axle.$sideKey.$i'),
              group: groups[i],
              cardWidth: cardWidth,
              readingDirection: readingDirection,
              selectedPosition: selectedPosition,
              onPositionTap: onPositionTap,
            ),
          ),
        ],
      ];
    }

    return Directionality(
      textDirection: TextDirection.ltr,
      child: SizedBox(
        key: const Key('tyre.diagram.figma_capture_stage'),
        width: width,
        height: stageHeight,
        child: DecoratedBox(
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(16),
            border: Border.all(color: palette.border),
            gradient: LinearGradient(
              begin: Alignment.topCenter,
              end: Alignment.bottomCenter,
              colors: <Color>[palette.surface, palette.surfaceAlt],
            ),
          ),
          child: Stack(
            clipBehavior: Clip.none,
            children: <Widget>[
              Positioned.fill(
                child: ExcludeSemantics(
                  child: ClipRRect(
                    borderRadius: BorderRadius.circular(16),
                    child: CustomPaint(
                      painter: _CaptureGridPainter(
                        color: palette.info.base,
                        glow: palette.surface,
                        vehicleCentre: Rect.fromLTWH(
                          photoLeft,
                          0,
                          photoWidth,
                          stageHeight,
                        ),
                      ),
                    ),
                  ),
                ),
              ),
              Positioned(
                left: photoLeft,
                top: 0,
                width: photoWidth,
                height: stageHeight,
                child: Padding(
                  padding: const EdgeInsets.symmetric(vertical: 3),
                  child: photo != null
                      ? RotatedBox(
                          quarterTurns: photo.quarterTurns,
                          child: Image.asset(
                            photo.asset,
                            key: ValueKey<String>(photo.asset),
                            fit: photo.fit,
                            filterQuality: FilterQuality.high,
                            excludeFromSemantics: true,
                          ),
                        )
                      : SvgPicture.asset(
                          tyreDiagramBodyAsset(layout.bodyKey),
                          fit: BoxFit.contain,
                          excludeFromSemantics: true,
                        ),
                ),
              ),
              ...side(groups: leftAxles, tops: leftTops, onLeft: true),
              ...side(groups: rightAxles, tops: rightTops, onLeft: false),
            ],
          ),
        ),
      ),
    );
  }

  static int _compareWheelPosition(_ResolvedWheel a, _ResolvedWheel b) {
    final int y = a.tyre.y.compareTo(b.tyre.y);
    if (y != 0) return y;
    return a.tyre.x.compareTo(b.tyre.x);
  }

  /// Outer before inner, so every dual axle reads the same way on both
  /// sides of the vehicle.
  static int _roleOrder(_ResolvedWheel wheel) {
    return switch (parsePositionStruct(wheel.tyre.id).role) {
      PositionRole.outer => 0,
      PositionRole.single => 1,
      PositionRole.inner => 2,
    };
  }

  static List<_CaptureAxleGroup> _groupByPhysicalAxle(
    List<_ResolvedWheel> wheels,
  ) {
    wheels.sort(_compareWheelPosition);
    final List<_CaptureAxleGroup> groups = <_CaptureAxleGroup>[];
    for (final _ResolvedWheel wheel in wheels) {
      final double centerY = wheel.tyre.y + (wheel.tyre.h / 2);
      if (groups.isEmpty || (groups.last.centerY - centerY).abs() > 1) {
        groups.add(
          _CaptureAxleGroup(centerY: centerY, wheels: <_ResolvedWheel>[wheel]),
        );
      } else {
        groups.last.wheels.add(wheel);
      }
    }
    for (final _CaptureAxleGroup group in groups) {
      group.wheels.sort((_ResolvedWheel a, _ResolvedWheel b) {
        final int role = _roleOrder(a).compareTo(_roleOrder(b));
        if (role != 0) return role;
        // Two wheels with the same role on one side: furthest from the
        // centreline first.
        return (b.tyre.x + (b.tyre.w / 2) - 100)
            .abs()
            .compareTo((a.tyre.x + (a.tyre.w / 2) - 100).abs());
      });
    }
    return groups;
  }

  static List<double> _topsForGroups(
    List<_CaptureAxleGroup> groups, {
    required double Function(double layoutCentre) targetY,
    required double stageHeight,
  }) {
    if (groups.isEmpty) return const <double>[];
    const double inset = TyreCaptureStageMetrics.inset;
    const double gap = TyreCaptureStageMetrics.groupGap;
    const double rowPitch =
        TyreCaptureStageMetrics.slotExtent + TyreCaptureStageMetrics.rowGap;
    const double firstCardCentre = TyreCaptureStageMetrics.labelHeight +
        TyreCaptureStageMetrics.labelGap +
        (TyreCaptureStageMetrics.cardHeight / 2);
    final List<double> heights = <double>[
      for (final _CaptureAxleGroup group in groups)
        TyreCaptureStageMetrics.groupHeight(group.wheels.length),
    ];
    // Centre the axle's cards (not its labels) on the axle.
    final List<double> tops = <double>[
      for (int i = 0; i < groups.length; i++)
        (targetY(groups[i].centerY) -
                firstCardCentre -
                (((groups[i].wheels.length - 1) * rowPitch) / 2))
            .clamp(inset, math.max(inset, stageHeight - inset - heights[i]))
            .toDouble(),
    ];

    // Keep every card readable when authored axle centres are close, while
    // retaining their physical front-to-rear order.
    for (int i = 1; i < tops.length; i++) {
      final double minimum = tops[i - 1] + heights[i - 1] + gap;
      if (tops[i] < minimum) tops[i] = minimum;
    }
    final double maxLastTop = stageHeight - inset - heights.last;
    if (tops.last > maxLastTop) {
      tops[tops.length - 1] = maxLastTop;
      for (int i = tops.length - 2; i >= 0; i--) {
        final double maximum = tops[i + 1] - heights[i] - gap;
        if (tops[i] > maximum) tops[i] = maximum;
      }
    }
    return tops;
  }
}

class _CaptureAxleGroup {
  _CaptureAxleGroup({required this.centerY, required this.wheels});

  final double centerY;
  final List<_ResolvedWheel> wheels;
}

/// One physical axle on one side: each wheel is its own full row, a
/// position label over its card.
class _CaptureAxleControls extends StatelessWidget {
  const _CaptureAxleControls({
    required this.group,
    required this.cardWidth,
    required this.readingDirection,
    required this.selectedPosition,
    required this.onPositionTap,
    super.key,
  });

  final _CaptureAxleGroup group;
  final double cardWidth;
  final TextDirection readingDirection;
  final String? selectedPosition;
  final ValueChanged<String>? onPositionTap;

  @override
  Widget build(BuildContext context) {
    final TpPalette palette = TpPalette.of(context);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: <Widget>[
        for (int i = 0; i < group.wheels.length; i++) ...<Widget>[
          if (i > 0) const SizedBox(height: TyreCaptureStageMetrics.rowGap),
          SizedBox(
            height: TyreCaptureStageMetrics.labelHeight,
            // The card's own semantics already carry the code; a second,
            // non-tappable node here would only duplicate it.
            child: ExcludeSemantics(
              child: Center(
                child: TpIdentifierText(
                  group.wheels[i].code,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: Theme.of(context).textTheme.labelSmall?.copyWith(
                        color: palette.text,
                        fontSize: 10,
                        height: 1.2,
                        fontWeight: FontWeight.w800,
                      ),
                ),
              ),
            ),
          ),
          const SizedBox(height: TyreCaptureStageMetrics.labelGap),
          SizedBox(
            height: TyreCaptureStageMetrics.cardHeight,
            child: _FigmaTyreStatusCard(
              wheel: group.wheels[i],
              width: cardWidth,
              readingDirection: readingDirection,
              selected: _isSelected(group.wheels[i]),
              onTap: onPositionTap == null
                  ? null
                  : () => onPositionTap!(group.wheels[i].tyre.positionId),
            ),
          ),
        ],
      ],
    );
  }

  bool _isSelected(_ResolvedWheel wheel) =>
      wheel.tyre.positionId == selectedPosition ||
      wheel.tyre.id == selectedPosition;
}

/// A wheel's display tone: an unrecorded wheel is never given a result
/// colour, whatever its seeded condition says.
TpStatus _captureTone(_ResolvedWheel wheel) =>
    wheel.isRecorded ? wheel.status : TpStatus.unknown;

IconData _captureStatusIcon(TpStatus tone) => switch (tone) {
      TpStatus.ok => Icons.check_rounded,
      TpStatus.critical => Icons.priority_high_rounded,
      TpStatus.warning => Icons.priority_high_rounded,
      TpStatus.unknown => Icons.remove_rounded,
      TpStatus.info || TpStatus.neutral => Icons.circle,
    };

/// The dashed leader from a card to the vehicle, ending in a small
/// status-coloured chevron at the vehicle end. Decoration only - the card is
/// the one tap target for its wheel.
class _CaptureLeader extends StatelessWidget {
  const _CaptureLeader({required this.wheel, required this.vehicleOnRight});

  final _ResolvedWheel wheel;
  final bool vehicleOnRight;

  @override
  Widget build(BuildContext context) {
    final TpPalette palette = TpPalette.of(context);
    final TpStatus tone = _captureTone(wheel);
    final TpStatusColors colors = palette.forStatus(tone);
    final Color lineColor =
        tone == TpStatus.unknown ? palette.borderStrong : colors.base;
    const double knob = TyreCaptureStageMetrics.knobSize;
    return ExcludeSemantics(
      child: Stack(
        clipBehavior: Clip.none,
        children: <Widget>[
          Positioned(
            left: vehicleOnRight ? 2 : knob + 2,
            right: vehicleOnRight ? knob + 2 : 2,
            top: 0,
            bottom: 0,
            child: CustomPaint(
              painter: _DashedLeaderPainter(color: lineColor),
            ),
          ),
          Positioned(
            left: vehicleOnRight ? null : 0,
            right: vehicleOnRight ? 0 : null,
            top: 0,
            width: knob,
            height: knob,
            child: DecoratedBox(
              decoration: BoxDecoration(
                color: colors.base,
                shape: BoxShape.circle,
                border: Border.all(color: palette.surface, width: 1.5),
                boxShadow: <BoxShadow>[
                  BoxShadow(
                    color: colors.base.withValues(alpha: 0.35),
                    blurRadius: 4,
                    offset: const Offset(0, 1),
                  ),
                ],
              ),
              child: Icon(
                vehicleOnRight
                    ? Icons.chevron_right_rounded
                    : Icons.chevron_left_rounded,
                color: colors.onBase,
                size: 12,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _DashedLeaderPainter extends CustomPainter {
  const _DashedLeaderPainter({required this.color});

  final Color color;

  @override
  void paint(Canvas canvas, Size size) {
    final Paint paint = Paint()
      ..color = color
      ..strokeWidth = 1.6
      ..strokeCap = StrokeCap.round;
    final double y = size.height / 2;
    const double dash = 4;
    const double gap = 2.5;
    double x = 0;
    while (x < size.width) {
      final double end = math.min(x + dash, size.width);
      canvas.drawLine(Offset(x, y), Offset(end, y), paint);
      x += dash + gap;
    }
  }

  @override
  bool shouldRepaint(_DashedLeaderPainter oldDelegate) =>
      oldDelegate.color != color;
}

/// The blueprint grid behind the vehicle on the approved mocks: a fine
/// minor grid, a stronger major grid every fourth line and a soft glow
/// under the vehicle so the photo lifts off the paper. Decoration only.
class _CaptureGridPainter extends CustomPainter {
  const _CaptureGridPainter({
    required this.color,
    required this.glow,
    required this.vehicleCentre,
  });

  final Color color;
  final Color glow;
  final Rect vehicleCentre;

  @override
  void paint(Canvas canvas, Size size) {
    final Paint minor = Paint()
      ..color = color.withValues(alpha: 0.07)
      ..strokeWidth = 0.6;
    final Paint major = Paint()
      ..color = color.withValues(alpha: 0.14)
      ..strokeWidth = 0.8;
    const double step = 16;
    int i = 1;
    for (double x = step; x < size.width; x += step, i++) {
      canvas.drawLine(
        Offset(x, 0),
        Offset(x, size.height),
        i % 4 == 0 ? major : minor,
      );
    }
    i = 1;
    for (double y = step; y < size.height; y += step, i++) {
      canvas.drawLine(
        Offset(0, y),
        Offset(size.width, y),
        i % 4 == 0 ? major : minor,
      );
    }

    final Rect glowRect = vehicleCentre.inflate(vehicleCentre.width * 0.35);
    canvas.drawOval(
      glowRect,
      Paint()
        ..shader = RadialGradient(
          colors: <Color>[
            glow.withValues(alpha: 0.9),
            glow.withValues(alpha: 0),
          ],
        ).createShader(glowRect),
    );
  }

  @override
  bool shouldRepaint(_CaptureGridPainter oldDelegate) =>
      oldDelegate.color != color ||
      oldDelegate.glow != glow ||
      oldDelegate.vehicleCentre != vehicleCentre;
}

/// FRONT / REAR orientation marker above and below the capture stage.
class _CaptureOrientationPill extends StatelessWidget {
  const _CaptureOrientationPill({required this.label, required this.icon});

  final String label;
  final IconData icon;

  @override
  Widget build(BuildContext context) {
    final TpPalette palette = TpPalette.of(context);
    return DecoratedBox(
      decoration: BoxDecoration(
        color: palette.surface,
        borderRadius: BorderRadius.circular(TpRadius.pill),
        border: Border.all(color: palette.border),
      ),
      child: Padding(
        padding: const EdgeInsets.symmetric(
          horizontal: TpSpace.md,
          vertical: 3,
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: <Widget>[
            ExcludeSemantics(
              child: Icon(icon, size: 14, color: palette.primary),
            ),
            const SizedBox(width: TpSpace.xs),
            Text(
              label,
              style: Theme.of(context).textTheme.labelSmall?.copyWith(
                    color: palette.text,
                    fontWeight: FontWeight.w800,
                    letterSpacing: 1.2,
                  ),
            ),
          ],
        ),
      ),
    );
  }
}

/// A text-led tyre card: status icon, then ONLY what was actually recorded
/// (tread in mm and pressure in psi, exactly as stored). A wheel with no
/// evidence says so rather than showing a value.
class _FigmaTyreStatusCard extends StatelessWidget {
  const _FigmaTyreStatusCard({
    required this.wheel,
    required this.width,
    required this.readingDirection,
    required this.selected,
    required this.onTap,
  });

  final _ResolvedWheel wheel;
  final double width;
  final TextDirection readingDirection;
  final bool selected;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final TpPalette palette = TpPalette.of(context);
    final TpStatus tone = _captureTone(wheel);
    final TpStatusColors colors = palette.forStatus(tone);
    final String statusLabel = !wheel.isRecorded || wheel.condition == null
        ? l10n.tyreDiagramListNotRecorded
        : tyreConditionLabel(l10n, wheel.condition!);
    final String semanticLabel = wheel.pressureText == null
        ? '${wheel.code}, $statusLabel'
        : '${wheel.code}, $statusLabel, ${wheel.pressureText}';
    final bool hasMeasurement =
        wheel.treadDisplay != null || wheel.pressureDisplay != null;
    final Color valueColor =
        tone == TpStatus.critical ? colors.base : palette.text;
    final TextStyle? valueStyle =
        Theme.of(context).textTheme.labelSmall?.copyWith(
              color: valueColor,
              fontSize: 12,
              height: 1.15,
              fontWeight: FontWeight.w800,
            );
    const double hPad = 6;
    const double vPad = 3;
    final double innerWidth = width - (hPad * 2) - 4;

    final Color borderColor = selected
        ? (tone == TpStatus.unknown ? palette.focus : colors.base)
        : (tone == TpStatus.unknown ? palette.borderStrong : colors.base);
    final Color fill = tone == TpStatus.critical
        ? colors.soft
        : (selected
            ? Color.alphaBlend(
                colors.soft.withValues(alpha: 0.55),
                palette.surface,
              )
            : palette.surface);

    return Semantics(
      label: semanticLabel,
      selected: selected,
      button: onTap != null,
      child: DecoratedBox(
        decoration: BoxDecoration(
          borderRadius: BorderRadius.circular(10),
          boxShadow: <BoxShadow>[
            BoxShadow(
              color: (tone == TpStatus.unknown ? palette.overlay : colors.base)
                  .withValues(alpha: selected ? 0.32 : 0.14),
              blurRadius: selected ? 10 : 6,
              spreadRadius: selected ? 1 : 0,
              offset: const Offset(0, 2),
            ),
          ],
        ),
        child: Material(
          color: fill,
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(10),
            side: BorderSide(
              color: borderColor,
              width: selected ? 2.2 : 1.4,
            ),
          ),
          clipBehavior: Clip.antiAlias,
          child: InkWell(
            onTap: onTap,
            child: Padding(
              padding: const EdgeInsets.symmetric(
                horizontal: hPad,
                vertical: vPad,
              ),
              child: Directionality(
                textDirection: readingDirection,
                child: FittedBox(
                  fit: BoxFit.scaleDown,
                  alignment: AlignmentDirectional.topStart,
                  child: SizedBox(
                    width: innerWidth < 1 ? 1 : innerWidth,
                    child: ExcludeSemantics(
                      child: Column(
                        mainAxisSize: MainAxisSize.min,
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: <Widget>[
                          DecoratedBox(
                            decoration: BoxDecoration(
                              color: colors.base,
                              shape: BoxShape.circle,
                            ),
                            child: SizedBox(
                              width: 15,
                              height: 15,
                              child: Icon(
                                _captureStatusIcon(tone),
                                color: colors.onBase,
                                size: 11,
                              ),
                            ),
                          ),
                          const SizedBox(height: 2),
                          if (wheel.isRecorded && !hasMeasurement)
                            Text(
                              statusLabel,
                              maxLines: 2,
                              overflow: TextOverflow.ellipsis,
                              style: valueStyle,
                            ),
                          if (!wheel.isRecorded)
                            Text(
                              l10n.tyreDiagramListNotRecorded,
                              maxLines: 2,
                              overflow: TextOverflow.ellipsis,
                              style: valueStyle?.copyWith(
                                color: palette.textSecondary,
                                fontWeight: FontWeight.w600,
                              ),
                            ),
                          if (wheel.treadDisplay != null)
                            _CaptureMeasurement(
                              text: l10n.tyreDiagramListTreadValue(
                                wheel.treadDisplay!,
                              ),
                              number: wheel.treadDisplay!,
                              style: valueStyle,
                              unitColor: tone == TpStatus.critical
                                  ? colors.base
                                  : palette.textSecondary,
                            ),
                          if (wheel.pressureDisplay != null)
                            _CaptureMeasurement(
                              text: l10n.tyreDiagramListPressureValue(
                                wheel.pressureDisplay!,
                              ),
                              number: wheel.pressureDisplay!,
                              style: valueStyle,
                              unitColor: tone == TpStatus.critical
                                  ? colors.base
                                  : palette.textSecondary,
                            ),
                        ],
                      ),
                    ),
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

/// One recorded value, the number set bold and its unit set lighter, while
/// the whole localized string (e.g. `118 psi`) stays one text node.
class _CaptureMeasurement extends StatelessWidget {
  const _CaptureMeasurement({
    required this.text,
    required this.number,
    required this.style,
    required this.unitColor,
  });

  final String text;
  final String number;
  final TextStyle? style;
  final Color unitColor;

  @override
  Widget build(BuildContext context) {
    final int at = text.indexOf(number);
    final TextStyle? unitStyle = style?.copyWith(
      fontSize: 9.5,
      fontWeight: FontWeight.w600,
      color: unitColor,
    );
    final List<InlineSpan> spans = at < 0
        ? <InlineSpan>[TextSpan(text: text, style: style)]
        : <InlineSpan>[
            if (at > 0) TextSpan(text: text.substring(0, at), style: unitStyle),
            TextSpan(text: number, style: style),
            if (at + number.length < text.length)
              TextSpan(
                text: text.substring(at + number.length),
                style: unitStyle,
              ),
          ];
    return Text.rich(
      TextSpan(children: spans),
      maxLines: 1,
      overflow: TextOverflow.ellipsis,
    );
  }
}

class _CapturePositionLabel extends StatelessWidget {
  const _CapturePositionLabel({
    required this.label,
    required this.position,
    required this.wheelRect,
    required this.diagramLeft,
    required this.diagramWidth,
    required this.viewportHeight,
  });

  final String label;
  final PositionStruct position;
  final Rect wheelRect;
  final double diagramLeft;
  final double diagramWidth;
  final double viewportHeight;

  @override
  Widget build(BuildContext context) {
    final bool onLeft = position.side != PositionSide.right;
    final double roleOffset = switch (position.role) {
      PositionRole.outer => -10,
      PositionRole.inner => 10,
      PositionRole.single => 0,
    };
    final double top = (wheelRect.center.dy - 9 + roleOffset)
        .clamp(0, viewportHeight - 18)
        .toDouble();
    return Positioned(
      left: onLeft ? 0 : diagramLeft + diagramWidth + TpSpace.sm,
      top: top,
      width: 48,
      child: ExcludeSemantics(
        child: Align(
          alignment: onLeft ? Alignment.centerRight : Alignment.centerLeft,
          child: TpIdentifierText(
            label,
            maxLines: 1,
            overflow: TextOverflow.visible,
            style: Theme.of(context).textTheme.labelSmall?.copyWith(
                  fontWeight: FontWeight.w800,
                  color: TpPalette.of(context).textSecondary,
                ),
          ),
        ),
      ),
    );
  }
}

/// One wheel's resolved presentation state, computed once per build so the
/// painter and the hit-target/accessibility layer never disagree about it.
class _ResolvedWheel {
  const _ResolvedWheel({
    required this.tyre,
    required this.code,
    required this.serial,
    required this.condition,
    required this.status,
    required this.isRecorded,
    required this.isOutstanding,
    required this.pressureText,
    required this.pressureDisplay,
    required this.treadDisplay,
  });

  final MatchedTyreSlot tyre;
  final String code;
  final String? serial;
  final TyreCondition? condition;
  final TpStatus status;
  final bool isRecorded;
  final bool isOutstanding;
  final String? pressureText;

  /// Recorded pressure formatted for a card, or `null` when not recorded.
  final String? pressureDisplay;

  /// Recorded tread depth formatted for a card, or `null` when not recorded.
  final String? treadDisplay;

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
    required this.rect,
    required this.isSelected,
    required this.label,
    required this.onTap,
  });

  final _ResolvedWheel wheel;
  final Rect rect;
  final bool isSelected;
  final String label;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
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

class _SelectedTyreSummary extends StatelessWidget {
  const _SelectedTyreSummary({required this.wheel, required this.l10n});

  final _ResolvedWheel wheel;
  final AppLocalizations l10n;

  @override
  Widget build(BuildContext context) {
    final TpPalette palette = TpPalette.of(context);
    final TpStatusColors colors = palette.forStatus(wheel.status);
    final bool isImmediateAttention =
        wheel.condition == TyreCondition.puncture ||
            wheel.condition == TyreCondition.flat;
    final String conditionLabel = wheel.condition == null
        ? l10n.tyreDiagramListNotRecorded
        : tyreConditionLabel(l10n, wheel.condition!);
    final String summarySemanticsLabel = wheel.pressureText == null
        ? conditionLabel
        : '$conditionLabel, '
            '${l10n.tyreDiagramPressureDetail(wheel.pressureText!)}';

    return Semantics(
      container: true,
      liveRegion: true,
      excludeSemantics: true,
      label: summarySemanticsLabel,
      child: DecoratedBox(
        decoration: BoxDecoration(
          color: colors.soft,
          borderRadius: BorderRadius.circular(TpRadius.md),
          border: Border.all(
            color: colors.base,
            width: TpBorderWidth.strong,
          ),
        ),
        child: Padding(
          padding: const EdgeInsets.symmetric(
            horizontal: TpSpace.md,
            vertical: TpSpace.sm,
          ),
          child: Row(
            children: <Widget>[
              Icon(
                isImmediateAttention
                    ? Icons.report_problem_outlined
                    : Icons.tire_repair_outlined,
                color: colors.onSoft,
                size: TpSizing.iconMd,
              ),
              const SizedBox(width: TpSpace.sm),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: <Widget>[
                    Text(
                      wheel.code,
                      textDirection: TextDirection.ltr,
                      style: Theme.of(context).textTheme.labelMedium?.copyWith(
                            color: colors.onSoft,
                            fontWeight: FontWeight.w800,
                          ),
                    ),
                    Text(
                      conditionLabel,
                      style: Theme.of(context).textTheme.titleSmall?.copyWith(
                            color: colors.onSoft,
                            fontWeight: FontWeight.w800,
                          ),
                    ),
                  ],
                ),
              ),
              if (wheel.pressureText != null)
                Text(
                  l10n.tyreDiagramPressureDetail(wheel.pressureText!),
                  style: Theme.of(context).textTheme.labelMedium?.copyWith(
                        color: colors.onSoft,
                        fontWeight: FontWeight.w700,
                      ),
                ),
            ],
          ),
        ),
      ),
    );
  }
}

class _ConditionLegend extends StatelessWidget {
  const _ConditionLegend({required this.l10n, required this.compact});

  final AppLocalizations l10n;
  final bool compact;

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
    if (compact) {
      return Wrap(
        alignment: WrapAlignment.center,
        spacing: TpSpace.md,
        runSpacing: TpSpace.xs,
        children: <Widget>[
          TpStatusChip(
            status: TpStatus.ok,
            label: l10n.tyreDiagramStatOk,
            isCompact: true,
          ),
          TpStatusChip(
            status: TpStatus.warning,
            label: l10n.tyreDiagramStatMonitor,
            isCompact: true,
          ),
          TpStatusChip(
            status: TpStatus.critical,
            label: l10n.tyreDiagramStatCritical,
            isCompact: true,
          ),
        ],
      );
    }
    return Wrap(
      alignment: WrapAlignment.center,
      spacing: TpSpace.xs,
      runSpacing: TpSpace.xs,
      children: <Widget>[
        for (final TyreCondition condition in _kOrder)
          TpStatusChip(
            status: tyreConditionStatus(condition),
            label: tyreConditionLabel(l10n, condition),
            icon: switch (condition) {
              TyreCondition.puncture => Icons.report_problem_outlined,
              TyreCondition.flat => Icons.warning_amber_rounded,
              _ => null,
            },
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
