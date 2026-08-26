/// Parity group O - the client/server contract. Cases O1-O6, marked in the
/// artifact itself as "Integration, not unit" - a pure Dart library that
/// makes no network call and has no notion of blocking marks, offline
/// state, or a live database row cannot prove most of this group directly.
/// This file is deliberately explicit about the boundary, per this task's
/// own brief: "port only the parts of group O that are genuinely testable
/// as pure logic against your engine... note which O cases you judged
/// untestable at this pure-logic layer and why, rather than fabricating a
/// test that doesn't actually exercise anything real."
///
/// `docs/flutter-migration/08-checklist-engine-parity-tests.md` section 10,
/// group O.
///
/// ## What each of the six cases means for THIS library, and why
///
/// **O1** ("the client's blocking verdict AGREES with the trigger") and
/// **O2** ("a blocking mark does NOT stop a SUBMIT") both concern the
/// checklist FIELD/marks engine's `canClose`/`blockingAnswers` and the fill
/// screen's submit-confirmation dialog. Neither `answers` nor a blocking
/// mark exists anywhere in this library's vocabulary - the approval ladder
/// module comment says so explicitly, and by design: only the checklist
/// domain engine (a parallel, separate port - see `checklist_approval.dart`'s
/// library comment) reads `answers` at all. **EXCLUDED - belongs to that
/// engine's own test suite, not this one.**
///
/// **O4** ("the closing rung REFUSES the same sheet") is, per the
/// artifact's OWN "WHAT THE DATABASE ENFORCES, and what only the client
/// does" table in section 8, enforced by the database ONLY - the blocking-
/// mark-refuses-`approved` rule is marked "ADVISORY only" on the client,
/// even at the closing rung. A pure client library correctly does NOT
/// refuse this (see the O3 test below, which proves exactly that this
/// library never gates a transition on a fault it cannot see), so there is
/// no true refusal here for this file to assert - asserting one would
/// fabricate a guarantee this layer does not and must not provide.
/// **EXCLUDED**, but see [decisionRequirementError] below for the adjacent,
/// genuinely client-owned rule (name + signature) this file DOES enforce.
///
/// **O6** ("a stale decision is refused, not clobbered") needs a real
/// `decide_checklist_approval` RPC call against a live row with an
/// optimistic-concurrency guard (`and approval_status = v_status`) - there
/// is no way to fabricate staleness without a server round trip.
/// **EXCLUDED.** The closest thing this layer can offer is already covered
/// by parity case L5 (`group_l_approval_ladder_test.dart`): once a
/// submission's own status has moved on, [canDecide] returns `false` for
/// everyone, including a super admin - a caller holding stale local data
/// for an already-decided row gets nothing to act on, not a wrong answer.
///
/// **O3** ("the supervisor rung ACCEPTS a sheet with a fault") and **O5**
/// ("an approval is never QUEUED") are covered below, each in the form this
/// layer can actually prove - see the tests themselves for exactly what
/// each one demonstrates and how it maps back to the artifact's wording.
library;

import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/features/approvals/domain/approval_decision_requirements.dart';
import 'package:tyre_pulse/features/approvals/domain/checklist_approval.dart';

const List<String> _kDomainFiles = <String>[
  'lib/features/approvals/domain/checklist_approval.dart',
  'lib/features/approvals/domain/checklist_approval_history.dart',
  'lib/features/approvals/domain/approval_decision_requirements.dart',
];

