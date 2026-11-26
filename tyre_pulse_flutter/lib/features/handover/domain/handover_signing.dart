/// Who may sign which party of a handover, and the signature shape the
/// server accepts. Mirrors `src/lib/handoverAuthorization.js`
/// (`isValidSignature`, `signingMode`, `rowSigningMode`, `isSentBack`) and
/// `sign_handover` / `handover_valid_signature` in
/// `20261126171000_handover_authorization_paper.sql`. CHANGE ALL TOGETHER.
library;

import 'package:tyre_pulse/core/signatures/signature_rules.dart';
import 'package:tyre_pulse/features/handover/domain/handover_record.dart';

/// The server signature rule (PNG header and minimum size, or the strict
/// web SVG with at least 10 points). One implementation for charges and
/// handovers: `core/signatures/signature_rules.dart`.
bool isValidHandoverSignature(String? signature) =>
    isAcceptedSignature(signature);

/// How the signed-in account may sign one party.
enum HandoverSigningMode {
  /// The account is linked to that party's driver.
  self,

  /// Anyone else. The server accepts it only from a supervisor-level account,
  /// and the screen must ask for the explicit on-behalf confirmation first.
  onBehalf,

  /// The account is linked to the OTHER driver on this handover and may not
  /// sign for this party at all.
  blocked,
}

HandoverSigningMode handoverSigningMode({
  String? partyDriverId,
  String? otherDriverId,
  String? myDriverId,
}) {
  if (myDriverId != null &&
      partyDriverId != null &&
      myDriverId == partyDriverId) {
    return HandoverSigningMode.self;
  }
  if (myDriverId != null &&
      otherDriverId != null &&
      myDriverId == otherDriverId) {
    return HandoverSigningMode.blocked;
  }
  return HandoverSigningMode.onBehalf;
}

HandoverSigningMode rowSigningMode(
  HandoverRecord record,
  HandoverParty party,
  String? myDriverId,
) =>
    party == HandoverParty.handing
        ? handoverSigningMode(
            partyDriverId: record.fromDriverId,
            otherDriverId: record.toDriverId,
            myDriverId: myDriverId,
          )
        : handoverSigningMode(
            partyDriverId: record.toDriverId,
            otherDriverId: record.fromDriverId,
            myDriverId: myDriverId,
          );

/// Sent back for correction: returned to draft with a reason and the
/// signatures cleared. Rows sent back before that change carry `rejected`.
bool isHandoverSentBack(HandoverRecord record) {
  if (record.approvalStatus == 'rejected') return true;
  return record.approvalStatus == 'draft' &&
      (record.reviewNote ?? '').trim().isNotEmpty &&
      record.fromSignedAt == null &&
      record.toSignedAt == null;
}

/// The site written on a handover, mirroring web `resolveHandoverSite`: the
/// asset's fleet-register site wins, else the typed site; upper case. Null
/// means the wizard must ask for a site before saving.
String? resolveHandoverSite({String? registerSite, String? typedSite}) {
  final String register = (registerSite ?? '').trim();
  final String s = (register.isNotEmpty ? register : (typedSite ?? ''))
      .trim()
      .toUpperCase();
  return s.isEmpty ? null : s;
}

/// The receiving signature must come from a different account than the
/// handing one (`from_signed_by <> to_signed_by` on the server).
bool mustLeaveReceivingToAnother({
  required HandoverRecord record,
  required String? myUserId,
}) =>
    record.nextParty == HandoverParty.receiving &&
    myUserId != null &&
    myUserId.isNotEmpty &&
    record.fromSignedBy == myUserId;
