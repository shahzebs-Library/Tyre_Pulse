/// Source-only preview panels for the end-to-end accident case workflow.
library;

import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:tyre_pulse/app/localization/tp_localizations.dart';
import 'package:tyre_pulse/app/theme/tp_colors.dart';
import 'package:tyre_pulse/app/theme/tp_spacing.dart';
import 'package:tyre_pulse/core/design_system/design_system.dart';
import 'package:tyre_pulse/core/workspace/workspace_providers.dart';
import 'package:tyre_pulse/features/accidents/domain/accident_case_workflow.dart';
import 'package:tyre_pulse/features/accidents/domain/accident_case_workflow_preview.dart';
import 'package:tyre_pulse/features/accidents/domain/accident_models.dart';
import 'package:tyre_pulse/features/accidents/presentation/accident_case_workflow_copy.dart';
import 'package:tyre_pulse/features/accidents/presentation/accident_copy.dart';
import 'package:tyre_pulse/features/accidents/presentation/accident_ui.dart';
import 'package:tyre_pulse/features/notifications/domain/app_notification.dart';
import 'package:tyre_pulse/features/notifications/notifications_providers.dart';

abstract final class AccidentCaseWorkflowKeys {
  static const Key fleetValidation = Key('accident.case.fleetValidation');
  static const Key responsibilityDocuments =
      Key('accident.case.responsibilityDocuments');
  static const Key documentBoundary = Key('accident.case.documentBoundary');
  static const Key insuranceControl = Key('accident.case.insuranceControl');
  static const Key workshopAssessment = Key('accident.case.workshopAssessment');
  static const Key repairPlanning = Key('accident.case.repairPlanning');
  static const Key quotationBoundary = Key('accident.case.quotationBoundary');
  static const Key purchaseOrderBoundary =
      Key('accident.case.purchaseOrderBoundary');
  static const Key handover = Key('accident.case.handover');
  static const Key sla = Key('accident.case.sla');
  static const Key timeline = Key('accident.case.timeline');
  static const Key notifications = Key('accident.case.notifications');
}

class AccidentFleetValidationSection extends StatelessWidget {
  const AccidentFleetValidationSection({required this.snapshot, super.key});

  final AccidentCaseSnapshot snapshot;

  @override
  Widget build(BuildContext context) {
    final AccidentCopy copy = AccidentCopy.of(context);
    final AccidentCaseWorkflowCopy workflowCopy =
        AccidentCaseWorkflowCopy.of(context);
    final AccidentCaseWorkflowProjection projection =
        AccidentCaseWorkflowProjection(snapshot);
    final AccidentRecord record = snapshot.accident;
    return _WorkflowPanel(
      key: AccidentCaseWorkflowKeys.fleetValidation,
      icon: Icons.local_shipping_outlined,
      title: copy('wsFleet'),
      subtitle: workflowCopy('fleetHint'),
      children: <Widget>[
        _PreviewBanner(copy: workflowCopy),
        const SizedBox(height: TpSpace.sm),
        _Subheading(workflowCopy('validationFacts')),
        _RecordedFact(
          label: copy('assetNo'),
          value: record.assetNo,
          copy: copy,
          workflowCopy: workflowCopy,
        ),
        _RecordedFact(
          label: copy('vehicleType'),
          value: record.vehicleType,
          copy: copy,
          workflowCopy: workflowCopy,
        ),
        _RecordedFact(
          label: copy('plate'),
          value: record.plateNumber,
          copy: copy,
          workflowCopy: workflowCopy,
        ),
        _RecordedFact(
          label: copy('site'),
          value: record.site,
          copy: copy,
          workflowCopy: workflowCopy,
        ),
        _RecordedFact(
          label: copy('exactLocation'),
          value: record.location,
          copy: copy,
          workflowCopy: workflowCopy,
        ),
        _RecordedFact(
          label: copy('reporter'),
          value: record.reporterName,
          copy: copy,
          workflowCopy: workflowCopy,
        ),
        _RecordedFact(
          label: copy('incidentDateLabel'),
          value: formatAccidentIncidentDate(
            context,
            record.incidentDate,
            includeTime: true,
          ),
          copy: copy,
          workflowCopy: workflowCopy,
        ),
        const SizedBox(height: TpSpace.sm),
        _Subheading(workflowCopy('workstreamControl')),
        _WorkstreamControl(
          workstream: projection.workstream('fleet_validation'),
          provisioned: projection.provisioned,
          copy: copy,
          workflowCopy: workflowCopy,
        ),
      ],
    );
  }
}

class AccidentResponsibilityDocumentsSection extends StatefulWidget {
  const AccidentResponsibilityDocumentsSection({
    required this.snapshot,
    super.key,
  });

  final AccidentCaseSnapshot snapshot;

  @override
  State<AccidentResponsibilityDocumentsSection> createState() =>
      _AccidentResponsibilityDocumentsSectionState();
}

class _AccidentResponsibilityDocumentsSectionState
    extends State<AccidentResponsibilityDocumentsSection> {
  late AccidentLiabilityChoice _liability;
  late AccidentPayerChoice _payer;
  late double _liabilityPercent;

  @override
  void initState() {
    super.initState();
    final AccidentCaseWorkflowPreview preview =
        AccidentCaseWorkflowPreview.fromSnapshot(widget.snapshot);
    _liability = preview.liability;
    _payer = preview.payer;
    _liabilityPercent = preview.liabilityPercent;
  }

  @override
  Widget build(BuildContext context) {
    final AccidentCopy copy = AccidentCopy.of(context);
    final AccidentCaseWorkflowCopy workflowCopy =
        AccidentCaseWorkflowCopy.of(context);
    final AccidentCaseWorkflowProjection projection =
        AccidentCaseWorkflowProjection(widget.snapshot);
    final AccidentCaseWorkflowPreview preview =
        AccidentCaseWorkflowPreview.fromSnapshot(widget.snapshot);
    final AccidentRecord record = widget.snapshot.accident;
    final int evidenceCount = record.photos.length;
    return Column(
      key: AccidentCaseWorkflowKeys.responsibilityDocuments,
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: <Widget>[
        _WorkflowPanel(
          icon: Icons.gavel_outlined,
          title: workflowCopy('responsibilityTitle'),
          subtitle: workflowCopy('responsibilityHint'),
          children: <Widget>[
            _PreviewBanner(copy: workflowCopy),
            const SizedBox(height: TpSpace.sm),
            AccidentInfoRow(copy('fault'), record.faultStatus),
            AccidentInfoRow(copy('responsible'), record.responsibleParty),
            AccidentInfoRow(copy('liable'), record.liableParty),
            AccidentInfoRow(copy('payer'), record.payer),
            AccidentInfoRow(
              workflowCopy('liabilityPercent'),
              '${_liabilityPercent.toStringAsFixed(0)}%',
            ),
            AccidentInfoRow(
              workflowCopy('responsibleCompany'),
              preview.responsibleCompany,
            ),
            AccidentInfoRow(
              workflowCopy('failedParty'),
              preview.failedParty,
            ),
            AccidentInfoRow(
              workflowCopy('provisionalAuditNote'),
              preview.provisionalLiabilityNote,
            ),
            const SizedBox(height: TpSpace.sm),
            _Subheading(workflowCopy('responsibilityChoice')),
            Wrap(
              spacing: TpSpace.sm,
              runSpacing: TpSpace.sm,
              children: <Widget>[
                for (final AccidentLiabilityChoice option
                    in AccidentLiabilityChoice.values)
                  ChoiceChip(
                    label: Text(workflowCopy(_liabilityKey(option))),
                    selected: _liability == option,
                    onSelected: (bool selected) {
                      if (!selected) return;
                      setState(() => _liability = option);
                    },
                  ),
              ],
            ),
            Slider(
              value: _liabilityPercent,
              min: 0,
              max: 100,
              divisions: 20,
              label: '${_liabilityPercent.toStringAsFixed(0)}%',
              onChanged: (double value) {
                setState(() => _liabilityPercent = value);
              },
            ),
            const SizedBox(height: TpSpace.md),
            _Subheading(workflowCopy('payerChoice')),
            Wrap(
              spacing: TpSpace.sm,
              runSpacing: TpSpace.sm,
              children: <Widget>[
                for (final AccidentPayerChoice option
                    in AccidentPayerChoice.values)
                  ChoiceChip(
                    label: Text(workflowCopy(_payerKey(option))),
                    selected: _payer == option,
                    onSelected: (bool selected) {
                      if (!selected) return;
                      setState(() => _payer = option);
                    },
                  ),
              ],
            ),
            const SizedBox(height: TpSpace.sm),
            Align(
              alignment: AlignmentDirectional.centerEnd,
              child: TpStatusChip(
                status: TpStatus.info,
                label: workflowCopy('localChange'),
                icon: Icons.smartphone_outlined,
                isCompact: true,
              ),
            ),
            const SizedBox(height: TpSpace.sm),
            _WorkstreamControl(
              workstream: projection.workstream('liability'),
              provisioned: projection.provisioned,
              copy: copy,
              workflowCopy: workflowCopy,
            ),
          ],
        ),
        const SizedBox(height: TpSpace.md),
        _WorkflowPanel(
          key: AccidentCaseWorkflowKeys.documentBoundary,
          icon: Icons.folder_copy_outlined,
          title: workflowCopy('documentRegister'),
          children: <Widget>[
            _PreviewBanner(copy: workflowCopy),
            const SizedBox(height: TpSpace.sm),
            _EvidenceCount(
              count: evidenceCount,
              message: evidenceCount == 0
                  ? workflowCopy('noEvidenceLinked')
                  : workflowCopy.evidenceLinked(evidenceCount),
            ),
            const SizedBox(height: TpSpace.sm),
            _DocumentRegister(
              documents: preview.documents,
              copy: workflowCopy,
            ),
          ],
        ),
      ],
    );
  }
}