void main() {
  test('case O3: the supervisor rung accepts a sheet regardless of any '
      'fault, because this engine has no notion of "answers" at all', () {
    // Blocking marks ("Not OK" and similar) live entirely in the
    // checklist FIELD/marks engine and in the database trigger - this
    // library never reads `answers`, so it structurally cannot gate a
    // stage transition on one. That is the correct division of labour
    // (the artifact's own table marks the blocking-mark check "ADVISORY
    // only" on the client even at the CLOSING rung - see O4 above), and
    // this proves the approval ladder holds up its half: a two-stage
    // supervisor sign-off always reaches the second rung, whatever the
    // sheet's real-world answers contain. `nextStatusFor` and
    // `canDecide` both take no `answers` parameter, so there is no
    // faulty/not-faulty input to even construct - the guarantee is
    // structural, not a case the engine happens to handle correctly.
    const ApprovalTemplateLike template = ApprovalTemplateLike(
      requireAreaManager: true,
    );
    const ApprovalSubmissionLike submission = ApprovalSubmissionLike(
      approvalStatus: 'pending',
    );
    expect(canDecide(template, submission, 'Workshop Supervisor'), isTrue);
    expect(nextStatusFor(template, submission, true), 'pending_area_manager');
  });

  group('case O5: an approval is never queued', () {
    test('the approval domain has no way to reach a network or a queue at '
        'all - it imports nothing outside its own three sibling files', () {
      // AGENTS.md: "Approvals and other decisions that depend on current
      // server state are NOT blindly queued." A pure library cannot
      // enforce "refuse while offline" on its own - it has no notion of
      // connectivity at all, and never will, since that belongs to
      // whichever repository/queue layer eventually calls it. What it
      // CAN guarantee, and what this test checks by reading its own
      // source text (the same technique
      // test/core/permissions/module_registry_drift_test.dart already
      // uses for a cross-repo drift guard), is that it structurally
      // cannot reach a queue, a socket, or a database client itself:
      // every import line in this folder, if one exists at all, names
      // only another file inside this same domain folder.
      for (final String path in _kDomainFiles) {
        final File file = _locate(path);
        final List<String> lines = file.readAsStringSync().split('\n');
        for (final String line in lines) {
          final String trimmed = line.trimLeft();
          if (!trimmed.startsWith('import ')) continue;
          expect(
            trimmed,
            contains('package:tyre_pulse/features/approvals/domain/'),
            reason:
                '$path imports something outside this domain folder '
                '("$line"). This library must stay pure Dart, dependent '
                'on nothing but its own sibling files - no Flutter, no '
                'networking, no queue, no other feature\'s domain.',
          );
        }
      }
      // checklist_approval.dart specifically is the base of the graph
      // and must import literally nothing - not even a sibling.
      final String base = _locate(_kDomainFiles.first).readAsStringSync();
      final bool baseHasAnyImport = base
          .split('\n')
          .any((String l) => l.trimLeft().startsWith('import '));
      expect(
        baseHasAnyImport,
        isFalse,
        reason:
            'checklist_approval.dart must be the base of this folder\'s '
            'dependency graph and import nothing at all.',
      );
    });

    test('a decision can never be silently ready to persist - it is refused '
        'until it carries a name AND a signature (or, for a rejection, a '
        'reason) - so even a caller that mistakenly tried to build an '
        'offline write from an incomplete decision would be stopped here '
        'first, before it ever reached a queue', () {
      const ApprovalStage stage = ApprovalStage.supervisor;
      // Approving with nothing at all: refused.
      expect(
        decisionRequirementError(
          stage,
          const ApprovalDecisionInput(approved: true),
        ),
        isNotNull,
      );
      // Approving with a name but no signature: still refused - a
      // decision object must never both approve and carry no signature.
      expect(
        decisionRequirementError(
          stage,
          const ApprovalDecisionInput(approved: true, name: 'A. Khan'),
        ),
        isNotNull,
      );
      // Only once both are present does it clear.
      expect(
        decisionRequirementError(
          stage,
          const ApprovalDecisionInput(
            approved: true,
            name: 'A. Khan',
            signature: '<svg/>',
          ),
        ),
        isNull,
      );
    });
  });

  group('decisionRequirementError - direct coverage of the added contract', () {
    test('no outstanding stage refuses outright, whatever the input', () {
      expect(
        decisionRequirementError(
          null,
          const ApprovalDecisionInput(
            approved: true,
            name: 'A',
            signature: '<svg/>',
          ),
        ),
        isNotNull,
      );
    });

    test('a rejection needs a non-blank reason', () {
      expect(
        decisionRequirementError(
          ApprovalStage.areaManager,
          const ApprovalDecisionInput(approved: false),
        ),
        isNotNull,
      );
      expect(
        decisionRequirementError(
          ApprovalStage.areaManager,
          const ApprovalDecisionInput(approved: false, note: '   '),
        ),
        isNotNull,
        reason: 'whitespace is not a reason',
      );
      expect(
        decisionRequirementError(
          ApprovalStage.areaManager,
          const ApprovalDecisionInput(
            approved: false,
            note: 'wrong asset selected',
          ),
        ),
        isNull,
      );
    });

    test('an approval needs a non-blank name and a non-blank signature, '
        'independently', () {
      expect(
        decisionRequirementError(
          ApprovalStage.areaManager,
          const ApprovalDecisionInput(
            approved: true,
            name: '   ',
            signature: '<svg/>',
          ),
        ),
        isNotNull,
        reason: 'whitespace is not a name',
      );
      expect(
        decisionRequirementError(
          ApprovalStage.areaManager,
          const ApprovalDecisionInput(
            approved: true,
            name: 'A. Khan',
            signature: '',
          ),
        ),
        isNotNull,
        reason: 'an empty string is not a signature',
      );
      expect(
        decisionRequirementError(
          ApprovalStage.areaManager,
          const ApprovalDecisionInput(
            approved: true,
            name: 'A. Khan',
            signature: '<svg/>',
          ),
        ),
        isNull,
      );
    });
  });
}

/// Walks up a handful of levels from the working directory looking for
/// [relativePath]. `flutter test` runs with the package root as the working
/// directory, so this normally resolves on the first try; the walk covers a
/// repository-root working directory too, mirroring
/// `_locateMobileRegistry` in `module_registry_drift_test.dart`. Fails
/// loudly rather than skipping if the file cannot be found - a guard that
/// quietly disappears is worse than no guard.
File _locate(String relativePath) {
  Directory dir = Directory.current;
  for (int i = 0; i < 4; i++) {
    final File candidate = File(
      '${dir.path}${Platform.pathSeparator}'
      '${relativePath.replaceAll('/', Platform.pathSeparator)}',
    );
    if (candidate.existsSync()) return candidate;
    final Directory parent = dir.parent;
    if (parent.path == dir.path) break;
    dir = parent;
  }
  fail(
    'Could not find $relativePath by walking up from '
    '${Directory.current.path}. This guard reads this library\'s own '
    'source and cannot run without it.',
  );
}
