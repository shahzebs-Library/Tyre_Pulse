/// Deterministic presentation data for the source-only accident workflow mock.
///
/// This model is never persisted and never sent to a repository. It fills the
/// portions of the approved end-to-end case mock whose dedicated mobile read
/// models are not wired yet (documents, quotations, PO, SLA and delivery log).
/// The UI labels it as a local preview; verified values on [AccidentRecord]
/// always take precedence where a matching field exists.
library;

import 'package:tyre_pulse/features/accidents/domain/accident_models.dart';

enum AccidentLiabilityChoice {
  ourDriverGcc,
  otherParty,
  shared,
  underInvestigation,
  notApplicable,
}

enum AccidentPayerChoice {
  otherPartyInsurance,
  ourInsurance,
  gccCompany,
  driverRecovery,
  warranty,
  pending,
}

enum AccidentRepairRoute {
  internalWorkshop,
  authorisedDealer,
  externalWorkshop,
  onSiteRepair,
  totalLoss,
}

enum AccidentRecoverySource {
  insuranceSettlement,
  thirdParty,
  driverRecovery,
  warranty,
  company,
}

enum AccidentWorkflowPreviewStatus {
  complete,
  inProgress,
  pending,
  warning,
  missing,
  verified,
  delivered,
  queued,
  scheduled,
  signed,
}

final class AccidentWorkflowPreviewDocument {
  const AccidentWorkflowPreviewDocument({
    required this.labelKey,
    required this.reference,
    required this.status,
    required this.required,
    required this.updatedAt,
    this.uploadedBy = 'PMV Manager',
  });

  final String labelKey;
  final String reference;
  final AccidentWorkflowPreviewStatus status;
  final bool required;
  final DateTime updatedAt;
  final String uploadedBy;
}

final class AccidentWorkflowPreviewActor {
  const AccidentWorkflowPreviewActor({
    required this.name,
    required this.roleKey,
    required this.actionKey,
    required this.status,
  });

  final String name;
  final String roleKey;
  final String actionKey;
  final AccidentWorkflowPreviewStatus status;
}

final class AccidentWorkflowPreviewQuote {
  const AccidentWorkflowPreviewQuote({
    required this.id,
    required this.vendorKey,
    required this.amount,
    required this.turnaroundDays,
  });

  final String id;
  final String vendorKey;
  final double amount;
  final int turnaroundDays;
}

final class AccidentWorkflowPreviewPurchaseOrder {
  const AccidentWorkflowPreviewPurchaseOrder({
    required this.reference,
    required this.amount,
    required this.status,
    required this.ownerKey,
  });

  final String reference;
  final double amount;
  final AccidentWorkflowPreviewStatus status;
  final String ownerKey;
}

final class AccidentWorkflowPreviewRepairMilestone {
  const AccidentWorkflowPreviewRepairMilestone({
    required this.titleKey,
    required this.ownerKey,
    required this.status,
    this.occurredAt,
  });

  final String titleKey;
  final String ownerKey;
  final AccidentWorkflowPreviewStatus status;
  final DateTime? occurredAt;
}

final class AccidentWorkflowPreviewCheck {
  const AccidentWorkflowPreviewCheck({
    required this.labelKey,
    required this.complete,
  });

  final String labelKey;
  final bool complete;
}

final class AccidentWorkflowPreviewSla {
  const AccidentWorkflowPreviewSla({
    required this.activityKey,
    required this.targetKey,
    required this.ownerKey,
    required this.dueAt,
    required this.status,
  });

  final String activityKey;
  final String targetKey;
  final String ownerKey;
  final DateTime dueAt;
  final AccidentWorkflowPreviewStatus status;
}

final class AccidentWorkflowPreviewTimelineEntry {
  const AccidentWorkflowPreviewTimelineEntry({
    required this.titleKey,
    required this.detailKey,
    required this.occurredAt,
    required this.status,
  });

  final String titleKey;
  final String detailKey;
  final DateTime occurredAt;
  final AccidentWorkflowPreviewStatus status;
}