class AccidentInsuranceControlSection extends ConsumerStatefulWidget {
  const AccidentInsuranceControlSection({required this.snapshot, super.key});

  final AccidentCaseSnapshot snapshot;

  @override
  ConsumerState<AccidentInsuranceControlSection> createState() =>
      _AccidentInsuranceControlSectionState();
}

class _AccidentInsuranceControlSectionState
    extends ConsumerState<AccidentInsuranceControlSection> {
  late AccidentRecoverySource _recoverySource;
  late DateTime _recoveryDate;
  late double _recoveryAmount;
  late String _recoveryReference;
  bool _financialClosureConfirmed = false;

  @override
  void initState() {
    super.initState();
    final AccidentCaseWorkflowPreview preview =
        AccidentCaseWorkflowPreview.fromSnapshot(widget.snapshot);
    _recoverySource = preview.recoverySource;
    _recoveryDate = preview.recoveryDate;
    _recoveryAmount = preview.recoveredAmount;
    _recoveryReference = preview.recoveryReference;
    final String closure =
        widget.snapshot.accident.closureStatus?.trim().toLowerCase() ?? '';
    _financialClosureConfirmed =
        closure == 'closed' || closure == 'completed' || closure == 'approved';
  }

  Future<void> _pickRecoveryDate() async {
    final DateTime? selected = await showDatePicker(
      context: context,
      initialDate: _recoveryDate,
      firstDate: DateTime(2020),
      lastDate: DateTime(2100),
    );
    if (selected == null || !mounted) return;
    setState(() => _recoveryDate = selected);
  }

  @override
  Widget build(BuildContext context) {
    final AccidentCopy copy = AccidentCopy.of(context);
    final AccidentCaseWorkflowCopy workflowCopy =
        AccidentCaseWorkflowCopy.of(context);
    final AccidentCaseWorkflowProjection projection =
        AccidentCaseWorkflowProjection(widget.snapshot);
    final AccidentCaseWorkflowPreview preview =
        AccidentCaseWorkflowPreview.fromSnapshot(widget.snapshot);
    final String? currency = ref.watch(activeCurrencyProvider);
    final int requiredDocuments = preview.documents
        .where((AccidentWorkflowPreviewDocument item) => item.required)
        .length;
    final int verifiedDocuments = preview.documents
        .where(
          (AccidentWorkflowPreviewDocument item) =>
              item.required &&
              (item.status == AccidentWorkflowPreviewStatus.verified ||
                  item.status == AccidentWorkflowPreviewStatus.complete),
        )
        .length;
    final bool packageReady = verifiedDocuments == requiredDocuments;
    return Column(
      key: AccidentCaseWorkflowKeys.insuranceControl,
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: <Widget>[
        _WorkflowPanel(
          icon: Icons.policy_outlined,
          title: workflowCopy('claimPackageTitle'),
          subtitle: workflowCopy('claimPackageHint'),
          children: <Widget>[
            _PreviewBanner(copy: workflowCopy),
            const SizedBox(height: TpSpace.sm),
            AccidentInfoRow(copy('insurer'), preview.insurer),
            AccidentInfoRow(copy('policy'), preview.policyNumber),
            AccidentInfoRow(
              workflowCopy('insurerDecision'),
              widget.snapshot.accident.claimStatus?.trim().isNotEmpty ?? false
                  ? humaniseAccidentToken(widget.snapshot.accident.claimStatus)
                  : workflowCopy('approvedForSettlement'),
            ),
            const SizedBox(height: TpSpace.sm),
            _Subheading(workflowCopy('claimCompleteness')),
            Row(
              children: <Widget>[
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: <Widget>[
                      Text(
                        workflowCopy('documentsVerified')
                            .replaceAll('%verified%', '$verifiedDocuments')
                            .replaceAll('%required%', '$requiredDocuments'),
                      ),
                      const SizedBox(height: TpSpace.xs),
                      LinearProgressIndicator(
                        value: requiredDocuments == 0
                            ? 0
                            : verifiedDocuments / requiredDocuments,
                      ),
                    ],
                  ),
                ),
                const SizedBox(width: TpSpace.sm),
                TpStatusChip(
                  status: packageReady ? TpStatus.ok : TpStatus.warning,
                  label: workflowCopy(
                    packageReady ? 'claimReady' : 'claimBlocked',
                  ),
                  isCompact: true,
                ),
              ],
            ),
            const SizedBox(height: TpSpace.sm),
            _DocumentRegister(
              documents: preview.documents.take(4).toList(growable: false),
              copy: workflowCopy,
              compact: true,
            ),
            const SizedBox(height: TpSpace.sm),
            _WorkstreamControl(
              workstream: projection.workstream('insurance'),
              provisioned: projection.provisioned,
              copy: copy,
              workflowCopy: workflowCopy,
            ),
          ],
        ),
        const SizedBox(height: TpSpace.md),
        _WorkflowPanel(
          icon: Icons.account_balance_wallet_outlined,
          title: workflowCopy('claimRecoveryTitle'),
          subtitle: workflowCopy('claimRecoveryHint'),
          children: <Widget>[
            AccidentInfoRow(
              copy('claimed'),
              _formatAmount(preview.claimAmount, currency),
            ),
            AccidentInfoRow(
              copy('approved'),
              _formatAmount(preview.approvedAmount, currency),
            ),
            AccidentInfoRow(
              copy('recovered'),
              _formatAmount(_recoveryAmount, currency),
            ),
            AccidentInfoRow(
              workflowCopy('deductible'),
              _formatAmount(preview.deductibleAmount, currency),
            ),
            AccidentInfoRow(
              workflowCopy('netClaimable'),
              _formatAmount(preview.netClaimableAmount, currency),
            ),
            AccidentInfoRow(
              workflowCopy('outstandingRecovery'),
              _formatAmount(
                (preview.approvedAmount - _recoveryAmount)
                    .clamp(0, double.infinity),
                currency,
              ),
            ),
            const SizedBox(height: TpSpace.sm),
            Material(
              type: MaterialType.transparency,
              child: SwitchListTile(
                contentPadding: EdgeInsets.zero,
                title: Text(workflowCopy('financialClosure')),
                subtitle: Text(workflowCopy('recoveryEditHint')),
                value: _financialClosureConfirmed,
                onChanged: (bool value) {
                  setState(() => _financialClosureConfirmed = value);
                },
              ),
            ),
            DropdownButtonFormField<AccidentRecoverySource>(
              initialValue: _recoverySource,
              isExpanded: true,
              decoration: InputDecoration(
                labelText: workflowCopy('recoverySource'),
              ),
              items: <DropdownMenuItem<AccidentRecoverySource>>[
                for (final AccidentRecoverySource source
                    in AccidentRecoverySource.values)
                  DropdownMenuItem<AccidentRecoverySource>(
                    value: source,
                    child: Text(workflowCopy(_recoverySourceKey(source))),
                  ),
              ],
              onChanged: _financialClosureConfirmed
                  ? (AccidentRecoverySource? value) {
                      if (value != null) {
                        setState(() => _recoverySource = value);
                      }
                    }
                  : null,
            ),
            const SizedBox(height: TpSpace.sm),
            TextFormField(
              initialValue: _recoveryReference,
              enabled: _financialClosureConfirmed,
              decoration: InputDecoration(
                labelText: workflowCopy('recoveryReference'),
              ),
              onChanged: (String value) => _recoveryReference = value,
            ),
            const SizedBox(height: TpSpace.sm),
            TextFormField(
              initialValue: _recoveryAmount.toStringAsFixed(2),
              enabled: _financialClosureConfirmed,
              keyboardType:
                  const TextInputType.numberWithOptions(decimal: true),
              decoration: InputDecoration(
                labelText: workflowCopy('recoveryAmount'),
                suffixText: currency,
              ),
              onChanged: (String value) {
                final double? parsed = double.tryParse(value);
                if (parsed != null && parsed >= 0) {
                  setState(() => _recoveryAmount = parsed);
                }
              },
            ),
            const SizedBox(height: TpSpace.sm),
            Material(
              type: MaterialType.transparency,
              child: ListTile(
                contentPadding: EdgeInsets.zero,
                leading: const Icon(Icons.event_outlined),
                title: Text(workflowCopy('recoveryDate')),
                subtitle: Text(
                  formatAccidentIncidentDate(
                    context,
                    _recoveryDate.toIso8601String(),
                  ),
                ),
                trailing: const Icon(Icons.edit_calendar_outlined),
                enabled: _financialClosureConfirmed,
                onTap: _financialClosureConfirmed
                    ? () => unawaited(_pickRecoveryDate())
                    : null,
              ),
            ),
            const SizedBox(height: TpSpace.sm),
            _WorkstreamControl(
              workstream: projection.workstream('finance'),
              provisioned: projection.provisioned,
              copy: copy,
              workflowCopy: workflowCopy,
            ),
          ],
        ),
      ],
    );
  }
}

