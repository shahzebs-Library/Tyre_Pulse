/// Pure-logic tests for the SVG-to-screen coordinate transform, per artifact
/// section 7.1: the viewBox math, and the Material-minimum hit-target
/// expansion a Line pump dual wheel needs on both axes.
library;

import 'dart:ui';

import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/features/tyre_diagram/domain/tyre_diagram_layouts.dart';
import 'package:tyre_pulse/features/tyre_diagram/domain/tyre_slot.dart';
import 'package:tyre_pulse/features/tyre_diagram/presentation/tyre_diagram_geometry.dart';

void main() {
  group('TyreDiagramViewport.wheelRect', () {
    test('maps the viewBox origin (minX, minY) to screen (0, 0)', () {
      const TyreDiagramViewport viewport = TyreDiagramViewport(
        width: 220,
        viewH: 320,
      );
      final Rect rect = viewport.wheelRect(
        kDiagramViewMinX,
        kDiagramViewMinY,
        1,
        1,
      );
      expect(rect.left, 0);
      expect(rect.top, 0);
    });

    test('scale is width / 220, applied to both size axes', () {
      const TyreDiagramViewport viewport = TyreDiagramViewport(
        width: 440,
        viewH: 320,
      );
      expect(viewport.scale, 2);
      final Rect rect = viewport.wheelRect(0, 0, 10, 20);
      expect(rect.width, 20);
      expect(rect.height, 40);
    });

    test('height derives from viewH + 10, scaled', () {
      const TyreDiagramViewport viewport = TyreDiagramViewport(
        width: 220,
        viewH: 320,
      );
      expect(viewport.height, 330);
    });
  });

  group('TyreDiagramViewport.hitRect', () {
    test('adds finger padding on every side before scaling', () {
      const TyreDiagramViewport viewport = TyreDiagramViewport(
        width: 220,
        viewH: 320,
      );
      // A wheel comfortably above the minimum, so the padding (not the
      // minimum expansion) is what is being measured here.
      final Rect wheel = viewport.wheelRect(50, 50, 60, 60);
      final Rect hit = viewport.hitRect(50, 50, 60, 60);
      expect(hit.left, lessThan(wheel.left));
      expect(hit.top, lessThan(wheel.top));
      expect(hit.width, greaterThan(wheel.width));
      expect(hit.height, greaterThan(wheel.height));
    });

    test(
        'never falls below the Material minimum on either axis, even for '
        'a Line pump dual wheel (19x33 SVG units at a 300px-wide diagram)', () {
      const TyreDiagramViewport viewport = TyreDiagramViewport(
        width: 300,
        viewH: 375,
      );
      final Rect hit = viewport.hitRect(13, 258, 19, 33);
      expect(hit.width, greaterThanOrEqualTo(kDiagramMinHitTarget));
      expect(hit.height, greaterThanOrEqualTo(kDiagramMinHitTarget));
    });

    test(
        'the minimum expansion grows the rect from its own centre, never '
        'moving the visually painted wheel', () {
      const TyreDiagramViewport viewport = TyreDiagramViewport(
        width: 300,
        viewH: 375,
      );
      final Rect wheel = viewport.wheelRect(13, 258, 19, 33);
      final Rect hit = viewport.hitRect(13, 258, 19, 33);
      expect(hit.center.dx, closeTo(wheel.center.dx, 0.01));
      expect(hit.center.dy, closeTo(wheel.center.dy, 0.01));
    });

    test(
        'a wheel already at or above the minimum after padding is not '
        'expanded further', () {
      // At a wider render (scale 2), Pickup's front-left wheel
      // (23x44 SVG units) pads out to 54x96 screen pixels - already
      // above the 48px minimum on both axes, so the minimum-expansion
      // step is a genuine no-op here, not merely satisfied by luck.
      const TyreDiagramViewport viewport = TyreDiagramViewport(
        width: 440,
        viewH: 320,
      );
      final Rect padded = viewport.hitRect(32, 48, 23, 44);
      expect(padded.width, greaterThan(kDiagramMinHitTarget));
      expect(padded.height, greaterThan(kDiagramMinHitTarget));
    });
  });

  group('buildTyreHitRects', () {
    for (final String layoutKey in <String>[
      'Tri-mixer',
      'Line pump',
      'Concrete pump',
    ]) {
      test(
        '$layoutKey compact dual targets keep each painted centre on its '
        'own side of the seam',
        () {
          final DiagramLayout layout = kTyreDiagramLayouts[layoutKey]!;
          const TyreDiagramViewport viewport = TyreDiagramViewport(
            width: 190,
            viewH: 375,
          );
          final Map<String, Rect> targets = buildTyreHitRects(
            layout: layout,
            viewport: viewport,
          );

          for (final (String, String) pair in <(String, String)>[
            ('R1Lo', 'R1Li'),
            ('R1Ri', 'R1Ro'),
            ('R2Lo', 'R2Li'),
            ('R2Ri', 'R2Ro'),
          ]) {
            final TyreSlot first = layout.tyres.singleWhere(
              (TyreSlot slot) => slot.id == pair.$1,
            );
            final TyreSlot second = layout.tyres.singleWhere(
              (TyreSlot slot) => slot.id == pair.$2,
            );
            final TyreSlot left = first.x < second.x ? first : second;
            final TyreSlot right = identical(left, first) ? second : first;
            final Rect leftTarget = targets[left.id]!;
            final Rect rightTarget = targets[right.id]!;

            expect(leftTarget.overlaps(rightTarget), isFalse);
            expect(leftTarget.right, closeTo(rightTarget.left, 0.001));
            expect(leftTarget.width, greaterThanOrEqualTo(48));
            expect(rightTarget.width, greaterThanOrEqualTo(48));
            expect(
              leftTarget.contains(
                viewport.wheelRect(left.x, left.y, left.w, left.h).center,
              ),
              isTrue,
              reason: '$layoutKey ${left.id} must not select ${right.id}',
            );
            expect(
              rightTarget.contains(
                viewport.wheelRect(right.x, right.y, right.w, right.h).center,
              ),
              isTrue,
              reason: '$layoutKey ${right.id} must not select ${left.id}',
            );
          }
        },
      );
    }

    test(
        'every concrete-pump inner/outer pair has two adjacent, non-overlapping targets',
        () {
      final DiagramLayout layout = kTyreDiagramLayouts['Concrete pump']!;
      const TyreDiagramViewport viewport = TyreDiagramViewport(
        width: 300,
        viewH: 375,
      );
      final Map<String, Rect> targets = buildTyreHitRects(
        layout: layout,
        viewport: viewport,
      );

      for (final (String, String) pair in <(String, String)>[
        ('R1Lo', 'R1Li'),
        ('R1Ri', 'R1Ro'),
        ('R2Lo', 'R2Li'),
        ('R2Ri', 'R2Ro'),
      ]) {
        final TyreSlot first =
            layout.tyres.singleWhere((TyreSlot slot) => slot.id == pair.$1);
        final TyreSlot second =
            layout.tyres.singleWhere((TyreSlot slot) => slot.id == pair.$2);
        final TyreSlot left = first.x < second.x ? first : second;
        final TyreSlot right = identical(left, first) ? second : first;
        final Rect leftTarget = targets[left.id]!;
        final Rect rightTarget = targets[right.id]!;

        expect(leftTarget.right, closeTo(rightTarget.left, 0.001));
        expect(leftTarget.overlaps(rightTarget), isFalse);
        expect(leftTarget.width, greaterThanOrEqualTo(kDiagramMinHitTarget));
        expect(rightTarget.width, greaterThanOrEqualTo(kDiagramMinHitTarget));
        expect(
          leftTarget.contains(
            viewport.wheelRect(left.x, left.y, left.w, left.h).center,
          ),
          isTrue,
        );
        expect(
          rightTarget.contains(
            viewport.wheelRect(right.x, right.y, right.w, right.h).center,
          ),
          isTrue,
        );
      }
    });

    test('single steer-wheel targets keep the centred geometry', () {
      final DiagramLayout layout = kTyreDiagramLayouts['Line pump']!;
      const TyreDiagramViewport viewport = TyreDiagramViewport(
        width: 300,
        viewH: 375,
      );
      final TyreSlot slot =
          layout.tyres.singleWhere((TyreSlot tyre) => tyre.id == 'F1L');
      final Map<String, Rect> targets = buildTyreHitRects(
        layout: layout,
        viewport: viewport,
      );
      expect(
        targets[slot.id],
        viewport.hitRect(slot.x, slot.y, slot.w, slot.h),
      );
    });
  });
}
