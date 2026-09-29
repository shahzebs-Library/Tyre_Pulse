/// Mock M5 "Repair assessment report" (Workstream 2 of 7 - Workshop).
///
/// Vehicle card, safety and mobility, the merged damage rows (web
/// `damage_areas` plus the phone's `damage_description` marks), labour and
/// parts estimate, the route recommendation, required attachments and the
/// notify strip. Save keeps a draft row; Submit stamps it submitted and
/// upserts the repair order. Gating comes from `accident_assessment_gating`.
library;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/intl.dart' show NumberFormat;
import 'package:tyre_pulse/app/localization/tp_direction.dart';
import 'package:tyre_pulse/app/localization/tp_localizations.dart';
import 'package:tyre_pulse/app/theme/tp_colors.dart';
import 'package:tyre_pulse/app/theme/tp_spacing.dart';
import 'package:tyre_pulse/core/design_system/design_system.dart';
import 'package:tyre_pulse/core/workspace/workspace_providers.dart';
import 'package:tyre_pulse/features/accidents/accidents_providers.dart';
import 'package:tyre_pulse/features/accidents/data/accident_assessment_repository.dart';
import 'package:tyre_pulse/features/accidents/data/accident_photo_capture.dart';
import 'package:tyre_pulse/features/accidents/domain/accident_assessment_gating.dart';
import 'package:tyre_pulse/features/accidents/domain/accident_case_vocab.dart';
import 'package:tyre_pulse/features/accidents/domain/accident_damage_map.dart';
import 'package:tyre_pulse/features/accidents/domain/accident_models.dart';
import 'package:tyre_pulse/features/accidents/presentation/accident_copy.dart';
import 'package:tyre_pulse/features/accidents/presentation/accident_damage_copy.dart';
import 'package:tyre_pulse/features/accidents/presentation/accident_mock_copy.dart';
import 'package:tyre_pulse/features/accidents/presentation/widgets/accident_ws_header.dart';
import 'package:tyre_pulse/features/accidents/presentation/widgets/accident_ws_shared.dart';
import 'package:tyre_pulse/features/assets/data/vehicle_fleet_repository.dart';
import 'package:tyre_pulse/features/assets/domain/vehicle_asset.dart';
import 'package:tyre_pulse/features/assets/presentation/vehicle_fleet_providers.dart';
import 'package:tyre_pulse/features/assets/presentation/vehicle_photo_resolver.dart';

class AccidentWorkshopAssessmentMockWorkspace extends ConsumerStatefulWidget {
  const AccidentWorkshopAssessmentMockWorkspace({
    required this.snapshot,
    required this.onNavigate,
    this.showWorkstreamHeader = true,
    super.key,
  });

  final AccidentCaseSnapshot snapshot;
  final void Function(String workspaceKey) onNavigate;

  /// False when the case screen already shows the single workstream header
  /// above this workspace, so the step is never stated twice.
  final bool showWorkstreamHeader;

  @override
  ConsumerState<AccidentWorkshopAssessmentMockWorkspace> createState() =>
      _State();
}

class _State extends ConsumerState<AccidentWorkshopAssessmentMockWorkspace> {
  final TextEditingController _labourHours = TextEditingController();
  final TextEditingController _labourCost = TextEditingController();
  final TextEditingController _partsCost = TextEditingController();
  final TextEditingController _partsAvailable = TextEditingController();
  final TextEditingController _partsSpecial = TextEditingController();
  final TextEditingController _workshopName = TextEditingController();
  final TextEditingController _vendorCity = TextEditingController();
  final TextEditingController _duration = TextEditingController();
  bool? _safeToMove;
  bool? _recoveryRequired;
  bool? _vor;
  bool? _totalLoss;
  String? _route;
  String? _quotationStatus;
  String? _seededFromId;
  bool _busy = false;

  AccidentRecord get _record => widget.snapshot.accident;

  @override
  void dispose() {
    for (final TextEditingController c in <TextEditingController>[
      _labourHours,
      _labourCost,
      _partsCost,
      _partsAvailable,
      _partsSpecial,
      _workshopName,
      _vendorCity,
      _duration,
    ]) {
      c.dispose();
    }
    super.dispose();
  }

