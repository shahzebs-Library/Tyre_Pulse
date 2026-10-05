import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/app/localization/tp_localizations.dart';
import 'package:tyre_pulse/app/theme/tp_theme.dart';
import 'package:tyre_pulse/features/checklists/checklists_providers.dart';
import 'package:tyre_pulse/features/checklists/data/checklist_remote_models.dart';
import 'package:tyre_pulse/features/checklists/data/checklist_remote_repository.dart';
import 'package:tyre_pulse/features/checklists/data/checklist_submission_detail.dart';
import 'package:tyre_pulse/features/checklists/presentation/checklist_submission_detail_screen.dart';

/// The template as it was when the sheet was filled. `hidden` only shows
/// when `brakes` is 'Not OK', so it must NOT render for this sheet.
final Map<String, dynamic> _snapshot = <String, dynamic>{
  'template_id': 'tpl-1',
  'name': 'Workshop Daily Checklist',
  'require_approval': true,
  'require_area_manager': true,
  'fields': <dynamic>[
    <String, dynamic>{'id': 'brakes', 'type': 'text', 'label': 'Brakes'},
    <String, dynamic>{
      'id': 'tyres',
      'type': 'text',
      'label': 'Tyre condition',
      'allow_note': true,
    },
    <String, dynamic>{
      'id': 'hidden',
      'type': 'text',
      'label': 'Brake repair detail',
      'visibleWhen': <dynamic>[
        <String, dynamic>{'field': 'brakes', 'op': '=', 'value': 'Not OK'},
      ],
    },
  ],
};

ChecklistSubmissionDetail _detail({
  Map<String, dynamic>? snapshot,
  String? reviewNote = 'Replace the cut tyre before the next shift.',
}) =>
    ChecklistSubmissionDetail.fromRow(<String, dynamic>{
      'id': 'sub-1',
      'template_id': 'tpl-1',
      'template_name': 'Workshop Daily Checklist',
      'template_snapshot': snapshot ?? _snapshot,
      'site': 'NHC',
      'asset_no': 'TM514',
      'answers': <String, dynamic>{'brakes': 'OK', 'tyres': 'Cut on LHF1'},
      'notes': <String, dynamic>{'tyres': 'Sidewall cut 3 cm'},
      'printed_name': 'Ijaz Ali',
      'submitted_at': '2026-10-05T08:12:00Z',
      'score_pct': 92,
      'score_passed': true,
      'approval_status': 'pending_area_manager',
      'document_no': 'WDC-TM514-2026-0007',
      'supervisor_name': 'Vinay Kumar',
      'supervisor_at': '2026-10-05T09:00:00Z',
      'review_note': reviewNote,
    })!;

final class _RemoteFake implements ChecklistRemoteRepository {
  _RemoteFake({this.detail, this.fail = false, this.liveTemplate});

  ChecklistSubmissionDetail? detail;
  bool fail;
  ChecklistTemplateRecord? liveTemplate;
  int submissionCalls = 0;
  int templateCalls = 0;

  @override
  Future<ChecklistSubmissionDetail?> getSubmission(String id) async {
    submissionCalls++;
    if (fail) throw Exception('network down');
    return detail;
  }

  @override
  Future<ChecklistTemplateRecord?> getTemplate(String id) async {
    templateCalls++;
    return liveTemplate;
  }

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

Future<void> _pump(
  WidgetTester tester,
  _RemoteFake remote, {
  Locale locale = const Locale('en'),
  Size size = const Size(390, 900),
}) async {
  tester.view.physicalSize = size;
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.reset);
  await tester.pumpWidget(
    ProviderScope(
      overrides: [
        checklistRemoteRepositoryProvider.overrideWithValue(remote),
      ],
      child: MaterialApp(
        theme: TpTheme.light,
        locale: locale,
        supportedLocales: TpLocalizations.supportedLocales,
        localizationsDelegates: TpLocalizations.delegates,
        home: const ChecklistSubmissionDetailScreen(
          submissionId: 'sub-1',
          fallbackTitle: 'WDC-TM514-2026-0007',
        ),
      ),
    ),
  );
  await tester.pumpAndSettle();
}