class AccidentWorkshopWorkflowSection extends ConsumerStatefulWidget {
  const AccidentWorkshopWorkflowSection({required this.snapshot, super.key});

  final AccidentCaseSnapshot snapshot;

  @override
  ConsumerState<AccidentWorkshopWorkflowSection> createState() =>
      _AccidentWorkshopWorkflowSectionState();
}

class _AccidentWorkshopWorkflowSectionState
    extends ConsumerState<AccidentWorkshopWorkflowSection> {
  late AccidentRepairRoute _route;
  late String _selectedQuoteId;
  late List<bool> _handoverChecks;
  bool _poRecorded = false;
  bool _repairStarted = false;

  @override
  void initState() {
    super.initState();
    final AccidentCaseWorkflowPreview preview =
        AccidentCaseWorkflowPreview.fromSnapshot(widget.snapshot);
    _route = preview.repairRoute;
    _selectedQuoteId = preview.quotes.first.id;
    _handoverChecks = preview.handoverChecks
        .map((AccidentWorkflowPreviewCheck item) => item.complete)
        .toList(growable: false);
  }

  @override
  Widget build(BuildContext context) {
    final AccidentCopy copy = AccidentCopy.of(context);
    final AccidentCaseWorkflowCopy workflowCopy =
        AccidentCaseWorkflowCopy.of(context);
    final AccidentCaseWorkflowProjection projection =
        AccidentCaseWorkflowProjection(widget.snapshot);
    final AccidentCaseWorkflowPreview preview =
        AccidentCaseWorkflowPreview.fromSnapshot(widget.snapshot);
    final AccidentRecord record = widget.snapshot.accident;
    final String? currency = ref.watch(activeCurrencyProvider);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: <Widget>[
        _WorkflowPanel(
          key: AccidentCaseWorkflowKeys.workshopAssessment,
          icon: Icons.fact_check_outlined,
          title: copy('wsAssessment'),
          subtitle: workflowCopy('assessmentHint'),
          children: <Widget>[
            _PreviewBanner(copy: workflowCopy),
            const SizedBox(height: TpSpace.sm),
            AccidentInfoRow(copy('damage'), record.damageDescription),
            AccidentInfoRow(
              copy('repairCost'),
              _formatAmount(preview.repairEstimate, currency),
            ),
            AccidentInfoRow(copy('workshop'), record.workshopName),
            AccidentInfoRow(
              workflowCopy('safeToMove'),
              workflowCopy(preview.safeToMove ? 'yes' : 'no'),
            ),
            AccidentInfoRow(
              workflowCopy('towingRequired'),
              workflowCopy(preview.towingRequired ? 'yes' : 'no'),
            ),
            AccidentInfoRow(
              workflowCopy('vehicleOffRoad'),
              workflowCopy(preview.vehicleOffRoad ? 'yes' : 'no'),
            ),
            AccidentInfoRow(
              workflowCopy('labourHours'),
              preview.labourHours.toStringAsFixed(1),
            ),
            AccidentInfoRow(
              workflowCopy('labourCost'),
              _formatAmount(preview.labourCost, currency),
            ),
            AccidentInfoRow(
              workflowCopy('partsAvailability'),
              workflowCopy('partsCount')
                  .replaceAll(
                    '%available%',
                    '${preview.partsAvailableCount}',
                  )
                  .replaceAll(
                    '%required%',
                    '${preview.partsRequiredCount}',
                  ),
            ),
            AccidentInfoRow(
              workflowCopy('workshopRecommendation'),
              workflowCopy(_repairRouteKey(_route)),
            ),
            _WorkstreamControl(
              workstream: projection.workstream('assessment'),
              provisioned: projection.provisioned,
              copy: copy,
              workflowCopy: workflowCopy,
            ),
          ],
        ),
        const SizedBox(height: TpSpace.md),
        _WorkflowPanel(
          key: AccidentCaseWorkflowKeys.repairPlanning,
          icon: Icons.handyman_outlined,
          title: workflowCopy('repairPlanTitle'),
          subtitle: workflowCopy('repairPlanHint'),
          children: <Widget>[
            _PreviewBanner(copy: workflowCopy),
            const SizedBox(height: TpSpace.sm),
            AccidentInfoRow(copy('repairType'), record.repairType),
            AccidentInfoRow(copy('workshop'), record.workshopName),
            AccidentInfoRow(copy('nextAction'), record.nextStep),
            AccidentInfoRow(
              copy('expectedRelease'),
              record.expectedReleaseDate,
            ),
            AccidentInfoRow(copy('actualRelease'), record.releaseDate),
            const SizedBox(height: TpSpace.sm),
            _Subheading(workflowCopy('repairRouteDecision')),
            Wrap(
              spacing: TpSpace.sm,
              runSpacing: TpSpace.sm,
              children: <Widget>[
                for (final AccidentRepairRoute option
                    in AccidentRepairRoute.values)
                  ChoiceChip(
                    label: Text(workflowCopy(_repairRouteKey(option))),
                    selected: _route == option,
                    onSelected: (bool selected) {
                      if (!selected) return;
                      setState(() => _route = option);
                    },
                  ),
              ],
            ),
            const SizedBox(height: TpSpace.md),
            _Subheading(workflowCopy('externalRepairFlow')),
            Text(
              workflowCopy('externalRepairFlowHint'),
              style: Theme.of(context).textTheme.bodySmall,
            ),
            const SizedBox(height: TpSpace.sm),
            _RepairMilestoneList(
              milestones: preview.repairMilestones,
              poRecorded: _poRecorded,
              repairStarted: _repairStarted,
              copy: workflowCopy,
            ),
            const SizedBox(height: TpSpace.md),
            _Subheading(workflowCopy('quotationRegister')),
            _QuotationRegister(
              quotes: preview.quotes,
              selectedQuoteId: _selectedQuoteId,
              currency: currency,
              copy: workflowCopy,
              onSelected: (String value) {
                setState(() => _selectedQuoteId = value);
              },
            ),
            const SizedBox(height: TpSpace.md),
            _Subheading(workflowCopy('purchaseOrderControl')),
            _PurchaseOrderCard(
              purchaseOrder: preview.purchaseOrder,
              poRecorded: _poRecorded,
              currency: currency,
              copy: workflowCopy,
            ),
            const SizedBox(height: TpSpace.md),
            TpButton.primary(
              label: workflowCopy(
                _poRecorded ? 'startRepairLocally' : 'recordPoRepairStart',
              ),
              icon: _poRecorded
                  ? Icons.play_circle_outline
                  : Icons.receipt_long_outlined,
              onPressed: _repairStarted
                  ? null
                  : () {
                      final bool recordingPo = !_poRecorded;
                      setState(() {
                        if (recordingPo) {
                          _poRecorded = true;
                        } else {
                          _repairStarted = true;
                        }
                      });
                      ScaffoldMessenger.of(context).showSnackBar(
                        SnackBar(
                          content: Text(
                            workflowCopy(
                              recordingPo
                                  ? 'poRecordedLocal'
                                  : 'repairStartedLocal',
                            ),
                          ),
                        ),
                      );
                    },
              isFullWidth: true,
            ),
            const SizedBox(height: TpSpace.md),
            _WorkstreamControl(
              workstream: projection.workstream('repair'),
              provisioned: projection.provisioned,
              copy: copy,
              workflowCopy: workflowCopy,
            ),
          ],
        ),
        const SizedBox(height: TpSpace.md),
        _WorkflowPanel(
          key: AccidentCaseWorkflowKeys.handover,
          icon: Icons.assignment_turned_in_outlined,
          title: workflowCopy('handoverTitle'),
          subtitle: workflowCopy('handoverHint'),
          children: <Widget>[
            _PreviewBanner(copy: workflowCopy),
            const SizedBox(height: TpSpace.sm),
            AccidentInfoRow(
              copy('expectedRelease'),
              record.expectedReleaseDate,
            ),
            AccidentInfoRow(copy('actualRelease'), record.releaseDate),
            AccidentInfoRow(
              workflowCopy('receiptNumber'),
              'HND-DRAFT-${record.reference}',
            ),
            const SizedBox(height: TpSpace.sm),
            _Subheading(workflowCopy('handoverChecklist')),
            Text(
              workflowCopy('toggleChecklistHint'),
              style: Theme.of(context).textTheme.bodySmall,
            ),
            const SizedBox(height: TpSpace.xs),
            for (int index = 0; index < preview.handoverChecks.length; index++)
              Material(
                type: MaterialType.transparency,
                child: CheckboxListTile(
                  contentPadding: EdgeInsets.zero,
                  dense: true,
                  controlAffinity: ListTileControlAffinity.leading,
                  value: _handoverChecks[index],
                  title: Text(
                    workflowCopy(preview.handoverChecks[index].labelKey),
                  ),
                  onChanged: (bool? value) {
                    setState(() => _handoverChecks[index] = value ?? false);
                  },
                ),
              ),
            const SizedBox(height: TpSpace.sm),
            _SignaturePair(
              workshopSigned: true,
              fleetSigned: _handoverChecks.last,
              copy: workflowCopy,
            ),
            const SizedBox(height: TpSpace.md),
            _WorkstreamControl(
              workstream: projection.workstream('workshop_qc'),
              provisioned: projection.provisioned,
              copy: copy,
              workflowCopy: workflowCopy,
            ),
            const SizedBox(height: TpSpace.sm),
            _WorkstreamControl(
              workstream: projection.workstream('handover'),
              provisioned: projection.provisioned,
              copy: copy,
              workflowCopy: workflowCopy,
            ),
          ],
        ),
      ],
    );
  }
}