final class AccidentWorkflowPreviewDelivery {
  const AccidentWorkflowPreviewDelivery({
    required this.subjectKey,
    required this.recipientKey,
    required this.channelKey,
    required this.createdAt,
    required this.status,
  });

  final String subjectKey;
  final String recipientKey;
  final String channelKey;
  final DateTime createdAt;
  final AccidentWorkflowPreviewStatus status;
}

final class AccidentCaseWorkflowPreview {
  factory AccidentCaseWorkflowPreview.fromSnapshot(
    AccidentCaseSnapshot snapshot,
  ) {
    final AccidentRecord record = snapshot.accident;
    final DateTime incident = _seedDate(record);
    final double estimate = record.repairCost?.toDouble() ?? 18750;
    final double claim = record.claimAmount?.toDouble() ?? 24500;
    final double approved = record.claimApprovedAmount?.toDouble() ?? 19750;
    final double recovered = record.recoveredAmount?.toDouble() ?? 0;
    return AccidentCaseWorkflowPreview(
      liability: _liability(record),
      payer: _payer(record),
      repairRoute: _repairRoute(record),
      insurer: _text(record.insurer) ?? 'Gulf Shield Insurance',
      policyNumber: _text(record.policyNo) ?? 'POL-DEMO-2026-0841',
      claimNumber: _text(record.insuranceClaimNo) ?? 'CLM-DRAFT-2026-8821',
      claimAmount: claim,
      approvedAmount: approved,
      recoveredAmount: recovered,
      repairEstimate: estimate,
      liabilityPercent: 75,
      provisionalLiabilityNote:
          'Provisional split - PMV Manager approval and audit reason required.',
      responsibleCompany: 'Other-party contracting company',
      failedParty: 'Al Matar Contracting LLC',
      safeToMove: false,
      towingRequired: true,
      vehicleOffRoad: true,
      labourHours: 42,
      labourCost: 5250,
      partsAvailableCount: 8,
      partsRequiredCount: 11,
      deductibleAmount: 2500,
      recoverySource: AccidentRecoverySource.insuranceSettlement,
      recoveryReference: 'REC-DRAFT-2026-0904',
      recoveryDate: incident.add(const Duration(days: 45)),
      documents: <AccidentWorkflowPreviewDocument>[
        AccidentWorkflowPreviewDocument(
          labelKey: 'policeReport',
          reference: 'POLICE-2026-1843',
          status: AccidentWorkflowPreviewStatus.verified,
          required: true,
          updatedAt: incident.add(const Duration(hours: 3)),
          uploadedBy: 'Mr. Ajay',
        ),
        AccidentWorkflowPreviewDocument(
          labelKey: 'najmReport',
          reference: 'NAJM-2026-73184',
          status: AccidentWorkflowPreviewStatus.verified,
          required: true,
          updatedAt: incident.add(const Duration(hours: 4)),
          uploadedBy: 'Mr. Ajay',
        ),
        AccidentWorkflowPreviewDocument(
          labelKey: 'taqdeerAssessment',
          reference: 'TAQ-2026-44091',
          status: AccidentWorkflowPreviewStatus.complete,
          required: true,
          updatedAt: incident.add(const Duration(hours: 8)),
          uploadedBy: 'Ms. Fatima',
        ),
        AccidentWorkflowPreviewDocument(
          labelKey: 'thirdPartyRegistration',
          reference: 'TP-REG-28491',
          status: AccidentWorkflowPreviewStatus.verified,
          required: true,
          updatedAt: incident.add(const Duration(hours: 9)),
          uploadedBy: 'Ms. Fatima',
        ),
        AccidentWorkflowPreviewDocument(
          labelKey: 'thirdPartyPolicy',
          reference: 'TP-POL-884120',
          status: AccidentWorkflowPreviewStatus.verified,
          required: true,
          updatedAt: incident.add(const Duration(hours: 9, minutes: 20)),
          uploadedBy: 'Ms. Fatima',
        ),
        AccidentWorkflowPreviewDocument(
          labelKey: 'drivingLicence',
          reference: 'DL-****-4821',
          status: AccidentWorkflowPreviewStatus.verified,
          required: true,
          updatedAt: incident.add(const Duration(hours: 4, minutes: 15)),
          uploadedBy: 'Mr. Ajay',
        ),
        AccidentWorkflowPreviewDocument(
          labelKey: 'companyUndertaking',
          reference: 'UNDERTAKING-DRAFT-18',
          status: AccidentWorkflowPreviewStatus.pending,
          required: false,
          updatedAt: incident.add(const Duration(hours: 10)),
          uploadedBy: 'PMV Manager',
        ),
        AccidentWorkflowPreviewDocument(
          labelKey: 'vehicleRegistration',
          reference: 'VEH-REG-${record.reference}',
          status: AccidentWorkflowPreviewStatus.verified,
          required: true,
          updatedAt: incident.add(const Duration(hours: 2)),
          uploadedBy: 'Mr. Ajay',
        ),
        AccidentWorkflowPreviewDocument(
          labelKey: 'accidentPhotos',
          reference: '${record.photos.length} FILES',
          status: record.photos.isEmpty
              ? AccidentWorkflowPreviewStatus.missing
              : AccidentWorkflowPreviewStatus.complete,
          required: true,
          updatedAt: incident.add(const Duration(hours: 1)),
          uploadedBy: 'Mr. Ajay',
        ),
        AccidentWorkflowPreviewDocument(
          labelKey: 'workshopAssessmentDocument',
          reference: 'WA-2026-0319',
          status: AccidentWorkflowPreviewStatus.inProgress,
          required: true,
          updatedAt: incident.add(const Duration(days: 1, hours: 2)),
          uploadedBy: 'Eng. Vinay',
        ),
      ],
      quotes: <AccidentWorkflowPreviewQuote>[
        AccidentWorkflowPreviewQuote(
          id: 'QTN-2026-0441',
          vendorKey: 'internalWorkshopEstimate',
          amount: estimate,
          turnaroundDays: 5,
        ),
        AccidentWorkflowPreviewQuote(
          id: 'QTN-2026-0442',
          vendorKey: 'authorisedRepairCentre',
          amount: estimate * 1.12,
          turnaroundDays: 7,
        ),
      ],
      purchaseOrder: AccidentWorkflowPreviewPurchaseOrder(
        reference: 'PO-DRAFT-2026-1048',
        amount: estimate,
        status: AccidentWorkflowPreviewStatus.pending,
        ownerKey: 'procurementManager',
      ),
      repairMilestones: <AccidentWorkflowPreviewRepairMilestone>[
        AccidentWorkflowPreviewRepairMilestone(
          titleKey: 'vehicleDispatchedMilestone',
          ownerKey: 'fleetWorkshopCoordinator',
          occurredAt: incident.add(const Duration(days: 1, hours: 2)),
          status: AccidentWorkflowPreviewStatus.complete,
        ),
        AccidentWorkflowPreviewRepairMilestone(
          titleKey: 'externalWorkshopArrivalMilestone',
          ownerKey: 'externalWorkshopCoordinator',
          occurredAt: incident.add(const Duration(days: 1, hours: 4)),
          status: AccidentWorkflowPreviewStatus.complete,
        ),
        AccidentWorkflowPreviewRepairMilestone(
          titleKey: 'vendorQuotationReceivedMilestone',
          ownerKey: 'externalWorkshopCoordinator',
          occurredAt: incident.add(const Duration(days: 1, hours: 6)),
          status: AccidentWorkflowPreviewStatus.complete,
        ),
        AccidentWorkflowPreviewRepairMilestone(
          titleKey: 'quotationComparedMilestone',
          ownerKey: 'workshopPlanner',
          occurredAt: incident.add(const Duration(days: 1, hours: 8)),
          status: AccidentWorkflowPreviewStatus.complete,
        ),
        const AccidentWorkflowPreviewRepairMilestone(
          titleKey: 'purchaseOrderRecordedMilestone',
          ownerKey: 'procurementManager',
          status: AccidentWorkflowPreviewStatus.inProgress,
        ),
        const AccidentWorkflowPreviewRepairMilestone(
          titleKey: 'repairStartMilestone',
          ownerKey: 'externalWorkshopCoordinator',
          status: AccidentWorkflowPreviewStatus.pending,
        ),
      ],
      handoverChecks: const <AccidentWorkflowPreviewCheck>[
        AccidentWorkflowPreviewCheck(
          labelKey: 'repairScopeCompleted',
          complete: true,
        ),
        AccidentWorkflowPreviewCheck(
          labelKey: 'roadTestCompleted',
          complete: true,
        ),
        AccidentWorkflowPreviewCheck(
          labelKey: 'warningLightsClear',
          complete: true,
        ),
        AccidentWorkflowPreviewCheck(
          labelKey: 'handoverPhotosAttached',
          complete: true,
        ),
        AccidentWorkflowPreviewCheck(
          labelKey: 'fleetAcceptance',
          complete: false,
        ),
      ],
      slaItems: <AccidentWorkflowPreviewSla>[
        AccidentWorkflowPreviewSla(
          activityKey: 'fleetValidationActivity',
          targetKey: 'fourWorkingHours',
          ownerKey: 'fleetSupervisor',
          dueAt: incident.add(const Duration(hours: 4)),
          status: AccidentWorkflowPreviewStatus.complete,
        ),
        AccidentWorkflowPreviewSla(
          activityKey: 'insuranceReviewActivity',
          targetKey: 'fourWorkingHours',
          ownerKey: 'insuranceClaimsOfficer',
          dueAt: incident.add(const Duration(hours: 12)),
          status: AccidentWorkflowPreviewStatus.warning,
        ),
        AccidentWorkflowPreviewSla(
          activityKey: 'repairEstimateActivity',
          targetKey: 'twoBusinessDays',
          ownerKey: 'workshopPlanner',
          dueAt: incident.add(const Duration(days: 2)),
          status: AccidentWorkflowPreviewStatus.inProgress,
        ),
        AccidentWorkflowPreviewSla(
          activityKey: 'poAfterApprovalActivity',
          targetKey: 'oneBusinessDay',
          ownerKey: 'procurementOfficer',
          dueAt: incident.add(const Duration(days: 3)),
          status: AccidentWorkflowPreviewStatus.pending,
        ),
        AccidentWorkflowPreviewSla(
          activityKey: 'fleetInspectionActivity',
          targetKey: 'fourWorkingHours',
          ownerKey: 'fleetInspector',
          dueAt: incident.add(const Duration(days: 6)),
          status: AccidentWorkflowPreviewStatus.scheduled,
        ),
      ],
      timeline: <AccidentWorkflowPreviewTimelineEntry>[
        AccidentWorkflowPreviewTimelineEntry(
          titleKey: 'incidentSubmittedEvent',
          detailKey: 'fleetIncidentOfficer',
          occurredAt: incident,
          status: AccidentWorkflowPreviewStatus.complete,
        ),
        AccidentWorkflowPreviewTimelineEntry(
          titleKey: 'fleetValidatedEvent',
          detailKey: 'fleetSupervisor',
          occurredAt: incident.add(const Duration(hours: 2)),
          status: AccidentWorkflowPreviewStatus.complete,
        ),
        AccidentWorkflowPreviewTimelineEntry(
          titleKey: 'liabilityReviewEvent',
          detailKey: 'hseOfficer',
          occurredAt: incident.add(const Duration(hours: 6)),
          status: AccidentWorkflowPreviewStatus.inProgress,
        ),
        AccidentWorkflowPreviewTimelineEntry(
          titleKey: 'claimPackageEvent',
          detailKey: 'insuranceClaimsOfficer',
          occurredAt: incident.add(const Duration(hours: 10)),
          status: AccidentWorkflowPreviewStatus.warning,
        ),
        AccidentWorkflowPreviewTimelineEntry(
          titleKey: 'workshopAssessmentEvent',
          detailKey: 'workshopPlanner',
          occurredAt: incident.add(const Duration(days: 1)),
          status: AccidentWorkflowPreviewStatus.scheduled,
        ),
      ],
      deliveries: <AccidentWorkflowPreviewDelivery>[
        AccidentWorkflowPreviewDelivery(
          subjectKey: 'caseSubmittedSubject',
          recipientKey: 'fleetAndHseRecipients',
          channelKey: 'inAppAndEmail',
          createdAt: incident.add(const Duration(minutes: 5)),
          status: AccidentWorkflowPreviewStatus.delivered,
        ),
        AccidentWorkflowPreviewDelivery(
          subjectKey: 'claimActionSubject',
          recipientKey: 'insuranceRecipients',
          channelKey: 'inAppAndEmail',
          createdAt: incident.add(const Duration(hours: 8)),
          status: AccidentWorkflowPreviewStatus.delivered,
        ),
        AccidentWorkflowPreviewDelivery(
          subjectKey: 'repairApprovalSubject',
          recipientKey: 'repairApprovalRecipients',
          channelKey: 'inApp',
          createdAt: incident.add(const Duration(days: 1, hours: 4)),
          status: AccidentWorkflowPreviewStatus.queued,
        ),
        AccidentWorkflowPreviewDelivery(
          subjectKey: 'dailyDigestSubject',
          recipientKey: 'caseMemberRecipients',
          channelKey: 'emailDigest',
          createdAt: incident.add(const Duration(days: 1, hours: 12)),
          status: AccidentWorkflowPreviewStatus.scheduled,
        ),
      ],
      actors: const <AccidentWorkflowPreviewActor>[
        AccidentWorkflowPreviewActor(
          name: 'Mr. Ajay',
          roleKey: 'fleetSupervisor',
          actionKey: 'fleetValidatedEvent',
          status: AccidentWorkflowPreviewStatus.complete,
        ),
        AccidentWorkflowPreviewActor(
          name: 'Ms. Fatima',
          roleKey: 'insuranceClaimsOfficer',
          actionKey: 'claimPackageEvent',
          status: AccidentWorkflowPreviewStatus.inProgress,
        ),
        AccidentWorkflowPreviewActor(
          name: 'Eng. Vinay',
          roleKey: 'workshopPlanner',
          actionKey: 'workshopAssessmentEvent',
          status: AccidentWorkflowPreviewStatus.complete,
        ),
        AccidentWorkflowPreviewActor(
          name: 'Ms. Mai',
          roleKey: 'procurementManager',
          actionKey: 'purchaseOrderRecordedMilestone',
          status: AccidentWorkflowPreviewStatus.pending,
        ),
        AccidentWorkflowPreviewActor(
          name: 'PMV Manager',
          roleKey: 'pmvManager',
          actionKey: 'closureApprovalAction',
          status: AccidentWorkflowPreviewStatus.pending,
        ),
      ],
    );
  }

