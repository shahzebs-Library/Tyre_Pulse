import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:supabase_flutter/supabase_flutter.dart';
import 'package:tyre_pulse/core/network/supabase_tables.dart';
import 'package:tyre_pulse/features/problem_report/data/device_context_reader.dart';
import 'package:tyre_pulse/features/problem_report/data/problem_report_repository.dart';
import 'package:tyre_pulse/features/problem_report/domain/problem_report.dart';

ProblemReportDraft _draft({
  String description = 'The tyre list stays empty after I pick a site',
  ProblemCategory category = ProblemCategory.dataWrong,
  ProblemSeverity? severity,
}) {
  return ProblemReportDraft(
    description: description,
    category: category,
    severity: severity,
    context: const ProblemReportContext(
      appVersion: '0.1.1',
      device: 'samsung SM-A155F',
      os: 'Android 14 (SDK 34)',
      screen: '/profile',
    ),
  );
}

void main() {
  group('validateProblemDescription', () {
    test('needs at least 10 characters after trimming', () {
      expect(
        validateProblemDescription('   broken   '),
        ProblemDescriptionIssue.tooShort,
      );
      expect(
        validateProblemDescription(null),
        ProblemDescriptionIssue.tooShort,
      );
      expect(validateProblemDescription('0123456789'), isNull);
    });

    test('refuses more than 2000 characters', () {
      expect(validateProblemDescription('a' * 2000), isNull);
      expect(
        validateProblemDescription('a' * 2001),
        ProblemDescriptionIssue.tooLong,
      );
    });
  });

  group('submitUserIssueParams', () {
    test('matches the live RPC signature and CHECK vocabulary', () {
      final Map<String, Object?> params = submitUserIssueParams(
        _draft(description: '  it is too slow to open  '),
      );
      expect(params.keys.toSet(), <String>{
        'p_description',
        'p_category',
        'p_severity',
        'p_platform',
        'p_app_version',
        'p_device',
        'p_os',
        'p_page',
        'p_reference_id',
      });
      expect(params['p_description'], 'it is too slow to open');
      expect(params['p_category'], 'data_wrong');
      // Not chosen travels as null; the server applies medium.
      expect(params['p_severity'], isNull);
      // `user_issues.platform` only allows web | flutter | expo.
      expect(params['p_platform'], 'flutter');
      expect(params['p_os'], 'Android 14 (SDK 34)');
      expect(params['p_page'], '/profile');
      expect(params['p_reference_id'], isNull);
    });

    test('category and severity wire values', () {
      expect(
        ProblemCategory.values.map((ProblemCategory c) => c.wire).toSet(),
        <String>{'bug', 'data_wrong', 'access', 'slow', 'other'},
      );
      expect(
        submitUserIssueParams(
          _draft(severity: ProblemSeverity.critical),
        )['p_severity'],
        'critical',
      );
    });

    test('blank context values become null, long ones are capped', () {
      final Map<String, Object?> params = submitUserIssueParams(
        ProblemReportDraft(
          description: 'Something went wrong here',
          category: ProblemCategory.bug,
          context: ProblemReportContext(
            appVersion: '   ',
            device: 'x' * 500,
          ),
        ),
      );
      expect(params['p_app_version'], isNull);
      expect((params['p_device']! as String).length, 200);
      expect(params['p_os'], isNull);
      expect(params['p_page'], isNull);
    });
  });

  group('device description', () {
    test('does not repeat the brand', () {
      expect(describeAndroidModel('samsung', 'SM-A155F'), 'samsung SM-A155F');
      expect(
        describeAndroidModel('Google', 'Google Pixel 8'),
        'Google Pixel 8',
      );
      expect(describeAndroidModel(null, null), isNull);
      expect(describeAndroidOs('14', 34), 'Android 14 (SDK 34)');
      expect(describeAndroidOs(null, null), isNull);
    });
  });

  group('SupabaseProblemReportRepository', () {
    SupabaseProblemReportRepository repo(
      Future<Object?> Function(String, Map<String, Object?>) rpc, {
      bool signedIn = true,
    }) =>
        SupabaseProblemReportRepository(rpc: rpc, hasSession: () => signedIn);

    test('sends submit_user_issue and reads the reply', () async {
      String? called;
      Map<String, Object?>? sent;
      final ProblemSubmitOutcome outcome = await repo((name, params) async {
        called = name;
        sent = params;
        return <String, Object?>{'ok': true, 'id': 'abc', 'linked_logs': 2};
      }).submit(_draft());
      expect(called, SupabaseRpcs.submitUserIssue);
      expect(sent!['p_platform'], 'flutter');
      expect(outcome, isA<ProblemSubmitted>());
      expect((outcome as ProblemSubmitted).id, 'abc');
      expect(outcome.linkedLogs, 2);
    });

    test('never calls the server without a session', () async {
      bool called = false;
      final ProblemSubmitOutcome outcome = await repo(
        (name, params) async {
          called = true;
          return null;
        },
        signedIn: false,
      ).submit(_draft());
      expect(called, isFalse);
      expect(
        (outcome as ProblemNotSubmitted).reason,
        ProblemSubmitFailure.signedOut,
      );
    });

    test('an invalid draft never reaches the server', () async {
      bool called = false;
      final ProblemSubmitOutcome outcome = await repo((name, params) async {
        called = true;
        return null;
      }).submit(_draft(description: 'short'));
      expect(called, isFalse);
      expect(
        (outcome as ProblemNotSubmitted).reason,
        ProblemSubmitFailure.invalid,
      );
    });

    Future<ProblemSubmitFailure> failWith(Object error) async {
      final ProblemSubmitOutcome outcome = await repo(
        (name, params) async =>
            Error.throwWithStackTrace(error, StackTrace.current),
      ).submit(_draft());
      return (outcome as ProblemNotSubmitted).reason;
    }

    test('maps the RPC SQLSTATEs, never the message text', () async {
      expect(
        await failWith(
          const PostgrestException(message: 'Your account', code: '42501'),
        ),
        ProblemSubmitFailure.notAllowed,
      );
      expect(
        await failWith(
          const PostgrestException(message: 'Too many', code: '54000'),
        ),
        ProblemSubmitFailure.tooMany,
      );
      expect(
        await failWith(
          const PostgrestException(message: 'Unknown type', code: '22023'),
        ),
        ProblemSubmitFailure.invalid,
      );
      expect(
        await failWith(
          const PostgrestException(message: 'no function', code: 'PGRST202'),
        ),
        ProblemSubmitFailure.unavailable,
      );
      expect(
        await failWith(const SocketException('no route to host')),
        ProblemSubmitFailure.needsSignal,
      );
      expect(
        await failWith(StateError('boom')),
        ProblemSubmitFailure.failed,
      );
    });

    test('a non-ok reply is a failure, not a success', () {
      expect(
        problemOutcomeFromReply(<String, Object?>{'ok': false}),
        isA<ProblemNotSubmitted>(),
      );
      expect(problemOutcomeFromReply(null), isA<ProblemNotSubmitted>());
    });
  });
}