  /// Seeds the editors from the stored row once per loaded id, so a reload
  /// after a save refreshes facts without clobbering unsaved typing.
  void _seed(AccidentAssessmentBundle bundle) {
    final String stamp =
        '${bundle.assessment?.id ?? '-'}/${bundle.repairOrder?.id ?? '-'}';
    if (_seededFromId == stamp) return;
    _seededFromId = stamp;
    final AccidentDamageAssessmentRecord? a = bundle.assessment;
    final AccidentRepairOrderRecord? o = bundle.repairOrder;
    String text(num? v) => v == null ? '' : v.toString();
    _labourHours.text = text(a?.labourHours);
    _labourCost.text = text(a?.labourCost);
    _partsCost.text = text(a?.partsCost);
    _partsAvailable.text = text(a?.partsAvailable);
    _partsSpecial.text = text(a?.partsSpecialOrder);
    _workshopName.text = o?.workshopName ?? _record.workshopName ?? '';
    _vendorCity.text = o?.vendorCity ?? _record.workshopLocation ?? '';
    _duration.text = text(o?.expectedDurationDays);
    _safeToMove = a?.safeToMove;
    _recoveryRequired = a?.recoveryRequired;
    _vor = a?.recommendedOffroad;
    _totalLoss = a?.totalLossPossible;
    _route = o?.repairRoute ?? a?.recommendedRoute;
    _quotationStatus = o?.quotationStatus;
  }

  @override
  Widget build(BuildContext context) {
    final AsyncValue<AccidentAssessmentBundle> state =
        ref.watch(accidentAssessmentBundleProvider(_record.id));
    return state.when(
      loading: () => const Padding(
        padding: EdgeInsets.all(TpSpace.xl),
        child: Center(child: CircularProgressIndicator()),
      ),
      error: (Object error, StackTrace _) => TpStateView(
        icon: Icons.cloud_off_outlined,
        tone: TpStatus.critical,
        title: AppLocalizations.of(context).accAssessmentLoadFailed,
        message: accidentWsErrorText(context, error),
        primaryActionLabel: AppLocalizations.of(context).actionRetry,
        onPrimaryAction: () =>
            ref.invalidate(accidentAssessmentBundleProvider(_record.id)),
      ),
      data: (AccidentAssessmentBundle bundle) {
        _seed(bundle);
        return _body(context, bundle);
      },
    );
  }

