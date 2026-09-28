/// Localized labels for the driver workspace.
///
/// Every user-facing string of this feature comes from the ARB catalogs
/// (keys prefixed `driverWs`). The server speaks in snake_case tokens
/// (`awaiting_response`, `respond_fine`, `driver_training`, ...); those are
/// resolved through ICU `select` messages here, and a token the catalog does
/// not know yet falls back to the token itself with underscores spaced out,
/// so a new server value is shown honestly instead of blank.
///
/// This replaces the private English-keyed copy map that used to live in
/// `driver_workspace_copy.dart`, which duplicated the ARB catalogs.
library;

import 'package:tyre_pulse/app/localization/tp_localizations.dart';
import 'package:tyre_pulse/features/driver_workspace/domain/driver_workspace.dart';

String _fallback(String token) => token.replaceAll('_', ' ');

/// Display name of an action, resolution, decision, status or record type.
String driverWsTermLabel(AppLocalizations l10n, String token) {
  final String value = l10n.driverWsTerm(token);
  return value.isEmpty ? _fallback(token) : value;
}

/// Display name of a linked-record column.
String driverWsRecordFieldLabel(AppLocalizations l10n, String field) {
  final String value = l10n.driverWsRecordField(field);
  return value.isEmpty ? _fallback(field) : value;
}

/// Display name of an evidence kind.
String driverWsEvidenceKindLabel(AppLocalizations l10n, String kind) {
  final String value = l10n.driverWsEvidenceKind(kind);
  return value.isEmpty ? _fallback(kind) : value;
}

/// The localized sentence for a response validation issue.
String driverWsIssueMessage(
  AppLocalizations l10n,
  DriverFineResponseIssue issue,
) =>
    switch (issue) {
      DriverFineResponseIssue.resolution => l10n.driverWsErrResolution,
      DriverFineResponseIssue.explanation => l10n.driverWsErrExplanation,
      DriverFineResponseIssue.paymentReference =>
        l10n.driverWsErrPaymentReference,
      DriverFineResponseIssue.proposedDate => l10n.driverWsErrProposedDate,
      DriverFineResponseIssue.signature => l10n.driverWsErrSignature,
    };

/// One input on a driver workspace form. [type] is `text`, `number`, a
/// picker kind (`users`, `vehicles`, `records`) or a dropdown kind
/// (`resolution`, `decision`, `record_type`).
final class DriverWsField {
  const DriverWsField(this.key, this.label, [this.type = 'text']);
  final String key;
  final String Function(AppLocalizations) label;
  final String type;
}

String _employeeId(AppLocalizations l) => l.driverWsFieldEmployeeId;
String _driverName(AppLocalizations l) => l.driverWsFieldDriverName;
String _country(AppLocalizations l) => l.driverWsFieldCountry;
String _site(AppLocalizations l) => l.driverWsFieldSite;
String _loginAccount(AppLocalizations l) => l.driverWsFieldLoginAccount;
String _identityReason(AppLocalizations l) => l.driverWsFieldIdentityReason;
String _supervisor(AppLocalizations l) => l.driverWsFieldSupervisor;
String _manager(AppLocalizations l) => l.driverWsFieldManager;
String _vehicle(AppLocalizations l) => l.driverWsFieldVehicle;
String _assignmentReason(AppLocalizations l) => l.driverWsFieldAssignmentReason;
String _authority(AppLocalizations l) => l.driverWsFieldAuthority;
String _noticeReference(AppLocalizations l) => l.driverWsFieldNoticeReference;
String _incidentAt(AppLocalizations l) => l.driverWsFieldIncidentAt;
String _dueDate(AppLocalizations l) => l.driverWsFieldDueDate;
String _amount(AppLocalizations l) => l.driverWsFieldAmount;
String _currency(AppLocalizations l) => l.driverWsFieldCurrency;
String _noticeDetails(AppLocalizations l) => l.driverWsFieldNoticeDetails;
String _assignmentEvidence(AppLocalizations l) =>
    l.driverWsFieldAssignmentEvidence;
String _recordType(AppLocalizations l) => l.driverWsFieldRecordType;
String _existingRecord(AppLocalizations l) => l.driverWsFieldExistingRecord;
String _identityMethod(AppLocalizations l) => l.driverWsFieldIdentityMethod;
String _resolution(AppLocalizations l) => l.driverWsFieldResolution;
String _explanation(AppLocalizations l) => l.driverWsFieldExplanation;
String _paymentReference(AppLocalizations l) => l.driverWsFieldPaymentReference;
String _proposedDate(AppLocalizations l) => l.driverWsFieldProposedDate;
String _decision(AppLocalizations l) => l.driverWsFieldDecision;
String _reviewReason(AppLocalizations l) => l.driverWsFieldReviewReason;
String _verifiedReference(AppLocalizations l) =>
    l.driverWsFieldVerifiedReference;
String _verifiedAmount(AppLocalizations l) => l.driverWsFieldVerifiedAmount;

/// The inputs each workspace command collects. The keys are the command
/// payload fields the server RPC reads and must not change.
const Map<String, List<DriverWsField>> driverWsFields =
    <String, List<DriverWsField>>{
  'create_driver': <DriverWsField>[
    DriverWsField('driver_id', _employeeId),
    DriverWsField('driver_name', _driverName),
    DriverWsField('country', _country),
    DriverWsField('site', _site),
  ],
  'link_account': <DriverWsField>[
    DriverWsField('user_id', _loginAccount, 'users'),
    DriverWsField('reason', _identityReason),
  ],
  'assign_team': <DriverWsField>[
    DriverWsField('supervisor_id', _supervisor, 'users'),
    DriverWsField('manager_id', _manager, 'users'),
    DriverWsField('vehicle_id', _vehicle, 'vehicles'),
    DriverWsField('reason', _assignmentReason),
  ],
  'create_fine': <DriverWsField>[
    DriverWsField('vehicle_id', _vehicle, 'vehicles'),
    DriverWsField('authority', _authority),
    DriverWsField('notice_reference', _noticeReference),
    DriverWsField('incident_at', _incidentAt),
    DriverWsField('due_date', _dueDate),
    DriverWsField('amount', _amount, 'number'),
    DriverWsField('currency', _currency),
    DriverWsField('description', _noticeDetails),
    DriverWsField('assignment_reason', _assignmentEvidence),
  ],
  'link_record': <DriverWsField>[
    DriverWsField('source_type', _recordType, 'record_type'),
    DriverWsField('source_id', _existingRecord, 'records'),
    DriverWsField('reason', _identityMethod),
  ],
  'respond_fine': <DriverWsField>[
    DriverWsField('resolution', _resolution, 'resolution'),
    DriverWsField('explanation', _explanation),
    DriverWsField('payment_reference', _paymentReference),
    DriverWsField('proposed_date', _proposedDate),
  ],
  'review_fine': <DriverWsField>[
    DriverWsField('decision', _decision, 'decision'),
    DriverWsField('reason', _reviewReason),
    DriverWsField('payment_reference', _verifiedReference),
    DriverWsField('payment_amount', _verifiedAmount, 'number'),
  ],
};
