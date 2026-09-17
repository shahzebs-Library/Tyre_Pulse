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
import 'package:tyre_pulse/app/localization/tp_direction.dart';
import 'package:tyre_pulse/app/theme/tp_colors.dart';
import 'package:tyre_pulse/app/theme/tp_spacing.dart';
import 'package:tyre_pulse/core/design_system/design_system.dart';
import 'package:tyre_pulse/core/workspace/workspace_providers.dart';
import 'package:tyre_pulse/features/accidents/accidents_providers.dart';
import 'package:tyre_pulse/features/accidents/data/accident_assessment_repository.dart';
import 'package:tyre_pulse/features/accidents/data/accident_photo_capture.dart';
import 'package:tyre_pulse/features/accidents/domain/accident_assessment_gating.dart';
import 'package:tyre_pulse/features/accidents/domain/accident_case_vocab.dart';
import 'package:tyre_pulse/features/accidents/domain/accident_models.dart';
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
    super.key,
  });

  final AccidentCaseSnapshot snapshot;
  final void Function(String workspaceKey) onNavigate;

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
        title: 'The assessment could not be loaded',
        message: accidentWsErrorText(error),
        primaryActionLabel: 'Retry',
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
        AccidentWorkstreamHeader(
          snapshot: widget.snapshot,
          workstreamKey: 'assessment',
        ),
        const SizedBox(height: TpSpace.md),
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
          title: 'Safety and mobility',
          children: <Widget>[
            AccidentWsYesNo(
              key: const Key('accident.ws.assessment.safeToMove'),
              label: 'Safe to move',
              value: _safeToMove,
              riskWhen: false,
              onChanged: submitted
                  ? null
                  : (bool v) => setState(() => _safeToMove = v),
            ),
            const SizedBox(height: TpSpace.sm),
            AccidentWsYesNo(
              label: 'Recovery / tow required',
              value: _recoveryRequired,
              riskWhen: true,
              onChanged: submitted
                  ? null
                  : (bool v) => setState(() => _recoveryRequired = v),
            ),
            const SizedBox(height: TpSpace.sm),
            AccidentWsYesNo(
              label: 'Vehicle off road (VOR)',
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
          title: 'Damage assessment',
          trailing: Text(
            '${rows.length} ${rows.length == 1 ? 'area' : 'areas'}',
            style: text.labelMedium?.copyWith(fontWeight: FontWeight.w800),
          ),
          children: <Widget>[
            if (rows.isEmpty)
              Text(
                'No damage areas have been marked on this case yet.',
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
          title: 'Labour and parts estimate',
          children: <Widget>[
            _NumberInput(
              label: 'Labour hours',
              controller: _labourHours,
              enabled: !submitted,
              onChanged: () => setState(() {}),
            ),
            const SizedBox(height: TpSpace.sm),
            _NumberInput(
              label: 'Labour estimate',
              controller: _labourCost,
              enabled: !submitted,
              onChanged: () => setState(() {}),
              helper: accidentWsMoney(context, labourCost, currency),
            ),
            const SizedBox(height: TpSpace.sm),
            _NumberInput(
              label: 'Parts estimate',
              controller: _partsCost,
              enabled: !submitted,
              onChanged: () => setState(() {}),
              helper: accidentWsMoney(context, partsCost, currency),
            ),
            AccidentWsFact(
              label: 'Total preliminary estimate',
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
                    label: 'Parts available',
                    controller: _partsAvailable,
                    enabled: !submitted,
                    integer: true,
                    onChanged: () => setState(() {}),
                  ),
                ),
                const SizedBox(width: TpSpace.sm),
                Expanded(
                  child: _NumberInput(
                    label: 'Special order',
                    controller: _partsSpecial,
                    enabled: !submitted,
                    integer: true,
                    onChanged: () => setState(() {}),
                  ),
                ),
              ],
            ),
            AccidentWsFact(
              label: 'Parts availability',
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
          title: 'Repair route recommendation',
          children: <Widget>[
            for (final VocabItem tile in repairRouteTiles) ...<Widget>[
              _RouteTile(
                tile: tile,
                selected: route == tile.key,
                recommended: recommended == tile.key,
                onTap:
                    submitted ? null : () => setState(() => _route = tile.key),
              ),
              const SizedBox(height: TpSpace.xs),
            ],
            const SizedBox(height: TpSpace.xs),
            Text(reason, style: text.bodySmall),
            const SizedBox(height: TpSpace.sm),
            CheckboxListTile(
              contentPadding: EdgeInsets.zero,
              value: totalLoss,
              onChanged: submitted
                  ? null
                  : (bool? v) => setState(() => _totalLoss = v ?? false),
              title: const Text('Total loss possible'),
            ),
            TpInput(
              label: 'Selected workshop',
              controller: _workshopName,
              enabled: !submitted,
            ),
            const SizedBox(height: TpSpace.sm),
            TpInput(
              label: 'City',
              controller: _vendorCity,
              enabled: !submitted,
            ),
            const SizedBox(height: TpSpace.sm),
            _NumberInput(
              label: 'Expected duration (days)',
              controller: _duration,
              enabled: !submitted,
              integer: true,
              onChanged: () => setState(() {}),
            ),
            const SizedBox(height: TpSpace.sm),
            TpDropdown<String>(
              label: 'Quotation status',
              value: _quotationStatus,
              hint: accidentWsNotSet,
              items: <TpDropdownItem<String>>[
                for (final VocabItem q in quotationStates)
                  TpDropdownItem<String>(value: q.key, label: q.label),
              ],
              onChanged: submitted
                  ? null
                  : (String? v) => setState(() => _quotationStatus = v),
            ),
            AccidentWsFact(
              label: 'Quotation status',
              value: quotationStatusLabel(_quotationStatus),
            ),
          ],
        ),
        const SizedBox(height: TpSpace.md),

        // Required attachments
        AccidentWsSection(
          title: 'Required attachments (${attachments.length})',
          children: <Widget>[
            for (final AssessmentAttachmentStatus a in attachments)
              _AttachmentRow(
                status: a,
                onUpload: _busy ? null : () => _upload(a.doc),
              ),
            if (route == 'external' &&
                !hasAttachment(attachments, submitGatingAttachment))
              ...<Widget>[
              const SizedBox(height: TpSpace.sm),
              const AccidentWsWarning(
                message: 'Attach vendor quotation to enable submission to '
                    'External Workshop.',
              ),
            ],
          ],
        ),
        const SizedBox(height: TpSpace.md),

        // After submit notify
        AccidentWsSection(
          title: 'After submit notify',
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
        Row(
          children: <Widget>[
            Expanded(
              child: TpButton.secondary(
                key: const Key('accident.ws.assessment.save'),
                label: 'Save assessment',
                icon: Icons.save_outlined,
                isBusy: _busy,
                onPressed: _busy || submitted ? null : () => _save(bundle),
              ),
            ),
            const SizedBox(width: TpSpace.sm),
            Expanded(
              child: TpButton.primary(
                key: const Key('accident.ws.assessment.submit'),
                label: submitted
                    ? 'Assessment submitted'
                    : 'Submit assessment and route',
                icon: Icons.send_outlined,
                isBusy: _busy,
                onPressed: _busy || submitted || !submittable
                    ? null
                    : () => _save(bundle, submit: true),
              ),
            ),
          ],
        ),
        if (!submittable && !submitted)
          Padding(
            padding: const EdgeInsets.only(top: TpSpace.xs),
            child: Text(
              'Submission needs the vendor quotation for an external route.',
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
      final String dropped = result.droppedFields.isEmpty
          ? ''
          : ' Not stored yet (pending migration): '
              '${result.droppedFields.join(', ')}.';
      _snack(
        submit
            ? 'Assessment submitted and routed to '
                '${repairRouteLabel(route)}.$dropped'
            : 'Assessment saved.$dropped',
      );
    } on Object catch (error) {
      _snack(accidentWsErrorText(error));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _upload(VocabItem doc) async {
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
        _snack('${doc.label} attached.');
      }
    } on Object catch (error) {
      _snack(accidentWsErrorText(error));
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
    final TpPalette palette = TpPalette.of(context);
    final TextTheme text = Theme.of(context).textTheme;
    final bool rtl = TpDirection.isRtl(context);
    final AsyncValue<VehicleDetailOutcome> detail =
        ref.watch(vehicleDetailProvider(record.assetNo));
    final VehicleAsset? loaded = switch (detail) {
      AsyncData<VehicleDetailOutcome>(value: final VehicleDetailLoaded v) =>
        v.asset,
      AsyncData<VehicleDetailOutcome>(
        value: final VehicleDetailFromCache v
      ) =>
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
                          ? accidentWsText(record.vehicleType)
                          : makeModel,
                      style: text.titleMedium
                          ?.copyWith(fontWeight: FontWeight.w800),
                    ),
                    Text(
                      ltr(record.assetNo),
                      style: text.bodyMedium
                          ?.copyWith(color: palette.textSecondary),
                    ),
                  ],
                ),
              ),
            ],
          ),
          const SizedBox(height: TpSpace.sm),
          AccidentWsFact(
            label: 'KM',
            value: vehicle.currentKm == null
                ? accidentWsNotSet
                : ltr('${vehicle.currentKm} km'),
          ),
          AccidentWsFact(
            label: 'Plate',
            value: (vehicle.registrationNo ?? record.plateNumber ?? '')
                    .trim()
                    .isEmpty
                ? accidentWsNotSet
                : ltr((vehicle.registrationNo ?? record.plateNumber)!.trim()),
          ),
          AccidentWsFact(
            label: 'Site · location',
            value: siteLine.isEmpty ? accidentWsNotSet : siteLine,
          ),
          const SizedBox(height: TpSpace.xs),
          TpButton.secondary(
            key: const Key('accident.ws.assessment.viewDamageMap'),
            label: 'View damage map · $areaCount '
                '${areaCount == 1 ? 'area' : 'areas'}',
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
    final String detail = <String>[
      if (row.damageTypeLabel.isNotEmpty) row.damageTypeLabel,
      if (row.severityLabel.isNotEmpty) row.severityLabel,
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
                      detail.isEmpty ? accidentWsNotSet : detail,
                      style: text.bodySmall
                          ?.copyWith(color: palette.textSecondary),
                    ),
                  ),
                ],
              ),
              Text(
                row.actionLabel.isNotEmpty
                    ? row.actionLabel
                    : row.source == DamageRowSource.phone
                        ? 'Action: not yet assessed'
                        : 'Action: $accidentWsNotSet',
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

  @override
  Widget build(BuildContext context) {
    final TpPalette palette = TpPalette.of(context);
    return TpCard(
      key: Key('accident.ws.assessment.route.${tile.key}'),
      onTap: onTap,
      padding: const EdgeInsets.all(TpSpace.md),
      borderColor: selected ? palette.primary : null,
      background: selected ? palette.primarySoft : null,
      child: Row(
        children: <Widget>[
          Icon(
            selected
                ? Icons.radio_button_checked_rounded
                : Icons.radio_button_off_rounded,
            color: selected ? palette.primary : palette.textMuted,
          ),
          const SizedBox(width: TpSpace.sm),
          Expanded(
            child: Text(
              tile.label,
              style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                    fontWeight: FontWeight.w700,
                  ),
            ),
          ),
          if (recommended)
            const TpStatusChip(
              status: TpStatus.ok,
              label: 'Recommended',
              isCompact: true,
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
            tooltip: 'Upload ${status.doc.label}',
            onPressed: onUpload,
            icon: const Icon(Icons.upload_file_outlined),
          ),
        ],
      ),
    );
  }
}
