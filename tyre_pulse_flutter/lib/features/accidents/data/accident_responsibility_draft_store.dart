/// Encrypted, device-only draft of the M3 Responsibility and payment form.
///
/// "Draft saved on device" on the mock is only ever shown when one of these
/// entries exists for the signed-in user and this case. The draft is cleared
/// the moment the server accepts the save, so the chip cannot outlive the
/// unsaved work it describes.
library;

import 'dart:convert';

import 'package:flutter/foundation.dart' show immutable;
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:tyre_pulse/core/storage/secure_key_value_store.dart';
import 'package:tyre_pulse/core/storage/storage_providers.dart';
import 'package:tyre_pulse/features/accidents/data/accident_case_schema.dart';

final Provider<AccidentResponsibilityDraftStore>
    accidentResponsibilityDraftStoreProvider =
    Provider<AccidentResponsibilityDraftStore>(
  (Ref ref) =>
      AccidentResponsibilityDraftStore(ref.watch(secureStoreProvider)),
);

@immutable
final class AccidentResponsibilityDraft {
  const AccidentResponsibilityDraft({
    this.liabilityType,
    this.ourPct,
    this.otherPct,
    this.payer,
    this.responsibleCompany,
    this.recoveryRequired,
    this.thirdPartyPlate,
    this.thirdPartyDriver,
    this.thirdPartyPhone,
    this.taqdeerRequired,
    this.policeReportNo,
    this.najmStatus,
    this.taqdeerNo,
    this.savedAt,
  });

  factory AccidentResponsibilityDraft.fromJson(Map<String, Object?> json) =>
      AccidentResponsibilityDraft(
        liabilityType: accidentRowText(json['liability_type']),
        ourPct: accidentRowNum(json['our_pct']),
        otherPct: accidentRowNum(json['other_pct']),
        payer: accidentRowText(json['payer']),
        responsibleCompany: accidentRowText(json['responsible_company']),
        recoveryRequired: accidentRowBool(json['recovery_required']),
        thirdPartyPlate: accidentRowText(json['third_party_plate']),
        thirdPartyDriver: accidentRowText(json['third_party_driver']),
        thirdPartyPhone: accidentRowText(json['third_party_phone']),
        taqdeerRequired: accidentRowBool(json['taqdeer_required']),
        policeReportNo: accidentRowText(json['police_report_no']),
        najmStatus: accidentRowText(json['najm_status']),
        taqdeerNo: accidentRowText(json['taqdeer_no']),
        savedAt: accidentRowDate(json['saved_at']),
      );

  final String? liabilityType;
  final num? ourPct;
  final num? otherPct;
  final String? payer;
  final String? responsibleCompany;
  final bool? recoveryRequired;
  final String? thirdPartyPlate;
  final String? thirdPartyDriver;
  final String? thirdPartyPhone;
  final bool? taqdeerRequired;
  final String? policeReportNo;
  final String? najmStatus;
  final String? taqdeerNo;
  final DateTime? savedAt;

  Map<String, Object?> toJson() => <String, Object?>{
        'liability_type': liabilityType,
        'our_pct': ourPct,
        'other_pct': otherPct,
        'payer': payer,
        'responsible_company': responsibleCompany,
        'recovery_required': recoveryRequired,
        'third_party_plate': thirdPartyPlate,
        'third_party_driver': thirdPartyDriver,
        'third_party_phone': thirdPartyPhone,
        'taqdeer_required': taqdeerRequired,
        'police_report_no': policeReportNo,
        'najm_status': najmStatus,
        'taqdeer_no': taqdeerNo,
        'saved_at': savedAt?.toUtc().toIso8601String(),
      };
}

final class AccidentResponsibilityDraftStore {
  const AccidentResponsibilityDraftStore(this._store);

  final SecureKeyValueStore _store;

  static const String storageKey = 'tp_accident_responsibility_drafts_v1';

  static String scopeKey({
    required String userId,
    required String accidentId,
  }) =>
      '${userId.trim()}|${accidentId.trim()}';

  /// Null when nothing is stored OR the store could not be read: an
  /// unreadable Keystore must not be presented as "no draft" to a screen that
  /// would then overwrite it, so the caller treats null as "show nothing".
  Future<AccidentResponsibilityDraft?> load(String scope) async {
    final SecureRead read = await _store.read(storageKey);
    if (read.failed) return null;
    final String? raw = read.value;
    if (raw == null || raw.trim().isEmpty) return null;
    try {
      final Object? decoded = jsonDecode(raw);
      final Map<String, Object?> envelope = accidentRowMap(decoded);
      final Map<String, Object?> entries = accidentRowMap(envelope['entries']);
      final Object? draft = entries[scope];
      if (draft == null) return null;
      return AccidentResponsibilityDraft.fromJson(accidentRowMap(draft));
    } on FormatException {
      return null;
    }
  }

  Future<void> save(String scope, AccidentResponsibilityDraft draft) async {
    await _store.updateValue(storageKey, (String? current) {
      final Map<String, Object?> entries = _entries(current);
      entries[scope] = draft.toJson();
      return jsonEncode(<String, Object?>{'version': 1, 'entries': entries});
    });
  }

  Future<void> clear(String scope) async {
    await _store.updateValue(storageKey, (String? current) {
      final Map<String, Object?> entries = _entries(current)..remove(scope);
      if (entries.isEmpty) return null;
      return jsonEncode(<String, Object?>{'version': 1, 'entries': entries});
    });
  }

  static Map<String, Object?> _entries(String? raw) {
    if (raw == null || raw.trim().isEmpty) return <String, Object?>{};
    try {
      final Object? decoded = jsonDecode(raw);
      return Map<String, Object?>.of(
        accidentRowMap(accidentRowMap(decoded)['entries']),
      );
    } on FormatException {
      throw const FormatException(
        'The saved responsibility draft uses an unsupported format.',
      );
    }
  }
}
