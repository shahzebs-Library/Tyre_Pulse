library;

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/core/permissions/access_resolver.dart';
import 'package:tyre_pulse/core/permissions/roles.dart';
import 'package:tyre_pulse/core/workspace/workspace_context.dart';
import 'package:tyre_pulse/core/workspace/workspace_providers.dart';
import 'package:tyre_pulse/core/workspace/workspace_scope.dart';
import 'package:tyre_pulse/features/inspections/data/inspection_draft_repository.dart';
import 'package:tyre_pulse/features/inspections/domain/inspection_draft_summary.dart';
import 'package:tyre_pulse/features/inspections/inspections_providers.dart';
import 'package:tyre_pulse/features/inspections/presentation/controllers/inspection_wizard_controller.dart';

const String _userId = 'inspector-1';

final class _DraftRepository implements InspectionDraftRepository {
  _DraftRepository({
    required this.drafts,
    required this.contentByDraftKey,
  });

  final List<InspectionDraftSummary> drafts;
  final Map<String, bool> contentByDraftKey;
  final List<String> contentChecks = <String>[];

  @override
  Future<List<InspectionDraftSummary>> draftsForUser(String userId) async {
    expect(userId, _userId);
    return drafts;
  }

  @override
  Future<bool> hasContent(String draftKey) async {
    contentChecks.add(draftKey);
    return contentByDraftKey[draftKey] ?? false;
  }

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

const WorkspaceContext _workspace = WorkspaceContext(
  userId: _userId,
  role: UserRole.known(RoleId.reporter),
  effectivePermissions: AccessState(
    role: UserRole.known(RoleId.reporter),
  ),
  countryScope: CountryScope.none,
  siteScope: SiteScope.none,
  companyId: 'company-1',
);

Future<void> _settle() async {
  for (int i = 0; i < 6; i++) {
    await Future<void>.delayed(Duration.zero);
  }
}

void main() {
  test(
    'Continue unfinished work hides opened-only TM749 but keeps a real '
    'partial draft',
    () async {
      final DateTime now = DateTime.utc(2026, 8, 28, 12);
      final InspectionDraftSummary openedOnly = InspectionDraftSummary(
        draftKey: '$_userId::TM749',
        assetNo: 'TM749',
        filled: 0,
        total: 12,
        updatedAt: now,
      );
      final InspectionDraftSummary realPartial = InspectionDraftSummary(
        draftKey: '$_userId::TM750',
        assetNo: 'TM750',
        filled: 1,
        total: 12,
        updatedAt: now.subtract(const Duration(minutes: 1)),
      );
      final _DraftRepository drafts = _DraftRepository(
        drafts: <InspectionDraftSummary>[openedOnly, realPartial],
        contentByDraftKey: <String, bool>{
          openedOnly.draftKey: false,
          realPartial.draftKey: true,
        },
      );
      final ProviderContainer container = ProviderContainer(
        overrides: [
          workspaceContextProvider.overrideWithValue(_workspace),
          inspectionDraftRepositoryProvider.overrideWithValue(drafts),
        ],
      );
      addTearDown(container.dispose);

      container.read(inspectionWizardControllerProvider);
      await _settle();

      final unfinished =
          container.read(inspectionWizardControllerProvider).unfinishedDrafts;
      expect(unfinished, <InspectionDraftSummary>[realPartial]);
      expect(drafts.contentChecks, <String>[
        openedOnly.draftKey,
        realPartial.draftKey,
      ]);
    },
  );
}
