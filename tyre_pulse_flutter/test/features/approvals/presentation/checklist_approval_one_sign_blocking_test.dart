/// Loop 18 / F-H-03: the one-sign close preview must use the viewer's role.
/// A role that closes a two-stage (`require_area_manager`) sheet in one sign
/// (admin / area / PMV manager) reviewing a sheet with a blocking 'Fault' answer
/// must see the cannot-close card. Before the fix the preview called
/// nextStatusFor without the role, computed the status as still two-stage, hid
/// the block, and let the approve proceed to a close the server would refuse.
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
import 'package:tyre_pulse/features/approvals/presentation/checklist_approval_review_screen.dart';
import 'package:tyre_pulse/features/profile/profile_providers.dart';

// An Admin closes a two-stage sheet in one sign (owner rule 2026-11-08), so this
// is a role whose one-sign preview the bug used to miss.
const WorkspaceContext _oneSignReviewer = WorkspaceContext(
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

final Map<String, Object?> _twoStageTemplate = <String, Object?>{
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

ChecklistApprovalItem _blockingItem() => ChecklistApprovalItem.fromRow(
      <String, Object?>{
        'id': 'sub-1',
        'template_id': 'tpl-1',
        'template_name': 'Daily Plant Checklist',
        'asset_no': 'CP-045',
        'site': 'Dubai Industrial City',
        'submitted_at': '2026-08-28T10:18:00Z',
        'printed_name': 'Ibrahim Noor',
        'approval_status': 'pending',
        'document_no': 'DVC-2026-0819',
        'score_pct': 50,
        'answers': <String, Object?>{'interlock': 'Fault'},
      },
    );

final class _Repo implements ChecklistApprovalRepository {
  @override
  Future<ChecklistApprovalItem?> byId(String id) async => _blockingItem();

  @override
  Future<ChecklistApprovalTemplateInfo?> templateInfo(String id) async =>
      ChecklistApprovalTemplateInfo.fromRow(_twoStageTemplate);

  @override
  Future<String?> currentUserDisplayName(String userId) async => null;

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

void main() {
  testWidgets(
    'a one-sign role sees the cannot-close card on a blocking two-stage sheet (F-H-03)',
    (WidgetTester tester) async {
      tester.view.physicalSize = const Size(400, 1200);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.reset);

      await tester.pumpWidget(
        ProviderScope(
          overrides: [
            workspaceContextProvider.overrideWithValue(_oneSignReviewer),
            checklistApprovalRepositoryProvider.overrideWithValue(_Repo()),
            mySavedSignatureProvider.overrideWith((Ref ref) async => null),
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

      await tester.scrollUntilVisible(
        find.text('This sheet cannot be closed yet'),
        300,
        scrollable: find.byType(Scrollable).first,
      );
      expect(find.text('This sheet cannot be closed yet'), findsOneWidget);
      expect(find.text('Boom safety interlocks: Fault'), findsOneWidget);
    },
  );
}
