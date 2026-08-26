/// Who may sign a checklist off, at which stage, and what a sign-off (or a
/// rejection) actually changes.
///
/// Ported rule-for-rule from `mobile/lib/checklistApproval.ts`
/// (`mobile/` is READ-ONLY reference material - see `AGENTS.md` rule "Never
/// edit them from this project"), per
/// `docs/flutter-migration/08-checklist-engine-parity-tests.md` section 8
/// ("Approval ladder") and section 10 groups L and M. That artifact's own
/// words explain the design better than a summary could, so its reasoning
/// is kept here rather than paraphrased:
///
/// Before V594 a checklist had ONE approver field and one `'pending'`
/// state, so a supervisor signature and a final approval were the same
/// event - one person could close a sheet on their own. The owner's rule is
/// two sign-offs: the trade fills and signs, a SUPERVISOR signs it off, and
/// only then the AREA MANAGER closes it. The database enforces the same
/// order in `guard_checklist_approval_stages`, and this library exists so
/// the app can explain a refusal BEFORE somebody signs rather than surface
/// a raw `22023` afterwards.
///
/// # This is a state machine, not an authority
///
/// Nothing here calls Supabase and nothing here has the last word: the
/// server independently re-checks every rule this file models, and one rule
/// it enforces is not modelled here AT ALL - a blocking mark (an item
/// answered e.g. `'Not OK'`) refuses a close server-side, but that check
/// belongs to the checklist FIELD/marks engine (a parallel, separate
/// domain) and reads the submission's `answers`, which this file never
/// receives and never will. A caller that treats any function here as
/// permission to skip the real decision RPC has reproduced exactly the bug
/// this file exists to prevent - see `decide_checklist_approval` in the
/// artifact, and this library's own test file (group O) for the parts of
/// that contract this file can and cannot prove on its own.
///
/// # Pure Dart only - no Flutter, no widgets, no I/O
///
/// THIS file imports nothing at all - it is the base of this folder's small
/// dependency graph. The two files beside it
/// (`checklist_approval_history.dart`, `approval_decision_requirements.dart`)
/// each import ONLY this file, for the shared [ApprovalStage] /
/// [ApprovalSubmissionLike] types, and nothing else - no Flutter, no
/// networking, no other feature's domain (in particular, never
/// `lib/features/checklists/`, which belongs to a separate, parallel port of
/// the checklist FIELD/marks engine this module deliberately does not
/// depend on or wait for). An approval decision is exactly the kind of code
/// path that must never throw, never block on a network call, and never be
/// second-guessed by whatever happens to be imported. Every function in all
/// three files is total - a `null`, blank, or unrecognised argument
/// resolves to the safest answer ("no stage", "cannot act", "not closed")
/// rather than throwing.
/// `test/features/approvals/domain/group_o_client_server_contract_test.dart`
/// asserts, by reading each file's own source text, that this file carries
/// zero `import` lines and that the other two import ONLY a sibling file in
/// this same folder - so neither guarantee can regress silently.
///
/// One consequence of "no Flutter" specifically: this codebase's usual
/// `@immutable` annotation lives in `package:flutter/foundation.dart` and is
/// therefore off-limits here. The model classes below use the `final class`
/// modifier instead - closed to subclassing, all fields `final`, only `const`
/// constructors - which gives the same "this is a plain immutable value"
/// guarantee through the Dart language itself rather than through an
/// annotation, exactly as `tyre_scrap_mark.dart` already does for the same
/// reason (small pure value type, no Flutter dependency wanted).
///
/// # English text in a domain file, and why it is here despite the house
/// # rule against it
///
/// `vehicle_asset.dart`'s library comment states the rule this codebase
/// otherwise follows: a domain decoder has no `BuildContext` to translate
/// with, so an English fallback baked in there is a string with no way to
/// become Arabic or Urdu. [statusSummary] and [stageLabel] keep a narrow,
/// justified exception to that rule, for the same reason
/// `tyre_completeness.dart` already established one: parity artifact 08
/// section 10 group M pins these exact English sentences - `'Closed'`,
/// `'Waiting for approval'` - or a case-insensitive match against them -
/// `'Waiting for the area manager'`, `'Waiting for a supervisor'` - as part
/// of the parity contract itself (cases M1 and M2). [ApprovalStatusSummary]
/// carries that English text ONLY as the pinned fallback; its
/// [ApprovalStatusSummary.tone] and [ApprovalStatusSummary.holder] fields
/// are the structured, language-free facts a later UI task should build its
/// OWN localised copy from - exactly what `tyre_completeness.dart`'s own
/// comment recommends doing for its English `summary` field, and precisely
/// why [statusSummary] returns a whole [ApprovalStatusSummary] rather than a
/// bare string.
library;

