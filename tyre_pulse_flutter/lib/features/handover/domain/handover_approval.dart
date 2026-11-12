/// Who may sign a vehicle handover off, at which rung, and what a sign-off (or
/// a rejection) actually changes.
///
/// Ported rule-for-rule from the live SQL in
/// `supabase/migrations/20261112130000_handover_two_stage_signoff.sql`
/// (`decide_handover_approval`, `handover_can_sign_supervisor`,
/// `handover_can_sign_incharge`, `guard_handover_approval_stages`) and from the
/// web mirror `src/lib/handoverApproval.js`. That migration's own header states
/// the pairing plainly: "The SQL `decide_handover_approval` AND
/// `src/lib/handoverApproval.js` ARE A PAIR ... and must change together,
/// exactly as `checklistApproval.js` mirrors `decide_checklist_approval`." This
/// Dart file is the phone's third copy of the same ladder, kept in step with
/// both, following the same convention
/// `lib/features/approvals/domain/checklist_approval.dart` already established
/// for the checklist ladder.
///
/// # A handover is ALWAYS two-stage
///
/// Unlike a checklist (which can be single- or two-stage depending on its
/// template), every vehicle handover moves through both rungs in order: the
/// driver captures and signs the field record, a FLEET SUPERVISOR signs it off
/// (`pending_supervisor` -> `pending_incharge`), and only then the FLEET
/// INCHARGE closes it (`pending_incharge` -> `approved`). The one shortcut is
/// `closesInOneSign`: an incharge-level signer (Admin, super admin, or a Fleet
/// Incharge) acting at the supervisor rung closes BOTH rungs with a single
/// signature, written to both column sets, exactly as the SQL does. There is no
/// single-stage variant and therefore no `isTwoStage` flag.
///
/// # This is a state machine, not an authority
///
/// Nothing here calls Supabase and nothing here has the last word: the server
/// independently re-checks every rule this file models inside
/// `decide_handover_approval`, which derives the signer identity from
/// `auth.uid()` and refuses an unsigned or out-of-order sign-off. A caller that
/// treats any function here as permission to skip the decision RPC has
/// reproduced exactly the bug this file exists to prevent - see the SQL header
/// and this file's own test group. The driver's own field signature lives in
/// `handover_reports.signature_url` and is NEVER a sign-off; it is field
/// evidence.
///
/// # Pure Dart only - no Flutter, no widgets, no I/O
///
/// This file imports NOTHING, mirroring `checklist_approval.dart`: it is the
/// base of this folder's dependency graph. An approval decision must never
/// throw, never block on a network call, and never be second-guessed by
/// whatever happens to be imported. Every function is total - a `null`, blank
/// or unrecognised argument resolves to the safest answer ("no stage", "cannot
/// act", "not closed") rather than throwing. Because `@immutable` lives in
/// `package:flutter/foundation.dart` and is off-limits here, the model classes
/// use the `final class` modifier instead, exactly as `checklist_approval.dart`
/// does for the same reason.
///
/// # English text in a domain file
///
/// [statusSummary] and [stageLabel] carry English sentences ONLY as a pinned
/// fallback, for the same narrow, justified reason `checklist_approval.dart`
/// does: a domain decoder has no `BuildContext` to translate with. Their
/// [HandoverStatusTone] and [HandoverHolder] fields are the structured,
/// language-free facts the UI builds its OWN localised copy from.
library;

/// The two sign-off rungs a handover moves through, in order.
///
/// #mirror: the two stages in `decide_handover_approval` /
/// `src/lib/handoverApproval.js` `STAGE_SUPERVISOR` / `STAGE_INCHARGE`.
enum HandoverStage {
  /// The Fleet Supervisor signs first.
  supervisor,

  /// The closing signature. The Fleet Incharge (or an Admin / super admin).
  incharge,
}

/// Role names (as stored in `profiles.role`, Title Case) that may sign the
/// [HandoverStage.supervisor] rung. Compared case/spacing-insensitively via
/// [normaliseHandoverRole] - never compare a raw role string against this list
/// directly.
///
/// #mirror: SQL `handover_can_sign_supervisor()` =
/// `is_super_admin() OR app_is_elevated() OR role IN ('Fleet Supervisor',
/// 'Fleet Incharge')`. `app_is_elevated()` is Admin / Manager / Director, so
/// those three are listed literally here. A higher rung (Fleet Incharge) may
/// act on a lower one, which is what lets an incharge close in one sign.
const List<String> kHandoverSupervisorRoles = <String>[
  'Admin',
  'Manager',
  'Director',
  'Fleet Supervisor',
  'Fleet Incharge',
];

