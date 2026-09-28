import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/app/theme/tp_colors.dart';
import 'package:tyre_pulse/app/theme/tp_theme.dart';
import 'package:tyre_pulse/core/design_system/design_system.dart';
import 'package:tyre_pulse/features/approvals/presentation/widgets/approval_decision_bar.dart';

Future<void> _pump(WidgetTester tester, ApprovalDecisionBar bar) {
  return tester.pumpWidget(
    MaterialApp(
      theme: TpTheme.light,
      home: Scaffold(
        body: Padding(padding: const EdgeInsets.all(16), child: bar),
      ),
    ),
  );
}

void main() {
  const Key returnKey = Key('return');
  const Key approveKey = Key('approve');

  testWidgets('Return is outlined critical and Approve is the one primary', (
    WidgetTester tester,
  ) async {
    int returned = 0;
    int approved = 0;
    await _pump(
      tester,
      ApprovalDecisionBar(
        returnKey: returnKey,
        approveKey: approveKey,
        returnLabel: 'Return for correction',
        approveLabel: 'Approve',
        onReturn: () => returned++,
        onApprove: () => approved++,
      ),
    );

    final OutlinedButton ret = tester.widget<OutlinedButton>(
      find.byKey(returnKey),
    );
    final BuildContext context = tester.element(find.byKey(returnKey));
    final Color critical = TpPalette.of(context).critical.base;
    expect(ret.style?.side?.resolve(<WidgetState>{})?.color, critical);
    expect(
      ret.style?.foregroundColor?.resolve(<WidgetState>{}),
      critical,
    );
    final TpButton approve = tester.widget<TpButton>(find.byKey(approveKey));
    expect(approve.variant, TpButtonVariant.primary);

    await tester.tap(find.byKey(returnKey));
    await tester.tap(find.byKey(approveKey));
    expect(returned, 1);
    expect(approved, 1);

    // Both meet the 48dp touch target.
    expect(
      tester.getSize(find.byKey(returnKey)).height,
      greaterThanOrEqualTo(48),
    );
    expect(
      tester.getSize(find.byKey(approveKey)).height,
      greaterThanOrEqualTo(48),
    );
  });

  testWidgets('null callbacks disable; busy flags show a spinner', (
    WidgetTester tester,
  ) async {
    await _pump(
      tester,
      const ApprovalDecisionBar(
        returnKey: returnKey,
        approveKey: approveKey,
        returnLabel: 'Return',
        approveLabel: 'Approve',
        onReturn: null,
        onApprove: null,
        isReturning: true,
      ),
    );
    expect(
      tester.widget<OutlinedButton>(find.byKey(returnKey)).onPressed,
      isNull,
    );
    expect(tester.widget<TpButton>(find.byKey(approveKey)).onPressed, isNull);
    expect(
      find.descendant(
        of: find.byKey(returnKey),
        matching: find.byType(CircularProgressIndicator),
      ),
      findsOneWidget,
    );
  });
}