class AccidentCaseOperationsSection extends ConsumerWidget {
  const AccidentCaseOperationsSection({required this.snapshot, super.key});

  final AccidentCaseSnapshot snapshot;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final AccidentCopy copy = AccidentCopy.of(context);
    final AccidentCaseWorkflowCopy workflowCopy =
        AccidentCaseWorkflowCopy.of(context);
    final AccidentCaseWorkflowProjection projection =
        AccidentCaseWorkflowProjection(snapshot);
    final AccidentCaseWorkflowPreview preview =
        AccidentCaseWorkflowPreview.fromSnapshot(snapshot);
    final String userId =
        ref.watch(workspaceContextProvider)?.userId.trim() ?? '';
    final AsyncValue<List<AppNotification>>? inbox =
        userId.isEmpty ? null : ref.watch(notificationsInboxProvider);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: <Widget>[
        _SlaOwnerPanel(
          projection: projection,
          preview: preview,
          copy: copy,
          workflowCopy: workflowCopy,
        ),
        const SizedBox(height: TpSpace.md),
        _WorkflowTimelinePanel(
          projection: projection,
          preview: preview,
          copy: copy,
          workflowCopy: workflowCopy,
        ),
        const SizedBox(height: TpSpace.md),
        _NotificationsPanel(
          accidentId: snapshot.accident.id,
          deliveries: preview.deliveries,
          inbox: inbox,
          copy: copy,
          workflowCopy: workflowCopy,
          onRetry: inbox == null
              ? null
              : () => ref.invalidate(notificationsInboxProvider),
        ),
      ],
    );
  }
}

class _SlaOwnerPanel extends StatelessWidget {
  const _SlaOwnerPanel({
    required this.projection,
    required this.preview,
    required this.copy,
    required this.workflowCopy,
  });

  final AccidentCaseWorkflowProjection projection;
  final AccidentCaseWorkflowPreview preview;
  final AccidentCopy copy;
  final AccidentCaseWorkflowCopy workflowCopy;

  @override
  Widget build(BuildContext context) {
    final AccidentWorkstream? active = projection.activeWorkstream;
    final String owner = <String?>[active?.team, active?.ownerRole]
        .whereType<String>()
        .where((String value) => value.trim().isNotEmpty)
        .join(' / ');
    final double? completion = projection.recordedCompletionPercent;
    return _WorkflowPanel(
      key: AccidentCaseWorkflowKeys.sla,
      icon: Icons.timer_outlined,
      title: workflowCopy('slaTitle'),
      subtitle: workflowCopy('slaHint'),
      children: <Widget>[
        _PreviewBanner(copy: workflowCopy),
        const SizedBox(height: TpSpace.sm),
        AccidentInfoRow(
          workflowCopy('currentOwner'),
          owner.isEmpty ? workflowCopy('noActiveOwner') : owner,
        ),
        AccidentInfoRow(copy('nextAction'), projection.accident.nextStep),
        AccidentInfoRow(
          workflowCopy('routeCompletion'),
          completion == null
              ? workflowCopy('routeCompletionUnavailable')
              : '${completion.round()}%',
        ),
        const SizedBox(height: TpSpace.sm),
        _Subheading(workflowCopy('assignedActors')),
        _ActorRegister(actors: preview.actors, copy: workflowCopy),
        const SizedBox(height: TpSpace.sm),
        _Subheading(workflowCopy('slaRegister')),
        for (final AccidentWorkflowPreviewSla item in preview.slaItems)
          _SlaRow(item: item, copy: workflowCopy),
        const SizedBox(height: TpSpace.sm),
        _Subheading(workflowCopy('recipientGroups')),
        Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: <Widget>[
            _RecipientGroupChip(
              label: workflowCopy('fleetAndHseRecipients'),
            ),
            const SizedBox(height: TpSpace.xs),
            _RecipientGroupChip(
              label: workflowCopy('insuranceRecipients'),
            ),
            const SizedBox(height: TpSpace.xs),
            _RecipientGroupChip(
              label: workflowCopy('repairApprovalRecipients'),
            ),
          ],
        ),
      ],
    );
  }
}

class _RecipientGroupChip extends StatelessWidget {
  const _RecipientGroupChip({required this.label});

  final String label;

  @override
  Widget build(BuildContext context) {
    final TpStatusColors colors =
        TpPalette.of(context).forStatus(TpStatus.neutral);
    return DecoratedBox(
      decoration: BoxDecoration(
        color: colors.soft,
        borderRadius: BorderRadius.circular(TpRadius.md),
        border: Border.all(color: colors.base),
      ),
      child: Padding(
        padding: const EdgeInsets.symmetric(
          horizontal: TpSpace.sm,
          vertical: TpSpace.xs,
        ),
        child: Text(
          label,
          style: Theme.of(context)
              .textTheme
              .labelMedium
              ?.copyWith(color: colors.onSoft),
        ),
      ),
    );
  }
}

class _WorkflowTimelinePanel extends StatelessWidget {
  const _WorkflowTimelinePanel({
    required this.projection,
    required this.preview,
    required this.copy,
    required this.workflowCopy,
  });

  final AccidentCaseWorkflowProjection projection;
  final AccidentCaseWorkflowPreview preview;
  final AccidentCopy copy;
  final AccidentCaseWorkflowCopy workflowCopy;

  @override
  Widget build(BuildContext context) {
    final List<AccidentWorkstream> updates = projection.datedUpdates;
    return _WorkflowPanel(
      key: AccidentCaseWorkflowKeys.timeline,
      icon: Icons.timeline_outlined,
      title: workflowCopy('timelineTitle'),
      subtitle: workflowCopy('timelineHint'),
      children: <Widget>[
        _PreviewBanner(copy: workflowCopy),
        const SizedBox(height: TpSpace.sm),
        for (int index = 0; index < preview.timeline.length; index++)
          _PreviewTimelineRow(
            entry: preview.timeline[index],
            copy: workflowCopy,
            showConnector: index < preview.timeline.length - 1,
          ),
        if (updates.isNotEmpty) ...<Widget>[
          const SizedBox(height: TpSpace.sm),
          _Subheading(copy('timeline')),
          for (int index = 0; index < updates.length; index++)
            _TimelineRow(
              workstream: updates[index],
              copy: copy,
              showConnector: index < updates.length - 1,
            ),
        ],
      ],
    );
  }
}

class _NotificationsPanel extends StatelessWidget {
  const _NotificationsPanel({
    required this.accidentId,
    required this.deliveries,
    required this.inbox,
    required this.copy,
    required this.workflowCopy,
    required this.onRetry,
  });

  final String accidentId;
  final List<AccidentWorkflowPreviewDelivery> deliveries;
  final AsyncValue<List<AppNotification>>? inbox;
  final AccidentCopy copy;
  final AccidentCaseWorkflowCopy workflowCopy;
  final VoidCallback? onRetry;

  @override
  Widget build(BuildContext context) => _WorkflowPanel(
        key: AccidentCaseWorkflowKeys.notifications,
        icon: Icons.mark_email_unread_outlined,
        title: workflowCopy('notificationsTitle'),
        subtitle: workflowCopy('notificationsHint'),
        children: <Widget>[
          _PreviewBanner(copy: workflowCopy),
          const SizedBox(height: TpSpace.sm),
          _Subheading(workflowCopy('deliveryLog')),
          for (final AccidentWorkflowPreviewDelivery delivery in deliveries)
            _DeliveryRow(delivery: delivery, copy: workflowCopy),
          const SizedBox(height: TpSpace.md),
          _Subheading(workflowCopy('notificationsTitle')),
          if (inbox == null)
            _InlineEmpty(
              icon: Icons.person_off_outlined,
              message: workflowCopy('notificationsNoWorkspace'),
            )
          else
            inbox!.when(
              data: (List<AppNotification> notifications) {
                final List<AppNotification> related = notifications
                    .where(
                      (AppNotification notification) =>
                          _belongsToAccident(notification, accidentId),
                    )
                    .take(5)
                    .toList(growable: false);
                if (related.isEmpty) {
                  return _InlineEmpty(
                    icon: Icons.notifications_none_outlined,
                    message: workflowCopy('notificationsEmpty'),
                  );
                }
                return Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: <Widget>[
                    Text(
                      workflowCopy.notificationCount(related.length),
                      style: Theme.of(context).textTheme.labelMedium?.copyWith(
                            color: TpPalette.of(context).textSecondary,
                            fontWeight: FontWeight.w700,
                          ),
                    ),
                    const SizedBox(height: TpSpace.xs),
                    for (final AppNotification notification in related)
                      _NotificationRow(
                        notification: notification,
                        copy: copy,
                        workflowCopy: workflowCopy,
                      ),
                  ],
                );
              },
              loading: () => _InlineLoading(
                message: workflowCopy('notificationsLoading'),
              ),
              error: (Object error, StackTrace stackTrace) => _InlineError(
                message: workflowCopy('notificationsFailed'),
                onRetry: onRetry,
              ),
            ),
        ],
      );

  static bool _belongsToAccident(
    AppNotification notification,
    String accidentId,
  ) {
    if (notification.entityId?.trim() != accidentId.trim()) return false;
    final String type =
        (notification.entityType ?? notification.type ?? '').toLowerCase();
    return type.isEmpty ||
        type.contains('accident') ||
        type.contains('incident') ||
        type.contains('claim');
  }
}

