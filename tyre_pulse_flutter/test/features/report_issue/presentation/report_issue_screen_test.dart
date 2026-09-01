library;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/app/localization/tp_localizations.dart';
import 'package:tyre_pulse/app/router/routes.dart';
import 'package:tyre_pulse/app/theme/tp_theme.dart';
import 'package:tyre_pulse/core/permissions/access_resolver.dart';
import 'package:tyre_pulse/core/permissions/roles.dart';
import 'package:tyre_pulse/core/workspace/workspace_context.dart';
import 'package:tyre_pulse/core/workspace/workspace_providers.dart';
import 'package:tyre_pulse/core/workspace/workspace_scope.dart';
import 'package:tyre_pulse/features/report_issue/presentation/report_issue_screen.dart';
import 'package:tyre_pulse/features/tyre_diagram/data/tyre_defect_report_repository.dart';
import 'package:tyre_pulse/features/tyre_diagram/tyre_diagram_providers.dart';

final class _FakeDefectRepository implements TyreDefectReportRepository {
  SubmitTyreDefectReportInput? submitted;

  @override
  Future<Set<String>> submitDefectReport({
    required WorkspaceContext workspace,
    required SubmitTyreDefectReportInput input,
  }) async {
    submitted = input;
    return const <String>{};
  }
}

const AccessState _access = AccessState(role: UserRole.known(RoleId.admin));
const WorkspaceContext _workspace = WorkspaceContext(
  userId: 'user-1',
  role: UserRole.known(RoleId.admin),
  effectivePermissions: _access,
  countryScope: CountryScope.none,
  siteScope: SiteScope.none,
  activeCountry: 'KSA',
  legacySite: 'NHC',
  fullName: 'Eng Vinay',
);

Future<void> _pump(
  WidgetTester tester,
  _FakeDefectRepository repository, {
  Locale locale = const Locale('en'),
}) async {
  await tester.pumpWidget(
    ProviderScope(
      overrides: [
        workspaceContextProvider.overrideWithValue(_workspace),
        tyreDefectReportRepositoryProvider.overrideWithValue(repository),
      ],
      child: MaterialApp(
        theme: TpTheme.light,
        locale: locale,
        supportedLocales: TpLocalizations.supportedLocales,
        localizationsDelegates: TpLocalizations.delegates,
        home: const ReportIssueScreen(
          route: ReportIssueRoute(
            assetNo: AssetNo('PUMP-208'),
            siteName: SiteName('Qiddiya G2'),
            tyreSerial: TyreSerial('TY-90'),
          ),
        ),
      ),
    ),
  );
  await tester.pumpAndSettle();
}

void main() {
  testWidgets('prefills route context and submits the complete offline input', (
    WidgetTester tester,
  ) async {
    final repository = _FakeDefectRepository();
    await _pump(tester, repository);

    expect(
      tester
          .widget<TextField>(find.byKey(const Key('reportIssue.asset')))
          .controller!
          .text,
      'PUMP-208',
    );
    expect(
      tester
          .widget<TextField>(find.byKey(const Key('reportIssue.site')))
          .controller!
          .text,
      'Qiddiya G2',
    );
    expect(
      tester
          .widget<TextField>(find.byKey(const Key('reportIssue.asset')))
          .readOnly,
      isTrue,
    );
    expect(
      tester
          .widget<TextField>(find.byKey(const Key('reportIssue.site')))
          .readOnly,
      isTrue,
    );

    await tester.enterText(
      find.byKey(const Key('reportIssue.title')),
      'Hydraulic warning',
    );
    await tester.enterText(
      find.byKey(const Key('reportIssue.details')),
      'Pressure drops while extending the boom.',
    );
    final Finder criticalPriority =
        find.byKey(const Key('reportIssue.priority.Critical'));
    await tester.ensureVisible(criticalPriority);
    await tester.tap(criticalPriority);
    await tester.ensureVisible(find.byKey(const Key('reportIssue.submit')));
    await tester.tap(find.byKey(const Key('reportIssue.submit')));
    await tester.pumpAndSettle();

    final SubmitTyreDefectReportInput input = repository.submitted!;
    expect(input.title, 'Hydraulic warning');
    expect(input.assetNo, 'PUMP-208');
    expect(input.site, 'Qiddiya G2');
    expect(input.tyreSerial, 'TY-90');
    expect(input.priority, CorrectiveActionPriority.critical);
    expect(input.assignedTo, 'Eng Vinay');
    expect(input.country, 'KSA');
    expect(input.dueDate, isNull);
    expect(input.rootCause, 'mechanical');
    expect(input.description, contains('Can the asset operate safely?'));
    expect(find.text('Issue saved'), findsOneWidget);
  });

  testWidgets('blank title is refused without queuing', (
    WidgetTester tester,
  ) async {
    final repository = _FakeDefectRepository();
    await _pump(tester, repository);
    await tester.ensureVisible(find.byKey(const Key('reportIssue.submit')));
    await tester.tap(find.byKey(const Key('reportIssue.submit')));
    await tester.pump();

    expect(repository.submitted, isNull);
    expect(
      find.text('Enter what is wrong before saving.'),
      findsOneWidget,
    );
  });

  testWidgets('Arabic copy renders with RTL direction', (
    WidgetTester tester,
  ) async {
    await _pump(tester, _FakeDefectRepository(), locale: const Locale('ar'));
    final Finder title = find.text('الإبلاغ عن مشكلة');
    expect(title, findsOneWidget);
    expect(Directionality.of(tester.element(title)), TextDirection.rtl);
  });
}
