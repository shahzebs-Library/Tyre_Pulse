/// Mock parity for the checklist approval review ("checklist approval.png"):
/// outcome tally, findings, grouped sections, the saved-signature pre-fill
/// and the Approve gate - over a fake repository, never the network.
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
import 'package:tyre_pulse/features/approvals/checklist_approvals_providers.dart';
import 'package:tyre_pulse/features/approvals/data/checklist_approval_item.dart';
import 'package:tyre_pulse/features/approvals/data/checklist_approval_repository.dart';
import 'package:tyre_pulse/features/approvals/data/checklist_approval_template_info.dart';
import 'package:tyre_pulse/features/approvals/domain/checklist_review_outcome.dart';
import 'package:tyre_pulse/features/approvals/presentation/checklist_approval_review_screen.dart';
import 'package:tyre_pulse/features/approvals/presentation/widgets/approval_decision_bar.dart';
import 'package:tyre_pulse/features/checklists/domain/checklist_field.dart';
import 'package:tyre_pulse/features/profile/data/saved_signature_repository.dart';
import 'package:tyre_pulse/features/profile/profile_providers.dart';

const WorkspaceContext _reviewer = WorkspaceContext(
  userId: 'reviewer-1',
  role: UserRole.known(RoleId.admin, rawValue: 'Admin'),
  effectivePermissions: AccessState(
    role: UserRole.known(RoleId.admin, rawValue: 'Admin'),
  ),
  countryScope: CountryScope.none,
  siteScope: SiteScope.none,
  tenantId: 'org-1',
  companyId: 'org-1',
  activeCountry: 'UAE',
  fullName: 'Vinay Kumar',
);

final Map<String, Object?> _templateRow = <String, Object?>{
  'id': 'tpl-1',
  'require_area_manager': true,
  'fields': <Object?>[
    <String, Object?>{'id': 's1', 'type': 'section', 'label': 'Safety'},
    <String, Object?>{
      'id': 'interlock',
      'type': 'select',
      'label': 'Boom safety interlocks',
      'options_ref': 'legend',
      'required': true,
    },
    <String, Object?>{
      'id': 'horn',
      'type': 'select',
      'label': 'Horn',
      'options_ref': 'legend',
      'required': true,
    },
    <String, Object?>{
      'id': 'lamp',
      'type': 'select',
      'label': 'Beacon lamp',
      'options_ref': 'legend',
    },
    <String, Object?>{'id': 's2', 'type': 'section', 'label': 'Sign-off'},
    <String, Object?>{'id': 'operator', 'type': 'text', 'label': 'Operator'},
  ],
  'option_sets': <String, Object?>{
    'legend': <String, Object?>{
      'options': <String>['OK', 'Fault', 'N/A'],
      'meta': <Object?>[
        <String, Object?>{'value': 'OK', 'icon': 'ok'},
        <String, Object?>{'value': 'Fault', 'icon': 'fault'},
        <String, Object?>{'value': 'N/A', 'icon': 'na'},
      ],
      'blocking': <String>['Fault'],
    },
  },
};

ChecklistApprovalItem _item() => ChecklistApprovalItem.fromRow(
      <String, Object?>{
        'id': 'sub-1',
        'template_id': 'tpl-1',
        'template_name': 'Daily Plant & Vehicle Checklist',
        'asset_no': 'CP-045',
        'site': 'Dubai Industrial City',
        'submitted_at': '2026-08-28T10:18:00Z',
        'printed_name': 'Ibrahim Noor',
        'signature_data': 'data:image/png;base64,AAAA',
        'approval_status': 'pending',
        'document_no': 'DVC-2026-0819',
        'score_pct': 89,
        'answers': <String, Object?>{
          'interlock': 'Fault',
          'horn': 'OK',
          'lamp': 'N/A',
          'operator': 'Ibrahim',
        },
        'notes': <String, Object?>{'interlock': 'Warning stays active'},
        'photos': <String, Object?>{
          'interlock': <String>['a.jpg', 'b.jpg'],
        },
      },
    );

final class _Repo implements ChecklistApprovalRepository {
  @override
  Future<ChecklistApprovalItem?> byId(String id) async => _item();

  @override
  Future<ChecklistApprovalTemplateInfo?> templateInfo(String id) async =>
      ChecklistApprovalTemplateInfo.fromRow(_templateRow);

  @override
  Future<String?> currentUserDisplayName(String userId) async => null;

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

Future<void> _pump(WidgetTester tester, {SavedSignature? saved}) async {
  tester.view.physicalSize = const Size(400, 900);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.reset);
  await tester.pumpWidget(
    ProviderScope(
      overrides: [
        workspaceContextProvider.overrideWithValue(_reviewer),
        checklistApprovalRepositoryProvider.overrideWithValue(_Repo()),
        mySavedSignatureProvider.overrideWith((Ref ref) async => saved),
      ],
      child: MaterialApp(
        theme: TpTheme.light,
        supportedLocales: TpLocalizations.supportedLocales,
        localizationsDelegates: TpLocalizations.delegates,
        home: const ChecklistApprovalReviewScreen(
          route: ChecklistApprovalReviewRoute(
            submissionId: SubmissionId('sub-1'),
          ),
        ),
      ),
    ),
  );
  await tester.pumpAndSettle();
}

