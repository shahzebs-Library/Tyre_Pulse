/// Tests for [TpSegmented].
library;

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/core/design_system/design_system.dart';

import 'design_system_test_support.dart';

enum _Mode { a, b, c }

void main() {
  testWidgets('every option label renders', (WidgetTester tester) async {
    await pumpTp(
      tester,
      TpSegmented<_Mode>(
        value: _Mode.a,
        options: const <TpSegmentedOption<_Mode>>[
          TpSegmentedOption<_Mode>(value: _Mode.a, label: 'Layout'),
          TpSegmentedOption<_Mode>(value: _Mode.b, label: 'List'),
        ],
        onChanged: (_Mode value) {},
      ),
    );

    expect(find.text('Layout'), findsOneWidget);
    expect(find.text('List'), findsOneWidget);
  });

  testWidgets(
      'tapping an option reports its value, not the currently '
      'selected one', (WidgetTester tester) async {
    _Mode? selected;
    await pumpTp(
      tester,
      TpSegmented<_Mode>(
        value: _Mode.a,
        options: const <TpSegmentedOption<_Mode>>[
          TpSegmentedOption<_Mode>(value: _Mode.a, label: 'Layout'),
          TpSegmentedOption<_Mode>(value: _Mode.b, label: 'List'),
        ],
        onChanged: (_Mode value) => selected = value,
      ),
    );

    await tester.tap(find.text('List'));
    await tester.pump();

    expect(selected, _Mode.b);
  });

  testWidgets(
      'a null onChanged disables every segment - the design '
      'system\'s own "a disabled control is honest" idiom, never a segment '
      'that looks tappable and silently does nothing', (
    WidgetTester tester,
  ) async {
    await pumpTp(
      tester,
      const TpSegmented<_Mode>(
        value: _Mode.a,
        options: <TpSegmentedOption<_Mode>>[
          TpSegmentedOption<_Mode>(value: _Mode.a, label: 'Layout'),
          TpSegmentedOption<_Mode>(value: _Mode.b, label: 'List'),
        ],
        onChanged: null,
      ),
    );

    final Iterable<InkWell> wells = tester.widgetList<InkWell>(
      find.byType(InkWell),
    );
    expect(wells, isNotEmpty);
    for (final InkWell w in wells) {
      expect(w.onTap, isNull);
    }
  });

  testWidgets('three options render left to right in the order supplied', (
    WidgetTester tester,
  ) async {
    await pumpTp(
      tester,
      TpSegmented<_Mode>(
        value: _Mode.b,
        options: const <TpSegmentedOption<_Mode>>[
          TpSegmentedOption<_Mode>(value: _Mode.a, label: 'First'),
          TpSegmentedOption<_Mode>(value: _Mode.b, label: 'Second'),
          TpSegmentedOption<_Mode>(value: _Mode.c, label: 'Third'),
        ],
        onChanged: (_Mode value) {},
      ),
    );

    final double xFirst = tester.getCenter(find.text('First')).dx;
    final double xSecond = tester.getCenter(find.text('Second')).dx;
    final double xThird = tester.getCenter(find.text('Third')).dx;

    expect(xFirst, lessThan(xSecond));
    expect(xSecond, lessThan(xThird));
  });
}