  Widget _body(BuildContext context, AccidentAssessmentBundle bundle) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final TpPalette palette = TpPalette.of(context);
    final TextTheme text = Theme.of(context).textTheme;
    final String? currency = ref.watch(activeCurrencyProvider);
    final AccidentDamageAssessmentRecord? assessment = bundle.assessment;
    final List<AssessmentDamageRow> rows = mergeDamageRows(
      damageAreas: assessment?.damageAreas,
      damageDescription: _record.damageDescription,
    );
    final List<AssessmentAttachmentStatus> attachments =
        assessmentAttachmentStatuses(bundle.evidence);
    final bool totalLoss = _totalLoss ?? false;
    final String recommended = recommendedRepairRoute(
      rows: rows,
      totalLossPossible: totalLoss,
    );
    final String route = _route ?? recommended;
    final bool submittable = canSubmitAssessment(
      route: route,
      attachments: attachments,
    );
    final bool submitted = assessment?.isSubmitted ?? false;
    final num? labourCost = num.tryParse(_labourCost.text.trim());
    final num? partsCost = num.tryParse(_partsCost.text.trim());
    final String reason = assessment?.routeReason ??
        recommendedRouteReason(rows: rows, totalLossPossible: totalLoss);

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: <Widget>[
        if (widget.showWorkstreamHeader) ...<Widget>[
          AccidentWorkstreamHeader(
            snapshot: widget.snapshot,
            workstreamKey: 'assessment',
          ),
          const SizedBox(height: TpSpace.md),
        ],
        AccidentWsNotes(notes: bundle.notes),
        _VehicleCard(
          record: _record,
          areaCount: rows.length,
          onViewDamageMap: () => widget.onNavigate('damage_map'),
        ),
        const SizedBox(height: TpSpace.md),

        // 1 Safety and mobility
        AccidentWsSection(
          number: 1,
          title: l10n.accSafetyAndMobility,
          children: <Widget>[
            AccidentWsYesNo(
              key: const Key('accident.ws.assessment.safeToMove'),
              label: l10n.accSafeToMove,
              value: _safeToMove,
              riskWhen: false,
              onChanged: submitted
                  ? null
                  : (bool v) => setState(() => _safeToMove = v),
            ),
            const SizedBox(height: TpSpace.sm),
            AccidentWsYesNo(
              label: l10n.accRecoveryTowRequired,
              value: _recoveryRequired,
              riskWhen: true,
              onChanged: submitted
                  ? null
                  : (bool v) => setState(() => _recoveryRequired = v),
            ),
            const SizedBox(height: TpSpace.sm),
            AccidentWsYesNo(
              label: l10n.accVehicleOffRoad,
              value: _vor,
              riskWhen: true,
              onChanged:
                  submitted ? null : (bool v) => setState(() => _vor = v),
            ),
          ],
        ),
        const SizedBox(height: TpSpace.md),

        // 2 Damage assessment
        AccidentWsSection(
          number: 2,
          title: l10n.accDamageAssessment,
          trailing: Text(
            l10n.accDamageAreaCount(rows.length),
            style: text.labelMedium?.copyWith(fontWeight: FontWeight.w800),
          ),
          children: <Widget>[
            if (rows.isEmpty)
              Text(
                l10n.accNoDamageAreas,
                style: text.bodyMedium?.copyWith(color: palette.textSecondary),
              ),
            for (int i = 0; i < rows.length; i++) ...<Widget>[
              if (i > 0) Divider(height: TpSpace.lg, color: palette.border),
              _DamageRow(row: rows[i]),
            ],
          ],
        ),
        const SizedBox(height: TpSpace.md),

        // 3 Labour and parts estimate
        AccidentWsSection(
          number: 3,
          title: l10n.accLabourAndPartsEstimate,
          children: <Widget>[
            _NumberInput(
              label: l10n.accLabourHours,
              controller: _labourHours,
              enabled: !submitted,
              onChanged: () => setState(() {}),
            ),
            const SizedBox(height: TpSpace.sm),
            _NumberInput(
              label: l10n.accLabourEstimate,
              controller: _labourCost,
              enabled: !submitted,
              onChanged: () => setState(() {}),
              helper: accidentWsMoney(context, labourCost, currency),
            ),
            const SizedBox(height: TpSpace.sm),
            _NumberInput(
              label: l10n.accPartsEstimate,
              controller: _partsCost,
              enabled: !submitted,
              onChanged: () => setState(() {}),
              helper: accidentWsMoney(context, partsCost, currency),
            ),
            AccidentWsFact(
              label: l10n.accTotalPreliminaryEstimate,
              value: accidentWsMoney(
                context,
                preliminaryTotal(labourCost: labourCost, partsCost: partsCost),
                currency,
              ),
              emphasis: true,
            ),
            Row(
              children: <Widget>[
                Expanded(
                  child: _NumberInput(
                    label: l10n.accPartsAvailable,
                    controller: _partsAvailable,
                    enabled: !submitted,
                    integer: true,
                    onChanged: () => setState(() {}),
                  ),
                ),
                const SizedBox(width: TpSpace.sm),
                Expanded(
                  child: _NumberInput(
                    label: l10n.accSpecialOrder,
                    controller: _partsSpecial,
                    enabled: !submitted,
                    integer: true,
                    onChanged: () => setState(() {}),
                  ),
                ),
              ],
            ),
            AccidentWsFact(
              label: l10n.accPartsAvailability,
              value: partsAvailabilityLabel(
                available: int.tryParse(_partsAvailable.text.trim()),
                specialOrder: int.tryParse(_partsSpecial.text.trim()),
              ),
            ),
          ],
        ),
        const SizedBox(height: TpSpace.md),

        // 4 Repair route recommendation
        AccidentWsSection(
          number: 4,
          title: l10n.accRepairRouteRecommendation,
          children: <Widget>[
            IntrinsicHeight(
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: <Widget>[
                  for (int i = 0; i < repairRouteTiles.length; i++) ...<Widget>[
                    if (i > 0) const SizedBox(width: TpSpace.sm),
                    Expanded(
                      child: _RouteTile(
                        tile: repairRouteTiles[i],
                        selected: route == repairRouteTiles[i].key,
                        recommended: recommended == repairRouteTiles[i].key,
                        onTap: submitted
                            ? null
                            : () => setState(
                                  () => _route = repairRouteTiles[i].key,
                                ),
                      ),
                    ),
                  ],
                ],
              ),
            ),
            const SizedBox(height: TpSpace.sm),
            Text(
              reason,
              textAlign: TextAlign.center,
              style: text.bodySmall?.copyWith(color: palette.textSecondary),
            ),
            const SizedBox(height: TpSpace.sm),
            CheckboxListTile(
              contentPadding: EdgeInsets.zero,
              value: totalLoss,
              onChanged: submitted
                  ? null
                  : (bool? v) => setState(() => _totalLoss = v ?? false),
              title: Text(l10n.accTotalLossPossible),
            ),
            TpInput(
              label: l10n.accSelectedWorkshop,
              controller: _workshopName,
              enabled: !submitted,
              onChanged: (_) => setState(() {}),
            ),
            const SizedBox(height: TpSpace.sm),
            TpInput(
              label: l10n.accCity,
              controller: _vendorCity,
              enabled: !submitted,
              onChanged: (_) => setState(() {}),
            ),
            const SizedBox(height: TpSpace.sm),
            _NumberInput(
              label: l10n.accExpectedDurationDays,
              controller: _duration,
              enabled: !submitted,
              integer: true,
              onChanged: () => setState(() {}),
            ),
            const SizedBox(height: TpSpace.sm),
            TpDropdown<String>(
              label: l10n.accQuotationStatus,
              value: _quotationStatus,
              hint: accidentWsNotSet(context),
              items: <TpDropdownItem<String>>[
                for (final VocabItem q in quotationStates)
                  TpDropdownItem<String>(value: q.key, label: q.label),
              ],
              onChanged: submitted
                  ? null
                  : (String? v) => setState(() => _quotationStatus = v),
            ),
            const SizedBox(height: TpSpace.sm),
            _VendorSummary(
              workshop: _workshopName.text,
              city: _vendorCity.text,
              durationDays: int.tryParse(_duration.text.trim()),
              quotationStatus: quotationStatusLabel(_quotationStatus),
            ),
          ],
        ),
        const SizedBox(height: TpSpace.md),

