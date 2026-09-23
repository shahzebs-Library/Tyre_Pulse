import 'package:flutter/material.dart';
import 'package:tyre_pulse/app/theme/tp_colors.dart';
import 'package:tyre_pulse/core/design_system/design_system.dart';
import 'package:tyre_pulse/features/accidents/domain/accident_models.dart';
import 'package:tyre_pulse/features/accidents/presentation/accident_case_workflow_copy.dart';
import 'package:tyre_pulse/features/accidents/presentation/accident_claims_screen.dart';
import 'package:tyre_pulse/features/accidents/presentation/accident_copy.dart';

/// Role panels accept only persisted case facts. Callbacks must be connected
/// to existing authorized actions; an absent callback remains visibly disabled.
class AccidentFleetValidationWorkspace extends StatelessWidget {
  const AccidentFleetValidationWorkspace({
    super.key,
    required this.snapshot,
    this.onOpenIncident,
    this.onUpdateWorkstream,
  });
  final AccidentCaseSnapshot snapshot;
  final VoidCallback? onOpenIncident;
  final VoidCallback? onUpdateWorkstream;
  @override
  Widget build(BuildContext context) => _PrimaryPanel(
        snapshot: snapshot,
        kind: _Kind.fleet,
        onOpenIncident: onOpenIncident,
        onUpdate: onUpdateWorkstream,
      );
}

class AccidentInsuranceClaimsWorkspace extends StatelessWidget {
  const AccidentInsuranceClaimsWorkspace({
    super.key,
    required this.snapshot,
    this.onRegisterClaim,
    this.onUpdateWorkstream,
  });
  final AccidentCaseSnapshot snapshot;
  final VoidCallback? onRegisterClaim;
  final VoidCallback? onUpdateWorkstream;
  @override
  Widget build(BuildContext context) => _PrimaryPanel(
        snapshot: snapshot,
        kind: _Kind.insurance,
        onRegisterClaim: onRegisterClaim,
        onUpdate: onUpdateWorkstream,
      );
}

class AccidentResponsibilityPaymentWorkspace extends StatelessWidget {
  const AccidentResponsibilityPaymentWorkspace({
    super.key,
    required this.snapshot,
    this.onUpdateWorkstream,
  });
  final AccidentCaseSnapshot snapshot;
  final VoidCallback? onUpdateWorkstream;
  @override
  Widget build(BuildContext context) => _PrimaryPanel(
        snapshot: snapshot,
        kind: _Kind.responsibility,
        onUpdate: onUpdateWorkstream,
      );
}

enum _Kind { fleet, insurance, responsibility }

class _PrimaryPanel extends StatelessWidget {
  const _PrimaryPanel({
    required this.snapshot,
    required this.kind,
    this.onOpenIncident,
    this.onRegisterClaim,
    this.onUpdate,
  });
  final AccidentCaseSnapshot snapshot;
  final _Kind kind;
  final VoidCallback? onOpenIncident;
  final VoidCallback? onRegisterClaim;
  final VoidCallback? onUpdate;

