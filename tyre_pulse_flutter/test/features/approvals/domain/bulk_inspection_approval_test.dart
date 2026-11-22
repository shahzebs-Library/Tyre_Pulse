import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/features/approvals/data/inspection_approval_item.dart';
import 'package:tyre_pulse/features/approvals/data/inspection_approval_repository.dart';
import 'package:tyre_pulse/features/approvals/domain/bulk_inspection_approval.dart';
import 'package:tyre_pulse/features/tyre_diagram/domain/tyre_diagram_layouts.dart';

const String _sig = 'data:image/png;base64,AAAA';

InspectionApprovalItem _mixer(
  String id, {
  required bool complete,
  String status = 'pending_approval',
}) {
  final List<String> positions = diagramPositions('Tri-mixer', 'TM001');
  return InspectionApprovalItem(
    id: id,
    assetNo: 'TM001',
    vehicleType: 'Tri-mixer',
    approvalStatus: status,
    tyreConditions: <String, Object?>{
      for (int i = 0; i < positions.length; i++)
        positions[i]: <String, Object?>{
          'position': positions[i],
          'condition': 'Good',
          'checked': complete || i == 0,
        },
    },
  );
}

final class _Repo implements InspectionApprovalRepository {
  _Repo(this.rows, {this.failDecideFor = const <String>{}});

  final Map<String, InspectionApprovalItem> rows;
  final Set<String> failDecideFor;
  final List<InspectionApprovalDecision> decisions =
      <InspectionApprovalDecision>[];

  @override
  Future<InspectionApprovalItem?> byId(String id) async => rows[id];

  @override
  Future<void> decide(InspectionApprovalDecision input) async {
    if (failDecideFor.contains(input.inspectionId)) {
      throw StateError('refused');
    }
    decisions.add(input);
  }

  @override
  Future<String?> currentUserDisplayName(String userId) async => null;

  @override
  Future<List<InspectionApprovalItem>> listPending({String? country}) async =>
      rows.values.toList();

  @override
  Future<List<InspectionApprovalItem>> listByStatus(
    String status, {
    String? country,
  }) async =>
      const <InspectionApprovalItem>[];
}

void main() {
  test('complete rows are approved with the saved signature', () async {
    final _Repo repo = _Repo(<String, InspectionApprovalItem>{
      'a': _mixer('a', complete: true),
      'b': _mixer('b', complete: true),
    });
    final BulkInspectionApprovalOutcome out = await bulkApproveInspections(
      repository: repo,
      inspectionIds: <String>['a', 'b'],
      signature: _sig,
    );
    expect(out.approved, <String>['a', 'b']);
    expect(repo.decisions, hasLength(2));
    expect(
      repo.decisions.every(
        (InspectionApprovalDecision d) =>
            d.approved && d.approverSignature == _sig,
      ),
      isTrue,
    );
  });

  test(
      'bulk is never looser than the single Approve: incomplete tyre '
      'evidence is skipped, not approved', () async {
    final _Repo repo = _Repo(<String, InspectionApprovalItem>{
      'ok': _mixer('ok', complete: true),
      'gap': _mixer('gap', complete: false),
    });
    expect(inspectionTyreEvidenceAllowsApproval(repo.rows['gap']!), isFalse);
    final BulkInspectionApprovalOutcome out = await bulkApproveInspections(
      repository: repo,
      inspectionIds: <String>['ok', 'gap'],
      signature: _sig,
    );
    expect(out.approved, <String>['ok']);
    expect(out.skippedIncomplete, <String>['gap']);
    expect(repo.decisions.map((d) => d.inspectionId), <String>['ok']);
  });

  test('decided, missing and refused rows are reported separately', () async {
    final _Repo repo = _Repo(
      <String, InspectionApprovalItem>{
        'done': _mixer('done', complete: true, status: 'approved'),
        'bad': _mixer('bad', complete: true),
      },
      failDecideFor: <String>{'bad'},
    );
    final List<(int, int)> progress = <(int, int)>[];
    final BulkInspectionApprovalOutcome out = await bulkApproveInspections(
      repository: repo,
      inspectionIds: <String>['done', 'gone', 'bad', 'done'],
      signature: _sig,
      onProgress: (int d, int t) => progress.add((d, t)),
    );
    expect(out.alreadyDecided, <String>['done']);
    expect(out.failed, <String>['gone', 'bad']);
    expect(out.approved, isEmpty);
    expect(out.total, 3);
    expect(progress.last, (3, 3));
  });
}
