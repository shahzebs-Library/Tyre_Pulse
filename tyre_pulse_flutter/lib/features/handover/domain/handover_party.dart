/// Who may NOT sign off a handover: the rule "you cannot approve your own
/// work", the same three tests `decide_handover_approval` applies on the
/// server. The phone checks first so a supervisor who is a party never sees a
/// sign-off button the server would refuse; the server stays the authority.
library;

import 'package:tyre_pulse/features/handover/domain/handover_record.dart';

enum HandoverPartyReason {
  /// The caller created the handover record.
  created,

  /// The caller collected one of the two driver signatures.
  collectedSignature,

  /// The caller's own login is linked to the giving or receiving driver.
  isDriver,
}

/// Why [userId] is a party to [record], or null when they are independent.
/// [linkedDriverId] is the caller's own driver record, when they have one.
HandoverPartyReason? handoverPartyReason(
  HandoverRecord record, {
  required String userId,
  String? linkedDriverId,
}) {
  if (userId.isEmpty) return null;
  final String? driver = linkedDriverId?.trim();
  if (driver != null &&
      driver.isNotEmpty &&
      (driver == record.fromDriverId || driver == record.toDriverId)) {
    return HandoverPartyReason.isDriver;
  }
  if (userId == record.fromSignedBy || userId == record.toSignedBy) {
    return HandoverPartyReason.collectedSignature;
  }
  if (userId == record.createdBy) return HandoverPartyReason.created;
  return null;
}

/// The notice shown in place of the sign-off form. Local copy because the ARB
/// catalogs are owned by another lane this round (keys are in the scratchpad
/// fragment as `handoverPartyNotice*`).
String handoverPartyNotice(String lang, HandoverPartyReason reason) {
  const Map<String, Map<HandoverPartyReason, String>> copy =
      <String, Map<HandoverPartyReason, String>>{
    'en': <HandoverPartyReason, String>{
      HandoverPartyReason.created:
          'You created this handover, so another supervisor must sign it off.',
      HandoverPartyReason.collectedSignature:
          'You collected a signature on this handover, so another supervisor must sign it off.',
      HandoverPartyReason.isDriver:
          'You are one of the drivers on this handover, so another supervisor must sign it off.',
    },
    'ar': <HandoverPartyReason, String>{
      HandoverPartyReason.created:
          'أنت من أنشأ هذا التسليم، لذلك يجب أن يعتمده مشرف آخر.',
      HandoverPartyReason.collectedSignature:
          'أنت جمعت توقيعًا على هذا التسليم، لذلك يجب أن يعتمده مشرف آخر.',
      HandoverPartyReason.isDriver:
          'أنت أحد السائقين في هذا التسليم، لذلك يجب أن يعتمده مشرف آخر.',
    },
    'ur': <HandoverPartyReason, String>{
      HandoverPartyReason.created:
          'یہ حوالگی آپ نے بنائی ہے، اس لیے کوئی دوسرا سپروائزر منظوری دے گا۔',
      HandoverPartyReason.collectedSignature:
          'آپ نے اس حوالگی پر دستخط لیے ہیں، اس لیے کوئی دوسرا سپروائزر منظوری دے گا۔',
      HandoverPartyReason.isDriver:
          'آپ اس حوالگی کے ڈرائیوروں میں سے ہیں، اس لیے کوئی دوسرا سپروائزر منظوری دے گا۔',
    },
  };
  return (copy[lang] ?? copy['en']!)[reason]!;
}