  @override
  Widget build(BuildContext context) {
    final r = snapshot.accident;
    final c = AccidentCopy.of(context);
    final w = AccidentCaseWorkflowCopy.of(context);
    String value(Object? raw) => raw == null || raw.toString().trim().isEmpty
        ? c('notRecorded')
        : raw.toString();
    String flag(bool? raw) =>
        raw == null ? c('notRecorded') : w(raw ? 'yes' : 'no');
    AccidentWorkstream? stream(String key) =>
        snapshot.workstreams.where((item) => item.key == key).firstOrNull;
    Widget fact(
      String label,
      Object? raw, [
      IconData icon = Icons.description_outlined,
    ]) =>
        _FactLine(label: label, value: value(raw), icon: icon);
    Widget section(int number, String title, List<Widget> children) =>
        _NumberedCard(number: number, title: title, children: children);
    Widget documents(List<String> keys) => Column(
          children: <Widget>[
            for (final key in keys)
              fact(w(key), null, Icons.insert_drive_file_outlined),
            Padding(
              padding: const EdgeInsets.all(12),
              child: Text(w('documentsUnavailable')),
            ),
          ],
        );
    final active = stream(
      switch (kind) {
        _Kind.fleet => 'fleet_validation',
        _Kind.insurance => 'insurance',
        _Kind.responsibility => 'liability',
      },
    );
    final content = <Widget>[
      _NumberedCard(
        number: null,
        title: w('workstreamControl'),
        children: <Widget>[
          fact(w('status'), active?.status, Icons.flag_outlined),
          fact(w('owningTeam'), active?.team, Icons.group_outlined),
          fact(w('ownerRole'), active?.ownerRole, Icons.person_outline),
          fact(
            w('lastUpdate'),
            active?.updatedAt?.toIso8601String(),
            Icons.schedule,
          ),
          if (active?.progressPct != null)
            fact(
              w('recordedProgress'),
              '${active!.progressPct}%',
              Icons.donut_small_outlined,
            ),
          if (active?.notes?.trim().isNotEmpty == true)
            fact('Notes', active!.notes, Icons.notes_outlined),
          if (active?.naReason?.trim().isNotEmpty == true)
            fact(
              'Waiver reason',
              active!.naReason,
              Icons.playlist_remove_outlined,
            ),
          fact(w('slaTitle'), null, Icons.timer_outlined),
        ],
      ),
    ];
    switch (kind) {
      case _Kind.fleet:
        content.addAll(<Widget>[
          section(1, _copy(context, 'summary'), <Widget>[
            fact(c('description'), r.description, Icons.car_crash_outlined),
            fact(c('location'), r.location, Icons.location_on_outlined),
            fact(c('driver'), r.driverName, Icons.person_outline),
            fact(
              c('injuries'),
              flag(r.injuries),
              Icons.health_and_safety_outlined,
            ),
            fact(
              c('thirdParty'),
              flag(r.thirdPartyInvolved),
              Icons.groups_outlined,
            ),
            fact(
              c('evidenceFiles'),
              r.photos.length,
              Icons.photo_library_outlined,
            ),
            TextButton.icon(
              onPressed: onOpenIncident,
              icon: const Icon(Icons.article_outlined),
              label: Text(_copy(context, 'report')),
            ),
          ]),
          section(2, _copy(context, 'checklist'), <Widget>[
            for (final key in <String>[
              'identityChecked',
              'factsChecked',
              'damageChecked',
              'photosChecked',
            ])
              fact(_copy(context, key), null, Icons.radio_button_unchecked),
            fact(w('najmStatus'), r.najmStatus),
            fact(w('workshopAssessmentDocument'), stream('assessment')?.status),
          ]),
          section(3, _copy(context, 'notify'), <Widget>[
            fact(
              w('owningTeam'),
              stream('insurance')?.team,
              Icons.group_outlined,
            ),
            fact(
              w('ownerRole'),
              stream('insurance')?.ownerRole,
              Icons.person_outline,
            ),
            fact(w('deliveryLog'), null, Icons.mark_email_unread_outlined),
            Padding(
              padding: const EdgeInsets.all(12),
              child: Text(_copy(context, 'unsupported')),
            ),
          ]),
        ]);
      case _Kind.insurance:
        content.addAll(<Widget>[
          section(1, w('claimPackageTitle'), <Widget>[
            documents(<String>[
              'policeReport',
              'workshopAssessmentDocument',
              'vehicleRegistration',
              'drivingLicence',
              'insurancePolicy',
            ]),
            fact(
              c('evidenceFiles'),
              r.photos.length,
              Icons.photo_library_outlined,
            ),
          ]),
          section(2, accidentClaimCopy(context, 'title'), <Widget>[
            fact(c('insurer'), r.insurer, Icons.shield_outlined),
            fact(c('policy'), r.policyNo),
            fact(c('claimNo'), r.insuranceClaimNo),
            fact(c('claimed'), r.claimAmount, Icons.payments_outlined),
            fact(w('deductible'), r.deductible),
            fact(w('netClaimable'), null),
            Padding(
              padding: const EdgeInsets.all(12),
              child: OutlinedButton.icon(
                onPressed: onRegisterClaim,
                icon: const Icon(Icons.policy_outlined),
                label: Text(accidentClaimCopy(context, 'title')),
              ),
            ),
          ]),
          section(3, w('claimRecoveryTitle'), <Widget>[
            fact(c('claimStatus'), r.claimStatus),
            fact(w('approvedForSettlement'), r.claimApprovedAmount),
            fact(w('recoveryAmount'), r.recoveredAmount),
            fact(w('outstandingRecovery'), null),
            fact(w('recoverySource'), null),
          ]),
          section(4, _copy(context, 'notify'), <Widget>[
            fact(w('recipients'), null, Icons.group_outlined),
            fact(w('deliveryLog'), null, Icons.mail_outline),
          ]),
        ]);
      case _Kind.responsibility:
        content.addAll(<Widget>[
          section(1, _copy(context, 'fault'), <Widget>[
            _RecordedOptions(
              value: r.responsibleParty,
              values: <String, String>{
                'driver': w('liabilityOurDriverGcc'),
                'other_party': w('liabilityOtherParty'),
                'shared': w('liabilityShared'),
                'under_investigation': w('liabilityUnderInvestigation'),
                'not_applicable': w('liabilityNotApplicable'),
              },
            ),
            fact(c('responsible'), r.responsibleParty),
            fact(c('fault'), r.faultStatus),
            fact(w('liabilityPercent'), null),
          ]),
          section(2, _copy(context, 'payer'), <Widget>[
            _RecordedOptions(
              value: r.payer,
              values: <String, String>{
                'other_party_insurance': w('payerOtherPartyInsurance'),
                'our_insurance': w('payerOurInsurance'),
                'company': w('payerGccCompany'),
                'driver_recovery': w('payerDriverRecovery'),
                'warranty': w('payerWarranty'),
                'pending': w('payerPending'),
              },
            ),
            fact(c('payer'), r.payer),
            fact(c('liable'), r.liableParty),
            fact(w('responsibleCompany'), null),
          ]),
          section(3, w('responsibilityTitle'), <Widget>[
            fact(c('thirdParty'), flag(r.thirdPartyInvolved)),
            fact(w('policeReport'), r.policeReportNo),
            fact(w('najmStatus'), r.najmStatus),
            fact(w('najmFault'), r.najmFault),
            fact(w('taqdeerStatus'), r.taqdeerStatus),
            fact(w('taqdeerNumber'), r.taqdeerNo),
          ]),
          section(4, w('documentsTitle'), <Widget>[
            documents(<String>[
              'policeReport',
              'najmReport',
              'taqdeerAssessment',
              'thirdPartyRegistration',
              'thirdPartyPolicy',
              'drivingLicence',
              'companyUndertaking',
            ]),
          ]),
        ]);
    }
    content.add(
      Padding(
        padding: const EdgeInsets.symmetric(vertical: 8),
        child: OutlinedButton.icon(
          onPressed: onUpdate,
          icon: const Icon(Icons.edit_note),
          label: Text(w('workstreamControl')),
        ),
      ),
    );
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: <Widget>[
        for (final child in content)
          Padding(padding: const EdgeInsets.only(bottom: 12), child: child),
      ],
    );
  }
}

