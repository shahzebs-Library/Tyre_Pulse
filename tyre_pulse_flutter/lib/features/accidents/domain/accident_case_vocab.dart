/// The vocabulary of the owner's 10 accident mock screens, mirrored
/// byte-for-label from `src/lib/accidentCaseVocab.js` on the web. Change
/// BOTH together. Tokens are the live Supabase CHECK tokens; labels are what
/// the mocks print. Nothing here is a person's name or a country rule.
library;

import 'package:flutter/foundation.dart' show immutable;

@immutable
final class VocabItem {
  const VocabItem(
    this.key,
    this.label, {
    this.required = false,
    this.countable = false,
  });
  final String key;
  final String label;
  final bool required;
  final bool countable;
}

@immutable
final class NumberedStep {
  const NumberedStep(this.n, this.key, this.label, {this.owner = ''});
  final int n;
  final String key;
  final String label;
  final String owner;
}

/// Report wizard - "Step N of 7".
const List<NumberedStep> reportWizardSteps = <NumberedStep>[
  NumberedStep(1, 'identify_asset', 'Identify asset'),
  NumberedStep(2, 'incident', 'Incident details'),
  NumberedStep(3, 'people_authority', 'People and authority'),
  NumberedStep(4, 'damage', 'Mark damage'),
  NumberedStep(5, 'evidence', 'Evidence'),
  NumberedStep(6, 'documents', 'Documents'),
  NumberedStep(7, 'review', 'Review and submit'),
];

/// Case flow - "Workstream N of 7". Keys are the accident_case_workstreams
/// workstream_key values; damage_map and timeline are presentation-only.
const List<NumberedStep> caseFlow = <NumberedStep>[
  NumberedStep(1, 'fleet_validation', 'Fleet validation', owner: 'Fleet'),
  NumberedStep(2, 'assessment', 'Workshop assessment', owner: 'Workshop'),
  NumberedStep(3, 'insurance', 'Insurance / Claims', owner: 'Insurance'),
  NumberedStep(4, 'liability', 'Responsibility and payment', owner: 'Fleet'),
  NumberedStep(5, 'damage_map', 'Damage mapping', owner: 'Workshop'),
  NumberedStep(6, 'handover', 'Dispatch and handover', owner: 'Fleet'),
  NumberedStep(7, 'timeline', 'Timeline and closure', owner: 'Command Center'),
];

NumberedStep? caseFlowStep(String key) {
  for (final NumberedStep s in caseFlow) {
    if (s.key == key) return s;
  }
  return null;
}

String caseFlowLabel(String key) {
  final NumberedStep? s = caseFlowStep(key);
  return s == null ? '' : 'Workstream ${s.n} of ${caseFlow.length}';
}

/// M3 Who was at fault (accident_liability_assessments.liability_type).
@immutable
final class FaultTile {
  const FaultTile(this.key, this.label, {this.ourPct, this.otherPct});
  final String key;
  final String label;
  final int? ourPct;
  final int? otherPct;
}

const List<FaultTile> faultTiles = <FaultTile>[
  FaultTile('our_driver_full', 'Our driver / GCC', ourPct: 100, otherPct: 0),
  FaultTile('third_party_full', 'Other party', ourPct: 0, otherPct: 100),
  FaultTile('shared', 'Shared fault', ourPct: 50, otherPct: 50),
  FaultTile('under_investigation', 'Under investigation'),
  FaultTile('not_applicable', 'Not applicable'),
];

/// Mirrors the web `faultStatusFor`: an unset percentage is "not decided",
/// never Non-faulty.
String faultStatusFor(String? liabilityType, num? ourPct) {
  if (liabilityType == 'under_investigation') return 'Under review';
  if (liabilityType == 'not_applicable') return 'Not applicable';
  if (ourPct == null) return '';
  return ourPct > 0 ? 'Faulty' : 'Non-faulty';
}

/// M3 Who will pay (accident_liability_assessments.payer).
const List<VocabItem> payerTiles = <VocabItem>[
  VocabItem('other_party_insurance', 'Other party insurance'),
  VocabItem('our_insurance', 'Our insurance'),
  VocabItem('company', 'GCC / company'),
  VocabItem('driver_recovery', 'Driver recovery'),
  VocabItem('warranty', 'Warranty'),
  VocabItem('pending', 'Pending decision'),
];