        // Required attachments
        AccidentWsSection(
          title: l10n.accRequiredAttachments(attachments.length),
          children: <Widget>[
            for (final AssessmentAttachmentStatus a in attachments)
              _AttachmentRow(
                status: a,
                onUpload: _busy ? null : () => _upload(a.doc),
              ),
            if (route == 'external' &&
                !hasAttachment(
                  attachments,
                  submitGatingAttachment,
                )) ...<Widget>[
              const SizedBox(height: TpSpace.sm),
              AccidentWsWarning(
                message: l10n.accAttachVendorQuotation,
              ),
            ],
          ],
        ),
        const SizedBox(height: TpSpace.md),

        // After submit notify
        AccidentWsSection(
          title: l10n.accAfterSubmitNotify,
          children: <Widget>[
            AccidentWsNotifyChips(
              snapshot: widget.snapshot,
              keys: const <String>[
                'fleet',
                'insurance',
                'command_center',
                'pmv_manager',
              ],
            ),
          ],
        ),
        const SizedBox(height: TpSpace.md),
        AccidentWsFooterPair(
          labels: <String>[
            l10n.accSaveAssessment,
            if (submitted)
              l10n.accAssessmentSubmitted
            else
              l10n.accSubmitAssessment,
          ],
          first: TpButton.secondary(
            key: const Key('accident.ws.assessment.save'),
            label: l10n.accSaveAssessment,
            icon: Icons.save_outlined,
            isBusy: _busy,
            onPressed: _busy || submitted ? null : () => _save(bundle),
          ),
          second: TpButton.primary(
            key: const Key('accident.ws.assessment.submit'),
            label: submitted
                ? l10n.accAssessmentSubmitted
                : l10n.accSubmitAssessment,
            icon: !submitted && !submittable
                ? Icons.lock_outline
                : Icons.send_outlined,
            isBusy: _busy,
            onPressed: _busy || submitted || !submittable
                ? null
                : () => _save(bundle, submit: true),
          ),
        ),
        if (!submittable && !submitted)
          Padding(
            padding: const EdgeInsets.only(top: TpSpace.xs),
            child: Text(
              l10n.accSubmissionNeedsQuotation,
              style: text.bodySmall?.copyWith(color: palette.textSecondary),
            ),
          ),
      ],
    );
  }

  AccidentAssessmentDraft _draft(String route) => AccidentAssessmentDraft(
        safeToMove: _safeToMove,
        recoveryRequired: _recoveryRequired,
        recommendedOffroad: _vor,
        labourHours: num.tryParse(_labourHours.text.trim()),
        labourCost: num.tryParse(_labourCost.text.trim()),
        partsCost: num.tryParse(_partsCost.text.trim()),
        partsAvailable: int.tryParse(_partsAvailable.text.trim()),
        partsSpecialOrder: int.tryParse(_partsSpecial.text.trim()),
        recommendedRoute: route,
        totalLossPossible: _totalLoss,
        workshopName: _workshopName.text,
        vendorCity: _vendorCity.text,
        expectedDurationDays: int.tryParse(_duration.text.trim()),
        quotationStatus: _quotationStatus,
      );

  Future<void> _save(
    AccidentAssessmentBundle bundle, {
    bool submit = false,
  }) async {
    final List<AssessmentDamageRow> rows = mergeDamageRows(
      damageAreas: bundle.assessment?.damageAreas,
      damageDescription: _record.damageDescription,
    );
    final String route = _route ??
        recommendedRepairRoute(
          rows: rows,
          totalLossPossible: _totalLoss ?? false,
        );
    final AppLocalizations l10n = AppLocalizations.of(context);
    setState(() => _busy = true);
    try {
      final AccidentAssessmentSaveResult result =
          await ref.read(accidentAssessmentRepositoryProvider).save(
                accidentId: _record.id,
                draft: _draft(route),
                existingAssessmentId: bundle.assessment?.id,
                existingRepairOrderId: bundle.repairOrder?.id,
                submit: submit,
                assessorName: ref.read(workspaceContextProvider)?.fullName,
                country: ref.read(workspaceContextProvider)?.activeCountry,
                site: _record.site,
              );
      _seededFromId = null;
      ref.invalidate(accidentAssessmentBundleProvider(_record.id));
      // Only when the server actually rejected optional columns; the parity
      // migration is live, so this is a safety net rather than a promise.
      final String dropped = result.droppedFields.isEmpty
          ? ''
          : ' ${l10n.accFieldsNotStored(result.droppedFields.join(', '))}';
      _snack(
        submit
            ? '${l10n.accAssessmentRouted(repairRouteLabel(route))}$dropped'
            : '${l10n.accAssessmentSaved}$dropped',
      );
    } on Object catch (error) {
      if (mounted) _snack(accidentWsErrorText(context, error));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _upload(VocabItem doc) async {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final AccidentPhotoSource? source =
        await pickAccidentEvidenceSource(context, doc.label);
    if (source == null || !mounted) return;
    setState(() => _busy = true);
    try {
      final String? path = await ref.read(accidentPhotoCaptureProvider).capture(
            sessionKey: 'assessment_${_record.id}',
            source: source,
          );
      if (path != null) {
        await ref.read(accidentAssessmentRepositoryProvider).uploadAttachment(
              accidentId: _record.id,
              requirementKey: doc.key,
              localPath: path,
              isPhoto: doc.countable,
              country: ref.read(workspaceContextProvider)?.activeCountry,
              site: _record.site,
            );
        ref.invalidate(accidentAssessmentBundleProvider(_record.id));
        _snack(l10n.accDocumentAttached(doc.label));
      }
    } on Object catch (error) {
      if (mounted) _snack(accidentWsErrorText(context, error));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  void _snack(String message) {
    if (!mounted) return;
    ScaffoldMessenger.maybeOf(context)
        ?.showSnackBar(SnackBar(content: Text(message)));
  }
}

class _VehicleCard extends ConsumerWidget {
  const _VehicleCard({
    required this.record,
    required this.areaCount,
    required this.onViewDamageMap,
  });

  final AccidentRecord record;
  final int areaCount;
  final VoidCallback onViewDamageMap;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final TpPalette palette = TpPalette.of(context);
    final TextTheme text = Theme.of(context).textTheme;
    final bool rtl = TpDirection.isRtl(context);
    final AsyncValue<VehicleDetailOutcome> detail =
        ref.watch(vehicleDetailProvider(record.assetNo));
    final VehicleAsset? loaded = switch (detail) {
      AsyncData<VehicleDetailOutcome>(value: final VehicleDetailLoaded v) =>
        v.asset,
      AsyncData<VehicleDetailOutcome>(value: final VehicleDetailFromCache v) =>
        v.asset,
      _ => null,
    };
    final VehicleAsset vehicle = loaded ??
        VehicleAsset(
          id: record.id,
          assetNo: record.assetNo,
          vehicleType: record.vehicleType,
          site: record.site,
          registrationNo: record.plateNumber,
        );
    final String? art = vehiclePhotoAsset(vehicle);
    final String makeModel = <String>[
      if ((vehicle.make ?? '').trim().isNotEmpty) vehicle.make!.trim(),
      if ((vehicle.model ?? '').trim().isNotEmpty) vehicle.model!.trim(),
    ].join(' ');
    String ltr(String v) => rtl ? TpDirection.isolateLtr(v) : v;
    final String siteLine = <String>[
      record.site,
      if ((record.location ?? '').trim().isNotEmpty) record.location!.trim(),
    ].where((String s) => s.trim().isNotEmpty).join(' · ');
    final String plateRaw =
        (vehicle.registrationNo ?? record.plateNumber ?? '').trim();
    final String plate =
        plateRaw.isEmpty ? accidentWsNotSet(context) : ltr(plateRaw);
    final String km = vehicle.currentKm == null
        ? accidentWsNotSet(context)
        : ltr(
            NumberFormat.decimalPattern(
              Localizations.localeOf(context).toLanguageTag(),
            ).format(vehicle.currentKm),
          );
    return TpCard(
      key: const Key('accident.ws.assessment.vehicleCard'),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: <Widget>[
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: <Widget>[
              SizedBox(
                width: 96,
                height: 72,
                child: DecoratedBox(
                  decoration: BoxDecoration(
                    color: palette.surfaceAlt,
                    borderRadius: BorderRadius.circular(TpRadius.md),
                  ),
                  child: art == null
                      ? Icon(
                          vehicleFallbackIcon(vehicle),
                          color: palette.textMuted,
                        )
                      : Image.asset(
                          art,
                          fit: BoxFit.contain,
                          errorBuilder: (_, __, ___) => Icon(
                            vehicleFallbackIcon(vehicle),
                            color: palette.textMuted,
                          ),
                        ),
                ),
              ),
              const SizedBox(width: TpSpace.md),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: <Widget>[
                    Text(
                      makeModel.isEmpty
                          ? accidentWsText(context, record.vehicleType)
                          : makeModel,
                      style: text.titleMedium
                          ?.copyWith(fontWeight: FontWeight.w800),
                    ),
                    const SizedBox(height: TpSpace.xs),
                    // The mock's one compact identity line:
                    // asset · KM · Plate, then the site and location.
                    Text(
                      <String>[
                        ltr(record.assetNo),
                        '${l10n.accKm}: $km',
                        '${l10n.accPlate}: $plate',
                      ].join(' · '),
                      style: text.bodySmall
                          ?.copyWith(color: palette.textSecondary),
                    ),
                    const SizedBox(height: TpSpace.xs),
                    Text(
                      siteLine.isEmpty ? accidentWsNotSet(context) : siteLine,
                      style: text.bodySmall
                          ?.copyWith(color: palette.textSecondary),
                    ),
                  ],
                ),
              ),
            ],
          ),
          const SizedBox(height: TpSpace.sm),
          TpButton.secondary(
            key: const Key('accident.ws.assessment.viewDamageMap'),
            label: l10n.accViewDamageMap(areaCount),
            icon: Icons.map_outlined,
            isFullWidth: true,
            onPressed: onViewDamageMap,
          ),
        ],
      ),
    );
  }
}