class _PreviewBanner extends StatelessWidget {
  const _PreviewBanner({required this.copy});

  final AccidentCaseWorkflowCopy copy;

  @override
  Widget build(BuildContext context) {
    final TpStatusColors colors = TpPalette.of(context).info;
    return DecoratedBox(
      decoration: BoxDecoration(
        color: colors.soft,
        borderRadius: BorderRadius.circular(TpRadius.md),
        border: Border.all(color: colors.base),
      ),
      child: Padding(
        padding: const EdgeInsets.all(TpSpace.sm),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            Icon(Icons.smartphone_outlined, color: colors.onSoft),
            const SizedBox(width: TpSpace.sm),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: <Widget>[
                  Text(
                    copy('localPreviewTitle'),
                    style: Theme.of(context).textTheme.labelLarge?.copyWith(
                          color: colors.onSoft,
                          fontWeight: FontWeight.w800,
                        ),
                  ),
                  const SizedBox(height: TpSpace.xs),
                  Text(
                    copy('localPreviewMessage'),
                    style: Theme.of(context).textTheme.bodySmall?.copyWith(
                          color: colors.onSoft,
                        ),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _DocumentRegister extends StatelessWidget {
  const _DocumentRegister({
    required this.documents,
    required this.copy,
    this.compact = false,
  });

  final List<AccidentWorkflowPreviewDocument> documents;
  final AccidentCaseWorkflowCopy copy;
  final bool compact;

  @override
  Widget build(BuildContext context) => Column(
        children: <Widget>[
          for (final AccidentWorkflowPreviewDocument document in documents)
            Padding(
              padding: const EdgeInsets.symmetric(vertical: TpSpace.xs),
              child: DecoratedBox(
                decoration: BoxDecoration(
                  color: TpPalette.of(context).surfaceAlt,
                  borderRadius: BorderRadius.circular(TpRadius.sm),
                  border: Border.all(color: TpPalette.of(context).border),
                ),
                child: Padding(
                  padding: const EdgeInsets.all(TpSpace.sm),
                  child: Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: <Widget>[
                      Icon(
                        Icons.description_outlined,
                        size: TpSizing.iconMd,
                        color: TpPalette.of(context).primary,
                      ),
                      const SizedBox(width: TpSpace.sm),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: <Widget>[
                            Text(
                              copy(document.labelKey),
                              style: Theme.of(context)
                                  .textTheme
                                  .bodyMedium
                                  ?.copyWith(fontWeight: FontWeight.w700),
                            ),
                            Text(
                              document.reference,
                              style: Theme.of(context).textTheme.bodySmall,
                            ),
                            Text(
                              '${copy('uploadedBy')}: ${document.uploadedBy}  •  '
                              '${copy(document.required ? 'mandatory' : 'optional')}',
                              style: Theme.of(context).textTheme.bodySmall,
                            ),
                            if (!compact)
                              Text(
                                formatAccidentIncidentDate(
                                  context,
                                  document.updatedAt.toIso8601String(),
                                  includeTime: true,
                                ),
                                style: Theme.of(context).textTheme.bodySmall,
                              ),
                          ],
                        ),
                      ),
                      const SizedBox(width: TpSpace.sm),
                      TpStatusChip(
                        status: _previewTone(document.status),
                        label: copy(_previewStatusKey(document.status)),
                        isCompact: true,
                      ),
                    ],
                  ),
                ),
              ),
            ),
        ],
      );
}

class _RepairMilestoneList extends StatelessWidget {
  const _RepairMilestoneList({
    required this.milestones,
    required this.poRecorded,
    required this.repairStarted,
    required this.copy,
  });

  final List<AccidentWorkflowPreviewRepairMilestone> milestones;
  final bool poRecorded;
  final bool repairStarted;
  final AccidentCaseWorkflowCopy copy;

  @override
  Widget build(BuildContext context) => Column(
        children: <Widget>[
          for (int index = 0; index < milestones.length; index++)
            Builder(
              builder: (BuildContext context) {
                final AccidentWorkflowPreviewRepairMilestone item =
                    milestones[index];
                final bool locallyCompleted =
                    (poRecorded && index == 4) || (repairStarted && index == 5);
                final AccidentWorkflowPreviewStatus status = locallyCompleted
                    ? AccidentWorkflowPreviewStatus.complete
                    : item.status;
                return Padding(
                  padding: const EdgeInsets.symmetric(vertical: TpSpace.xs),
                  child: Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: <Widget>[
                      Icon(
                        status == AccidentWorkflowPreviewStatus.complete
                            ? Icons.check_circle_rounded
                            : Icons.radio_button_checked_rounded,
                        size: TpSizing.iconMd,
                        color: TpPalette.of(context)
                            .forStatus(_previewTone(status))
                            .base,
                      ),
                      const SizedBox(width: TpSpace.sm),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: <Widget>[
                            Text(
                              copy(item.titleKey),
                              style: Theme.of(context)
                                  .textTheme
                                  .bodyMedium
                                  ?.copyWith(fontWeight: FontWeight.w700),
                            ),
                            Text(
                              copy(item.ownerKey),
                              style: Theme.of(context).textTheme.bodySmall,
                            ),
                            if (item.occurredAt != null)
                              Text(
                                formatAccidentIncidentDate(
                                  context,
                                  item.occurredAt!.toIso8601String(),
                                  includeTime: true,
                                ),
                                style: Theme.of(context).textTheme.bodySmall,
                              ),
                          ],
                        ),
                      ),
                      const SizedBox(width: TpSpace.sm),
                      TpStatusChip(
                        status: _previewTone(status),
                        label: copy(_previewStatusKey(status)),
                        isCompact: true,
                      ),
                    ],
                  ),
                );
              },
            ),
        ],
      );
}

class _QuotationRegister extends StatelessWidget {
  const _QuotationRegister({
    required this.quotes,
    required this.selectedQuoteId,
    required this.currency,
    required this.copy,
    required this.onSelected,
  });

  final List<AccidentWorkflowPreviewQuote> quotes;
  final String selectedQuoteId;
  final String? currency;
  final AccidentCaseWorkflowCopy copy;
  final ValueChanged<String> onSelected;

  @override
  Widget build(BuildContext context) => Column(
        children: <Widget>[
          for (final AccidentWorkflowPreviewQuote quote in quotes)
            Padding(
              padding: const EdgeInsets.symmetric(vertical: TpSpace.xs),
              child: DecoratedBox(
                decoration: BoxDecoration(
                  color: quote.id == selectedQuoteId
                      ? TpPalette.of(context).primarySoft
                      : TpPalette.of(context).surfaceAlt,
                  borderRadius: BorderRadius.circular(TpRadius.sm),
                  border: Border.all(
                    color: quote.id == selectedQuoteId
                        ? TpPalette.of(context).primary
                        : TpPalette.of(context).border,
                  ),
                ),
                child: Material(
                  type: MaterialType.transparency,
                  child: ListTile(
                    onTap: () => onSelected(quote.id),
                    contentPadding: const EdgeInsets.symmetric(
                      horizontal: TpSpace.sm,
                    ),
                    leading: Icon(
                      quote.id == selectedQuoteId
                          ? Icons.radio_button_checked
                          : Icons.radio_button_unchecked,
                      color: TpPalette.of(context).primary,
                    ),
                    title: Text(copy(quote.vendorKey)),
                    subtitle: Text(
                      '${quote.id}  |  ${_formatAmount(quote.amount, currency)}  |  '
                      '${quote.turnaroundDays} ${copy('days')}',
                    ),
                    trailing: quote.id == selectedQuoteId
                        ? TpStatusChip(
                            status: TpStatus.ok,
                            label: copy('selected'),
                            isCompact: true,
                          )
                        : null,
                  ),
                ),
              ),
            ),
        ],
      );
}

class _PurchaseOrderCard extends StatelessWidget {
  const _PurchaseOrderCard({
    required this.purchaseOrder,
    required this.poRecorded,
    required this.currency,
    required this.copy,
  });

  final AccidentWorkflowPreviewPurchaseOrder purchaseOrder;
  final bool poRecorded;
  final String? currency;
  final AccidentCaseWorkflowCopy copy;