void main() {
  testWidgets('shows the summary, sign-offs, review note and answers', (
    WidgetTester tester,
  ) async {
    final _RemoteFake remote = _RemoteFake(detail: _detail());
    await _pump(tester, remote);

    expect(find.text('Workshop Daily Checklist'), findsWidgets);
    expect(find.text('TM514 - NHC'), findsOneWidget);
    expect(find.textContaining('Submitted'), findsOneWidget);

    // Two-stage ladder: filled, supervisor signed, area manager outstanding.
    expect(find.text('Filled by'), findsOneWidget);
    expect(find.text('Supervisor sign-off'), findsOneWidget);
    expect(find.text('Area manager approval'), findsOneWidget);
    expect(find.textContaining('Vinay Kumar'), findsOneWidget);
    expect(find.text('Not signed yet'), findsOneWidget);

    expect(
      find.byKey(ChecklistSubmissionDetailKeys.reviewNote),
      findsOneWidget,
    );
    expect(
      find.text('Replace the cut tyre before the next shift.'),
      findsOneWidget,
    );

    await tester.scrollUntilVisible(
      find.text('Sidewall cut 3 cm'),
      200,
      scrollable: find.byType(Scrollable).first,
    );
    expect(find.text('Brakes'), findsOneWidget);
    expect(find.text('OK'), findsOneWidget);
    expect(find.text('Cut on LHF1'), findsOneWidget);
    expect(find.text('Sidewall cut 3 cm'), findsOneWidget);

    // A field hidden while filling stays hidden here.
    expect(find.text('Brake repair detail'), findsNothing);

    // The snapshot was enough; the live template was never read.
    expect(remote.templateCalls, 0);
    expect(tester.takeException(), isNull);
  });

  testWidgets('falls back to the live template when there is no snapshot', (
    WidgetTester tester,
  ) async {
    final _RemoteFake remote = _RemoteFake(
      detail: _detail(snapshot: <String, dynamic>{}),
      liveTemplate: ChecklistTemplateRecord.fromRow(<String, dynamic>{
        'id': 'tpl-1',
        ..._snapshot,
      }),
    );
    await _pump(tester, remote);
    expect(remote.templateCalls, 1);
    await tester.scrollUntilVisible(
      find.text('Tyre condition'),
      200,
      scrollable: find.byType(Scrollable).first,
    );
    expect(find.text('Tyre condition'), findsOneWidget);
  });

  testWidgets('no template at all still shows answers by field id', (
    WidgetTester tester,
  ) async {
    final _RemoteFake remote = _RemoteFake(
      detail: _detail(snapshot: <String, dynamic>{}),
    );
    await _pump(tester, remote);
    await tester.scrollUntilVisible(
      find.text('Cut on LHF1'),
      200,
      scrollable: find.byType(Scrollable).first,
    );
    expect(find.text('tyres'), findsOneWidget);
    expect(find.text('Cut on LHF1'), findsOneWidget);
  });

  testWidgets('a missing sheet says so instead of a blank page', (
    WidgetTester tester,
  ) async {
    await _pump(tester, _RemoteFake());
    expect(find.byKey(ChecklistSubmissionDetailKeys.notFound), findsOneWidget);
    expect(find.text('Checklist not found'), findsOneWidget);
  });

  testWidgets('a failed read shows the error and Retry reloads', (
    WidgetTester tester,
  ) async {
    final _RemoteFake remote = _RemoteFake(detail: _detail(), fail: true);
    await _pump(tester, remote);
    expect(find.text('Try again'), findsOneWidget);

    remote.fail = false;
    await tester.tap(find.text('Try again'));
    await tester.pumpAndSettle();
    expect(remote.submissionCalls, 2);
    expect(find.text('TM514 - NHC'), findsOneWidget);
  });

  testWidgets('no review note renders no note card', (
    WidgetTester tester,
  ) async {
    await _pump(tester, _RemoteFake(detail: _detail(reviewNote: null)));
    expect(find.byKey(ChecklistSubmissionDetailKeys.reviewNote), findsNothing);
  });

  testWidgets('compact Arabic renders right-to-left without overflow', (
    WidgetTester tester,
  ) async {
    await _pump(
      tester,
      _RemoteFake(detail: _detail()),
      locale: const Locale('ar'),
      size: const Size(320, 640),
    );
    expect(
      Directionality.of(
        tester.element(find.byType(ChecklistSubmissionDetailScreen)),
      ),
      TextDirection.rtl,
    );
    expect(find.text('تفاصيل قائمة الفحص'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });
}
