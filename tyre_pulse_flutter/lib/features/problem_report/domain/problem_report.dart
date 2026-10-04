/// "Report a problem" (Problem Tracking, Phase 1) - the pure vocabulary.
///
/// No I/O here. Mirrors the web helper `src/lib/problemReport.js` and the
/// CHECK / validation rules of `submit_user_issue` in
/// `supabase/migrations/20260930150000_user_issues.sql`. CHANGE ALL THREE
/// TOGETHER.
///
/// Wire values that are load-bearing:
/// - category is one of `bug`, `data_wrong`, `slow`, `access`, `other`. The
///   server raises "Unknown problem type" for anything else.
/// - severity is one of `low`, `medium`, `high`, `critical`; anything else
///   (and null) becomes `medium` server-side, so "not chosen" is sent as null.
/// - platform is `flutter`. `user_issues.platform` carries a CHECK of
///   `web | flutter | expo` and the RPC silently rewrites any other value to
///   `web` - sending `android` would mislabel every phone report as a web one.
///   The operating system (Android and its version) travels in `os` instead.
library;

/// What kind of problem the person is reporting.
enum ProblemCategory {
  bug('bug'),
  dataWrong('data_wrong'),
  access('access'),
  slow('slow'),
  other('other');

  const ProblemCategory(this.wire);

  /// The exact value the RPC accepts.
  final String wire;
}

/// How badly the problem blocks the person. Optional in the form.
enum ProblemSeverity {
  low('low'),
  medium('medium'),
  high('high'),
  critical('critical');

  const ProblemSeverity(this.wire);

  final String wire;
}

/// The platform value `user_issues.platform` accepts for this app.
const String problemReportPlatform = 'flutter';

/// Client-side minimum. Stricter than the server's 5 on purpose: a report of
/// under ten characters ("broken") gives whoever triages it nothing to act on.
const int problemDescriptionMin = 10;

/// Server maximum (`submit_user_issue` refuses longer).
const int problemDescriptionMax = 2000;

/// Why a description cannot be sent yet, or null when it can.
enum ProblemDescriptionIssue { tooShort, tooLong }

ProblemDescriptionIssue? validateProblemDescription(String? raw) {
  final String text = (raw ?? '').trim();
  if (text.length < problemDescriptionMin) {
    return ProblemDescriptionIssue.tooShort;
  }
  if (text.length > problemDescriptionMax) {
    return ProblemDescriptionIssue.tooLong;
  }
  return null;
}

/// What the app attaches to every report automatically. Every field is
/// optional: an unreadable value is sent as null, never guessed.
final class ProblemReportContext {
  const ProblemReportContext({
    this.appVersion,
    this.device,
    this.os,
    this.screen,
  });

  final String? appVersion;
  final String? device;
  final String? os;
  final String? screen;

  ProblemReportContext withScreen(String? value) => ProblemReportContext(
        appVersion: appVersion,
        device: device,
        os: os,
        screen: value,
      );
}

/// A report ready to send.
final class ProblemReportDraft {
  const ProblemReportDraft({
    required this.description,
    required this.category,
    required this.context,
    this.severity,
    this.referenceId,
  });

  final String description;
  final ProblemCategory category;
  final ProblemSeverity? severity;
  final ProblemReportContext context;

  /// An error reference the person was shown, when the report was opened from
  /// an error screen that carries one. Lets the server attach that log.
  final String? referenceId;
}

/// Trims, and turns blank into null. Caps to [max] characters so a long
/// device string can never be the reason a report fails.
String? cleanContextValue(String? raw, {int max = 200}) {
  final String text = (raw ?? '').trim();
  if (text.isEmpty) return null;
  return text.length > max ? text.substring(0, max) : text;
}

/// The exact named arguments for `submit_user_issue`
/// `(p_description, p_category, p_severity, p_platform, p_app_version,
/// p_device, p_os, p_page, p_reference_id)` - verified against the live
/// function signature 2026-09-30.
Map<String, Object?> submitUserIssueParams(ProblemReportDraft draft) {
  return <String, Object?>{
    'p_description': draft.description.trim(),
    'p_category': draft.category.wire,
    'p_severity': draft.severity?.wire,
    'p_platform': problemReportPlatform,
    'p_app_version': cleanContextValue(draft.context.appVersion, max: 40),
    'p_device': cleanContextValue(draft.context.device),
    'p_os': cleanContextValue(draft.context.os, max: 120),
    'p_page': cleanContextValue(draft.context.screen, max: 300),
    'p_reference_id': cleanContextValue(draft.referenceId, max: 100),
  };
}

/// What happened to a submission. Each maps to its own sentence on screen;
/// no database text is ever shown.
sealed class ProblemSubmitOutcome {
  const ProblemSubmitOutcome();
}

/// Recorded. [linkedLogs] is how many of the person's own recent error logs
/// the server attached.
final class ProblemSubmitted extends ProblemSubmitOutcome {
  const ProblemSubmitted({required this.id, required this.linkedLogs});

  final String? id;
  final int linkedLogs;
}

/// Why a submission did not go through.
enum ProblemSubmitFailure {
  /// No connection. Nothing is queued: the person sends it again with signal.
  needsSignal,

  /// No signed-in session.
  signedOut,

  /// The account is locked, unlinked from a company, or otherwise refused.
  notAllowed,

  /// The per-hour limit (20) was reached.
  tooMany,

  /// The server rejected the content (too short, unknown type).
  invalid,

  /// The function is not deployed on this database.
  unavailable,

  /// Anything else; safe to retry.
  failed,
}

final class ProblemNotSubmitted extends ProblemSubmitOutcome {
  const ProblemNotSubmitted(this.reason);

  final ProblemSubmitFailure reason;
}