  @override
  Widget build(BuildContext context) {
    final AccidentWorkflowPreviewStatus status = poRecorded
        ? AccidentWorkflowPreviewStatus.complete
        : purchaseOrder.status;
    return DecoratedBox(
      decoration: BoxDecoration(
        color: TpPalette.of(context).surfaceAlt,
        borderRadius: BorderRadius.circular(TpRadius.md),
        border: Border.all(color: TpPalette.of(context).border),
      ),
      child: Padding(
        padding: const EdgeInsets.all(TpSpace.md),
        child: Column(
          children: <Widget>[
            AccidentInfoRow(copy('poReference'), purchaseOrder.reference),
            AccidentInfoRow(
              copy('amount'),
              _formatAmount(purchaseOrder.amount, currency),
            ),
            AccidentInfoRow(copy('poOwner'), copy(purchaseOrder.ownerKey)),
            Align(
              alignment: AlignmentDirectional.centerEnd,
              child: TpStatusChip(
                status: _previewTone(status),
                label: copy(_previewStatusKey(status)),
                isCompact: true,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _SignaturePair extends StatelessWidget {
  const _SignaturePair({
    required this.workshopSigned,
    required this.fleetSigned,
    required this.copy,
  });

  final bool workshopSigned;
  final bool fleetSigned;
  final AccidentCaseWorkflowCopy copy;

  @override
  Widget build(BuildContext context) => Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Expanded(
            child: _SignatureCard(
              label: copy('workshopSignature'),
              signed: workshopSigned,
              copy: copy,
            ),
          ),
          const SizedBox(width: TpSpace.sm),
          Expanded(
            child: _SignatureCard(
              label: copy('fleetSignature'),
              signed: fleetSigned,
              copy: copy,
            ),
          ),
        ],
      );
}

class _SignatureCard extends StatelessWidget {
  const _SignatureCard({
    required this.label,
    required this.signed,
    required this.copy,
  });

  final String label;
  final bool signed;
  final AccidentCaseWorkflowCopy copy;

  @override
  Widget build(BuildContext context) => TpCard(
        isDashed: !signed,
        padding: const EdgeInsets.all(TpSpace.sm),
        child: Column(
          children: <Widget>[
            Icon(
              signed ? Icons.draw_rounded : Icons.pending_actions_outlined,
              color: TpPalette.of(context)
                  .forStatus(signed ? TpStatus.ok : TpStatus.unknown)
                  .base,
            ),
            const SizedBox(height: TpSpace.xs),
            Text(
              label,
              textAlign: TextAlign.center,
              style: Theme.of(context).textTheme.labelMedium,
            ),
            const SizedBox(height: TpSpace.xs),
            Text(
              signed ? copy('statusSigned') : copy('pendingSignature'),
              textAlign: TextAlign.center,
              style: Theme.of(context).textTheme.bodySmall,
            ),
          ],
        ),
      );
}

class _ActorRegister extends StatelessWidget {
  const _ActorRegister({required this.actors, required this.copy});

  final List<AccidentWorkflowPreviewActor> actors;
  final AccidentCaseWorkflowCopy copy;

  @override
  Widget build(BuildContext context) => Column(
        children: <Widget>[
          for (final AccidentWorkflowPreviewActor actor in actors)
            Padding(
              padding: const EdgeInsets.symmetric(vertical: TpSpace.xs),
              child: DecoratedBox(
                decoration: BoxDecoration(
                  color: TpPalette.of(context).surfaceAlt,
                  borderRadius: BorderRadius.circular(TpRadius.sm),
                  border: Border.all(color: TpPalette.of(context).border),
                ),
                child: Material(
                  type: MaterialType.transparency,
                  child: ListTile(
                    contentPadding: const EdgeInsets.symmetric(
                      horizontal: TpSpace.sm,
                    ),
                    leading: CircleAvatar(
                      backgroundColor: TpPalette.of(context).primarySoft,
                      foregroundColor: TpPalette.of(context).primary,
                      child: Text(_actorInitials(actor.name)),
                    ),
                    title: Text(
                      actor.name,
                      style: Theme.of(context)
                          .textTheme
                          .bodyMedium
                          ?.copyWith(fontWeight: FontWeight.w800),
                    ),
                    subtitle: Text(
                      '${copy(actor.roleKey)}\n${copy(actor.actionKey)}',
                    ),
                    trailing: TpStatusChip(
                      status: _previewTone(actor.status),
                      label: copy(_previewStatusKey(actor.status)),
                      isCompact: true,
                    ),
                  ),
                ),
              ),
            ),
        ],
      );
}

class _SlaRow extends StatelessWidget {
  const _SlaRow({required this.item, required this.copy});

  final AccidentWorkflowPreviewSla item;
  final AccidentCaseWorkflowCopy copy;

  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.symmetric(vertical: TpSpace.xs),
        child: DecoratedBox(
          decoration: BoxDecoration(
            color: TpPalette.of(context).surfaceAlt,
            borderRadius: BorderRadius.circular(TpRadius.sm),
            border: Border.all(color: TpPalette.of(context).border),
          ),
          child: Padding(
            padding: const EdgeInsets.all(TpSpace.sm),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                Icon(
                  Icons.timer_outlined,
                  size: TpSizing.iconMd,
                  color: TpPalette.of(context)
                      .forStatus(_previewTone(item.status))
                      .base,
                ),
                const SizedBox(width: TpSpace.sm),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: <Widget>[
                      Text(
                        copy(item.activityKey),
                        style: Theme.of(context)
                            .textTheme
                            .bodyMedium
                            ?.copyWith(fontWeight: FontWeight.w700),
                      ),
                      Text(
                        '${copy(item.targetKey)} • ${copy(item.ownerKey)}',
                        style: Theme.of(context).textTheme.bodySmall,
                      ),
                      Text(
                        formatAccidentIncidentDate(
                          context,
                          item.dueAt.toIso8601String(),
                          includeTime: true,
                        ),
                        style: Theme.of(context).textTheme.bodySmall,
                      ),
                    ],
                  ),
                ),
                const SizedBox(width: TpSpace.sm),
                TpStatusChip(
                  status: _previewTone(item.status),
                  label: copy(_previewStatusKey(item.status)),
                  isCompact: true,
                ),
              ],
            ),
          ),
        ),
      );
}

class _PreviewTimelineRow extends StatelessWidget {
  const _PreviewTimelineRow({
    required this.entry,
    required this.copy,
    required this.showConnector,
  });

  final AccidentWorkflowPreviewTimelineEntry entry;
  final AccidentCaseWorkflowCopy copy;
  final bool showConnector;

  @override
  Widget build(BuildContext context) => IntrinsicHeight(
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: <Widget>[
            SizedBox(
              width: TpSizing.iconLg,
              child: Column(
                children: <Widget>[
                  Icon(
                    Icons.circle,
                    size: TpSizing.iconSm,
                    color: TpPalette.of(context)
                        .forStatus(_previewTone(entry.status))
                        .base,
                  ),
                  if (showConnector)
                    Expanded(
                      child: Container(
                        width: TpBorderWidth.strong,
                        color: TpPalette.of(context).borderStrong,
                      ),
                    ),
                ],
              ),
            ),
            const SizedBox(width: TpSpace.sm),
            Expanded(
              child: Padding(
                padding: const EdgeInsets.only(bottom: TpSpace.md),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: <Widget>[
                    Text(
                      copy(entry.titleKey),
                      style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                            fontWeight: FontWeight.w700,
                          ),
                    ),
                    Text(
                      copy(entry.detailKey),
                      style: Theme.of(context).textTheme.bodySmall,
                    ),
                    Text(
                      formatAccidentIncidentDate(
                        context,
                        entry.occurredAt.toIso8601String(),
                        includeTime: true,
                      ),
                      style: Theme.of(context).textTheme.bodySmall,
                    ),
                  ],
                ),
              ),
            ),
            const SizedBox(width: TpSpace.sm),
            TpStatusChip(
              status: _previewTone(entry.status),
              label: copy(_previewStatusKey(entry.status)),
              isCompact: true,
            ),
          ],
        ),
      );
}

class _DeliveryRow extends StatelessWidget {
  const _DeliveryRow({required this.delivery, required this.copy});

  final AccidentWorkflowPreviewDelivery delivery;
  final AccidentCaseWorkflowCopy copy;

  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.symmetric(vertical: TpSpace.xs),
        child: DecoratedBox(
          decoration: BoxDecoration(
            color: TpPalette.of(context).surfaceAlt,
            borderRadius: BorderRadius.circular(TpRadius.sm),
            border: Border.all(color: TpPalette.of(context).border),
          ),
          child: Padding(
            padding: const EdgeInsets.all(TpSpace.sm),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                Icon(
                  Icons.outgoing_mail,
                  size: TpSizing.iconMd,
                  color: TpPalette.of(context).primary,
                ),
                const SizedBox(width: TpSpace.sm),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: <Widget>[
                      Text(
                        copy(delivery.subjectKey),
                        style: Theme.of(context)
                            .textTheme
                            .bodyMedium
                            ?.copyWith(fontWeight: FontWeight.w700),
                      ),
                      Text(
                        copy(delivery.recipientKey),
                        style: Theme.of(context).textTheme.bodySmall,
                      ),
                      Text(
                        '${copy(delivery.channelKey)} • '
                        '${formatAccidentIncidentDate(context, delivery.createdAt.toIso8601String(), includeTime: true)}',
                        style: Theme.of(context).textTheme.bodySmall,
                      ),
                    ],
                  ),
                ),
                const SizedBox(width: TpSpace.sm),
                TpStatusChip(
                  status: _previewTone(delivery.status),
                  label: copy(_previewStatusKey(delivery.status)),
                  isCompact: true,
                ),
              ],
            ),
          ),
        ),
      );
}