class _DamageRow extends StatelessWidget {
  const _DamageRow({required this.row});
  final AssessmentDamageRow row;

  @override
  Widget build(BuildContext context) {
    final TpPalette palette = TpPalette.of(context);
    final TextTheme text = Theme.of(context).textTheme;
    final Color dot = switch (row.severity) {
      'severe' => palette.critical.base,
      'moderate' => palette.warning.base,
      'minor' => palette.ok.base,
      _ => palette.unknown.base,
    };
    // The stored tokens print in the reader's language; the vocabulary's
    // English label stays the fallback for any token the catalog lacks.
    final AccidentCopy damageCopy = AccidentCopy.of(context);
    final AccidentDamageType? type = AccidentDamageType.values
        .where((AccidentDamageType t) => t.name == row.damageType)
        .firstOrNull;
    final AccidentDamageSeverity? level = AccidentDamageSeverity.values
        .where((AccidentDamageSeverity l) => l.name == row.severity)
        .firstOrNull;
    final String detail = <String>[
      if (type != null)
        accidentVocabLabel(
          AccidentMockCopy.of(context),
          'damageType',
          type == AccidentDamageType.bent ? 'bent' : '',
          accidentDamageTypeCopyLabel(damageCopy, type),
        )
      else if (row.damageTypeLabel.isNotEmpty)
        row.damageTypeLabel,
      if (level != null)
        accidentDamageLevelLabel(context, level)
      else if (row.severityLabel.isNotEmpty)
        row.severityLabel,
    ].join(' · ');
    return Row(
      children: <Widget>[
        _Thumbnail(reference: row.firstPhoto),
        const SizedBox(width: TpSpace.md),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: <Widget>[
              Text(
                row.component,
                style: text.bodyMedium?.copyWith(fontWeight: FontWeight.w800),
              ),
              Row(
                children: <Widget>[
                  DecoratedBox(
                    decoration:
                        BoxDecoration(color: dot, shape: BoxShape.circle),
                    child: const SizedBox(width: 10, height: 10),
                  ),
                  const SizedBox(width: TpSpace.xs),
                  Expanded(
                    child: Text(
                      detail.isEmpty ? accidentWsNotSet(context) : detail,
                      style: text.bodySmall
                          ?.copyWith(color: palette.textSecondary),
                    ),
                  ),
                ],
              ),
              Text(
                row.actionLabel.isNotEmpty
                    ? accidentVocabLabel(
                        AccidentMockCopy.of(context),
                        'action',
                        row.action ?? '',
                        row.actionLabel,
                      )
                    : row.source == DamageRowSource.phone
                        ? AppLocalizations.of(context).accActionNotAssessed
                        : AppLocalizations.of(context)
                            .accActionValue(accidentWsNotSet(context)),
                style: text.bodySmall,
              ),
            ],
          ),
        ),
        Icon(Icons.chevron_right_rounded, color: palette.textMuted),
      ],
    );
  }
}

