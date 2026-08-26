/// What a caller must supply before it may even ATTEMPT to act on a
/// checklist approval stage.
///
/// Modelled from parity artifact 08 section 8's "WHAT THE DATABASE
/// ENFORCES, and what only the client does" table, and from section 10
/// group O's own guidance to define a decision contract that can never
/// "both approve and provide no signature".
///
/// # This is a DELIBERATE ADDITION beyond the direct TS/SQL port
///
/// `checklistApproval.ts` has no equivalent of [decisionRequirementError].
/// On the real app this check lives split across the approval screen's own
/// submit handler (`approvals/[submissionId].tsx:217-237`, which refuses a
/// rejection with no reason) and the database trigger
/// `guard_checklist_approval_stages` (which raises errcode `22023` for a
/// missing name or signature on approval, and refuses a role that may not
/// sign the outstanding rung with `42501`). It is written as a standalone
/// function here, entirely within the approval ladder's own concerns - what
/// must be true to act on a STAGE; no `answers`, no blocking marks, no UI -
/// because that is the only way to give parity group O's cases O4 and O5 a
/// genuine, non-fabricated pure-logic test rather than skipping them
/// outright. `test/features/approvals/domain/group_o_client_server_contract_test.dart`
/// carries the full account of which O cases this covers and which it
/// deliberately does not (O1, O2, O4 and O6, each with its own reason - see
/// that file's own top-of-file comment before assuming a gap here is an
/// oversight).
///
/// Pure Dart only. The only import is the sibling mirror file, for
/// [ApprovalStage] - see `checklist_approval.dart`'s library comment.
library;

import 'package:tyre_pulse/features/approvals/domain/checklist_approval.dart';

/// The name, signature and (for a rejection) reason a caller is offering,
/// before it is checked against what the outstanding stage will actually
/// demand.
final class ApprovalDecisionInput {
  const ApprovalDecisionInput({
    required this.approved,
    this.name,
    this.signature,
    this.note,
  });

  /// `true` to sign off/approve the outstanding stage, `false` to send it
  /// back.
  final bool approved;

  /// The approver's or supervisor's printed name.
  final String? name;

  /// The captured signature mark (an SVG string or a `data:` URL, per the
  /// checklist field engine's own signature contract - this file does not
  /// inspect its shape, only whether one is present at all).
  final String? signature;

  /// The reason for a rejection. Ignored for an approval.
  final String? note;

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      (other is ApprovalDecisionInput &&
          other.approved == approved &&
          other.name == name &&
          other.signature == signature &&
          other.note == note);

  @override
  int get hashCode => Object.hash(approved, name, signature, note);

  @override
  String toString() => 'ApprovalDecisionInput(approved: $approved)';
}

bool _blank(String? s) => s == null || s.trim().isEmpty;

/// `null` when [input] carries everything its target [stage] will demand;
/// otherwise a short, specific English reason naming exactly what is
/// missing - never a generic "invalid form", matching this codebase's own
/// rule that a refusal must name the thing that is wrong (parity artifact
/// section 5, "the UI must name exactly what is missing").
///
/// - No [stage] at all (the submission has already been decided, or never
///   needed a decision) refuses outright - there is nothing left to act on.
/// - A rejection needs a NOTE. The database does NOT enforce this - the
///   approval screen does - so it is a client-only rule, and it belongs
///   here rather than left to whichever screen happens to call this
///   function, so every caller gets it for free.
/// - An approval at EITHER rung needs a NAME and a SIGNATURE. Both are
///   database-enforced with errcode `22023` ("A supervisor name and
///   signature are required" / "An approver name and signature are
///   required"). Checking here lets a caller refuse BEFORE anyone signs,
///   rather than surface that raw error afterwards - exactly the same
///   motive as every other function in this folder.
///
/// A blank/whitespace-only [ApprovalDecisionInput.name],
/// [ApprovalDecisionInput.signature] or [ApprovalDecisionInput.note] is
/// treated as absent, not as a real value - whitespace is not a name, a
/// signature or a reason, matching how the rest of this codebase treats a
/// whitespace-only remark as no remark at all.
String? decisionRequirementError(
  ApprovalStage? stage,
  ApprovalDecisionInput input,
) {
  if (stage == null) {
    return 'This checklist has nothing left to decide.';
  }
  if (!input.approved) {
    return _blank(input.note)
        ? 'A reason is required to send this checklist back.'
        : null;
  }
  if (_blank(input.name)) {
    return 'A name is required to sign this off.';
  }
  if (_blank(input.signature)) {
    return 'A signature is required to sign this off.';
  }
  return null;
}