class _WorkflowPanel extends StatelessWidget {
  const _WorkflowPanel({
    required this.icon,
    required this.title,
    required this.children,
    this.subtitle,
    super.key,
  });

  final IconData icon;
  final String title;
  final String? subtitle;
  final List<Widget> children;

  @override
  Widget build(BuildContext context) {
    final TpPalette palette = TpPalette.of(context);
    return TpCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: <Widget>[
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: <Widget>[
              DecoratedBox(
                decoration: BoxDecoration(
                  color: palette.primarySoft,
                  borderRadius: BorderRadius.circular(TpRadius.sm),
                ),
                child: Padding(
                  padding: const EdgeInsets.all(TpSpace.sm),
                  child:
                      Icon(icon, size: TpSizing.iconMd, color: palette.primary),
                ),
              ),
              const SizedBox(width: TpSpace.sm),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: <Widget>[
                    Text(
                      title,
                      style: Theme.of(context).textTheme.titleMedium?.copyWith(
                            fontWeight: FontWeight.w800,
                          ),
                    ),
                    if (subtitle != null) ...<Widget>[
                      const SizedBox(height: TpSpace.xs),
                      Text(
                        subtitle!,
                        style: Theme.of(context).textTheme.bodySmall,
                      ),
                    ],
                  ],
                ),
              ),
            ],
          ),
          const SizedBox(height: TpSpace.md),
          Divider(height: 1, color: palette.border),
          const SizedBox(height: TpSpace.sm),
          ...children,
        ],
      ),
    );
  }
}

class _Subheading extends StatelessWidget {
  const _Subheading(this.label);

  final String label;

  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.only(bottom: TpSpace.xs),
        child: Text(
          label.toUpperCase(),
          style: Theme.of(context).textTheme.labelSmall?.copyWith(
                color: TpPalette.of(context).textSecondary,
                fontWeight: FontWeight.w800,
                letterSpacing: 0.4,
              ),
        ),
      );
}

class _RecordedFact extends StatelessWidget {
  const _RecordedFact({
    required this.label,
    required this.value,
    required this.copy,
    required this.workflowCopy,
  });

  final String label;
  final Object? value;
  final AccidentCopy copy;
  final AccidentCaseWorkflowCopy workflowCopy;

  @override
  Widget build(BuildContext context) {
    final String shown = value?.toString().trim() ?? '';
    final bool recorded = shown.isNotEmpty;
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: TpSpace.xs),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Icon(
            recorded ? Icons.check_circle_outline : Icons.remove_circle_outline,
            size: TpSizing.iconMd,
            color: TpPalette.of(context)
                .forStatus(recorded ? TpStatus.info : TpStatus.unknown)
                .base,
          ),
          const SizedBox(width: TpSpace.sm),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                Text(label, style: Theme.of(context).textTheme.labelMedium),
                Text(
                  recorded ? shown : copy('notRecorded'),
                  style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                        fontWeight: FontWeight.w600,
                      ),
                ),
              ],
            ),
          ),
          const SizedBox(width: TpSpace.sm),
          TpStatusChip(
            status: recorded ? TpStatus.info : TpStatus.unknown,
            label: workflowCopy(recorded ? 'recorded' : 'missing'),
            isCompact: true,
          ),
        ],
      ),
    );
  }
}

class _WorkstreamControl extends StatelessWidget {
  const _WorkstreamControl({
    required this.workstream,
    required this.provisioned,
    required this.copy,
    required this.workflowCopy,
  });

  final AccidentWorkstream? workstream;
  final bool provisioned;
  final AccidentCopy copy;
  final AccidentCaseWorkflowCopy workflowCopy;

  @override
  Widget build(BuildContext context) {
    final AccidentWorkstream? item = workstream;
    if (!provisioned || item == null) {
      return DecoratedBox(
        decoration: BoxDecoration(
          color: TpPalette.of(context).surfaceAlt,
          borderRadius: BorderRadius.circular(TpRadius.md),
          border: Border.all(color: TpPalette.of(context).border),
        ),
        child: Padding(
          padding: const EdgeInsets.all(TpSpace.md),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: <Widget>[
              Icon(
                Icons.account_tree_outlined,
                size: TpSizing.iconMd,
                color: TpPalette.of(context).primary,
              ),
              const SizedBox(width: TpSpace.sm),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: <Widget>[
                    Text(
                      workflowCopy('localPreviewTitle'),
                      style: Theme.of(context).textTheme.labelLarge?.copyWith(
                            fontWeight: FontWeight.w800,
                          ),
                    ),
                    const SizedBox(height: TpSpace.xs),
                    Text(
                      workflowCopy('localPreviewMessage'),
                      style: Theme.of(context).textTheme.bodySmall,
                    ),
                  ],
                ),
              ),
              const SizedBox(width: TpSpace.sm),
              TpStatusChip(
                status: TpStatus.neutral,
                label: workflowCopy('statusPending'),
                isCompact: true,
              ),
            ],
          ),
        ),
      );
    }
    final String statusLabel = _workstreamStatus(copy, item);
    final String requirement = switch (item.required) {
      true => workflowCopy('required'),
      false => workflowCopy('notRequired'),
      null => workflowCopy('requirementUnknown'),
    };
    final String? progress = _validPercent(item.progressPct);
    return DecoratedBox(
      decoration: BoxDecoration(
        color: TpPalette.of(context).surfaceAlt,
        borderRadius: BorderRadius.circular(TpRadius.md),
        border: Border.all(color: TpPalette.of(context).border),
      ),
      child: Padding(
        padding: const EdgeInsets.all(TpSpace.md),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: <Widget>[
            Row(
              children: <Widget>[
                Expanded(
                  child: Text(
                    workstreamLabel(copy, item.key),
                    style: Theme.of(context).textTheme.titleSmall?.copyWith(
                          fontWeight: FontWeight.w800,
                        ),
                  ),
                ),
                const SizedBox(width: TpSpace.sm),
                TpStatusChip(
                  status: _workstreamTone(item.chip),
                  label: statusLabel,
                  isCompact: true,
                ),
              ],
            ),
            AccidentInfoRow(workflowCopy('required'), requirement),
            AccidentInfoRow(workflowCopy('owningTeam'), item.team),
            AccidentInfoRow(workflowCopy('ownerRole'), item.ownerRole),
            if (progress != null)
              AccidentInfoRow(workflowCopy('recordedProgress'), progress),
            if (item.updatedAt != null)
              AccidentInfoRow(
                workflowCopy('lastUpdate'),
                formatAccidentIncidentDate(
                  context,
                  item.updatedAt!.toIso8601String(),
                  includeTime: true,
                ),
              ),
            if (item.notes?.trim().isNotEmpty ?? false)
              AccidentInfoRow(workflowCopy('workstreamNotes'), item.notes),
            if (item.chip == AccidentWorkstreamChip.notRequired &&
                (item.naReason?.trim().isNotEmpty ?? false))
              AccidentInfoRow(copy('reason'), item.naReason),
          ],
        ),
      ),
    );
  }
}

class _EvidenceCount extends StatelessWidget {
  const _EvidenceCount({required this.count, required this.message});

  final int count;
  final String message;

  @override
  Widget build(BuildContext context) => Row(
        children: <Widget>[
          DecoratedBox(
            decoration: BoxDecoration(
              color: TpPalette.of(context).info.soft,
              shape: BoxShape.circle,
            ),
            child: Padding(
              padding: const EdgeInsets.all(TpSpace.sm),
              child: Text(
                '$count',
                style: Theme.of(context).textTheme.labelLarge?.copyWith(
                      color: TpPalette.of(context).info.onSoft,
                      fontWeight: FontWeight.w800,
                    ),
              ),
            ),
          ),
          const SizedBox(width: TpSpace.sm),
          Expanded(child: Text(message)),
        ],
      );
}

class _TimelineRow extends StatelessWidget {
  const _TimelineRow({
    required this.workstream,
    required this.copy,
    required this.showConnector,
  });

  final AccidentWorkstream workstream;
  final AccidentCopy copy;
  final bool showConnector;