class _Thumbnail extends ConsumerWidget {
  const _Thumbnail({required this.reference});
  final String? reference;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final TpPalette palette = TpPalette.of(context);
    final Widget placeholder = DecoratedBox(
      decoration: BoxDecoration(
        color: palette.surfaceAlt,
        borderRadius: BorderRadius.circular(TpRadius.sm),
      ),
      child: SizedBox(
        width: 56,
        height: 56,
        child: Icon(Icons.photo_outlined, color: palette.textMuted),
      ),
    );
    final String? r = reference;
    if (r == null || !r.startsWith('tp-storage://')) return placeholder;
    final AsyncValue<String> url = ref.watch(accidentEvidenceUrlProvider(r));
    final String? resolved = switch (url) {
      AsyncData<String>(value: final String v) => v,
      _ => null,
    };
    if (resolved == null) return placeholder;
    return ClipRRect(
      borderRadius: BorderRadius.circular(TpRadius.sm),
      child: Image.network(
        resolved,
        width: 56,
        height: 56,
        fit: BoxFit.cover,
        errorBuilder: (_, __, ___) => placeholder,
      ),
    );
  }
}

class _NumberInput extends StatelessWidget {
  const _NumberInput({
    required this.label,
    required this.controller,
    required this.enabled,
    required this.onChanged,
    this.integer = false,
    this.helper,
  });