/// Role names that may sign the [HandoverStage.incharge] (closing) rung.
///
/// #mirror: SQL `handover_can_sign_incharge()` =
/// `is_super_admin() OR role IN ('Admin', 'Fleet Incharge')`. Admin is here as
/// break-glass (exactly one person holds Fleet Incharge and a queue only they
/// could clear would jam the moment they take leave - the same reasoning as
/// Director on the checklist area-manager rung). Deliberately NOT Manager or
/// Director: they sign the supervisor rung only.
const List<String> kHandoverInchargeRoles = <String>[
  'Admin',
  'Fleet Incharge',
];

String _labelOf(HandoverStage stage) => switch (stage) {
      HandoverStage.supervisor => 'Supervisor sign-off',
      HandoverStage.incharge => 'Fleet incharge approval',
    };

List<String> _rolesOf(HandoverStage stage) => switch (stage) {
      HandoverStage.supervisor => kHandoverSupervisorRoles,
      HandoverStage.incharge => kHandoverInchargeRoles,
    };

/// The handover row facts the ladder needs to decide what happens next and who
/// may make it happen. #mirror: the submission shape read by
/// `decide_handover_approval` / `statusSummary` in the JS mirror.
final class HandoverApprovalLike {
  const HandoverApprovalLike({
    this.approvalStatus,
    this.supervisorName,
    this.supervisorSignature,
    this.supervisorAt,
    this.inchargeName,
    this.inchargeSignature,
    this.inchargeAt,
    this.reviewNote,
  });

  /// `handover_reports.approval_status`. One of `'draft'`,
  /// `'pending_supervisor'`, `'pending_incharge'`, `'approved'`, `'rejected'`
  /// on a well-formed row - but every function in this file tolerates anything
  /// else, folding an unrecognised or blank value to "no stage" ([stageFor])
  /// rather than throwing or guessing.
  final String? approvalStatus;

  final String? supervisorName;
  final String? supervisorSignature;
  final String? supervisorAt;
  final String? inchargeName;
  final String? inchargeSignature;
  final String? inchargeAt;
  final String? reviewNote;

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      (other is HandoverApprovalLike &&
          other.approvalStatus == approvalStatus &&
          other.supervisorName == supervisorName &&
          other.supervisorSignature == supervisorSignature &&
          other.supervisorAt == supervisorAt &&
          other.inchargeName == inchargeName &&
          other.inchargeSignature == inchargeSignature &&
          other.inchargeAt == inchargeAt &&
          other.reviewNote == reviewNote);

  @override
  int get hashCode => Object.hash(
        approvalStatus,
        supervisorName,
        supervisorSignature,
        supervisorAt,
        inchargeName,
        inchargeSignature,
        inchargeAt,
        reviewNote,
      );

  @override
  String toString() =>
      'HandoverApprovalLike(approvalStatus: $approvalStatus)';
}

/// `'Fleet Supervisor'` and `'fleet_supervisor'` are the same role. The
/// database stores Title Case (`profiles.role`); this app's own role tokens are
/// lower-case with underscores. A raw string compare between the two matches
/// NOTHING, which is how a gate silently locks out the exact person it was
/// written for - so every role comparison in this file goes through here first.
///
/// `null` or a blank/whitespace-only value normalises to `''`, which no real
/// role name in [kHandoverSupervisorRoles] or [kHandoverInchargeRoles] ever
/// normalises to - so a loading profile or a garbage role value simply fails to
/// match anything, rather than needing a special case. #mirror: `normaliseRole`
/// in `checklist_approval.dart` / `src/lib/handoverApproval.js`.
String normaliseHandoverRole(Object? raw) {
  final String coerced = raw == null ? '' : raw.toString();
  return coerced.trim().toLowerCase().replaceAll(RegExp(r'[\s-]+'), '_');
}

/// Which rung is outstanding on [submission], or `null` when nothing is.
///
/// Reads the SUBMISSION's own status: `'pending_supervisor'` ->
/// [HandoverStage.supervisor], `'pending_incharge'` -> [HandoverStage.incharge],
/// and `'draft'` / `'approved'` / `'rejected'` / anything unrecognised ->
/// `null`. A `draft` handover has not been submitted for sign-off yet, so there
/// is nothing to sign - exactly as the SQL refuses a decision on a draft.
/// #mirror: `stageFor`.
HandoverStage? stageFor(HandoverApprovalLike? submission) {
  final String status = submission?.approvalStatus ?? '';
  if (status == 'pending_supervisor') return HandoverStage.supervisor;
  if (status == 'pending_incharge') return HandoverStage.incharge;
  return null;
}