  const AccidentCaseWorkflowPreview({
    required this.liability,
    required this.payer,
    required this.repairRoute,
    required this.insurer,
    required this.policyNumber,
    required this.claimNumber,
    required this.claimAmount,
    required this.approvedAmount,
    required this.recoveredAmount,
    required this.repairEstimate,
    required this.liabilityPercent,
    required this.provisionalLiabilityNote,
    required this.responsibleCompany,
    required this.failedParty,
    required this.safeToMove,
    required this.towingRequired,
    required this.vehicleOffRoad,
    required this.labourHours,
    required this.labourCost,
    required this.partsAvailableCount,
    required this.partsRequiredCount,
    required this.deductibleAmount,
    required this.recoverySource,
    required this.recoveryReference,
    required this.recoveryDate,
    required this.documents,
    required this.quotes,
    required this.purchaseOrder,
    required this.repairMilestones,
    required this.handoverChecks,
    required this.slaItems,
    required this.timeline,
    required this.deliveries,
    required this.actors,
  });

  final AccidentLiabilityChoice liability;
  final AccidentPayerChoice payer;
  final AccidentRepairRoute repairRoute;
  final String insurer;
  final String policyNumber;
  final String claimNumber;
  final double claimAmount;
  final double approvedAmount;
  final double recoveredAmount;
  final double repairEstimate;
  final double liabilityPercent;
  final String provisionalLiabilityNote;
  final String responsibleCompany;
  final String failedParty;
  final bool safeToMove;
  final bool towingRequired;
  final bool vehicleOffRoad;
  final double labourHours;
  final double labourCost;
  final int partsAvailableCount;
  final int partsRequiredCount;
  final double deductibleAmount;
  final AccidentRecoverySource recoverySource;
  final String recoveryReference;
  final DateTime recoveryDate;
  final List<AccidentWorkflowPreviewDocument> documents;
  final List<AccidentWorkflowPreviewQuote> quotes;
  final AccidentWorkflowPreviewPurchaseOrder purchaseOrder;
  final List<AccidentWorkflowPreviewRepairMilestone> repairMilestones;
  final List<AccidentWorkflowPreviewCheck> handoverChecks;
  final List<AccidentWorkflowPreviewSla> slaItems;
  final List<AccidentWorkflowPreviewTimelineEntry> timeline;
  final List<AccidentWorkflowPreviewDelivery> deliveries;
  final List<AccidentWorkflowPreviewActor> actors;