  final String label;
  final TextEditingController controller;
  final bool enabled;
  final VoidCallback onChanged;
  final bool integer;
  final String? helper;

  @override
  Widget build(BuildContext context) => TpInput(
        label: label,
        controller: controller,
        enabled: enabled,
        helperText: helper,
        keyboardType: TextInputType.numberWithOptions(decimal: !integer),
        onChanged: (_) => onChanged(),
      );
}

class _RouteTile extends StatelessWidget {
  const _RouteTile({
    required this.tile,
    required this.selected,
    required this.recommended,
    this.onTap,
  });

  final VocabItem tile;
  final bool selected;
  final bool recommended;
  final VoidCallback? onTap;

  static IconData _icon(String key) => switch (key) {
        'internal' => Icons.build_outlined,
        'external' => Icons.apartment_outlined,
        _ => Icons.local_shipping_outlined,
      };

  @override
  Widget build(BuildContext context) {
    final TpPalette palette = TpPalette.of(context);
    return Semantics(
      selected: selected,
      button: true,
      child: TpCard(
        key: Key('accident.ws.assessment.route.${tile.key}'),
        onTap: onTap,
        padding: const EdgeInsets.all(TpSpace.sm),
        borderColor: selected ? palette.primary : null,
        background: selected ? palette.primarySoft : null,
        child: Stack(
          children: <Widget>[
            Center(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: <Widget>[
                  const SizedBox(height: TpSpace.sm),
                  Icon(_icon(tile.key), color: palette.primary, size: 28),
                  const SizedBox(height: TpSpace.xs),
                  Text(
                    accidentVocabLabel(
                      AccidentMockCopy.of(context),
                      'route',
                      tile.key,
                      tile.label,
                    ),
                    textAlign: TextAlign.center,
                    style: Theme.of(context).textTheme.bodySmall?.copyWith(
                          fontWeight: FontWeight.w700,
                          color: palette.text,
                        ),
                  ),
                  if (recommended) ...<Widget>[
                    const SizedBox(height: TpSpace.xs),
                    // The mock's filled "Recommended" pill. It scales down
                    // rather than truncating inside a narrow third-width tile.
                    DecoratedBox(
                      decoration: BoxDecoration(
                        color: palette.primary,
                        borderRadius: BorderRadius.circular(TpRadius.pill),
                      ),
                      child: Padding(
                        padding: const EdgeInsets.symmetric(
                          horizontal: TpSpace.sm,
                          vertical: 2,
                        ),
                        child: FittedBox(
                          fit: BoxFit.scaleDown,
                          child: Text(
                            AppLocalizations.of(context).accRecommended,
                            maxLines: 1,
                            style: Theme.of(context)
                                .textTheme
                                .labelSmall
                                ?.copyWith(
                                  color: palette.onPrimary,
                                  fontWeight: FontWeight.w700,
                                ),
                          ),
                        ),
                      ),
                    ),
                  ],
                ],
              ),
            ),
            if (selected)
              PositionedDirectional(
                top: 0,
                end: 0,
                child: Icon(
                  Icons.check_circle_rounded,
                  color: palette.primary,
                  size: TpSizing.iconMd,
                ),
              ),
          ],
        ),
      ),
    );
  }
}