/// The two sign-off rungs a checklist can carry.
///
/// A single-stage template only ever occupies [supervisor]; a two-stage one
/// moves through both, in order. #mirror: `ApprovalStage` (TS union type),
/// `STAGE_SUPERVISOR` / `STAGE_AREA_MANAGER`.
enum ApprovalStage {
  /// The trade's own supervisor signs first.
  supervisor,

  /// The closing signature on a two-stage template. Not reachable at all on
  /// a single-stage one - [stageFor] never returns it unless the
  /// submission's own `approval_status` is already `'pending_area_manager'`.
  areaManager,
}

/// Role names (as stored in `profiles.role`, Title Case) that may sign the
/// [ApprovalStage.supervisor] rung. Compared case/spacing-insensitively via
/// [normaliseRole] - never compare a raw role string against this list
/// directly. #mirror: `APPROVAL_STAGES[0].roles`;
/// SQL `checklist_is_supervisor()`.
///
/// V600 took Manager, Director and Fleet Supervisor OFF this rung - a
/// Manager signs nothing on either rung (parity case L6). Tyre Data
/// Collector was added by V606 and may sign THIS rung only.
const List<String> kApprovalSupervisorRoles = <String>[
  'Admin',
  'Maintenance Supervisor',
  'Workshop Supervisor',
  'PMV Manager',
  'Workshop Area Manager',
  'Workshop Maintenance Area Manager',
  'Tyre Data Collector',
];

/// Role names that may sign the [ApprovalStage.areaManager] (closing) rung.
/// #mirror: `APPROVAL_STAGES[1].roles`; SQL `checklist_is_area_manager()`.
///
/// Admin and Director are here deliberately, not by oversight: exactly one
/// person holds an area-manager role today, and a closing rung only they
/// could reach would jam the moment they take leave (parity case L9).
const List<String> kApprovalAreaManagerRoles = <String>[
  'Admin',
  'Director',
  'PMV Manager',
  'Workshop Area Manager',
  'Workshop Maintenance Area Manager',
];

String _labelOf(ApprovalStage stage) => switch (stage) {
  ApprovalStage.supervisor => 'Supervisor sign-off',
  ApprovalStage.areaManager => 'Area manager approval',
};

List<String> _rolesOf(ApprovalStage stage) => switch (stage) {
  ApprovalStage.supervisor => kApprovalSupervisorRoles,
  ApprovalStage.areaManager => kApprovalAreaManagerRoles,
};

/// The template facts the ladder needs - not the full checklist template
/// model, which belongs to the parallel checklist domain engine that this
/// library does not depend on and does not wait for.
/// #mirror: `ApprovalTemplateLike`.
final class ApprovalTemplateLike {
  const ApprovalTemplateLike({this.requireAreaManager});

  /// `checklist_templates.require_area_manager`. `null` or `false` means a
  /// single-stage template - see [isTwoStage].
  final bool? requireAreaManager;

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      (other is ApprovalTemplateLike &&
          other.requireAreaManager == requireAreaManager);

  @override
  int get hashCode => requireAreaManager.hashCode;

  @override
  String toString() =>
      'ApprovalTemplateLike(requireAreaManager: $requireAreaManager)';
}

/// The submission facts the ladder needs to decide what happens next and
/// who may make it happen. #mirror: `ApprovalSubmissionLike`.
final class ApprovalSubmissionLike {
  const ApprovalSubmissionLike({
    this.approvalStatus,
    this.approverName,
    this.approverSignature,
    this.approvedAt,
    this.supervisorName,
    this.supervisorSignature,
    this.supervisorAt,
  });

  /// `checklist_submissions.approval_status`. One of `'not_required'`,
  /// `'pending'`, `'pending_area_manager'`, `'approved'`, `'rejected'` on a
  /// well-formed row - but every function in this file tolerates anything
  /// else, folding an unrecognised or blank value to "no stage"
  /// ([stageFor]) rather than throwing or guessing.
  final String? approvalStatus;

