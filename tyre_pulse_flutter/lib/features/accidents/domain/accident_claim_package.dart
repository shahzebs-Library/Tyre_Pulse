/// Pure rules behind mock M4 "Register insurance claim".
///
/// Everything here is arithmetic over rows the repositories already loaded:
/// no I/O, no clock, no names. The widget renders what these functions say
/// and the tests pin them without a Supabase client.
library;

import 'package:flutter/foundation.dart' show immutable;
import 'package:tyre_pulse/features/accidents/domain/accident_case_vocab.dart';

/// One `accident_evidence` row, shared by the insurance and assessment
/// workspaces (they differ only by `workstream_key`).
@immutable
final class AccidentEvidenceItem {
  const AccidentEvidenceItem({
    required this.id,
    required this.workstreamKey,
    required this.requirementKey,
    this.kind,
    this.storageRef,
    this.fileName,
    this.uploadedAt,
  });

  final String id;
  final String workstreamKey;
  final String requirementKey;
  final String? kind;
  final String? storageRef;
  final String? fileName;
  final DateTime? uploadedAt;
}

/// One `accident_claim_recoveries` row.
@immutable
final class AccidentClaimRecovery {
  const AccidentClaimRecovery({
    required this.id,
    required this.amount,
    this.source,
    this.recoveredAt,
    this.status,
  });

  final String id;
  final num amount;
  final String? source;
  final DateTime? recoveredAt;
  final String? status;

  /// A rejected or cancelled recovery is history, not money in the bank.
  bool get counts {
    final String token = status?.trim().toLowerCase() ?? '';
    return token != 'rejected' && token != 'cancelled' && token != 'void';
  }
}

enum ClaimDocumentState { received, missing }

/// The status of one row of the claim document package.
@immutable
final class ClaimDocumentStatus {
  const ClaimDocumentStatus({
    required this.doc,
    required this.count,
    this.latestAt,
  });

  final VocabItem doc;
  final int count;
  final DateTime? latestAt;

  ClaimDocumentState get state =>
      count > 0 ? ClaimDocumentState.received : ClaimDocumentState.missing;

  bool get isMissingRequired =>
      doc.required && state == ClaimDocumentState.missing;

  /// Mock M4 prints "9 received" only on the countable row (photographs).
  String get label => switch (state) {
        ClaimDocumentState.missing => 'Missing',
        ClaimDocumentState.received when doc.countable => '$count received',
        ClaimDocumentState.received => 'Received',
      };
}

/// The whole package: every [claimPackageDocs] entry, in mock order.
@immutable
final class ClaimPackageStatus {
  const ClaimPackageStatus._(this.rows);

  factory ClaimPackageStatus.fromEvidence(
    Iterable<AccidentEvidenceItem> evidence,
  ) {
    final Map<String, int> counts = <String, int>{};
    final Map<String, DateTime> latest = <String, DateTime>{};
    for (final AccidentEvidenceItem item in evidence) {
      if (item.workstreamKey != 'insurance') continue;
      counts[item.requirementKey] = (counts[item.requirementKey] ?? 0) + 1;
      final DateTime? at = item.uploadedAt;
      if (at != null) {
        final DateTime? current = latest[item.requirementKey];
        if (current == null || at.isAfter(current)) {
          latest[item.requirementKey] = at;
        }
      }
    }
    return ClaimPackageStatus._(
      List<ClaimDocumentStatus>.unmodifiable(<ClaimDocumentStatus>[
        for (final VocabItem doc in claimPackageDocs)
          ClaimDocumentStatus(
            doc: doc,
            count: counts[doc.key] ?? 0,
            latestAt: latest[doc.key],
          ),
      ]),
    );
  }

  final List<ClaimDocumentStatus> rows;

  int get requiredTotal =>
      rows.where((ClaimDocumentStatus r) => r.doc.required).length;

  int get requiredReceived => rows
      .where(
        (ClaimDocumentStatus r) =>
            r.doc.required && r.state == ClaimDocumentState.received,
      )
      .length;

  bool get isComplete => requiredReceived == requiredTotal;

  List<ClaimDocumentStatus> get missingRequired => rows
      .where((ClaimDocumentStatus r) => r.isMissingRequired)
      .toList(growable: false);

  /// "7 of 8 required documents".
  String get progressLabel =>
      '$requiredReceived of $requiredTotal required documents';
}

/// Registration is allowed once, and only on a complete package.
bool canRegisterClaim({
  required ClaimPackageStatus package,
  required bool alreadyRegistered,
}) =>
    package.isComplete && !alreadyRegistered;

/// Net claimable = claim amount less the deductible, never below zero and
/// never invented when the claim amount is unknown.
num? netClaimable(num? claimAmount, num? deductible) {
  if (claimAmount == null || !claimAmount.isFinite) return null;
  final num net = claimAmount - (deductible ?? 0);
  return net < 0 ? 0 : net;
}

/// Sum of the recoveries that still count.
num recoveredTotal(Iterable<AccidentClaimRecovery> recoveries) {
  num total = 0;
  for (final AccidentClaimRecovery r in recoveries) {
    if (r.counts && r.amount.isFinite) total += r.amount;
  }
  return total;
}

/// Outstanding = approved amount less what was recovered. Null until the
/// insurer has approved something, because "outstanding" against nothing is
/// not a number.
num? outstandingAmount(num? approvedAmount, num recovered) {
  if (approvedAmount == null || !approvedAmount.isFinite) return null;
  final num left = approvedAmount - recovered;
  return left < 0 ? 0 : left;
}

/// Mock M4 "Claim status" pill. A claim with no decision token is still
/// registered; no claim row at all is "Not registered".
String claimStatusLabel({required bool registered, String? decision}) {
  if (!registered) return 'Not registered';
  final String token = decision?.trim() ?? '';
  if (token.isEmpty) return 'Registered';
  return token
      .split('_')
      .where((String p) => p.isNotEmpty)
      .map((String p) => '${p[0].toUpperCase()}${p.substring(1)}')
      .join(' ');
}

/// The workstream key each notify chip resolves its owner from; null means
/// the chip has no workstream and prints its role label.
const Map<String, String> notifyRoleWorkstream = <String, String>{
  'fleet': 'fleet_validation',
  'workshop': 'assessment',
  'insurance': 'insurance',
};

/// "`<owner>` · `<label>`" for a notify chip: the resolved owner role when the
/// workstream carries one, else the first configured role name.
String notifyChipText(NotifyRole role, String? resolvedOwnerRole) {
  final String owner = resolvedOwnerRole?.trim() ?? '';
  final String who = owner.isNotEmpty
      ? owner
      : role.roles.isEmpty
          ? role.label
          : role.roles.first;
  return '$who · ${role.label}';
}