/// The `approval_status` value a sign-off (or a rejection) moves [submission]
/// to. Never mutates anything - this only computes what the NEXT value would
/// be; writing it is the caller's job and must go through
/// `decide_handover_approval` while online.
///
/// - A rejection (`approved == false`) always resolves to `'rejected'`,
///   whichever rung is outstanding.
/// - Approving the [HandoverStage.supervisor] rung resolves to
///   `'pending_incharge'` - unless the signer is an incharge-level signer, in
///   which case it closes in one sign to `'approved'` (see [closesInOneSign]).
/// - Approving the [HandoverStage.incharge] rung resolves to `'approved'`.
/// - With no rung outstanding at all, [submission]'s own status is returned
///   unchanged (falling back to `'approved'` only when there is no submission,
///   or no status on it, to preserve) - there is nothing left to decide.
///
/// #mirror: the target status computed in `decide_handover_approval`.
String nextStatusFor(
  HandoverApprovalLike? submission,
  bool approved, {
  Object? role,
  bool isSuperAdmin = false,
}) {
  if (!approved) return 'rejected';
  final HandoverStage? stage = stageFor(submission);
  if (stage == HandoverStage.supervisor) {
    return closesInOneSign(submission, role, isSuperAdmin: isSuperAdmin)
        ? 'approved'
        : 'pending_incharge';
  }
  if (stage != null) return 'approved';
  return submission?.approvalStatus ?? 'approved';
}

/// Whether [role] may act on [stage] at all, independent of whether anything is
/// actually outstanding - use [canDecide] to ask both at once.
///
/// A super admin always passes, unconditionally - even, deliberately, when
/// [stage] is `null`, matching the SQL's own authority checks (a super admin is
/// an approver regardless). It is [canDecide] that stops a super admin "acting"
/// on a handover with nothing left to decide, by never calling this function at
/// all once [stageFor] returns `null`. #mirror: `canActOnStage`.
bool canActOnStage(
  HandoverStage? stage,
  Object? role, {
  bool isSuperAdmin = false,
}) {
  if (isSuperAdmin) return true;
  if (stage == null) return false;
  final String normalised = normaliseHandoverRole(role);
  if (normalised.isEmpty) return false;
  return _rolesOf(stage).any((String r) => normaliseHandoverRole(r) == normalised);
}

/// Can [role] do anything at all with [submission] right now?
///
/// This is [stageFor] then [canActOnStage] - and unlike [canActOnStage] called
/// directly, a `null` stage here refuses UNCONDITIONALLY, before `isSuperAdmin`
/// is even consulted: there is genuinely nothing to decide on a closed, sent-
/// back or still-draft handover, for anyone. #mirror: `canDecide`.
bool canDecide(
  HandoverApprovalLike? submission,
  Object? role, {
  bool isSuperAdmin = false,
}) {
  final HandoverStage? stage = stageFor(submission);
  if (stage == null) return false;
  return canActOnStage(stage, role, isSuperAdmin: isSuperAdmin) ||
      closesInOneSign(submission, role, isSuperAdmin: isSuperAdmin);
}

/// An incharge-level signer (Admin, super admin, or a Fleet Incharge) signing a
/// handover that is still at the supervisor rung closes it in ONE signature,
/// recorded on both rungs. Mirrors the `v_both` branch of
/// `decide_handover_approval`. #mirror: `closesInOneSign`.
bool closesInOneSign(
  HandoverApprovalLike? submission,
  Object? role, {
  bool isSuperAdmin = false,
}) =>
    stageFor(submission) == HandoverStage.supervisor &&
    canActOnStage(HandoverStage.incharge, role, isSuperAdmin: isSuperAdmin);

/// The English label for [stage], or `''` for `null`. See the library comment
/// on English text in this file. #mirror: `stageLabel`.
String stageLabel(HandoverStage? stage) =>
    stage == null ? '' : _labelOf(stage);

/// One rung of the ladder, with what has actually happened on it - who signed,
/// when, and their mark - so a "tap to see who signed this" panel has
/// everything it needs without a second query. #mirror: `ApprovalRung` in the
/// checklist mirror.
final class HandoverRung {
  const HandoverRung({
    required this.key,
    required this.label,
    required this.name,
    required this.signature,
    required this.at,
    required this.done,
    required this.current,
  });

  final HandoverStage key;

  /// See the library comment on English text in this file.
  final String label;
  final String? name;
  final String? signature;
  final String? at;

  /// Whether this rung's own signature has been captured (or, for the
  /// supervisor rung, whether the handover has moved past it).
  final bool done;