  double get unrecoveredAmount =>
      (approvedAmount - recoveredAmount).clamp(0, double.infinity).toDouble();

  double get netClaimableAmount =>
      (approvedAmount - deductibleAmount).clamp(0, double.infinity).toDouble();

  static DateTime _seedDate(AccidentRecord record) {
    final DateTime? incident = DateTime.tryParse(record.incidentDate);
    return incident ?? record.createdAt ?? DateTime.utc(2026, 5, 11, 8, 15);
  }

  static AccidentLiabilityChoice _liability(AccidentRecord record) {
    final String raw = <String?>[
      record.liableParty,
      record.responsibleParty,
      record.faultStatus,
    ].whereType<String>().join(' ').toLowerCase();
    if (raw.contains('shared') || raw.contains('partial')) {
      return AccidentLiabilityChoice.shared;
    }
    if (raw.contains('third') || raw.contains('other party')) {
      return AccidentLiabilityChoice.otherParty;
    }
    if (raw.contains('driver') || raw.contains('company')) {
      return AccidentLiabilityChoice.ourDriverGcc;
    }
    return AccidentLiabilityChoice.underInvestigation;
  }

  static AccidentPayerChoice _payer(AccidentRecord record) {
    final String raw = record.payer?.trim().toLowerCase() ?? '';
    if (raw.contains('third') || raw.contains('other')) {
      return AccidentPayerChoice.otherPartyInsurance;
    }
    if (raw.contains('driver')) return AccidentPayerChoice.driverRecovery;
    if (raw.contains('warranty')) return AccidentPayerChoice.warranty;
    if (raw.contains('company') || raw.contains('fleet')) {
      return AccidentPayerChoice.gccCompany;
    }
    if (raw.contains('insur')) return AccidentPayerChoice.ourInsurance;
    return AccidentPayerChoice.pending;
  }

  static AccidentRepairRoute _repairRoute(AccidentRecord record) {
    final String raw = <String?>[record.repairType, record.caseStatus]
        .whereType<String>()
        .join(' ')
        .toLowerCase();
    if (raw.contains('total')) return AccidentRepairRoute.totalLoss;
    if (raw.contains('dealer') || raw.contains('author')) {
      return AccidentRepairRoute.authorisedDealer;
    }
    if (raw.contains('external')) return AccidentRepairRoute.externalWorkshop;
    if (raw.contains('site')) return AccidentRepairRoute.onSiteRepair;
    return AccidentRepairRoute.internalWorkshop;
  }

  static String? _text(String? value) {
    final String text = value?.trim() ?? '';
    return text.isEmpty ? null : text;
  }
}
