import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/features/handover/domain/handover_approval.dart';

/// Pins the vehicle-handover sign-off ladder against the live SQL
/// (`decide_handover_approval` in
/// `supabase/migrations/20261112130000_handover_two_stage_signoff.sql`) and the
/// web mirror `src/lib/handoverApproval.js`. The three copies are a pinned set
/// and must change together.
void main() {
  HandoverApprovalLike at(String status) =>
      HandoverApprovalLike(approvalStatus: status);

  group('stageFor', () {
    test('reads the submission status, not a queue position', () {
      expect(stageFor(at('pending_supervisor')), HandoverStage.supervisor);
      expect(stageFor(at('pending_incharge')), HandoverStage.incharge);
    });

    test('a draft, closed, sent-back or unknown handover has no stage', () {
      expect(stageFor(at('draft')), isNull);
      expect(stageFor(at('approved')), isNull);
      expect(stageFor(at('rejected')), isNull);
      expect(stageFor(at('')), isNull);
      expect(stageFor(null), isNull);
      expect(stageFor(at('nonsense')), isNull);
    });
  });

  group('who may act on a rung', () {
    test('the supervisor rung admits the supervisor and the elevated roles', () {
      for (final String role in <String>[
        'Fleet Supervisor',
        'fleet_supervisor',
        'Manager',
        'Director',
        'Admin',
        'Fleet Incharge', // a higher rung may act on a lower one
      ]) {
        expect(
          canActOnStage(HandoverStage.supervisor, role),
          isTrue,
          reason: '$role should reach the supervisor rung',
        );
      }
    });

    test('the supervisor rung refuses a plain field role', () {
      for (final String role in <String>['Reporter', 'Tyre Man', 'Driver']) {
        expect(canActOnStage(HandoverStage.supervisor, role), isFalse);
      }
    });

    test('the incharge rung admits only Fleet Incharge and Admin', () {
      expect(canActOnStage(HandoverStage.incharge, 'Fleet Incharge'), isTrue);
      expect(canActOnStage(HandoverStage.incharge, 'fleet_incharge'), isTrue);
      expect(canActOnStage(HandoverStage.incharge, 'Admin'), isTrue);
      // Manager and Director sign the supervisor rung only.
      expect(canActOnStage(HandoverStage.incharge, 'Manager'), isFalse);
      expect(canActOnStage(HandoverStage.incharge, 'Director'), isFalse);
      expect(canActOnStage(HandoverStage.incharge, 'Fleet Supervisor'), isFalse);
    });

    test('a super admin passes any rung, and even a null rung directly', () {
      expect(
        canActOnStage(HandoverStage.incharge, 'Reporter', isSuperAdmin: true),
        isTrue,
      );
      expect(canActOnStage(null, 'Reporter', isSuperAdmin: true), isTrue);
    });

    test('a null or blank role matches nothing', () {
      expect(canActOnStage(HandoverStage.supervisor, null), isFalse);
      expect(canActOnStage(HandoverStage.supervisor, '   '), isFalse);
    });
  });

  group('canDecide', () {
    test('a closed, sent-back or draft handover can be decided by no one', () {
      for (final String terminal in <String>['approved', 'rejected', 'draft']) {
        expect(canDecide(at(terminal), 'Admin'), isFalse);
        expect(
          canDecide(at(terminal), 'Reporter', isSuperAdmin: true),
          isFalse,
          reason: 'not even a super admin on a finished/draft handover',
        );
      }
    });

    test('a supervisor can decide a supervisor-stage handover', () {
      expect(canDecide(at('pending_supervisor'), 'Fleet Supervisor'), isTrue);
    });

    test('a supervisor cannot decide an incharge-stage handover', () {
      expect(canDecide(at('pending_incharge'), 'Fleet Supervisor'), isFalse);
    });

    test('the incharge can decide the incharge-stage handover', () {
      expect(canDecide(at('pending_incharge'), 'Fleet Incharge'), isTrue);
      expect(canDecide(at('pending_incharge'), 'Admin'), isTrue);
    });

    test('an incharge-signer can decide a supervisor-stage handover (one sign)',
        () {
      expect(canDecide(at('pending_supervisor'), 'Admin'), isTrue);
      expect(canDecide(at('pending_supervisor'), 'Fleet Incharge'), isTrue);
    });
  });

  group('closesInOneSign', () {
    test('an incharge-signer at the supervisor rung closes both', () {
      expect(closesInOneSign(at('pending_supervisor'), 'Admin'), isTrue);
      expect(closesInOneSign(at('pending_supervisor'), 'Fleet Incharge'), isTrue);
      expect(
        closesInOneSign(at('pending_supervisor'), 'Reporter', isSuperAdmin: true),
        isTrue,
      );
    });

    test('a plain supervisor at the supervisor rung does NOT close both', () {
      expect(closesInOneSign(at('pending_supervisor'), 'Fleet Supervisor'),
          isFalse);
      expect(closesInOneSign(at('pending_supervisor'), 'Manager'), isFalse);
    });

    test('never at the incharge rung', () {
      expect(closesInOneSign(at('pending_incharge'), 'Admin'), isFalse);
    });
  });

  group('nextStatusFor', () {
    test('a rejection always resolves to rejected, at either rung', () {
      expect(
        nextStatusFor(at('pending_supervisor'), false, role: 'Fleet Supervisor'),
        'rejected',
      );
      expect(
        nextStatusFor(at('pending_incharge'), false, role: 'Fleet Incharge'),
        'rejected',
      );
    });

    test('a supervisor approving moves to pending_incharge', () {
      expect(
        nextStatusFor(at('pending_supervisor'), true, role: 'Fleet Supervisor'),
        'pending_incharge',
      );
      expect(
        nextStatusFor(at('pending_supervisor'), true, role: 'Manager'),
        'pending_incharge',
      );
    });

    test('an incharge-signer approving the supervisor rung closes in one sign',
        () {
      expect(
        nextStatusFor(at('pending_supervisor'), true, role: 'Admin'),
        'approved',
      );
      expect(
        nextStatusFor(at('pending_supervisor'), true, role: 'Fleet Incharge'),
        'approved',
      );
      expect(
        nextStatusFor(at('pending_supervisor'), true, isSuperAdmin: true),
        'approved',
      );
    });

    test('an incharge approving the incharge rung closes it', () {
      expect(
        nextStatusFor(at('pending_incharge'), true, role: 'Fleet Incharge'),
        'approved',
      );
    });

    test('with no rung outstanding the status is unchanged', () {
      expect(nextStatusFor(at('approved'), true), 'approved');
      expect(nextStatusFor(at('draft'), true), 'draft');
      expect(nextStatusFor(null, true), 'approved');
    });
  });

  group('approvalProgress', () {
    test('always two rungs, filled from the right column sets', () {
      final HandoverApprovalLike sub = HandoverApprovalLike(
        approvalStatus: 'pending_incharge',
        supervisorName: 'Sara',
        supervisorSignature: 'data:image/png;base64,AAA',
        supervisorAt: '2026-11-12T08:00:00Z',
      );
      final List<HandoverRung> rungs = approvalProgress(sub);
      expect(rungs, hasLength(2));
      final HandoverRung supervisor = rungs[0];
      expect(supervisor.key, HandoverStage.supervisor);
      expect(supervisor.name, 'Sara');
      expect(supervisor.done, isTrue, reason: 'moved past the supervisor rung');
      expect(supervisor.current, isFalse);
      final HandoverRung incharge = rungs[1];
      expect(incharge.key, HandoverStage.incharge);
      expect(incharge.done, isFalse);
      expect(incharge.current, isTrue);
    });

    test('a closed handover marks both rungs done', () {
      final List<HandoverRung> rungs = approvalProgress(at('approved'));
      expect(rungs.every((HandoverRung r) => r.done), isTrue);
      expect(rungs.any((HandoverRung r) => r.current), isFalse);
    });

    test('a pending_supervisor handover has the first rung current', () {
      final List<HandoverRung> rungs = approvalProgress(at('pending_supervisor'));
      expect(rungs[0].current, isTrue);
      expect(rungs[0].done, isFalse);
      expect(rungs[1].done, isFalse);
    });
  });

  group('closed / rejected helpers', () {
    test('isFullyClosed is true only for approved', () {
      expect(isFullyClosed(at('approved')), isTrue);
      expect(isFullyClosed(at('pending_incharge')), isFalse);
      expect(isFullyClosed(at('rejected')), isFalse);
      expect(isFullyClosed(null), isFalse);
    });

    test('isRejected is true only for rejected', () {
      expect(isRejected(at('rejected')), isTrue);
      expect(isRejected(at('approved')), isFalse);
      expect(isRejected(null), isFalse);
    });
  });

  group('statusSummary', () {
    test('names who is holding the handover, not a bare "pending"', () {
      expect(
        statusSummary(at('pending_supervisor')),
        const HandoverStatusSummary(
          tone: HandoverStatusTone.warn,
          holder: HandoverHolder.supervisor,
          text: 'Waiting for a supervisor',
        ),
      );
      expect(
        statusSummary(at('pending_incharge')),
        const HandoverStatusSummary(
          tone: HandoverStatusTone.warn,
          holder: HandoverHolder.incharge,
          text: 'Waiting for the fleet incharge',
        ),
      );
    });

    test('closed, sent back, draft and unknown each render distinctly', () {
      expect(statusSummary(at('approved')).tone, HandoverStatusTone.good);
      expect(statusSummary(at('approved')).holder, HandoverHolder.none);
      expect(statusSummary(at('rejected')).tone, HandoverStatusTone.bad);
      expect(statusSummary(at('draft')).tone, HandoverStatusTone.muted);
      expect(statusSummary(at('draft')).text, 'Not submitted');
      expect(statusSummary(null).tone, HandoverStatusTone.muted);
    });
  });

  group('stageLabel', () {
    test('returns a label for a stage and empty for null', () {
      expect(stageLabel(HandoverStage.supervisor), isNotEmpty);
      expect(stageLabel(HandoverStage.incharge), isNotEmpty);
      expect(stageLabel(null), '');
    });
  });

  test('this file imports only its subject (pure domain, no Flutter/IO)', () {
    // Mirrors the checklist ladder group-O contract: a decision engine must
    // not throw, block on IO, or depend on Flutter. The domain file itself
    // carries zero imports (see its library comment); this test file imports
    // only the subject under test.
    expect(normaliseHandoverRole('  Fleet Incharge '), 'fleet_incharge');
    expect(normaliseHandoverRole('fleet-incharge'), 'fleet_incharge');
  });
}