class _NumberedCard extends StatelessWidget {
  const _NumberedCard({
    required this.number,
    required this.title,
    required this.children,
  });
  final int? number;
  final String title;
  final List<Widget> children;
  @override
  Widget build(BuildContext context) => TpCard(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: <Widget>[
            Row(
              children: <Widget>[
                if (number != null) ...<Widget>[
                  CircleAvatar(
                    radius: 13,
                    backgroundColor: TpPalette.of(context).primary,
                    foregroundColor: Colors.white,
                    child:
                        Text('$number', style: const TextStyle(fontSize: 13)),
                  ),
                  const SizedBox(width: 10),
                ],
                Expanded(
                  child: Text(
                    title,
                    style: Theme.of(context).textTheme.titleSmall,
                  ),
                ),
              ],
            ),
            const SizedBox(height: 10),
            for (final child in children) ...<Widget>[
              const Divider(height: 1),
              child,
            ],
          ],
        ),
      );
}

class _FactLine extends StatelessWidget {
  const _FactLine({
    required this.label,
    required this.value,
    required this.icon,
  });
  final String label;
  final String value;
  final IconData icon;
  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.symmetric(vertical: 10),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            Icon(icon, size: 18, color: TpPalette.of(context).primary),
            const SizedBox(width: 8),
            Expanded(child: Text(label)),
            const SizedBox(width: 12),
            Expanded(
              child: Text(
                value,
                style: Theme.of(context)
                    .textTheme
                    .bodyMedium
                    ?.copyWith(fontWeight: FontWeight.w600),
              ),
            ),
          ],
        ),
      );
}

class _RecordedOptions extends StatelessWidget {
  const _RecordedOptions({required this.value, required this.values});
  final String? value;
  final Map<String, String> values;
  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.symmetric(vertical: 12),
        child: Wrap(
          spacing: 8,
          runSpacing: 8,
          children: <Widget>[
            for (final item in values.entries)
              InputChip(
                label: Text(item.value),
                selected: value == item.key,
                avatar: const Icon(Icons.person_outline, size: 18),
              ),
          ],
        ),
      );
}

String _copy(BuildContext context, String key) {
  final language = Localizations.localeOf(context).languageCode;
  final index = language == 'ar'
      ? 1
      : language == 'ur'
          ? 2
          : 0;
  return <String, List<String>>{
    'summary': <String>['Incident summary', 'ملخص الحادث', 'حادثے کا خلاصہ'],
    'report': <String>[
      'View incident report',
      'عرض تقرير الحادث',
      'حادثے کی رپورٹ دیکھیں',
    ],
    'checklist': <String>[
      'Fleet validation checklist',
      'قائمة التحقق للأسطول',
      'فلیٹ تصدیق کی فہرست',
    ],
    'identityChecked': <String>[
      'Asset and driver confirmed',
      'تأكيد الأصل والسائق',
      'اثاثے اور ڈرائیور کی تصدیق',
    ],
    'factsChecked': <String>[
      'Incident facts confirmed',
      'تأكيد وقائع الحادث',
      'حادثے کے حقائق کی تصدیق',
    ],
    'damageChecked': <String>[
      'Damage map reviewed',
      'مراجعة خريطة الأضرار',
      'نقصان کے نقشے کا جائزہ',
    ],
    'photosChecked': <String>[
      'Required photographs verified',
      'التحقق من الصور المطلوبة',
      'مطلوبہ تصاویر کی تصدیق',
    ],
    'notify': <String>[
      'Notification handoff',
      'تسليم الإشعار',
      'اطلاع کی حوالگی',
    ],
    'unsupported': <String>[
      'Delivery confirmation is not recorded.',
      'لم يتم تسجيل تأكيد التسليم.',
      'ترسیل کی تصدیق درج نہیں ہے۔',
    ],
    'fault': <String>['Who was at fault?', 'من المتسبب؟', 'قصور کس کا تھا؟'],
    'payer': <String>['Who will pay?', 'من سيدفع؟', 'ادائیگی کون کرے گا؟'],
  }[key]![index];
}
