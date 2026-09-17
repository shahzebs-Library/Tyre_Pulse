import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/features/accidents/domain/accident_case_vocab.dart';
import 'package:tyre_pulse/features/accidents/domain/accident_claim_package.dart';

AccidentEvidenceItem _doc(
  String key, {
  String workstream = 'insurance',
  DateTime? at,
}) =>
    AccidentEvidenceItem(
      id: '$key-${at?.millisecondsSinceEpoch ?? 0}',
      workstreamKey: workstream,
      requirementKey: key,
      uploadedAt: at,
    );

void main() {
  group('ClaimPackageStatus', () {
    test('counts required documents in mock order and prints N of M', () {
      final ClaimPackageStatus status = ClaimPackageStatus.fromEvidence(
        <AccidentEvidenceItem>[
          for (final VocabItem doc in claimPackageDocs)
            if (doc.key != 'driving_licence') _doc(doc.key),
          for (int i = 0; i < 8; i++) _doc('damage_photographs'),
        ],
      );
      expect(status.requiredTotal, 8);
      expect(status.requiredReceived, 7);
      expect(status.progressLabel, '7 of 8 required documents');
      expect(status.isComplete, isFalse);
      expect(status.missingRequired.single.doc.key, 'driving_licence');
      expect(
        status.rows.map((r) => r.doc.key),
        claimPackageDocs.map((d) => d.key),
      );
      final ClaimDocumentStatus photos = status.rows
          .firstWhere((r) => r.doc.key == 'damage_photographs');
      expect(photos.label, '9 received');
      expect(status.rows.first.label, 'Received');
      expect(
        status.rows.firstWhere((r) => r.doc.key == 'driving_licence').label,
        'Missing',
      );
    });

    test('evidence from another workstream never satisfies the package', () {
      final ClaimPackageStatus status = ClaimPackageStatus.fromEvidence(
        <AccidentEvidenceItem>[
          for (final VocabItem doc in claimPackageDocs)
            _doc(doc.key, workstream: 'assessment'),
        ],
      );
      expect(status.requiredReceived, 0);
    });

    test('registration unlocks only on a complete, unregistered package', () {
      final ClaimPackageStatus complete = ClaimPackageStatus.fromEvidence(
        <AccidentEvidenceItem>[
          for (final VocabItem doc in claimPackageDocs) _doc(doc.key),
        ],
      );
      expect(
        canRegisterClaim(package: complete, alreadyRegistered: false),
        isTrue,
      );
      expect(
        canRegisterClaim(package: complete, alreadyRegistered: true),
        isFalse,
      );
      expect(
        canRegisterClaim(
          package: ClaimPackageStatus.fromEvidence(const []),
          alreadyRegistered: false,
        ),
        isFalse,
      );
    });
  });

  group('money', () {
    test('net claimable is amount less deductible, floored at zero', () {
      expect(netClaimable(1000, 250), 750);
      expect(netClaimable(100, 250), 0);
      expect(netClaimable(1000, null), 1000);
      expect(netClaimable(null, 250), isNull);
      expect(netClaimable(double.nan, 1), isNull);
    });

    test('recovered total ignores rejected rows; outstanding needs approval',
        () {
      final List<AccidentClaimRecovery> rows = <AccidentClaimRecovery>[
        const AccidentClaimRecovery(id: 'a', amount: 400, status: 'received'),
        const AccidentClaimRecovery(id: 'b', amount: 100, status: 'rejected'),
        const AccidentClaimRecovery(id: 'c', amount: 50),
      ];
      expect(recoveredTotal(rows), 450);
      expect(outstandingAmount(1000, 450), 550);
      expect(outstandingAmount(300, 450), 0);
      expect(outstandingAmount(null, 450), isNull);
    });
  });

  group('labels', () {
    test('claim status pill', () {
      expect(claimStatusLabel(registered: false), 'Not registered');
      expect(claimStatusLabel(registered: true), 'Registered');
      expect(
        claimStatusLabel(registered: true, decision: 'partially_approved'),
        'Partially Approved',
      );
    });

    test('notify chip resolves owner role, else the configured role', () {
      final NotifyRole fleet =
          notifyRoles.firstWhere((r) => r.key == 'fleet');
      expect(
        notifyChipText(fleet, 'Fleet Supervisor'),
        'Fleet Supervisor · Fleet',
      );
      expect(notifyChipText(fleet, null), 'Fleet Supervisor · Fleet');
      final NotifyRole pmv =
          notifyRoles.firstWhere((r) => r.key == 'pmv_manager');
      expect(notifyChipText(pmv, ''), 'PMV Manager · PMV Manager');
      expect(notifyRoleWorkstream['command_center'], isNull);
    });
  });
}
