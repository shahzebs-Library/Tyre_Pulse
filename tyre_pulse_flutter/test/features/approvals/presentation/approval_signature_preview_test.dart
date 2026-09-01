import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_svg/flutter_svg.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/features/approvals/presentation/widgets/approval_signature_preview.dart';

void main() {
  testWidgets('renders the verified raw SVG signature shape without throwing', (
    WidgetTester tester,
  ) async {
    const String svg =
        '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="10">'
        '<path d="M0 5 L20 5" stroke="black"/></svg>';
    await tester.pumpWidget(
      const MaterialApp(
        home: ApprovalSignaturePreview(
          value: svg,
          fallback: Text('Unavailable'),
        ),
      ),
    );
    await tester.pump();

    expect(find.byType(SvgPicture), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('malformed legacy signature degrades instead of escaping', (
    WidgetTester tester,
  ) async {
    await tester.pumpWidget(
      const MaterialApp(
        home: ApprovalSignaturePreview(
          value: 'not a signature',
          fallback: Text('Unavailable'),
        ),
      ),
    );

    expect(find.text('Unavailable'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  test('accepts an image base64 data URL and refuses bare base64', () {
    final String encoded = base64Encode(<int>[1, 2, 3]);
    expect(
      approvalSignatureBytes('data:image/png;base64,$encoded'),
      <int>[1, 2, 3],
    );
    expect(approvalSignatureBytes(encoded), isNull);
    expect(approvalSignatureBytes('data:text/plain;base64,$encoded'), isNull);
  });
}