String payerLabel(String? key) {
  for (final VocabItem p in payerTiles) {
    if (p.key == key) return p.label;
  }
  return '';
}

bool recoveryRequiredFor(String? payer) => const <String>{
      'other_party_insurance',
      'driver_recovery',
      'warranty',
    }.contains(payer);

/// M3 Third-party and authority rows (value | recorded by | verification).
const List<VocabItem> authorityRows = <VocabItem>[
  VocabItem('third_party_plate', 'Third-party plate'),
  VocabItem('third_party_driver', 'Third-party driver'),
  VocabItem('third_party_phone', 'Contact phone'),
  VocabItem('police_report_no', 'Police report no.'),
  VocabItem('najm_report', 'Najm report'),
  VocabItem('taqdeer_required', 'Taqdeer required'),
  VocabItem('taqdeer_no', 'Taqdeer no.'),
];

const List<String> verificationStates = <String>[
  'verified',
  'pending',
  'missing',
];

/// M3 Responsibility documents (accident_evidence.requirement_key).
const List<VocabItem> responsibilityDocs = <VocabItem>[
  VocabItem('police_accident_report', 'Police Accident Report', required: true),
  VocabItem('najm_report', 'Najm Report', required: true),
  VocabItem('taqdeer_assessment', 'Taqdeer Assessment', required: true),
  VocabItem(
    'third_party_registration_card',
    'Third-party Registration Card',
    required: true,
  ),
  VocabItem(
    'third_party_insurance_policy',
    'Third-party Insurance Policy',
    required: true,
  ),
  VocabItem('driver_licence', 'Driver Licence', required: true),
  VocabItem('company_letter_undertaking', 'Company Letter / Undertaking'),
];

/// M4 Claim document package (accident_evidence.requirement_key,
/// workstream insurance).
const List<VocabItem> claimPackageDocs = <VocabItem>[
  VocabItem('accident_report_pdf', 'Accident report PDF', required: true),
  VocabItem('fleet_validation', 'Fleet validation', required: true),
  VocabItem(
    'workshop_assessment_pdf',
    'Workshop assessment PDF',
    required: true,
  ),
  VocabItem(
    'damage_photographs',
    'Damage photographs',
    required: true,
    countable: true,
  ),
  VocabItem('police_najm_report', 'Police / Najm report', required: true),
  VocabItem('vehicle_registration', 'Vehicle registration', required: true),
  VocabItem('driving_licence', 'Driving licence', required: true),
  VocabItem('policy_document', 'Policy document', required: true),
];

/// M5 Repair assessment.
const List<VocabItem> repairRouteTiles = <VocabItem>[
  VocabItem('internal', 'Internal workshop'),
  VocabItem('external', 'External workshop'),
  VocabItem('on_site', 'On-site repair'),
];

const List<VocabItem> damageActions = <VocabItem>[
  VocabItem('repair', 'Repair'),
  VocabItem('replace', 'Replace'),
  VocabItem('structural_review', 'Replace / structural review'),
  VocabItem('monitor', 'Monitor'),
];

const List<VocabItem> quotationStates = <VocabItem>[
  VocabItem('not_requested', 'Not requested'),
  VocabItem('requested', 'Requested'),
  VocabItem('received', 'Received'),
  VocabItem('approved', 'Approved'),
  VocabItem('rejected', 'Rejected'),
];

const List<VocabItem> assessmentAttachments = <VocabItem>[
  VocabItem('assessment_report_pdf', 'Assessment report PDF', required: true),
  VocabItem('vendor_quotation', 'Vendor quotation', required: true),
  VocabItem(
    'damage_photos',
    'Damage photos',
    required: true,
    countable: true,
  ),
  VocabItem('recovery_request', 'Recovery request'),
];

/// The one attachment that gates "Submit assessment and route" for an
/// external repair route.
const String submitGatingAttachment = 'vendor_quotation';

/// M6 Fleet validation checklist (accident_fleet_validation_items.item_key).
const List<VocabItem> fleetValidationItems = <VocabItem>[
  VocabItem('asset_driver_confirmed', 'Asset and driver confirmed'),
  VocabItem('incident_facts_confirmed', 'Incident facts confirmed'),
  VocabItem('damage_map_reviewed', 'Damage map reviewed'),
  VocabItem('required_photographs', 'Required photographs', countable: true),
  VocabItem(
    'police_najm_documents',
    'Police / Najm documents',
    countable: true,
  ),
  VocabItem(
    'workshop_assessment_requested',
    'Workshop assessment requested',
  ),
];