void main() {
  test('outcome classifies marks through the option set, not guesswork', () {
    final ChecklistApprovalTemplateInfo info =
        ChecklistApprovalTemplateInfo.fromRow(_templateRow)!;
    final ChecklistApprovalItem item = _item();
    final ChecklistReviewOutcome outcome = buildChecklistReviewOutcome(
      fields: info.fields,
      answers: item.answers,
      notes: item.notes,
      photos: item.photos,
      optionSets: info.optionSets,
      legendBlocking: info.legendBlocking,
    );
    expect(outcome.passes, 1);
    expect(outcome.fails, 1);
    expect(outcome.notApplicable, 1);
    expect(outcome.requiredAnswered, 2);
    expect(outcome.requiredTotal, 2);
    expect(outcome.findings.single.field.id, 'interlock');
    expect(outcome.findings.single.photoCount, 2);
    expect(outcome.sections, hasLength(2));
    // Free text is answered, never "passed".
    expect(outcome.sections[1].checks, 0);
  });

  test('a boolean false is a fault; an unanswered check is not a pass', () {
    const ChecklistField flag =
        ChecklistField(id: 'b', type: 'boolean', label: 'Brakes');
    expect(classifyReviewAnswer(flag, false), ReviewVerdict.fail);
    expect(classifyReviewAnswer(flag, true), ReviewVerdict.pass);
    expect(classifyReviewAnswer(flag, null), ReviewVerdict.unanswered);
  });

  testWidgets(
    'review mirrors the mock: document number, outcome, findings, sections',
    (WidgetTester tester) async {
      await _pump(tester);

      expect(find.text('DVC-2026-0819'), findsOneWidget);
      expect(find.text('Awaiting your approval'), findsOneWidget);
      expect(find.text('89%'), findsOneWidget);
      await tester.scrollUntilVisible(
        find.byKey(ChecklistApprovalReviewKeys.findings),
        300,
        scrollable: find.byType(Scrollable).first,
      );
      expect(find.text('Note: Warning stays active'), findsOneWidget);
      await tester.scrollUntilVisible(
        find.byKey(ChecklistApprovalReviewKeys.viewAll),
        300,
        scrollable: find.byType(Scrollable).first,
      );
      expect(find.text('1 finding'), findsOneWidget);
      expect(find.text('Complete'), findsOneWidget);
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets('Approve stays disabled until a signature exists', (
    WidgetTester tester,
  ) async {
    await _pump(tester);
    await tester.scrollUntilVisible(
      find.byKey(ChecklistApprovalReviewKeys.approve),
      300,
      scrollable: find.byType(Scrollable).first,
    );
    await tester.enterText(
      find.widgetWithText(TextField, 'Type your name'),
      'Vinay Kumar',
    );
    await tester.pump();
    final Finder approve = find.descendant(
      of: find.byKey(ChecklistApprovalReviewKeys.approve),
      matching: find.byWidgetPredicate((Widget w) => w is ButtonStyleButton),
    );
    expect(tester.widget<ButtonStyleButton>(approve).onPressed, isNull);
    expect(
      find.byKey(ChecklistApprovalReviewKeys.savedSignatureNote),
      findsNothing,
    );
  });

  testWidgets(
    'a saved signature pre-fills the pad but approving still needs a press',
    (WidgetTester tester) async {
      await _pump(
        tester,
        saved: const SavedSignature(value: 'data:image/png;base64,AAAA'),
      );
      await tester.scrollUntilVisible(
        find.byKey(ChecklistApprovalReviewKeys.savedSignatureNote),
        300,
        scrollable: find.byType(Scrollable).first,
      );
      expect(
        find.byKey(ChecklistApprovalReviewKeys.savedSignatureNote),
        findsOneWidget,
      );
      await tester.enterText(
        find.widgetWithText(TextField, 'Type your name'),
        'Vinay Kumar',
      );
      await tester.pump();
      final Finder approve = find.descendant(
        of: find.byKey(ChecklistApprovalReviewKeys.approve),
        matching: find.byWidgetPredicate((Widget w) => w is ButtonStyleButton),
      );
      // Enabled - but nothing was decided: pre-filling is not signing. The
      // decision form (not a decided-info card) is still on screen.
      expect(tester.widget<ButtonStyleButton>(approve).onPressed, isNotNull);
      expect(
        find.byKey(ChecklistApprovalReviewKeys.returnForCorrection),
        findsOneWidget,
      );
      // Same shared decision bar as the inspection review: outlined Return.
      expect(find.byType(ApprovalDecisionBar), findsOneWidget);
      expect(
        tester.widget(
          find.byKey(ChecklistApprovalReviewKeys.returnForCorrection),
        ),
        isA<OutlinedButton>(),
      );
    },
  );
}