  final String? approverName;
  final String? approverSignature;
  final String? approvedAt;
  final String? supervisorName;
  final String? supervisorSignature;
  final String? supervisorAt;

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      (other is ApprovalSubmissionLike &&
          other.approvalStatus == approvalStatus &&
          other.approverName == approverName &&
          other.approverSignature == approverSignature &&
          other.approvedAt == approvedAt &&
          other.supervisorName == supervisorName &&
          other.supervisorSignature == supervisorSignature &&
          other.supervisorAt == supervisorAt);

  @override
  int get hashCode => Object.hash(
    approvalStatus,
    approverName,
    approverSignature,
    approvedAt,
    supervisorName,
    supervisorSignature,
    supervisorAt,
  );

  @override
  String toString() =>
      'ApprovalSubmissionLike(approvalStatus: $approvalStatus)';
}

/// `'Tyre Man'` and `'tyre_man'` are the same role. The database stores
/// Title Case (`profiles.role`); this app's own role tokens are lower-case
/// with underscores. A raw string compare between the two matches NOTHING,
/// which is how a gate silently locks out the exact person it was written
/// for - so every role comparison in this file goes through here first.
///
/// `null` or a blank/whitespace-only value normalises to `''`, which no
/// real role name in [kApprovalSupervisorRoles] or [kApprovalAreaManagerRoles]
/// ever normalises to - so a loading profile or a garbage role value simply
/// fails to match anything, rather than needing a special case.
/// #mirror: `normaliseRole`.
String normaliseRole(Object? raw) {
  final String coerced = raw == null ? '' : raw.toString();
  return coerced.trim().toLowerCase().replaceAll(RegExp(r'[\s-]+'), '_');
}

/// `Boolean(template?.require_area_manager)` in the TS source: `null` and
/// `false` both mean single-stage. #mirror: `isTwoStage`.
bool isTwoStage(ApprovalTemplateLike? template) =>
    template?.requireAreaManager ?? false;

/// Which stage is outstanding on [submission], or `null` when nothing is.
///
/// Reads the SUBMISSION's own status, not its position in a queue or
/// [template]'s two-stage flag - so a sheet that has moved on since a list
/// was drawn still resolves correctly, and a `'pending_area_manager'`
/// submission resolves to [ApprovalStage.areaManager] even under a template
/// currently read as single-stage (parity case L3's second assertion).
/// `template` is accepted, matching the TS signature exactly, even though
/// this function does not read it - see [nextStatusFor] for the function
/// that does. #mirror: `stageFor`.
ApprovalStage? stageFor(
  ApprovalTemplateLike? template,
  ApprovalSubmissionLike? submission,
) {
  final String status = submission?.approvalStatus ?? '';
  if (status == 'pending') return ApprovalStage.supervisor;
  if (status == 'pending_area_manager') return ApprovalStage.areaManager;
  return null;
}

/// The `approval_status` value a sign-off (or a rejection) moves
/// [submission] to. Never mutates anything - this only computes what the
/// NEXT value would be; writing it is the caller's job, and it must be done
/// through `decide_checklist_approval` while online (see the library
/// comment and this file's group-O test coverage).
///
/// - A rejection (`approved == false`) always resolves to `'rejected'`,
///   whichever rung is outstanding (parity case L4).
/// - Approving the [ApprovalStage.supervisor] rung of a two-stage template
///   resolves to `'pending_area_manager'` - not yet closed.
/// - Approving any other outstanding stage resolves to `'approved'`.
/// - With no stage outstanding at all, [submission]'s own status is
///   returned unchanged (falling back to `'approved'` only when there is no
///   submission, or no status on it, to preserve) - there is nothing left
///   to decide.
///
/// #mirror: `nextStatusFor`.
String nextStatusFor(
  ApprovalTemplateLike? template,
  ApprovalSubmissionLike? submission,
  bool approved,
) {
  if (!approved) return 'rejected';
  final ApprovalStage? stage = stageFor(template, submission);
  if (stage == ApprovalStage.supervisor && isTwoStage(template)) {
    return 'pending_area_manager';
  }
  if (stage != null) return 'approved';
  return submission?.approvalStatus ?? 'approved';
}

