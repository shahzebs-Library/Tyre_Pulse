import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/app/localization/tp_localizations.dart';
import 'package:tyre_pulse/app/router/routes.dart';
import 'package:tyre_pulse/app/theme/tp_theme.dart';
import 'package:tyre_pulse/features/approvals/checklist_approvals_providers.dart';
import 'package:tyre_pulse/features/approvals/presentation/checklist_approval_review_screen.dart';

void main() {
  testWidgets('review failure stays actionable on a compact Arabic screen', (
    WidgetTester tester,
  ) async {
    tester.view.physicalSize = const Size(320, 640);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);

    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          checklistApprovalRepositoryProvider.overrideWith(
            (ref) => throw StateError('offline'),
          ),
        ],
        child: MaterialApp(
          theme: TpTheme.light,
          locale: const Locale('ar'),
          supportedLocales: TpLocalizations.supportedLocales,
          localizationsDelegates: TpLocalizations.delegates,
          home: const ChecklistApprovalReviewScreen(
            route: ChecklistApprovalReviewRoute(
              submissionId: SubmissionId('submission-1'),
            ),
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(
      find.text(
        'تعذّر تحميل قائمة التحقق هذه. تحقق من اتصالك وحاول مرة أخرى.',
      ),
      findsOneWidget,
    );
    expect(
      Directionality.of(
        tester.element(find.byType(ChecklistApprovalReviewScreen)),
      ),
      TextDirection.rtl,
    );

    await tester.tap(find.text('أعد المحاولة'));
    await tester.pumpAndSettle();

    expect(find.text('أعد المحاولة'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });
}
