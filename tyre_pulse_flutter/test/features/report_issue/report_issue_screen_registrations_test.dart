library;

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/app/router/routes.dart';
import 'package:tyre_pulse/app/router/screen_registry.dart';
import 'package:tyre_pulse/features/report_issue/presentation/report_issue_screen.dart';
import 'package:tyre_pulse/features/report_issue/report_issue_screen_registrations.dart';

void main() {
  test('registers the typed Report Issue route', () {
    expect(reportIssueScreenRegistrations.keys, <String>[
      TpRouteId.reportIssue,
    ]);
  });

  testWidgets('builds the form and rejects a wrong typed route', (
    WidgetTester tester,
  ) async {
    final TpScreenBuilder builder =
        reportIssueScreenRegistrations[TpRouteId.reportIssue]!;
    late Widget correct;
    late Widget wrong;
    await tester.pumpWidget(
      Builder(
        builder: (BuildContext context) {
          correct = builder(context, const ReportIssueRoute());
          wrong = builder(context, const HomeRoute());
          return const SizedBox.shrink();
        },
      ),
    );
    expect(correct, isA<ReportIssueScreen>());
    expect(wrong, isA<TpScreenNotAvailable>());
  });
}