/// Whether [role] may act on [stage] at all, independent of whether
/// anything is actually outstanding - use [canDecide] to ask both at once.
///
/// A super admin always passes, unconditionally - even, deliberately, when
/// [stage] is `null`, matching the TS source's own check ORDER exactly
/// (`if (opts.isSuperAdmin) return true` runs before the stage-null guard).
/// That means a raw `canActOnStage(null, anyRole, isSuperAdmin: true)`
/// returns `true` on its own; it is [canDecide] that stops a super admin
/// "acting" on a sheet with nothing left to decide, by never calling this
/// function at all once [stageFor] returns `null`. This file preserves that
/// exact split rather than "fixing" it, because it is the literal behaviour
/// of the file this is a mirror of. #mirror: `canActOnStage`.
bool canActOnStage(
  ApprovalStage? stage,
  Object? role, {
  bool isSuperAdmin = false,
}) {
  if (isSuperAdmin) return true;
  if (stage == null) return false;
  final String normalised = normaliseRole(role);
  return _rolesOf(stage).any((String r) => normaliseRole(r) == normalised);
}

/// Can [role] do anything at all with [submission] right now?
///
/// This is [stageFor] then [canActOnStage] - and unlike [canActOnStage]
/// called directly, a `null` stage here refuses UNCONDITIONALLY, before
/// `isSuperAdmin` is even consulted: there is genuinely nothing to decide on
/// a finished sheet, for anyone (parity case L5). #mirror: `canDecide`.
bool canDecide(
  ApprovalTemplateLike? template,
  ApprovalSubmissionLike? submission,
  Object? role, {
  bool isSuperAdmin = false,
}) {
  final ApprovalStage? stage = stageFor(template, submission);
  return stage == null
      ? false
      : canActOnStage(stage, role, isSuperAdmin: isSuperAdmin);
}

/// The English label for [stage], or `''` for `null`. See the library
/// comment on English text in this file. #mirror: `stageLabel`.
String stageLabel(ApprovalStage? stage) => stage == null ? '' : _labelOf(stage);

/// One rung of the ladder, with what has actually happened on it - who
/// signed, when, and their mark - so a "tap to see who approved this" panel
/// has everything it needs without a second query. #mirror: `ApprovalRung`.
final class ApprovalRung {
  const ApprovalRung({
    required this.key,
    required this.label,
    required this.name,
    required this.signature,
    required this.at,
    required this.done,
    required this.current,
  });

  final ApprovalStage key;

  /// See the library comment on English text in this file.
  final String label;
  final String? name;
  final String? signature;
  final String? at;

  /// Whether this rung's own signature has been captured (or, for the
  /// first rung of a two-stage sheet, whether the sheet has moved past it).
  final bool done;

  /// Whether this rung is the one currently outstanding.
  final bool current;

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      (other is ApprovalRung &&
          other.key == key &&
          other.label == label &&
          other.name == name &&
          other.signature == signature &&
          other.at == at &&
          other.done == done &&
          other.current == current);

  @override
  int get hashCode =>
      Object.hash(key, label, name, signature, at, done, current);

  @override
  String toString() =>
      'ApprovalRung(key: $key, done: $done, current: $current)';
}

bool _truthyString(String? s) => s != null && s.isNotEmpty;

/// The full ladder, with what has happened on each rung, for a panel that
/// lets someone open a rung and see who signed it.
///
/// Returns exactly one rung for a single-stage template, filled from the
/// APPROVER columns and labelled `'Approval'` (parity case L16); exactly
/// two for a two-stage one, the first filled from the SUPERVISOR columns
/// (parity case L15). Writing both column sets for one decision would make
/// one person look like two - see `checklists.ts`'s own comment, quoted in
/// the parity artifact, for why the two column sets exist at all.
/// #mirror: `approvalProgress`.
List<ApprovalRung> approvalProgress(
  ApprovalTemplateLike? template,
  ApprovalSubmissionLike? submission,
) {
  final bool two = isTwoStage(template);
  final String status = submission?.approvalStatus ?? '';

  final ApprovalRung supervisorRung = ApprovalRung(
    key: ApprovalStage.supervisor,
    label: two ? 'Supervisor sign-off' : 'Approval',
    name: submission?.supervisorName ?? (two ? null : submission?.approverName),
    signature:
        submission?.supervisorSignature ??
        (two ? null : submission?.approverSignature),
    at: submission?.supervisorAt ?? (two ? null : submission?.approvedAt),
    done: two
        ? (_truthyString(submission?.supervisorAt) ||
              status == 'pending_area_manager' ||
              status == 'approved')
        : status == 'approved',
    // The TS source's ternary here (`two ? st === 'pending' : st ===
    // 'pending'`) has identical branches on both sides - kept as a plain
    // comparison rather than reproducing dead branching that can never
    // change the result.
    current: status == 'pending',
  );

  if (!two) return <ApprovalRung>[supervisorRung];

  final ApprovalRung areaManagerRung = ApprovalRung(
    key: ApprovalStage.areaManager,
    label: 'Area manager approval',
    name: submission?.approverName,
    signature: submission?.approverSignature,
    at: submission?.approvedAt,
    done: status == 'approved',
    current: status == 'pending_area_manager',
  );

  return <ApprovalRung>[supervisorRung, areaManagerRung];
}

