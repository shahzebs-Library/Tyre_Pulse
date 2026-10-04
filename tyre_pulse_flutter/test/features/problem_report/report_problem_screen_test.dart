import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/app/localization/tp_localizations.dart';
import 'package:tyre_pulse/app/theme/tp_theme.dart';
import 'package:tyre_pulse/core/auth/auth_dependency_providers.dart';
import 'package:tyre_pulse/core/design_system/design_system.dart';
import 'package:tyre_pulse/core/errors/app_error.dart';
import 'package:tyre_pulse/features/problem_report/data/device_context_reader.dart';
import 'package:tyre_pulse/features/problem_report/data/problem_report_repository.dart';
import 'package:tyre_pulse/features/problem_report/domain/problem_report.dart';
import 'package:tyre_pulse/features/problem_report/presentation/report_problem_screen.dart';
import 'package:tyre_pulse/features/problem_report/problem_report_providers.dart';

final class _FakeRepo implements ProblemReportRepository {
  _FakeRepo(this.outcome);

  final ProblemSubmitOutcome outcome;
  final List<ProblemReportDraft> sent = <ProblemReportDraft>[];

  @override
  Future<ProblemSubmitOutcome> submit(ProblemReportDraft draft) async {
    sent.add(draft);
    return outcome;
  }
}

final class _FakeDevice implements DeviceContextReader {
  @override
  Future<DeviceDescription> read() async =>
      (device: 'samsung SM-A155F', os: 'Android 14 (SDK 34)');
}

Widget _app(_FakeRepo repo, {Locale locale = const Locale('en')}) {
  return ProviderScope(
    overrides: [
      problemReportRepositoryProvider.overrideWithValue(repo),
      deviceContextReaderProvider.overrideWithValue(_FakeDevice()),
      currentAppVersionProvider.overrideWithValue('0.1.1'),
    ],
    child: MaterialApp(
      theme: TpTheme.light,
      locale: locale,
      supportedLocales: TpLocalizations.supportedLocales,
      localizationsDelegates: TpLocalizations.delegates,
      home: const ReportProblemScreen(sourceScreen: '/inspections'),
    ),
  );
}

Future<void> _fillAndSend(WidgetTester tester) async {
  await tester.enterText(
    find.descendant(
      of: find.byKey(ReportProblemScreenKeys.description),
      matching: find.byType(EditableText),
    ),
    'The tyre list stays empty after I pick a site',
  );
  await tester.tap(find.byKey(ReportProblemScreenKeys.category));
  await tester.pumpAndSettle();
  await tester.tap(find.text('The data looks wrong').last);
  await tester.pumpAndSettle();
  await tester.ensureVisible(find.byKey(ReportProblemScreenKeys.send));
  await tester.tap(find.byKey(ReportProblemScreenKeys.send));
  await tester.pumpAndSettle();
}

/// A phone-height surface tall enough for the whole form, so taps land.
void _tallSurface(WidgetTester tester) {
  tester.view.physicalSize = const Size(420, 1400);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.reset);
}

void main() {
  testWidgets('shows what is attached automatically', (tester) async {
    await tester.pumpWidget(
      _app(_FakeRepo(const ProblemSubmitted(id: 'x', linkedLogs: 0))),
    );
    await tester.pumpAndSettle();
    expect(find.textContaining('0.1.1'), findsOneWidget);
    expect(find.textContaining('samsung SM-A155F'), findsOneWidget);
    expect(find.textContaining('/inspections'), findsOneWidget);
  });

  testWidgets('refuses a short description and a missing type', (
    tester,
  ) async {
    final _FakeRepo repo =
        _FakeRepo(const ProblemSubmitted(id: 'x', linkedLogs: 0));
    _tallSurface(tester);
    await tester.pumpWidget(_app(repo));
    await tester.pumpAndSettle();
    await tester.ensureVisible(find.byKey(ReportProblemScreenKeys.send));
    await tester.tap(find.byKey(ReportProblemScreenKeys.send));
    await tester.pumpAndSettle();
    expect(find.textContaining('at least 10 characters'), findsOneWidget);
    expect(find.text('Choose the type of problem.'), findsOneWidget);
    expect(repo.sent, isEmpty);
  });

  testWidgets('sends with the context attached and shows success', (
    tester,
  ) async {
    final _FakeRepo repo =
        _FakeRepo(const ProblemSubmitted(id: 'x', linkedLogs: 1));
    _tallSurface(tester);
    await tester.pumpWidget(_app(repo));
    await tester.pumpAndSettle();
    await _fillAndSend(tester);
    expect(repo.sent, hasLength(1));
    final ProblemReportDraft draft = repo.sent.single;
    expect(draft.category, ProblemCategory.dataWrong);
    expect(draft.severity, isNull);
    expect(draft.context.appVersion, '0.1.1');
    expect(draft.context.device, 'samsung SM-A155F');
    expect(draft.context.os, 'Android 14 (SDK 34)');
    expect(draft.context.screen, '/inspections');
    expect(find.byKey(ReportProblemScreenKeys.success), findsOneWidget);
  });

  testWidgets('no signal is said plainly and the text is kept', (
    tester,
  ) async {
    _tallSurface(tester);
    await tester.pumpWidget(
      _app(
        _FakeRepo(
          const ProblemNotSubmitted(
            ProblemSubmitFailure.needsSignal,
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();
    await _fillAndSend(tester);
    expect(find.byKey(ReportProblemScreenKeys.failure), findsOneWidget);
    expect(find.textContaining('No signal'), findsOneWidget);
    expect(
      find.text('The tyre list stays empty after I pick a site'),
      findsOneWidget,
    );
    expect(find.byKey(ReportProblemScreenKeys.success), findsNothing);
  });

  testWidgets('renders right to left in Arabic without overflow', (
    tester,
  ) async {
    await tester.pumpWidget(
      _app(
        _FakeRepo(const ProblemSubmitted(id: 'x', linkedLogs: 0)),
        locale: const Locale('ar'),
      ),
    );
    await tester.pumpAndSettle();
    expect(
      Directionality.of(tester.element(find.byType(ReportProblemScreen))),
      TextDirection.rtl,
    );
    expect(tester.takeException(), isNull);
  });

  group('shared error states', () {
    const AppError error = AppError(
      kind: AppErrorKind.server,
      message: 'Something failed',
    );

    Widget host(Widget child, {TpReportProblemHandler? onReport}) {
      final Widget body = Scaffold(body: child);
      return MaterialApp(
        theme: TpTheme.light,
        supportedLocales: TpLocalizations.supportedLocales,
        localizationsDelegates: TpLocalizations.delegates,
        home: onReport == null
            ? body
            : TpReportProblemScope(onReport: onReport, child: body),
      );
    }

    testWidgets('offer Report a problem only when the scope is installed', (
      tester,
    ) async {
      await tester.pumpWidget(host(const TpErrorState(error: error)));
      expect(find.text('Report a problem'), findsNothing);

      int opened = 0;
      await tester.pumpWidget(
        host(const TpErrorState(error: error), onReport: (_) => opened++),
      );
      await tester.tap(find.text('Report a problem'));
      expect(opened, 1);

      await tester.pumpWidget(
        host(const TpBackendUnavailableState(), onReport: (_) => opened++),
      );
      await tester.tap(find.text('Report a problem'));
      expect(opened, 2);
    });
  });

  test('the unconfigured build version is not attached', () {
    expect(reportableAppVersion('999.0.0'), isNull);
    expect(reportableAppVersion('  '), isNull);
    expect(reportableAppVersion('0.1.1'), '0.1.1');
  });
}
