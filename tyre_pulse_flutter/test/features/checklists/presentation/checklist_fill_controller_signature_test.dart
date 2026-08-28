library;

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_riverpod/misc.dart' show Override;
import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/core/database/database_constants.dart'
    show primarySignatureFieldKey;
import 'package:tyre_pulse/features/checklists/checklists_providers.dart';
import 'package:tyre_pulse/features/checklists/data/checklist_draft_repository.dart';
import 'package:tyre_pulse/features/checklists/presentation/controllers/checklist_fill_controller.dart';
import 'package:tyre_pulse/features/checklists/presentation/state/checklist_fill_state.dart';

const String _rawSvg =
    '<svg xmlns="http://www.w3.org/2000/svg"><path d="M1 1 L9 9"/></svg>';

final class _RecordingDraftRepository implements ChecklistDraftRepository {
  final List<({String draftKey, String fieldKey})> clears =
      <({String draftKey, String fieldKey})>[];

  @override
  Future<void> clearSignature({
    required String draftKey,
    required String fieldKey,
  }) async {
    clears.add((draftKey: draftKey, fieldKey: fieldKey));
  }

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

final class _SeededChecklistFillController extends ChecklistFillController {
  _SeededChecklistFillController(this.initialState);

  final ChecklistFillState initialState;

  @override
  ChecklistFillState build() => initialState;
}

void main() {
  test('null clears persisted field and primary signatures and their state',
      () async {
    final _RecordingDraftRepository drafts = _RecordingDraftRepository();
    final ProviderContainer container = ProviderContainer(
      overrides: <Override>[
        checklistDraftRepositoryProvider.overrideWithValue(drafts),
        checklistFillControllerProvider.overrideWith(
          () => _SeededChecklistFillController(
            const ChecklistFillState(
              phase: ChecklistFillPhase.ready,
              draftKey: 'draft-1',
              signaturesByField: <String, String>{
                'mechanic_signature': _rawSvg,
                'electrician_signature': _rawSvg,
              },
              primarySignature: _rawSvg,
            ),
          ),
        ),
      ],
    );
    addTearDown(container.dispose);

    final ChecklistFillController controller = container.read(
      checklistFillControllerProvider.notifier,
    );
    await controller.saveSignature('mechanic_signature', null);

    ChecklistFillState state = container.read(checklistFillControllerProvider);
    expect(state.signaturesByField, <String, String>{
      'electrician_signature': _rawSvg,
    });
    expect(state.primarySignature, _rawSvg);

    await controller.savePrimarySignature(null);

    state = container.read(checklistFillControllerProvider);
    expect(state.primarySignature, isNull);
    expect(
      drafts.clears,
      <({String draftKey, String fieldKey})>[
        (draftKey: 'draft-1', fieldKey: 'mechanic_signature'),
        (draftKey: 'draft-1', fieldKey: primarySignatureFieldKey),
      ],
    );
  });
}