/// Closed means CLOSED - not "a supervisor looked at it". `false` for
/// `'pending_area_manager'`, exactly as for every other non-`'approved'`
/// value (parity case M2). #mirror: `isFullyClosed`.
bool isFullyClosed(ApprovalSubmissionLike? submission) =>
    (submission?.approvalStatus ?? '') == 'approved';

/// #mirror: `isRejected`.
bool isRejected(ApprovalSubmissionLike? submission) =>
    (submission?.approvalStatus ?? '') == 'rejected';

/// The visual/semantic weight of an [ApprovalStatusSummary] - what a status
/// pill should look like, independent of language.
enum ApprovalStatusTone {
  /// Fully closed.
  good,

  /// Sent back.
  bad,

  /// Waiting on somebody.
  warn,

  /// Nothing outstanding, nothing to report.
  muted,
}

/// WHO is currently holding a submission - the language-free fact a later
/// UI task should build its own translated copy from, rather than parsing
/// [ApprovalStatusSummary.text].
enum ApprovalHolder {
  /// Waiting on [ApprovalStage.areaManager].
  areaManager,

  /// Waiting on [ApprovalStage.supervisor], specifically (a two-stage
  /// template's first rung).
  supervisor,

  /// Waiting on approval generically - a single-stage template with no
  /// named rung to point at.
  anyone,

  /// Nobody - the submission is closed, sent back, or needs no approval at
  /// all. Check [ApprovalStatusTone] to tell those apart.
  none,
}

/// One line saying where a submission has got to, for both a screen and a
/// filter. See the library comment on English text in this file for why
/// [text] exists at all alongside [tone] and [holder].
/// #mirror: the object `statusSummary` returns.
final class ApprovalStatusSummary {
  const ApprovalStatusSummary({
    required this.tone,
    required this.holder,
    required this.text,
  });

  final ApprovalStatusTone tone;
  final ApprovalHolder holder;

  /// See the library comment on English text in this file.
  final String text;

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      (other is ApprovalStatusSummary &&
          other.tone == tone &&
          other.holder == holder &&
          other.text == text);

  @override
  int get hashCode => Object.hash(tone, holder, text);

  @override
  String toString() =>
      'ApprovalStatusSummary(tone: $tone, holder: $holder, text: $text)';
}

/// Says WHO is holding [submission] rather than a generic "pending" -
/// "pending" alone told a reader nothing about who is expected to act.
/// #mirror: `statusSummary`.
ApprovalStatusSummary statusSummary(
  ApprovalTemplateLike? template,
  ApprovalSubmissionLike? submission,
) {
  final String status = submission?.approvalStatus ?? '';

  if (status == 'approved') {
    return const ApprovalStatusSummary(
      tone: ApprovalStatusTone.good,
      holder: ApprovalHolder.none,
      text: 'Closed',
    );
  }
  if (status == 'rejected') {
    return const ApprovalStatusSummary(
      tone: ApprovalStatusTone.bad,
      holder: ApprovalHolder.none,
      text: 'Sent back',
    );
  }
  if (status == 'pending_area_manager') {
    return const ApprovalStatusSummary(
      tone: ApprovalStatusTone.warn,
      holder: ApprovalHolder.areaManager,
      text: 'Waiting for the area manager',
    );
  }
  if (status == 'pending') {
    return isTwoStage(template)
        ? const ApprovalStatusSummary(
            tone: ApprovalStatusTone.warn,
            holder: ApprovalHolder.supervisor,
            text: 'Waiting for a supervisor',
          )
        : const ApprovalStatusSummary(
            tone: ApprovalStatusTone.warn,
            holder: ApprovalHolder.anyone,
            text: 'Waiting for approval',
          );
  }
  return const ApprovalStatusSummary(
    tone: ApprovalStatusTone.muted,
    holder: ApprovalHolder.none,
    text: 'No approval needed',
  );
}