/// The chosen vendor as one strip: workshop and city, expected duration,
/// quotation status. Blank values print "Not set", never a guess.
class _VendorSummary extends StatelessWidget {
  const _VendorSummary({
    required this.workshop,
    required this.city,
    required this.durationDays,
    required this.quotationStatus,
  });

  final String workshop;
  final String city;
  final int? durationDays;
  final String quotationStatus;

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final TpPalette palette = TpPalette.of(context);
    final TextTheme text = Theme.of(context).textTheme;
    final String notSet = accidentWsNotSet(context);
    Widget cell(String label, String value, {Color? color}) => Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            Text(label, style: text.labelSmall),
            Text(
              value,
              style: text.bodyMedium?.copyWith(
                fontWeight: FontWeight.w800,
                color: color,
              ),
            ),
          ],
        );
    return Container(
      key: const Key('accident.ws.assessment.vendorSummary'),
      padding: const EdgeInsets.all(TpSpace.md),
      decoration: BoxDecoration(
        color: palette.surfaceAlt,
        border: Border.all(color: palette.border),
        borderRadius: BorderRadius.circular(TpRadius.md),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: <Widget>[
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: <Widget>[
              Icon(Icons.place_outlined, color: palette.primary),
              const SizedBox(width: TpSpace.sm),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: <Widget>[
                    Text(
                      workshop.trim().isEmpty ? notSet : workshop.trim(),
                      style: text.bodyMedium
                          ?.copyWith(fontWeight: FontWeight.w800),
                    ),
                    Text(
                      city.trim().isEmpty ? notSet : city.trim(),
                      style: text.bodySmall,
                    ),
                  ],
                ),
              ),
            ],
          ),
          const SizedBox(height: TpSpace.sm),
          Row(
            children: <Widget>[
              Expanded(
                child: cell(
                  l10n.accExpectedDurationDays,
                  durationDays == null ? notSet : '$durationDays',
                ),
              ),
              const SizedBox(width: TpSpace.sm),
              Expanded(
                child: cell(
                  l10n.accQuotationStatus,
                  quotationStatus,
                  color: palette.primary,
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

class _AttachmentRow extends StatelessWidget {
  const _AttachmentRow({required this.status, this.onUpload});
  final AssessmentAttachmentStatus status;
  final VoidCallback? onUpload;

  @override
  Widget build(BuildContext context) {
    final TpPalette palette = TpPalette.of(context);
    final bool attached = status.state == AttachmentState.attached;
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: TpSpace.xs),
      child: Row(
        children: <Widget>[
          Icon(
            attached
                ? Icons.check_circle_rounded
                : status.doc.required
                    ? Icons.error_outline_rounded
                    : Icons.radio_button_unchecked,
            size: TpSizing.iconMd,
            color: attached
                ? palette.ok.base
                : status.doc.required
                    ? palette.critical.base
                    : palette.textMuted,
          ),
          const SizedBox(width: TpSpace.sm),
          Expanded(child: Text(status.doc.label)),
          TpStatusChip(
            status: attached
                ? TpStatus.ok
                : status.doc.required
                    ? TpStatus.critical
                    : TpStatus.unknown,
            label: status.label,
            isCompact: true,
          ),
          IconButton(
            tooltip: AppLocalizations.of(context)
                .accUploadNamedDocument(status.doc.label),
            onPressed: onUpload,
            icon: const Icon(Icons.upload_file_outlined),
          ),
        ],
      ),
    );
  }
}
