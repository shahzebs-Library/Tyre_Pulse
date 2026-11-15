import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/core/design_system/tp_text_scale.dart';

/// A fixed-height tile keeps the mock's size at the default text size and
/// grows only by its text as the person's text size grows.
void main() {
  Future<(double factor, double extent)> read(
    WidgetTester tester,
    double scale,
  ) async {
    late double factor;
    late double extent;
    await tester.pumpWidget(
      MediaQuery(
        data: MediaQueryData(textScaler: TextScaler.linear(scale)),
        child: Builder(
          builder: (BuildContext context) {
            factor = tpTextScaleFactor(context);
            extent = tpTextScaledExtent(context, base: 72, textHeight: 16);
            return const SizedBox.shrink();
          },
        ),
      ),
    );
    return (factor, extent);
  }

  testWidgets('the default text size leaves the designed height untouched',
      (WidgetTester tester) async {
    final (double factor, double extent) = await read(tester, 1);
    expect(factor, 1);
    expect(extent, 72);
  });

  testWidgets('only the text part grows at a large text size',
      (WidgetTester tester) async {
    final (double factor, double extent) = await read(tester, 2);
    expect(factor, 2);
    expect(extent, 88);
  });

  testWidgets('a small text size never shrinks a tile below its design',
      (WidgetTester tester) async {
    final (double factor, double extent) = await read(tester, 0.8);
    expect(factor, 1);
    expect(extent, 72);
  });

  testWidgets('an extreme text size is capped', (WidgetTester tester) async {
    final (double factor, double extent) = await read(tester, 4);
    expect(factor, 2.5);
    expect(extent, 96);
  });
}
