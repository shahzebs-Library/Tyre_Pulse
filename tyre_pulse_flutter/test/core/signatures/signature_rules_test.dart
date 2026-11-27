// The phone pads' real encoder output for a short scribble must pass the
// server signature rule (driver_charge_valid_signature /
// handover_valid_signature); a dot or a cropped tiny image must not.
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:signature/signature.dart';
import 'package:tyre_pulse/core/signatures/signature_rules.dart';

SignatureController _scribble({int strokes = 3, int pointsPerStroke = 6}) {
  final List<Point> points = <Point>[];
  for (int s = 0; s < strokes; s++) {
    for (int i = 0; i < pointsPerStroke; i++) {
      points.add(
        Point(
          Offset(20.0 + i * 9 + s * 4, 30.0 + (i.isEven ? 0 : 12) + s * 6),
          i == 0 ? PointType.tap : PointType.move,
          1,
        ),
      );
    }
  }
  return SignatureController(
    points: points,
    penStrokeWidth: 3,
    penColor: Colors.black,
    exportBackgroundColor: Colors.white,
  );
}

void main() {
  testWidgets('a short scribble through the pad encoder passes the rule',
      (WidgetTester tester) async {
    final SignatureController controller = _scribble();
    addTearDown(controller.dispose);
    final String? dataUrl =
        await tester.runAsync<String?>(() => encodeSignaturePng(controller));
    expect(dataUrl, isNotNull);
    expect(dataUrl, startsWith('data:image/png;base64,iVBORw0KGgo'));
    expect(dataUrl!.length, greaterThanOrEqualTo(minSignaturePngLength));
    expect(isAcceptedSignature(dataUrl), isTrue);
  });

  testWidgets('the old cropped export of a short scribble was too small',
      (WidgetTester tester) async {
    final SignatureController controller =
        _scribble(strokes: 1, pointsPerStroke: 3);
    addTearDown(controller.dispose);
    final String? cropped = await tester.runAsync<String?>(() async {
      final bytes = await controller.toPngBytes();
      return bytes == null ? null : 'data:image/png;base64,${base64(bytes)}';
    });
    expect(cropped, isNotNull);
    expect(isAcceptedSignature(cropped), isFalse);
    final String? fixed =
        await tester.runAsync<String?>(() => encodeSignaturePng(controller));
    expect(isAcceptedSignature(fixed), isTrue);
  });

  test('rule mirrors the server', () {
    expect(isAcceptedSignature('data:image/png;base64,AAAA'), isFalse);
    expect(
      isAcceptedSignature(
        'data:image/png;base64,iVBORw0KGgo${'A' * 1400}',
      ),
      isTrue,
    );
    expect(
      isAcceptedSignature('data:image/png;base64,iVBORw0KGgoAAAA'),
      isFalse,
    );
    String svg(int segments) =>
        '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="100" '
        'viewBox="0 0 300 100"><path d="M1 2${' L3 4' * segments}" '
        'fill="none" stroke="#111111" stroke-width="2" '
        'stroke-linecap="round" stroke-linejoin="round"/></svg>';
    expect(isAcceptedSignature(svg(9)), isTrue);
    expect(isAcceptedSignature(svg(8)), isFalse);
    expect(isAcceptedSignature(null), isFalse);
  });
}

String base64(List<int> bytes) => const Base64Codec().encode(bytes);
