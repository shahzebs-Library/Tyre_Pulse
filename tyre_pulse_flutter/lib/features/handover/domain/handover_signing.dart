/// Who may sign which party of a handover, and the signature shape the
/// server accepts. Mirrors `src/lib/handoverAuthorization.js`
/// (`isValidSignature`, `signingMode`, `rowSigningMode`, `isSentBack`) and
/// `sign_handover` / `handover_valid_signature` in
/// `20261126171000_handover_authorization_paper.sql`. CHANGE ALL TOGETHER.
library;

import 'package:tyre_pulse/features/handover/domain/handover_record.dart';

final RegExp _pngSignature = RegExp(r'^data:image/png;base64,[A-Za-z0-9+/=]+$');
final RegExp _svgSignature = RegExp(
  r'^<svg xmlns="http://www\.w3\.org/2000/svg" width="[0-9]+" height="[0-9]+" '
  r'viewBox="[0-9 .]+">(<path d="[ML0-9 .-]+" fill="none" stroke="#[a-fA-F0-9]{6}" '
  r'stroke-width="[0-9.]+" stroke-linecap="round" stroke-linejoin="round"/>)+</svg>$',
);

/// The exact rule `handover_valid_signature` applies: a PNG data URL, or the
/// static SVG the web pad emits. The phone pads emit PNG data URLs.
bool isValidHandoverSignature(String? signature) {
  final String s = signature ?? '';
  return _pngSignature.hasMatch(s) || _svgSignature.hasMatch(s);
}

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