  @override
  Widget build(BuildContext context) {
    final TpStatus tone = _workstreamTone(workstream.chip);
    return IntrinsicHeight(
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: <Widget>[
          SizedBox(
            width: TpSizing.iconLg,
            child: Column(
              children: <Widget>[
                Icon(
                  Icons.circle,
                  size: TpSizing.iconSm,
                  color: TpPalette.of(context).forStatus(tone).base,
                ),
                if (showConnector)
                  Expanded(
                    child: Container(
                      width: TpBorderWidth.strong,
                      color: TpPalette.of(context).borderStrong,
                    ),
                  ),
              ],
            ),
          ),
          const SizedBox(width: TpSpace.sm),
          Expanded(
            child: Padding(
              padding: const EdgeInsets.only(bottom: TpSpace.md),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: <Widget>[
                  Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: <Widget>[
                      Expanded(
                        child: Text(
                          workstreamLabel(copy, workstream.key),
                          style:
                              Theme.of(context).textTheme.bodyMedium?.copyWith(
                                    fontWeight: FontWeight.w700,
                                  ),
                        ),
                      ),
                      const SizedBox(width: TpSpace.sm),
                      TpStatusChip(
                        status: tone,
                        label: _workstreamStatus(copy, workstream),
                        isCompact: true,
                      ),
                    ],
                  ),
                  const SizedBox(height: TpSpace.xs),
                  Text(
                    formatAccidentIncidentDate(
                      context,
                      workstream.updatedAt!.toIso8601String(),
                      includeTime: true,
                    ),
                    style: Theme.of(context).textTheme.bodySmall,
                  ),
                  if (workstream.team?.trim().isNotEmpty ?? false)
                    Text(
                      workstream.team!,
                      style: Theme.of(context).textTheme.bodySmall,
                    ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _NotificationRow extends StatelessWidget {
  const _NotificationRow({
    required this.notification,
    required this.copy,
    required this.workflowCopy,
  });

  final AppNotification notification;
  final AccidentCopy copy;
  final AccidentCaseWorkflowCopy workflowCopy;

  @override
  Widget build(BuildContext context) {
    final String title = notification.title?.trim() ?? '';
    final String body = notification.body?.trim() ?? '';
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: TpSpace.sm),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Icon(
            notification.icon,
            size: TpSizing.iconMd,
            color: notification.isRead
                ? TpPalette.of(context).textMuted
                : TpPalette.of(context).primary,
          ),
          const SizedBox(width: TpSpace.sm),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                Text(
                  title.isEmpty ? workflowCopy('notificationsTitle') : title,
                  style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                        fontWeight: FontWeight.w700,
                      ),
                ),
                if (body.isNotEmpty) Text(body),
                Text(
                  formatAccidentIncidentDate(
                    context,
                    notification.createdAt.toIso8601String(),
                    includeTime: true,
                  ),
                  style: Theme.of(context).textTheme.bodySmall,
                ),
              ],
            ),
          ),
          const SizedBox(width: TpSpace.sm),
          TpStatusChip(
            status: notification.isRead ? TpStatus.neutral : TpStatus.info,
            label: workflowCopy(notification.isRead ? 'read' : 'unread'),
            isCompact: true,
          ),
        ],
      ),
    );
  }
}

class _InlineEmpty extends StatelessWidget {
  const _InlineEmpty({required this.icon, required this.message});

  final IconData icon;
  final String message;

  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.symmetric(vertical: TpSpace.sm),
        child: Row(
          children: <Widget>[
            Icon(icon, color: TpPalette.of(context).textMuted),
            const SizedBox(width: TpSpace.sm),
            Expanded(child: Text(message)),
          ],
        ),
      );
}

class _InlineLoading extends StatelessWidget {
  const _InlineLoading({required this.message});

  final String message;

  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.symmetric(vertical: TpSpace.sm),
        child: Row(
          children: <Widget>[
            SizedBox.square(
              dimension: TpSizing.iconMd,
              child: CircularProgressIndicator(
                strokeWidth: TpBorderWidth.strong,
                color: TpPalette.of(context).primary,
              ),
            ),
            const SizedBox(width: TpSpace.sm),
            Expanded(child: Text(message)),
          ],
        ),
      );
}

class _InlineError extends StatelessWidget {
  const _InlineError({required this.message, required this.onRetry});

  final String message;
  final VoidCallback? onRetry;

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: TpSpace.sm),
      child: Row(
        children: <Widget>[
          Icon(
            Icons.error_outline,
            color: TpPalette.of(context).critical.base,
          ),
          const SizedBox(width: TpSpace.sm),
          Expanded(child: Text(message)),
          if (onRetry != null)
            IconButton(
              onPressed: onRetry,
              tooltip: l10n.actionRetry,
              icon: const Icon(Icons.refresh_rounded),
            ),
        ],
      ),
    );
  }
}

TpStatus _workstreamTone(AccidentWorkstreamChip chip) => switch (chip) {
      AccidentWorkstreamChip.done => TpStatus.ok,
      AccidentWorkstreamChip.inProgress => TpStatus.warning,
      AccidentWorkstreamChip.pending => TpStatus.unknown,
      AccidentWorkstreamChip.notRequired => TpStatus.neutral,
    };

String _workstreamStatus(AccidentCopy copy, AccidentWorkstream workstream) =>
    switch (workstream.chip) {
      AccidentWorkstreamChip.done => copy('done'),
      AccidentWorkstreamChip.inProgress => copy('inProgress'),
      AccidentWorkstreamChip.pending => copy('pending'),
      AccidentWorkstreamChip.notRequired => copy('notRequired'),
    };

String? _validPercent(num? raw) {
  if (raw == null || !raw.isFinite || raw < 0 || raw > 100) return null;
  final double value = raw.toDouble();
  final String number = value == value.roundToDouble()
      ? value.toStringAsFixed(0)
      : value.toStringAsFixed(1);
  return '$number%';
}

TpStatus _previewTone(AccidentWorkflowPreviewStatus status) => switch (status) {
      AccidentWorkflowPreviewStatus.complete ||
      AccidentWorkflowPreviewStatus.verified ||
      AccidentWorkflowPreviewStatus.delivered ||
      AccidentWorkflowPreviewStatus.signed =>
        TpStatus.ok,
      AccidentWorkflowPreviewStatus.inProgress ||
      AccidentWorkflowPreviewStatus.queued ||
      AccidentWorkflowPreviewStatus.scheduled =>
        TpStatus.info,
      AccidentWorkflowPreviewStatus.warning => TpStatus.warning,
      AccidentWorkflowPreviewStatus.pending => TpStatus.neutral,
      AccidentWorkflowPreviewStatus.missing => TpStatus.critical,
    };

String _previewStatusKey(AccidentWorkflowPreviewStatus status) =>
    switch (status) {
      AccidentWorkflowPreviewStatus.complete => 'statusComplete',
      AccidentWorkflowPreviewStatus.inProgress => 'statusInProgress',
      AccidentWorkflowPreviewStatus.pending => 'statusPending',
      AccidentWorkflowPreviewStatus.warning => 'statusWarning',
      AccidentWorkflowPreviewStatus.missing => 'statusMissing',
      AccidentWorkflowPreviewStatus.verified => 'statusVerified',
      AccidentWorkflowPreviewStatus.delivered => 'statusDelivered',
      AccidentWorkflowPreviewStatus.queued => 'statusQueued',
      AccidentWorkflowPreviewStatus.scheduled => 'statusScheduled',
      AccidentWorkflowPreviewStatus.signed => 'statusSigned',
    };

String _liabilityKey(AccidentLiabilityChoice choice) => switch (choice) {
      AccidentLiabilityChoice.ourDriverGcc => 'liabilityOurDriverGcc',
      AccidentLiabilityChoice.otherParty => 'liabilityOtherParty',
      AccidentLiabilityChoice.shared => 'liabilityShared',
      AccidentLiabilityChoice.underInvestigation =>
        'liabilityUnderInvestigation',
      AccidentLiabilityChoice.notApplicable => 'liabilityNotApplicable',
    };

String _payerKey(AccidentPayerChoice choice) => switch (choice) {
      AccidentPayerChoice.otherPartyInsurance => 'payerOtherPartyInsurance',
      AccidentPayerChoice.ourInsurance => 'payerOurInsurance',
      AccidentPayerChoice.gccCompany => 'payerGccCompany',
      AccidentPayerChoice.driverRecovery => 'payerDriverRecovery',
      AccidentPayerChoice.warranty => 'payerWarranty',
      AccidentPayerChoice.pending => 'payerPending',
    };

String _repairRouteKey(AccidentRepairRoute route) => switch (route) {
      AccidentRepairRoute.internalWorkshop => 'internalWorkshop',
      AccidentRepairRoute.authorisedDealer => 'authorisedDealer',
      AccidentRepairRoute.externalWorkshop => 'externalWorkshop',
      AccidentRepairRoute.onSiteRepair => 'onSiteRepair',
      AccidentRepairRoute.totalLoss => 'totalLoss',
    };

String _recoverySourceKey(AccidentRecoverySource source) => switch (source) {
      AccidentRecoverySource.insuranceSettlement => 'insuranceSettlement',
      AccidentRecoverySource.thirdParty => 'recoveryThirdParty',
      AccidentRecoverySource.driverRecovery => 'recoveryDriver',
      AccidentRecoverySource.warranty => 'recoveryWarranty',
      AccidentRecoverySource.company => 'recoveryCompany',
    };

String _actorInitials(String name) {
  final List<String> words = name
      .trim()
      .split(RegExp(r'\s+'))
      .where((String value) => value.isNotEmpty)
      .toList(growable: false);
  if (words.isEmpty) return '?';
  return words.take(2).map((String value) => value[0].toUpperCase()).join();
}

String _formatAmount(num value, String? currency) {
  final String number = value.toStringAsFixed(2);
  final String code = currency?.trim() ?? '';
  return code.isEmpty ? number : '$code $number';
}