const List<String> checkStates = <String>[
  'pending',
  'done',
  'attention',
  'not_applicable',
];

/// M2 Dispatch and handover.
const List<NumberedStep> dispatchStepper = <NumberedStep>[
  NumberedStep(1, 'dispatched', 'Dispatched'),
  NumberedStep(2, 'arrived', 'Arrived'),
  NumberedStep(3, 'signed_acceptance', 'Signed acceptance'),
  NumberedStep(4, 'vendor_assessment', 'Vendor assessment / quotation starts'),
];

const List<VocabItem> dispatchLiveStates = <VocabItem>[
  VocabItem('preparing', 'Preparing'),
  VocabItem('in_transit', 'In transit'),
  VocabItem('arrived', 'Arrived'),
  VocabItem('accepted', 'Accepted'),
];

/// Vendor receipt fields the mock marks with an asterisk (accident_dispatches).
const List<String> receiptRequired = <String>[
  'arrived_at',
  'received_by_name',
  'received_by_designation',
  'receiving_photos',
  'handover_paper_ref',
  'receiver_signature',
  'custody_accepted',
];

/// M8/M9/M10 Damage mapping.
const List<VocabItem> damageTypes = <VocabItem>[
  VocabItem('dent', 'Dent'),
  VocabItem('scratch', 'Scratch'),
  VocabItem('cracked', 'Cracked'),
  VocabItem('broken', 'Broken'),
  VocabItem('missing', 'Missing'),
  VocabItem('bent', 'Bent'),
  VocabItem('other', 'Other'),
];

String canonDamageType(String? raw) {
  final String k = (raw ?? '').trim().toLowerCase();
  if (k.isEmpty) return '';
  if (k == 'crack' || k == 'cracked') return 'cracked';
  if (k == 'dented') return 'dent';
  for (final VocabItem d in damageTypes) {
    if (d.key == k) return k;
  }
  return 'other';
}

/// Levels keep the stored tokens; 'severe' is labelled Major.
const List<VocabItem> damageLevels = <VocabItem>[
  VocabItem('minor', 'Minor'),
  VocabItem('moderate', 'Moderate'),
  VocabItem('severe', 'Major'),
];

const int damageNoteMax = 200;

/// View chips per vehicle family in mock order. Keys match the web
/// FAMILY_VIEW_ORDER; 'front_left' and 'top' are the additions.
const Map<String, List<String>> familyViewOrder = <String, List<String>>{
  'bus': <String>['left', 'front_left', 'front', 'right', 'rear', 'top'],
  'concrete_pump': <String>['top', 'left', 'right', 'front', 'rear'],
  'pickup': <String>['left', 'right', 'front', 'rear', 'top'],
  'generic': <String>['left', 'right', 'front', 'rear', 'top'],
};

const Map<String, String> viewLabels = <String, String>{
  'left': 'Left',
  'front_left': 'Front-left',
  'front': 'Front',
  'right': 'Right',
  'rear': 'Rear',
  'top': 'Top',
  'overview': 'Overview',
};

/// Named notify roles on M4/M5/M6 (roles, never people).
@immutable
final class NotifyRole {
  const NotifyRole(
    this.key,
    this.label,
    this.roles, {
    this.visibilityOnly = false,
  });
  final String key;
  final String label;
  final List<String> roles;
  final bool visibilityOnly;
}

const List<NotifyRole> notifyRoles = <NotifyRole>[
  NotifyRole('fleet', 'Fleet', <String>['Fleet Supervisor', 'Manager']),
  NotifyRole(
    'workshop',
    'Workshop',
    <String>['Workshop Supervisor', 'Workshop Maintenance Area Manager'],
  ),
  NotifyRole('insurance', 'Insurance', <String>['Insurance Officer']),
  NotifyRole(
    'command_center',
    'Command Center',
    <String>['Data Monitor Officer'],
  ),
  NotifyRole(
    'pmv_manager',
    'PMV Manager',
    <String>['PMV Manager'],
    visibilityOnly: true,
  ),
];

/// M1 Timeline.
const List<String> timelineTabs = <String>[
  'Timeline',
  'Notifications',
  'Participants',
];
const List<String> timelineFilters = <String>[
  'all',
  'actions',
  'documents',
  'sla',
  'emails',
];
