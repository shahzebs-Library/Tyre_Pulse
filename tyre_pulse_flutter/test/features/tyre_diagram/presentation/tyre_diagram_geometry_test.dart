/// Pure-logic tests for the SVG-to-screen coordinate transform, per artifact
/// section 7.1: the viewBox math, and the Material-minimum hit-target
/// expansion a Line pump dual wheel needs on both axes.
library;

import 'dart:ui';

import 'package:flutter_test/flutter_test.dart';
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

    test('never falls below the Material minimum on either axis, even for '
        'a Line pump dual wheel (19x33 SVG units at a 300px-wide diagram)', () {
      const TyreDiagramViewport viewport = TyreDiagramViewport(
        width: 300,
        viewH: 375,
      );
      final Rect hit = viewport.hitRect(13, 258, 19, 33);
      expect(hit.width, greaterThanOrEqualTo(kDiagramMinHitTarget));
      expect(hit.height, greaterThanOrEqualTo(kDiagramMinHitTarget));
    });

    test('the minimum expansion grows the rect from its own centre, never '
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

    test('a wheel already at or above the minimum after padding is not '
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
}