  /// Whether this rung is the one currently outstanding.
  final bool current;

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      (other is HandoverRung &&
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
      'HandoverRung(key: $key, done: $done, current: $current)';
}

bool _truthyString(String? s) => s != null && s.trim().isNotEmpty;

/// The full two-rung ladder, with what has happened on each, for a panel that
/// lets someone open a rung and see who signed it. Always exactly two rungs -
/// a handover is always two-stage. #mirror: `approvalProgress`.
List<HandoverRung> approvalProgress(HandoverApprovalLike? submission) {
  final String status = submission?.approvalStatus ?? '';

  final HandoverRung supervisorRung = HandoverRung(
    key: HandoverStage.supervisor,
    label: 'Supervisor sign-off',
    name: submission?.supervisorName,
    signature: submission?.supervisorSignature,
    at: submission?.supervisorAt,
    done: _truthyString(submission?.supervisorAt) ||
        status == 'pending_incharge' ||
        status == 'approved',
    current: status == 'pending_supervisor',
  );

  final HandoverRung inchargeRung = HandoverRung(
    key: HandoverStage.incharge,
    label: 'Fleet incharge approval',
    name: submission?.inchargeName,
    signature: submission?.inchargeSignature,
    at: submission?.inchargeAt,
    done: status == 'approved',
    current: status == 'pending_incharge',
  );

  return <HandoverRung>[supervisorRung, inchargeRung];
}

/// Closed means CLOSED - not "a supervisor looked at it". `false` for
/// `'pending_incharge'`, exactly as for every other non-`'approved'` value.
/// #mirror: `isFullyClosed`.
bool isFullyClosed(HandoverApprovalLike? submission) =>
    (submission?.approvalStatus ?? '') == 'approved';

/// #mirror: `isRejected`.
bool isRejected(HandoverApprovalLike? submission) =>
    (submission?.approvalStatus ?? '') == 'rejected';

/// The visual/semantic weight of a [HandoverStatusSummary] - what a status pill
/// should look like, independent of language.
enum HandoverStatusTone {
  /// Fully closed.
  good,

  /// Sent back.
  bad,

  /// Waiting on somebody.
  warn,

  /// Not submitted, or nothing to report.
  muted,
}

/// WHO is currently holding a handover - the language-free fact the UI builds
/// its own translated copy from, rather than parsing
/// [HandoverStatusSummary.text].
enum HandoverHolder {
  /// Waiting on [HandoverStage.incharge].
  incharge,

  /// Waiting on [HandoverStage.supervisor].
  supervisor,

  /// Nobody - the handover is closed, sent back, or still a draft. Check
  /// [HandoverStatusTone] to tell those apart.
  none,
}

/// One line saying where a handover has got to, for both a screen and a filter.
/// See the library comment on English text in this file for why [text] exists
/// at all alongside [tone] and [holder]. #mirror: `statusSummary`.
final class HandoverStatusSummary {
  const HandoverStatusSummary({
    required this.tone,
    required this.holder,
    required this.text,
  });

  final HandoverStatusTone tone;
  final HandoverHolder holder;

  /// See the library comment on English text in this file.
  final String text;

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      (other is HandoverStatusSummary &&
          other.tone == tone &&
          other.holder == holder &&
          other.text == text);

  @override
  int get hashCode => Object.hash(tone, holder, text);

  @override
  String toString() =>
      'HandoverStatusSummary(tone: $tone, holder: $holder, text: $text)';
}

/// Says WHO is holding [submission] rather than a generic "pending".
/// #mirror: `statusSummary`.
HandoverStatusSummary statusSummary(HandoverApprovalLike? submission) {
  final String status = submission?.approvalStatus ?? '';

  if (status == 'approved') {
    return const HandoverStatusSummary(
      tone: HandoverStatusTone.good,
      holder: HandoverHolder.none,
      text: 'Closed',
    );
  }
  if (status == 'rejected') {
    return const HandoverStatusSummary(
      tone: HandoverStatusTone.bad,
      holder: HandoverHolder.none,
      text: 'Sent back',
    );
  }
  if (status == 'pending_incharge') {
    return const HandoverStatusSummary(
      tone: HandoverStatusTone.warn,
      holder: HandoverHolder.incharge,
      text: 'Waiting for the fleet incharge',
    );
  }
  if (status == 'pending_supervisor') {
    return const HandoverStatusSummary(
      tone: HandoverStatusTone.warn,
      holder: HandoverHolder.supervisor,
      text: 'Waiting for a supervisor',
    );
  }
  if (status == 'draft') {
    return const HandoverStatusSummary(
      tone: HandoverStatusTone.muted,
      holder: HandoverHolder.none,
      text: 'Not submitted',
    );
  }
  return const HandoverStatusSummary(
    tone: HandoverStatusTone.muted,
    holder: HandoverHolder.none,
    text: 'No sign-off needed',
  );
}
