/// The inspection capture wizard: header, tyres, review, submitted.
///
/// A faithful, four-step port of `mobile/app/(app)/inspection/new.tsx`'s
/// own step machine, rebuilt on real on-device persistence at every step
/// (risk R2) instead of React state that vanished on a process kill.
library;

import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:tyre_pulse/app/localization/tp_direction.dart';
import 'package:tyre_pulse/app/localization/tp_localizations.dart';
import 'package:tyre_pulse/app/router/back_navigation.dart';
import 'package:tyre_pulse/app/router/routes.dart';
import 'package:tyre_pulse/app/theme/tp_colors.dart';
import 'package:tyre_pulse/app/theme/tp_spacing.dart';
import 'package:tyre_pulse/core/design_system/design_system.dart';
import 'package:tyre_pulse/features/assets/data/vehicle_fleet_repository.dart';
import 'package:tyre_pulse/features/assets/domain/asset_classes.dart';
import 'package:tyre_pulse/features/assets/domain/vehicle_asset.dart';
import 'package:tyre_pulse/features/assets/presentation/vehicle_fleet_providers.dart';
import 'package:tyre_pulse/features/assets/presentation/vehicle_photo_resolver.dart';
import 'package:tyre_pulse/features/inspections/data/inspection_sync_engine.dart'
    show InspectionSubmitOutcome;
import 'package:tyre_pulse/features/inspections/domain/inspection_draft_summary.dart';
import 'package:tyre_pulse/features/inspections/domain/inspection_gps_fix.dart';
import 'package:tyre_pulse/features/inspections/domain/inspection_payload.dart';
import 'package:tyre_pulse/features/inspections/domain/tyre_position_reading.dart';
import 'package:tyre_pulse/features/inspections/presentation/controllers/inspection_wizard_controller.dart';
import 'package:tyre_pulse/features/inspections/presentation/state/inspection_wizard_state.dart';
import 'package:tyre_pulse/features/inspections/presentation/widgets/inspection_signature_pad.dart';
import 'package:tyre_pulse/features/inspections/presentation/widgets/tyre_position_editor_sheet.dart';
import 'package:tyre_pulse/features/tyre_diagram/domain/tyre_condition.dart';
import 'package:tyre_pulse/features/tyre_diagram/domain/tyre_diagram_layouts.dart';
import 'package:tyre_pulse/features/tyre_diagram/domain/tyre_position_struct.dart';
import 'package:tyre_pulse/features/tyre_diagram/presentation/tyre_condition_labels.dart';
import 'package:tyre_pulse/features/tyre_diagram/presentation/tyre_detail_screen.dart';
import 'package:tyre_pulse/features/tyre_diagram/presentation/tyre_diagram_board.dart';
import 'package:tyre_pulse/features/tyre_diagram/presentation/tyre_diagram_pending.dart';
import 'package:tyre_pulse/features/tyres/domain/tyre_fitment.dart';

/// Stable finders for the responsive root step of the inspection wizard.
@visibleForTesting
abstract final class NewInspectionScreenKeys {
  static const Key headerHero = Key('inspection.header.hero');
  static const Key resumeSection = Key('inspection.header.resume');
  static const Key vehicleSection = Key('inspection.header.vehicle');
  static const Key detailsSection = Key('inspection.header.details');
  static const Key odometerField = Key('inspection.header.odometer');
  static const Key hourMeterField = Key('inspection.header.hour_meter');
  static const Key selectedVehicleClass =
      Key('inspection.header.selected_vehicle_class');
  static const Key vehicleSectionIcon =
      Key('inspection.header.vehicle_section_icon');
  static const Key vehicleScanner = Key('inspection.header.vehicle_scanner');
  static const Key selectedVehicleImage =
      Key('inspection.header.selected_vehicle_image');
  static const Key tyreContextVehicleClass =
      Key('inspection.tyres.context_vehicle_class');
  static const Key tyreWorkflowStatus = Key('inspection.tyres.workflow_status');
  static const Key tyreWorkflowProgress =
      Key('inspection.tyres.workflow_progress');
  static const Key tyreWorkflowHelper = Key('inspection.tyres.workflow_helper');
  static const Key tyreDiagramBoard = Key('inspection.tyres.diagram_board');
  static const Key tyreSelectedCard = Key('inspection.tyres.selected_card');
  static const Key tyreEvidenceRow = Key('inspection.tyres.evidence_row');
  static const Key tyreDraftChip = Key('inspection.tyres.draft_chip');

  static Key resumeVehicleClass(String assetNo) =>
      ValueKey<String>('inspection.resume.$assetNo.vehicle_class');

  static Key resumeWorkflow(String assetNo) =>
      ValueKey<String>('inspection.resume.$assetNo.workflow');

  static Key pickerVehicleClass(String assetNo) =>
      ValueKey<String>('inspection.picker.$assetNo.vehicle_class');

  static const Key selectedChange = Key('inspection.header.selected_change');
  static const Key selectedContinue =
      Key('inspection.header.selected_continue');
  static const Key pickerClassFilters = Key('inspection.picker.class_filters');
  static const Key pickerTruncated = Key('inspection.picker.truncated');

  static Key pickerClassChip(String assetClass) =>
      ValueKey<String>('inspection.picker.class.$assetClass');

  static Key pickerRow(String assetNo) =>
      ValueKey<String>('inspection.picker.$assetNo.row');
}

class NewInspectionScreen extends ConsumerStatefulWidget {
  const NewInspectionScreen({required this.route, super.key});

  final NewInspectionRoute route;

  @override
  ConsumerState<NewInspectionScreen> createState() =>
      _NewInspectionScreenState();
}

class _NewInspectionScreenState extends ConsumerState<NewInspectionScreen> {
  @override
  void initState() {
    super.initState();
    // Runs once. See `InspectionWizardController.initialiseFromRoute`'s
    // own doc comment for why this is safe to fire directly here rather
    // than through a family provider this project's Riverpod major
    // cannot be confirmed to support without a resolvable pub cache.
    Future<void>.microtask(
      () => ref
          .read(inspectionWizardControllerProvider.notifier)
          .initialiseFromRoute(widget.route),
    );
  }

  @override
  Widget build(BuildContext context) {
    final InspectionWizardState state = ref.watch(
      inspectionWizardControllerProvider,
    );

    return switch (state.step) {
      InspectionWizardStep.header => _HeaderStep(state: state),
      InspectionWizardStep.tyres => _TyresStep(state: state),
      InspectionWizardStep.review => _ReviewStep(state: state),
      InspectionWizardStep.submitted => _SubmittedStep(state: state),
    };
  }
}

/// The step-progress track shown on every step but the success screen.
class _StepTrack extends StatelessWidget {
  const _StepTrack({required this.current});

  final int current;

  @override
  Widget build(BuildContext context) {
    final TpPalette palette = TpPalette.of(context);
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: <Widget>[
        for (int i = 1; i <= 3; i++) ...<Widget>[
          if (i > 1)
            Container(
              width: 16,
              height: 2,
              color: i <= current ? palette.primary : palette.border,
            ),
          CircleAvatar(
            radius: 12,
            backgroundColor:
                i <= current ? palette.primary : palette.surfaceAlt,
            child: i < current
                ? Icon(Icons.check, size: 14, color: palette.onPrimary)
                : Text(
                    '$i',
                    style: TextStyle(
                      fontSize: 11,
                      fontWeight: FontWeight.w800,
                      color:
                          i == current ? palette.onPrimary : palette.textMuted,
                    ),
                  ),
          ),
        ],
      ],
    );
  }
}

// ---------------------------------------------------------------------------
// Header step
// ---------------------------------------------------------------------------

class _HeaderStep extends ConsumerWidget {
  const _HeaderStep({required this.state});

  final InspectionWizardState state;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final controller = ref.read(inspectionWizardControllerProvider.notifier);

    // Site and meter readings belong to the chosen asset, so they are only
    // asked for once an asset is selected - and they live inside the
    // selected-asset card, directly above the one action that continues.
    final Widget details = KeyedSubtree(
      key: NewInspectionScreenKeys.detailsSection,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: <Widget>[
          _SiteField(state: state, controller: controller),
          const SizedBox(height: TpSpace.lg),
          LayoutBuilder(
            builder: (BuildContext context, BoxConstraints fieldConstraints) {
              final bool sideBySide = fieldConstraints.maxWidth >= 520;
              final Widget odometer = KeyedSubtree(
                key: NewInspectionScreenKeys.odometerField,
                child: TpInput(
                  label: l10n.inspectionOdometerLabel,
                  hint: l10n.inspectionOdometerHint,
                  keyboardType: TextInputType.number,
                  onChanged: controller.setOdometer,
                ),
              );
              final Widget hourMeter = KeyedSubtree(
                key: NewInspectionScreenKeys.hourMeterField,
                child: TpInput(
                  label: l10n.inspectionHourMeterLabel,
                  hint: l10n.inspectionHourMeterHint,
                  keyboardType: const TextInputType.numberWithOptions(
                    decimal: true,
                  ),
                  onChanged: controller.setHourMeter,
                ),
              );

              if (sideBySide) {
                return Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: <Widget>[
                    Expanded(child: odometer),
                    const SizedBox(width: TpSpace.md),
                    Expanded(child: hourMeter),
                  ],
                );
              }
              return Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: <Widget>[
                  odometer,
                  const SizedBox(height: TpSpace.md),
                  hourMeter,
                ],
              );
            },
          ),
        ],
      ),
    );

    return TpScaffold(
      backFallback: TpBackFallbacks.forRoute(const NewInspectionRoute()),
      appBar: TpAppBar(
        title: l10n.inspectionNavTitle,
        backFallback: TpBackFallbacks.forRoute(const NewInspectionRoute()),
      ),
      body: LayoutBuilder(
        builder: (BuildContext context, BoxConstraints constraints) {
          final double horizontalPadding =
              constraints.maxWidth >= 760 ? TpSpace.xxl : TpSpace.lg;

          return ListView(
            padding: EdgeInsets.fromLTRB(
              horizontalPadding,
              TpSpace.lg,
              horizontalPadding,
              TpSpace.xxxl,
            ),
            children: <Widget>[
              Center(
                child: ConstrainedBox(
                  constraints: const BoxConstraints(maxWidth: 820),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: <Widget>[
                      _InspectionHeaderHero(l10n: l10n),
                      const SizedBox(height: TpSpace.lg),
                      if (state.hasVehicle)
                        _SelectedVehicle(
                          key: NewInspectionScreenKeys.vehicleSection,
                          state: state,
                          details: details,
                          onChange: () => controller.pickVehicleByAssetNo(
                            assetNo: '',
                          ),
                          onContinue: state.selectedSite.trim().isEmpty
                              ? null
                              : () => controller.advanceToTyres(),
                        )
                      else
                        _SetupSection(
                          key: NewInspectionScreenKeys.vehicleSection,
                          title: l10n.vehiclesTitle,
                          icon: Icons.directions_car_outlined,
                          iconKey: NewInspectionScreenKeys.vehicleSectionIcon,
                          status: TpStatus.info,
                          child: _VehiclePicker(
                            onPicked: controller.pickVehicleByAssetNo,
                          ),
                        ),
                      if (state.unfinishedDrafts.isNotEmpty &&
                          !state.hasVehicle) ...<Widget>[
                        const SizedBox(height: TpSpace.lg),
                        _SetupSection(
                          key: NewInspectionScreenKeys.resumeSection,
                          title: l10n.inspectionResumeTitle,
                          icon: Icons.history_outlined,
                          status: TpStatus.info,
                          child: Column(
                            children: <Widget>[
                              for (int i = 0;
                                  i < state.unfinishedDrafts.length;
                                  i++) ...<Widget>[
                                if (i > 0) const SizedBox(height: TpSpace.sm),
                                _ResumeDraftRow(
                                  draft: state.unfinishedDrafts[i],
                                  onTap: () => controller.pickVehicleByAssetNo(
                                    assetNo: state.unfinishedDrafts[i].assetNo,
                                    vehicleType:
                                        state.unfinishedDrafts[i].vehicleType,
                                    site: state.unfinishedDrafts[i].site,
                                  ),
                                ),
                              ],
                            ],
                          ),
                        ),
                      ],
                    ],
                  ),
                ),
              ),
            ],
          );
        },
      ),
    );
  }
}

class _InspectionHeaderHero extends StatelessWidget {
  const _InspectionHeaderHero({required this.l10n});

  final AppLocalizations l10n;

  @override
  Widget build(BuildContext context) {
    final TpPalette palette = TpPalette.of(context);
    return TpCard(
      key: NewInspectionScreenKeys.headerHero,
      background: palette.primarySoft,
      borderColor: palette.primary.withValues(alpha: 0.32),
      padding: const EdgeInsets.all(TpSpace.lg),
      child: Row(
        children: <Widget>[
          DecoratedBox(
            decoration: BoxDecoration(
              color: palette.primary,
              borderRadius: BorderRadius.circular(TpRadius.md),
            ),
            child: Padding(
              padding: const EdgeInsets.all(TpSpace.md),
              child: Icon(
                Icons.assignment_outlined,
                color: palette.onPrimary,
                size: TpSizing.iconLg,
              ),
            ),
          ),
          const SizedBox(width: TpSpace.md),
          Expanded(
            child: Text(
              l10n.inspectionNavTitle,
              style: Theme.of(context).textTheme.headlineSmall?.copyWith(
                    fontWeight: FontWeight.w800,
                  ),
            ),
          ),
          const SizedBox(width: TpSpace.sm),
          const _StepTrack(current: 1),
        ],
      ),
    );
  }
}

class _SetupSection extends StatelessWidget {
  const _SetupSection({
    required this.title,
    required this.icon,
    required this.status,
    required this.child,
    this.iconKey,
    super.key,
  });

  final String title;
  final IconData icon;
  final TpStatus status;
  final Widget child;
  final Key? iconKey;

  @override
  Widget build(BuildContext context) {
    final TpPalette palette = TpPalette.of(context);
    final TpStatusColors tone = palette.forStatus(status);
    return TpCard(
      padding: const EdgeInsets.all(TpSpace.lg),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: <Widget>[
          Row(
            children: <Widget>[
              DecoratedBox(
                decoration: BoxDecoration(
                  color: tone.soft,
                  borderRadius: BorderRadius.circular(TpRadius.md),
                ),
                child: Padding(
                  padding: const EdgeInsets.all(TpSpace.sm),
                  child: Icon(
                    icon,
                    key: iconKey,
                    size: TpSizing.iconMd,
                    color: tone.onSoft,
                  ),
                ),
              ),
              const SizedBox(width: TpSpace.md),
              Expanded(
                child: Text(
                  title,
                  style: Theme.of(context).textTheme.titleMedium?.copyWith(
                        fontWeight: FontWeight.w800,
                      ),
                ),
              ),
            ],
          ),
          const SizedBox(height: TpSpace.md),
          child,
        ],
      ),
    );
  }
}

class _ResumeDraftRow extends StatelessWidget {
  const _ResumeDraftRow({required this.draft, required this.onTap});

  final InspectionDraftSummary draft;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final TpPalette palette = TpPalette.of(context);
    final String resolvedClass = resolveVehicleType(
      draft.vehicleType,
      draft.assetNo,
    );
    final _InspectionWorkflowStage workflow = _workflowStage(
      checked: draft.filled,
      total: draft.total,
      readyForReview: draft.total > 0 && draft.filled >= draft.total,
    );
    final String progress = l10n.inspectionResumeProgress(
      draft.filled,
      draft.total,
    );
    return TpCard(
      onTap: onTap,
      background: palette.surfaceAlt,
      padding: const EdgeInsets.all(TpSpace.md),
      child: Row(
        children: <Widget>[
          Icon(_vehicleClassIcon(resolvedClass), color: palette.primary),
          const SizedBox(width: TpSpace.md),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                TpIdentifierText(
                  draft.assetNo,
                  style: Theme.of(context).textTheme.titleSmall,
                ),
                Text(
                  l10n.inspectionWorkflowResumeSummary(
                    _workflowLabel(l10n, workflow),
                    progress,
                  ),
                  key: NewInspectionScreenKeys.resumeWorkflow(draft.assetNo),
                  style: Theme.of(context).textTheme.bodySmall,
                ),
                Text(
                  resolvedClass,
                  key: NewInspectionScreenKeys.resumeVehicleClass(
                    draft.assetNo,
                  ),
                  style: Theme.of(context).textTheme.labelSmall?.copyWith(
                        color: palette.textMuted,
                      ),
                ),
              ],
            ),
          ),
          Icon(
            TpDirection.isRtl(context)
                ? Icons.chevron_left
                : Icons.chevron_right,
            color: palette.textMuted,
          ),
        ],
      ),
    );
  }
}

/// The chosen asset, large, with the one action that continues the wizard.
///
/// Every value shown is read from the asset's own fleet row (or, for a
/// manually typed or resumed asset the register does not carry, from the
/// asset number alone). Nothing is estimated: no meter reading, no due date
/// and no last-inspected date is shown because the register does not hold
/// one for this screen to read.
class _SelectedVehicle extends ConsumerWidget {
  const _SelectedVehicle({
    required this.state,
    required this.details,
    required this.onChange,
    required this.onContinue,
    super.key,
  });

  final InspectionWizardState state;
  final Widget details;
  final VoidCallback onChange;
  final VoidCallback? onContinue;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final TpPalette palette = TpPalette.of(context);
    final TextTheme text = Theme.of(context).textTheme;
    final VehicleAsset? asset = _findFleetAsset(
      ref.watch(vehicleFleetListProvider),
      state.selectedAssetNo,
    );
    final String resolvedClass = resolveVehicleTypeFor(
      vehicleType: asset?.vehicleType ?? state.selectedVehicleType,
      assetNo: state.selectedAssetNo,
      make: asset?.make,
      model: asset?.model,
    );
    final String? classCode = assetClassOf(state.selectedAssetNo);
    final String? photo = asset == null ? null : vehiclePhotoAsset(asset);
    final String makeModel = <String?>[asset?.make, asset?.model]
        .whereType<String>()
        .map((String value) => value.trim())
        .where((String value) => value.isNotEmpty)
        .toSet()
        .join(' · ');
    final String? site = asset?.site?.trim().isNotEmpty == true
        ? asset!.site!.trim()
        : (state.selectedSite.trim().isEmpty
            ? null
            : state.selectedSite.trim());
    final String? displayStatus = _displayStatus(asset);

    final Widget image = Container(
      key: NewInspectionScreenKeys.selectedVehicleImage,
      height: 176,
      alignment: Alignment.center,
      clipBehavior: Clip.antiAlias,
      decoration: BoxDecoration(
        color: palette.surfaceAlt,
        borderRadius: BorderRadius.circular(TpRadius.lg),
        border: Border.all(color: palette.border),
      ),
      child: photo == null
          ? Icon(
              asset == null
                  ? _vehicleClassIcon(resolvedClass)
                  : vehicleFallbackIcon(asset),
              size: 72,
              color: palette.primary,
            )
          : Padding(
              padding: const EdgeInsets.all(TpSpace.sm),
              child: Image.asset(
                photo,
                width: double.infinity,
                height: double.infinity,
                fit: BoxFit.contain,
                filterQuality: FilterQuality.high,
                semanticLabel: asset?.displayIdentity,
              ),
            ),
    );

    final Widget identity = Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      mainAxisSize: MainAxisSize.min,
      children: <Widget>[
        Row(
          children: <Widget>[
            _ClassBadge(
              icon: _vehicleClassIcon(resolvedClass),
              iconKey: NewInspectionScreenKeys.vehicleSectionIcon,
              code: classCode,
            ),
            const Spacer(),
            TpButton.text(
              key: NewInspectionScreenKeys.selectedChange,
              label: l10n.inspectionChangeVehicleButton,
              icon: Icons.swap_horiz_rounded,
              onPressed: onChange,
            ),
          ],
        ),
        const SizedBox(height: TpSpace.xs),
        TpIdentifierText(
          state.selectedAssetNo,
          style: text.headlineSmall?.copyWith(
            color: palette.text,
            fontWeight: FontWeight.w900,
          ),
        ),
        const SizedBox(height: 2),
        Text(
          resolvedClass,
          key: NewInspectionScreenKeys.selectedVehicleClass,
          style: text.titleMedium?.copyWith(color: palette.textSecondary),
        ),
        if (makeModel.isNotEmpty)
          Text(
            makeModel,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: text.bodySmall?.copyWith(color: palette.textSecondary),
          ),
        if (asset?.registrationNo?.trim().isNotEmpty == true)
          Text(
            asset!.registrationNo!.trim(),
            style: text.labelSmall?.copyWith(color: palette.textMuted),
          ),
        if (site != null) ...<Widget>[
          const SizedBox(height: TpSpace.sm),
          _IconLine(icon: Icons.location_on_outlined, label: site),
        ],
        if (displayStatus != null) ...<Widget>[
          const SizedBox(height: TpSpace.sm),
          TpStatusChip(
            status: vehicleStatusTone(displayStatus),
            label: displayStatus,
            isCompact: true,
          ),
        ],
      ],
    );

    return TpCard(
      borderColor: palette.primary.withValues(alpha: 0.42),
      padding: const EdgeInsets.all(TpSpace.lg),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: <Widget>[
          Text(
            l10n.inspectionSelectedAssetTitle,
            style: text.titleSmall?.copyWith(
              color: palette.textSecondary,
              fontWeight: FontWeight.w800,
            ),
          ),
          const SizedBox(height: TpSpace.md),
          LayoutBuilder(
            builder: (BuildContext context, BoxConstraints constraints) {
              if (constraints.maxWidth >= 520) {
                return Row(
                  crossAxisAlignment: CrossAxisAlignment.center,
                  children: <Widget>[
                    Expanded(flex: 11, child: image),
                    const SizedBox(width: TpSpace.lg),
                    Expanded(flex: 9, child: identity),
                  ],
                );
              }
              return Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: <Widget>[
                  image,
                  const SizedBox(height: TpSpace.md),
                  identity,
                ],
              );
            },
          ),
          const SizedBox(height: TpSpace.lg),
          Divider(height: 1, color: palette.border),
          const SizedBox(height: TpSpace.lg),
          Text(
            l10n.inspectionDetailTitle,
            style: text.titleSmall?.copyWith(fontWeight: FontWeight.w800),
          ),
          const SizedBox(height: TpSpace.md),
          details,
          const SizedBox(height: TpSpace.xl),
          TpButton.primary(
            key: NewInspectionScreenKeys.selectedContinue,
            label: l10n.inspectionNextButton,
            icon: Icons.arrow_forward,
            isFullWidth: true,
            onPressed: onContinue,
          ),
        ],
      ),
    );
  }
}

/// The asset-number class prefix (`TM`, `MP`, ...) as a small badge, with
/// the resolved vehicle class icon. A code with no recognisable prefix shows
/// the icon alone - a class is never invented for it.
class _ClassBadge extends StatelessWidget {
  const _ClassBadge({required this.icon, required this.code, this.iconKey});

  final IconData icon;
  final String? code;
  final Key? iconKey;

  @override
  Widget build(BuildContext context) {
    final TpPalette palette = TpPalette.of(context);
    return Container(
      padding: const EdgeInsets.symmetric(
        horizontal: TpSpace.sm,
        vertical: TpSpace.xs,
      ),
      decoration: BoxDecoration(
        color: palette.primarySoft,
        borderRadius: BorderRadius.circular(TpRadius.sm),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: <Widget>[
          Icon(
            icon,
            key: iconKey,
            size: TpSizing.iconSm,
            color: palette.primary,
          ),
          if (code != null) ...<Widget>[
            const SizedBox(width: TpSpace.xs),
            TpIdentifierText(
              code!,
              style: Theme.of(context).textTheme.labelSmall?.copyWith(
                    color: palette.primary,
                    fontWeight: FontWeight.w800,
                    letterSpacing: 0.6,
                  ),
            ),
          ],
        ],
      ),
    );
  }
}

class _IconLine extends StatelessWidget {
  const _IconLine({required this.icon, required this.label});

  final IconData icon;
  final String label;

  @override
  Widget build(BuildContext context) {
    final TpPalette palette = TpPalette.of(context);
    return Row(
      children: <Widget>[
        Icon(icon, size: TpSizing.iconSm, color: palette.textMuted),
        const SizedBox(width: TpSpace.xs),
        Flexible(
          child: Text(
            label,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: Theme.of(context).textTheme.labelMedium?.copyWith(
                  color: palette.textSecondary,
                ),
          ),
        ),
      ],
    );
  }
}

/// The asset's operational status when recorded, else its register status.
/// Null when neither is recorded - the chip is then omitted, not faked.
String? _displayStatus(VehicleAsset? asset) {
  final String? ops = asset?.opsStatus?.trim();
  if (ops != null && ops.isNotEmpty) return ops;
  final String? status = asset?.status?.trim();
  return (status == null || status.isEmpty) ? null : status;
}

class _SiteField extends StatelessWidget {
  const _SiteField({required this.state, required this.controller});

  final InspectionWizardState state;
  final InspectionWizardController controller;

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    if (state.availableSites.isEmpty) {
      return TpInput(
        label: l10n.inspectionSiteLabel,
        isRequired: true,
        hint: l10n.inspectionTypeSiteName,
        onChanged: controller.setSite,
      );
    }
    return TpDropdown<String>(
      label: l10n.inspectionSiteLabel,
      isRequired: true,
      value: state.selectedSite.isEmpty ? null : state.selectedSite,
      items: <TpDropdownItem<String>>[
        for (final String s in state.availableSites)
          TpDropdownItem<String>(value: s, label: s),
      ],
      onChanged: (String? v) {
        if (v != null) controller.setSite(v);
      },
    );
  }
}

class _VehiclePicker extends ConsumerStatefulWidget {
  const _VehiclePicker({required this.onPicked});

  final void Function({
    required String assetNo,
    String? vehicleType,
    String? site,
  }) onPicked;

  @override
  ConsumerState<_VehiclePicker> createState() => _VehiclePickerState();
}

/// How many matches the picker lists at once. The list is a way to pick one
/// asset, not a register, so more than this asks the inspector to narrow
/// the search - and says so rather than truncating silently.
const int _kPickerMatchLimit = 30;

class _VehiclePickerState extends ConsumerState<_VehiclePicker> {
  final TextEditingController _search = TextEditingController();
  bool _manual = false;
  final TextEditingController _manualAsset = TextEditingController();

  /// The asset-number class prefix the list is narrowed to, or null for all.
  String? _classFilter;

  @override
  void dispose() {
    _search.dispose();
    _manualAsset.dispose();
    super.dispose();
  }

  Future<void> _scanAsset() async {
    final String? scanned = await context.push<String>(
      const ScannerRoute().location,
    );
    if (!mounted || scanned == null || scanned.trim().isEmpty) return;
    final String assetNo = scanned.trim();
    final VehicleAsset? asset = _findFleetAsset(
      ref.read(vehicleFleetListProvider),
      assetNo,
    );
    widget.onPicked(
      assetNo: asset?.assetNo?.trim() ?? assetNo,
      vehicleType: asset?.vehicleType,
      site: asset?.site,
    );
  }

  void _pick(VehicleAsset asset) {
    widget.onPicked(
      assetNo: asset.assetNo!,
      vehicleType: resolveVehicleTypeFor(
        vehicleType: asset.vehicleType,
        assetNo: asset.assetNo,
        make: asset.make,
        model: asset.model,
      ),
      site: asset.site,
    );
  }

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final TextTheme text = Theme.of(context).textTheme;

    if (_manual) {
      return Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          TpInput(
            label: l10n.inspectionManualAssetLabel,
            controller: _manualAsset,
            textCapitalization: TextCapitalization.characters,
          ),
          const SizedBox(height: TpSpace.sm),
          Row(
            children: <Widget>[
              TpButton.primary(
                label: l10n.inspectionManualUseButton,
                onPressed: () {
                  final String assetNo = _manualAsset.text.trim();
                  if (assetNo.isEmpty) return;
                  widget.onPicked(assetNo: assetNo);
                },
              ),
              const SizedBox(width: TpSpace.sm),
              TpButton.text(
                label: l10n.actionBack,
                onPressed: () => setState(() => _manual = false),
              ),
            ],
          ),
        ],
      );
    }

    final AsyncValue<VehicleFleetListOutcome> asyncFleet =
        ref.watch(vehicleFleetListProvider);
    final bool isLoading = asyncFleet.isLoading && !asyncFleet.hasValue;
    final bool failed = asyncFleet.hasError ||
        asyncFleet.maybeWhen(
          data: (VehicleFleetListOutcome outcome) =>
              outcome is VehicleFleetListFailed,
          orElse: () => false,
        );
    final List<VehicleAsset> unique = _uniqueNavigableAssets(asyncFleet);
    final List<AssetClassChip> chips = classChips(
      unique.map((VehicleAsset asset) => asset.assetNo),
    );
    // A class the fleet no longer carries cannot stay selected invisibly.
    final String? classFilter = chips.any(
      (AssetClassChip chip) => chip.assetClass == _classFilter,
    )
        ? _classFilter
        : null;

    final String query = _search.text.trim().toLowerCase();
    final bool browsing = query.isNotEmpty || classFilter != null;
    // A typed search always covers the WHOLE fleet: a class chip only shapes
    // browsing and must never make a real asset unfindable (the same rule
    // `applyVehicleFilters` carries over from production).
    final List<VehicleAsset> allMatches = !browsing
        ? const <VehicleAsset>[]
        : unique
            .where(
              (VehicleAsset asset) => query.isNotEmpty
                  ? vehicleMatchesSearch(asset, query)
                  : assetClassOf(asset.assetNo) == classFilter,
            )
            .toList(growable: false);
    final List<VehicleAsset> matches =
        allMatches.take(_kPickerMatchLimit).toList(growable: false);

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: <Widget>[
        KeyedSubtree(
          key: NewInspectionScreenKeys.vehicleScanner,
          child: TpButton.primary(
            label: l10n.inspectionScanAssetButton,
            icon: Icons.qr_code_scanner_rounded,
            isFullWidth: true,
            onPressed: _scanAsset,
          ),
        ),
        const SizedBox(height: TpSpace.md),
        TpSearchField(
          controller: _search,
          hint: l10n.inspectionVehicleSearchPlaceholder,
          onChanged: (_) => setState(() {}),
        ),
        if (chips.isNotEmpty) ...<Widget>[
          const SizedBox(height: TpSpace.md),
          _ClassFilterRow(
            key: NewInspectionScreenKeys.pickerClassFilters,
            chips: chips,
            selected: classFilter,
            allLabel: '${l10n.vehiclesAllFilter} (${unique.length})',
            onSelect: (String? value) => setState(() => _classFilter = value),
          ),
        ],
        const SizedBox(height: TpSpace.md),
        if (isLoading)
          const LinearProgressIndicator()
        else if (failed && unique.isEmpty)
          Row(
            children: <Widget>[
              Expanded(
                child: Text(l10n.stateErrorTitle, style: text.bodySmall),
              ),
              TpButton.text(
                label: l10n.actionRetry,
                icon: Icons.refresh_rounded,
                onPressed: () => ref.invalidate(vehicleFleetListProvider),
              ),
            ],
          )
        else if (!browsing)
          Text(l10n.inspectionSearchToBeginHint, style: text.bodySmall)
        else if (matches.isEmpty)
          Text(l10n.inspectionVehicleNoMatch, style: text.bodySmall)
        else ...<Widget>[
          for (int index = 0; index < matches.length; index++) ...<Widget>[
            if (index > 0) const SizedBox(height: TpSpace.sm),
            _VehicleChip(
              asset: matches[index],
              onTap: () => _pick(matches[index]),
            ),
          ],
          if (allMatches.length > matches.length) ...<Widget>[
            const SizedBox(height: TpSpace.sm),
            Text(
              l10n.vehiclesTruncatedNotice,
              key: NewInspectionScreenKeys.pickerTruncated,
              style: text.labelSmall,
            ),
          ],
        ],
        const SizedBox(height: TpSpace.sm),
        Align(
          alignment: AlignmentDirectional.centerStart,
          child: TpButton.text(
            label: l10n.inspectionEnterAssetManually,
            icon: Icons.edit_outlined,
            onPressed: () => setState(() => _manual = true),
          ),
        ),
      ],
    );
  }
}

/// The loaded fleet, collapsed to one row per business asset number.
///
/// The fleet view can contain more than one source row for the same asset
/// number. An inspector must never see two identical choices and risk
/// starting the draft against an arbitrary duplicate, so rows are collapsed
/// by the normalised asset number while preserving the repository's order.
List<VehicleAsset> _uniqueNavigableAssets(
  AsyncValue<VehicleFleetListOutcome> fleet,
) {
  final List<VehicleAsset> assets = fleet.maybeWhen(
    data: (VehicleFleetListOutcome outcome) => switch (outcome) {
      VehicleFleetListLoaded(:final assets) => assets,
      VehicleFleetListFromCache(:final assets) => assets,
      VehicleFleetListFailed() => const <VehicleAsset>[],
    },
    orElse: () => const <VehicleAsset>[],
  );
  final Map<String, VehicleAsset> unique = <String, VehicleAsset>{};
  for (final VehicleAsset asset in assets) {
    if (!asset.hasNavigableAssetNo) continue;
    unique.putIfAbsent(asset.assetNo!.trim().toUpperCase(), () => asset);
  }
  return unique.values.toList(growable: false);
}

/// Class filter chips derived from the loaded fleet's asset-number prefixes
/// ([classChips]); tyre-carrying classes first. No invented buckets.
class _ClassFilterRow extends StatelessWidget {
  const _ClassFilterRow({
    required this.chips,
    required this.selected,
    required this.allLabel,
    required this.onSelect,
    super.key,
  });

  final List<AssetClassChip> chips;
  final String? selected;
  final String allLabel;
  final ValueChanged<String?> onSelect;

  @override
  Widget build(BuildContext context) {
    // A handful of classes at most, so every chip is built (a lazy list
    // would leave off-screen chips unreachable to assistive technology).
    return SingleChildScrollView(
      scrollDirection: Axis.horizontal,
      child: Row(
        children: <Widget>[
          _ClassFilterChip(
            label: allLabel,
            isSelected: selected == null,
            onTap: () => onSelect(null),
          ),
          for (final AssetClassChip chip in chips) ...<Widget>[
            const SizedBox(width: TpSpace.xs),
            _ClassFilterChip(
              key: NewInspectionScreenKeys.pickerClassChip(chip.assetClass),
              label: '${chip.assetClass} (${chip.count})',
              isSelected: selected == chip.assetClass,
              onTap: () => onSelect(
                selected == chip.assetClass ? null : chip.assetClass,
              ),
            ),
          ],
        ],
      ),
    );
  }
}

class _ClassFilterChip extends StatelessWidget {
  const _ClassFilterChip({
    required this.label,
    required this.isSelected,
    required this.onTap,
    super.key,
  });

  final String label;
  final bool isSelected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final TpPalette palette = TpPalette.of(context);
    return ChoiceChip(
      label: Text(label),
      selected: isSelected,
      onSelected: (bool _) => onTap(),
      showCheckmark: false,
      backgroundColor: palette.surfaceAlt,
      selectedColor: palette.primary,
      labelStyle: Theme.of(context).textTheme.labelMedium?.copyWith(
            color: isSelected ? palette.onPrimary : palette.text,
            fontWeight: FontWeight.w700,
          ),
      side: BorderSide(
        color: isSelected ? palette.primary : palette.border,
        width: TpBorderWidth.hairline,
      ),
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(TpRadius.pill),
      ),
      materialTapTargetSize: MaterialTapTargetSize.shrinkWrap,
      visualDensity: VisualDensity.compact,
    );
  }
}

/// One match: photo, bold asset number, resolved class, site and status.
/// Only fields the fleet row actually carries are rendered.
class _VehicleChip extends StatelessWidget {
  const _VehicleChip({required this.asset, required this.onTap});

  final VehicleAsset asset;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final TpPalette palette = TpPalette.of(context);
    final TextTheme text = Theme.of(context).textTheme;
    final String resolvedClass = resolveVehicleTypeFor(
      vehicleType: asset.vehicleType,
      assetNo: asset.assetNo,
      make: asset.make,
      model: asset.model,
    );
    final String? photo = vehiclePhotoAsset(asset);
    final String? site =
        asset.site?.trim().isNotEmpty == true ? asset.site!.trim() : null;
    final String? displayStatus = _displayStatus(asset);
    return Semantics(
      button: true,
      label: asset.assetNo,
      child: Material(
        color: palette.surface,
        shape: RoundedRectangleBorder(
          side: BorderSide(color: palette.border),
          borderRadius: BorderRadius.circular(TpRadius.lg),
        ),
        clipBehavior: Clip.antiAlias,
        child: InkWell(
          key: NewInspectionScreenKeys.pickerRow(asset.assetNo!),
          onTap: onTap,
          child: Padding(
            padding: const EdgeInsets.all(TpSpace.sm),
            child: Row(
              children: <Widget>[
                Container(
                  width: 88,
                  height: 68,
                  alignment: Alignment.center,
                  clipBehavior: Clip.antiAlias,
                  decoration: BoxDecoration(
                    color: palette.surfaceAlt,
                    borderRadius: BorderRadius.circular(TpRadius.md),
                  ),
                  child: photo == null
                      ? Icon(
                          vehicleFallbackIcon(asset),
                          color: palette.primary,
                          size: 32,
                        )
                      : Padding(
                          padding: const EdgeInsets.all(TpSpace.xs),
                          child: Image.asset(
                            photo,
                            fit: BoxFit.contain,
                            filterQuality: FilterQuality.medium,
                            semanticLabel: asset.displayIdentity,
                          ),
                        ),
                ),
                const SizedBox(width: TpSpace.md),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    mainAxisSize: MainAxisSize.min,
                    children: <Widget>[
                      TpIdentifierText(
                        asset.assetNo ?? '',
                        style: text.titleMedium?.copyWith(
                          color: palette.text,
                          fontWeight: FontWeight.w900,
                        ),
                      ),
                      Text(
                        resolvedClass,
                        key: NewInspectionScreenKeys.pickerVehicleClass(
                          asset.assetNo!,
                        ),
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: text.bodySmall?.copyWith(
                          color: palette.textSecondary,
                        ),
                      ),
                      if (site != null) ...<Widget>[
                        const SizedBox(height: TpSpace.xs),
                        _IconLine(
                          icon: Icons.location_on_outlined,
                          label: site,
                        ),
                      ],
                    ],
                  ),
                ),
                const SizedBox(width: TpSpace.sm),
                Column(
                  crossAxisAlignment: CrossAxisAlignment.end,
                  mainAxisSize: MainAxisSize.min,
                  children: <Widget>[
                    if (displayStatus != null) ...<Widget>[
                      ConstrainedBox(
                        constraints: const BoxConstraints(maxWidth: 110),
                        child: TpStatusChip(
                          status: vehicleStatusTone(displayStatus),
                          label: displayStatus,
                          isCompact: true,
                        ),
                      ),
                      const SizedBox(height: TpSpace.sm),
                    ],
                    Icon(
                      TpDirection.isRtl(context)
                          ? Icons.chevron_left_rounded
                          : Icons.chevron_right_rounded,
                      color: palette.textSecondary,
                    ),
                  ],
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

VehicleAsset? _findFleetAsset(
  AsyncValue<VehicleFleetListOutcome> fleet,
  String assetNo,
) {
  final String wanted = assetNo.trim().toUpperCase();
  if (wanted.isEmpty) return null;
  final List<VehicleAsset> assets = fleet.maybeWhen(
    data: (VehicleFleetListOutcome outcome) => switch (outcome) {
      VehicleFleetListLoaded(:final assets) => assets,
      VehicleFleetListFromCache(:final assets) => assets,
      VehicleFleetListFailed() => const <VehicleAsset>[],
    },
    orElse: () => const <VehicleAsset>[],
  );
  for (final VehicleAsset asset in assets) {
    if (asset.assetNo?.trim().toUpperCase() == wanted) return asset;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Tyres step
// ---------------------------------------------------------------------------

class _TyresStep extends ConsumerStatefulWidget {
  const _TyresStep({required this.state});

  final InspectionWizardState state;

  @override
  ConsumerState<_TyresStep> createState() => _TyresStepState();
}

class _TyresStepState extends ConsumerState<_TyresStep> {
  String? _selectedPosition;

  @override
  Widget build(BuildContext context) {
    final InspectionWizardState state = widget.state;
    final AppLocalizations l10n = AppLocalizations.of(context);
    final TpPalette palette = TpPalette.of(context);
    final controller = ref.read(inspectionWizardControllerProvider.notifier);
    final String resolvedClass = resolveVehicleType(
      state.selectedVehicleType,
      state.selectedAssetNo,
    );
    final double mapWidth =
        (MediaQuery.sizeOf(context).width - (TpSpace.lg * 2))
            .clamp(220, 380)
            .toDouble();
    final String? selectedPosition = _resolvedSelection(state);
    final TyrePositionReading? selectedReading = selectedPosition == null
        ? null
        : state.tyreConditions[selectedPosition];

    return TpScaffold(
      backgroundColor: palette.surface,
      backFallback: TpBackFallbacks.forRoute(const NewInspectionRoute()),
      appBar: TpAppBar(
        title: l10n.inspectionDetailTitle,
        onBack: () => controller.backToHeader(),
        actions: <Widget>[
          Padding(
            padding: const EdgeInsetsDirectional.only(end: TpSpace.lg),
            child: Center(
              child: _InspectionDraftChip(
                label: l10n.inspectionDraftLabel,
              ),
            ),
          ),
        ],
      ),
      bottomNavigationBar: _InspectionTyresActionBar(
        label: l10n.inspectionSaveAndNext,
        enabled: state.touchedCount > 0 && state.completeness.ok,
        onPressed: controller.advanceToReview,
      ),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(
          TpSpace.lg,
          TpSpace.lg,
          TpSpace.lg,
          TpSpace.xxxl,
        ),
        children: <Widget>[
          _TyreInspectionContextCard(
            state: state,
            resolvedClass: resolvedClass,
            controller: controller,
            onNextOutstanding: _nextOutstanding(state) == null
                ? null
                : () => setState(
                      () => _selectedPosition = _nextOutstanding(state),
                    ),
          ),
          const SizedBox(height: TpSpace.sm),
          const _InspectionConditionLegend(),
          const SizedBox(height: TpSpace.lg),
          TyreDiagramBoard(
            key: NewInspectionScreenKeys.tyreDiagramBoard,
            vehicleType: resolvedClass,
            assetNo: state.selectedAssetNo,
            positions: state.positions,
            tyreData: <String, Map<String, Object?>>{
              for (final String position in state.positions)
                if ((state.tyreConditions[position]?.isTouched ?? false) ||
                    state.installedTyres.containsKey(position))
                  position: <String, Object?>{
                    ...?state.tyreConditions[position]?.toEntry(),
                    if (state.installedTyres[position]?.serialNo != null)
                      'installed_serial':
                          state.installedTyres[position]!.serialNo,
                    if (state.installedTyres[position]?.brand != null)
                      'installed_brand': state.installedTyres[position]!.brand,
                    if (state.installedTyres[position]?.size != null)
                      'installed_size': state.installedTyres[position]!.size,
                  },
            },
            selectedPosition: selectedPosition,
            onPositionTap: (String position) {
              setState(() => _selectedPosition = position);
              _openTyreDetail(context, ref, position);
            },
            pending: TyreDiagramPending.fromCompleteness(state.completeness),
            // The diagram's SVG viewport scales with width. Letting a 720px
            // handset use the full canvas makes a mixer/pump taller than the
            // visible work area and hides the last dual axle behind the fixed
            // Review bar. The compact capture map stays centred and capped;
            // painted rear duals and 48px hit targets remain unchanged.
            width: mapWidth,
            compact: true,
            captureMode: true,
          ),
          const SizedBox(height: TpSpace.md),
          if (selectedPosition == null || selectedReading == null) ...<Widget>[
            _TyreSelectionPrompt(
              message: l10n.inspectionWorkflowTapTyre,
            ),
            const SizedBox(height: TpSpace.sm),
            const _InspectionEvidenceRow(
              reading: null,
              enabled: false,
              onTap: null,
            ),
          ] else
            _SelectedInspectionTyreCard(
              position: selectedPosition,
              vehicleType: resolvedClass,
              reading: selectedReading,
              installedTyre: state.installedTyres[selectedPosition],
              index: state.positions.indexOf(selectedPosition),
              total: state.positions.length,
              previousPosition: _neighbour(state, selectedPosition, -1),
              nextPosition: _neighbour(state, selectedPosition, 1),
              onSelect: (String position) =>
                  setState(() => _selectedPosition = position),
              onEdit: () => _openEditor(context, ref, selectedPosition),
            ),
        ],
      ),
    );
  }

  /// The wheel [delta] steps away from [position] in layout order, wrapping
  /// at either end. `null` when there is no other wheel to move to.
  String? _neighbour(
    InspectionWizardState state,
    String position,
    int delta,
  ) {
    final List<String> positions = state.positions;
    if (positions.length < 2) return null;
    final int index = positions.indexOf(position);
    if (index < 0) return null;
    // Dart's `%` is never negative for a positive divisor, so this wraps
    // the first wheel back to the last one as well.
    return positions[(index + delta) % positions.length];
  }

  /// The first wheel, in layout order, that still has no evidence at all -
  /// the same "touched" rule the progress count uses.
  String? _nextOutstanding(InspectionWizardState state) {
    for (final String position in state.positions) {
      if (state.tyreConditions[position]?.isTouched != true) return position;
    }
    return null;
  }

  String? _resolvedSelection(InspectionWizardState state) {
    final String? local = _selectedPosition;
    if (local != null && state.positions.contains(local)) return local;
    final String? active = state.activePosition;
    if (active != null && state.positions.contains(active)) return active;
    for (final MapEntry<String, TyrePositionReading> entry
        in state.tyreConditions.entries.toList().reversed) {
      if (entry.value.isTouched && state.positions.contains(entry.key)) {
        return entry.key;
      }
    }
    return null;
  }

  /// A new wheel opens the data-entry surface immediately, matching the
  /// approved map -> details flow. A wheel that already has a reading opens
  /// its richer detail/action screen first so the inspector can review before
  /// replacing evidence. [_openEditor] remains the one write surface.
  void _openTyreDetail(BuildContext context, WidgetRef ref, String position) {
    final InspectionWizardState state = widget.state;
    final Map<String, Object?>? entry =
        state.tyreConditions[position]?.toEntry();
    if (entry == null || entry['checked'] != true) {
      _openEditor(context, ref, position);
      return;
    }
    unawaited(
      pushTyreDetailScreen(
        context,
        positionCode: position,
        vehicleType: state.selectedVehicleType,
        entry: entry,
        assetNo: state.selectedAssetNo,
        siteName: state.selectedSite,
        onAdjustReading: () {
          Navigator.of(context).pop();
          Navigator.of(context).pop();
          _openEditor(context, ref, position);
        },
      ),
    );
  }

  void _openEditor(BuildContext context, WidgetRef ref, String position) {
    final controller = ref.read(inspectionWizardControllerProvider.notifier);
    controller.openPosition(position);
    TpBottomSheet.show<void>(
      context: context,
      builder: (sheetContext) => Consumer(
        builder: (sheetContext, sheetRef, _) {
          final InspectionWizardState liveState = sheetRef.watch(
            inspectionWizardControllerProvider,
          );
          final TyrePositionReading reading =
              liveState.tyreConditions[position] ??
                  TyrePositionReading.seed(position);
          return TyrePositionEditorSheet(
            reading: reading,
            installedTyre: liveState.installedTyres[position],
            isCapturingPhoto: liveState.isCapturingPhoto,
            onChanged: (updated) => sheetRef
                .read(inspectionWizardControllerProvider.notifier)
                .updateTyreReading(updated),
            onCapturePhoto: (source) => sheetRef
                .read(inspectionWizardControllerProvider.notifier)
                .capturePhotoForActivePosition(source),
          );
        },
      ),
    ).whenComplete(controller.closePosition);
  }
}

class _TyreInspectionContextCard extends StatelessWidget {
  const _TyreInspectionContextCard({
    required this.state,
    required this.resolvedClass,
    required this.controller,
    required this.onNextOutstanding,
  });

  final InspectionWizardState state;
  final String resolvedClass;
  final InspectionWizardController controller;

  /// Selects the first wheel that still has no evidence. `null` once every
  /// wheel has been attended to, which hides the chevron: a chevron with
  /// nowhere to go would be a control that does nothing.
  final VoidCallback? onNextOutstanding;

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final TpPalette palette = TpPalette.of(context);
    final int total = state.positions.length;
    final int checked = state.touchedCount;
    final bool readyForReview = checked > 0 && state.completeness.ok;
    final _InspectionWorkflowStage workflow = _workflowStage(
      checked: checked,
      total: total,
      readyForReview: readyForReview,
    );
    final String helper = switch (workflow) {
      _InspectionWorkflowStage.notStarted => l10n.inspectionWorkflowTapTyre,
      _InspectionWorkflowStage.inProgress =>
        l10n.inspectionWorkflowContinueChecking,
      _InspectionWorkflowStage.readyForReview =>
        l10n.inspectionWorkflowAllChecked,
    };
    return TpCard(
      padding: const EdgeInsets.all(TpSpace.md),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: <Widget>[
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: <Widget>[
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: <Widget>[
                    TpIdentifierText(
                      state.selectedAssetNo,
                      style:
                          Theme.of(context).textTheme.headlineSmall?.copyWith(
                                fontWeight: FontWeight.w800,
                              ),
                    ),
                    const SizedBox(height: 2),
                    Text(
                      l10n.inspectionTyreConfiguration(total),
                      style: Theme.of(context).textTheme.titleMedium?.copyWith(
                            fontWeight: FontWeight.w700,
                          ),
                    ),
                    const SizedBox(height: 2),
                    Text(
                      resolvedClass,
                      key: NewInspectionScreenKeys.tyreContextVehicleClass,
                      style: Theme.of(context).textTheme.bodySmall?.copyWith(
                            color: palette.textSecondary,
                          ),
                    ),
                  ],
                ),
              ),
              TpStatusChip(
                key: NewInspectionScreenKeys.tyreWorkflowStatus,
                status: _workflowTone(workflow),
                label: _workflowLabel(l10n, workflow),
                isCompact: true,
              ),
              const SizedBox(width: TpSpace.xs),
              _GpsChip(state: state, controller: controller),
            ],
          ),
          const SizedBox(height: TpSpace.lg),
          Semantics(
            button: onNextOutstanding != null,
            child: InkWell(
              onTap: onNextOutstanding,
              borderRadius: BorderRadius.circular(TpRadius.sm),
              child: Row(
                children: <Widget>[
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: <Widget>[
                        Text(
                          l10n.inspectionStepOfTotal(2, 4),
                          style:
                              Theme.of(context).textTheme.titleSmall?.copyWith(
                                    color: palette.textSecondary,
                                    fontWeight: FontWeight.w700,
                                  ),
                        ),
                        const SizedBox(height: TpSpace.sm),
                        _SegmentedProgressBar(checked: checked, total: total),
                      ],
                    ),
                  ),
                  const SizedBox(width: TpSpace.md),
                  Column(
                    crossAxisAlignment: CrossAxisAlignment.end,
                    children: <Widget>[
                      Text(
                        '$checked / $total',
                        textDirection: TextDirection.ltr,
                        style:
                            Theme.of(context).textTheme.headlineSmall?.copyWith(
                                  color: palette.primary,
                                  fontWeight: FontWeight.w800,
                                ),
                      ),
                      Text(
                        l10n.inspectionResumeProgress(checked, total),
                        key: NewInspectionScreenKeys.tyreWorkflowProgress,
                        style: Theme.of(context).textTheme.labelSmall?.copyWith(
                              color: palette.textSecondary,
                              fontWeight: FontWeight.w700,
                            ),
                      ),
                    ],
                  ),
                  if (onNextOutstanding != null) ...<Widget>[
                    const SizedBox(width: TpSpace.xs),
                    Icon(
                      Icons.chevron_right_rounded,
                      color: palette.textSecondary,
                      size: TpSizing.iconLg,
                    ),
                  ],
                ],
              ),
            ),
          ),
          const SizedBox(height: TpSpace.sm),
          Text(
            helper,
            key: NewInspectionScreenKeys.tyreWorkflowHelper,
            maxLines: 2,
            overflow: TextOverflow.ellipsis,
            style: Theme.of(context).textTheme.labelSmall?.copyWith(
                  color: workflow == _InspectionWorkflowStage.readyForReview
                      ? palette.ok.onSoft
                      : palette.textSecondary,
                ),
          ),
        ],
      ),
    );
  }
}

/// One segment per tyre position, filled for each wheel with evidence.
class _SegmentedProgressBar extends StatelessWidget {
  const _SegmentedProgressBar({required this.checked, required this.total});

  final int checked;
  final int total;

  @override
  Widget build(BuildContext context) {
    final TpPalette palette = TpPalette.of(context);
    final int segments = total == 0 ? 1 : total;
    return Row(
      children: <Widget>[
        for (int index = 0; index < segments; index++) ...<Widget>[
          Expanded(
            child: DecoratedBox(
              decoration: BoxDecoration(
                color:
                    index < checked ? palette.primary : palette.surfaceSunken,
                borderRadius: BorderRadius.circular(TpRadius.pill),
              ),
              child: const SizedBox(height: 6),
            ),
          ),
          if (index < segments - 1) const SizedBox(width: 3),
        ],
      ],
    );
  }
}

class _InspectionConditionLegend extends StatelessWidget {
  const _InspectionConditionLegend();

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final TpPalette palette = TpPalette.of(context);
    const SizedBox gap = SizedBox(width: TpSpace.lg);
    return TpCard(
      padding: const EdgeInsets.symmetric(
        horizontal: TpSpace.sm,
        vertical: TpSpace.sm,
      ),
      // One row on every width: a long translation shrinks the row slightly
      // rather than wrapping or cutting a label off.
      child: FittedBox(
        fit: BoxFit.scaleDown,
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: <Widget>[
            _ConditionLegendItem(
              icon: Icons.check_circle_rounded,
              color: palette.ok.base,
              label: l10n.tyreConditionGood,
            ),
            gap,
            _ConditionLegendItem(
              icon: Icons.error_rounded,
              color: palette.warning.base,
              label: l10n.statusWarning,
            ),
            gap,
            _ConditionLegendItem(
              icon: Icons.warning_rounded,
              color: palette.critical.base,
              label: l10n.statusCritical,
            ),
            gap,
            _ConditionLegendItem(
              icon: Icons.remove_circle_rounded,
              color: palette.unknown.base,
              label: l10n.tyreDiagramListNotRecorded,
            ),
          ],
        ),
      ),
    );
  }
}

class _ConditionLegendItem extends StatelessWidget {
  const _ConditionLegendItem({
    required this.icon,
    required this.color,
    required this.label,
  });

  final IconData icon;
  final Color color;
  final String label;

  @override
  Widget build(BuildContext context) => Row(
        mainAxisSize: MainAxisSize.min,
        children: <Widget>[
          Icon(icon, color: color, size: TpSizing.iconMd),
          const SizedBox(width: 4),
          Text(
            label,
            maxLines: 1,
            style: Theme.of(context).textTheme.labelSmall?.copyWith(
                  color: TpPalette.of(context).textSecondary,
                  fontSize: 11,
                  fontWeight: FontWeight.w600,
                ),
          ),
        ],
      );
}

class _InspectionDraftChip extends StatelessWidget {
  const _InspectionDraftChip({required this.label});

  final String label;

  @override
  Widget build(BuildContext context) {
    final TpPalette palette = TpPalette.of(context);
    return DecoratedBox(
      key: NewInspectionScreenKeys.tyreDraftChip,
      decoration: BoxDecoration(
        color: palette.surface,
        borderRadius: BorderRadius.circular(TpRadius.sm),
        border: Border.all(color: palette.primary),
      ),
      child: Padding(
        padding: const EdgeInsets.symmetric(
          horizontal: TpSpace.md,
          vertical: TpSpace.xs,
        ),
        child: Text(
          label,
          style: Theme.of(context).textTheme.labelMedium?.copyWith(
                color: palette.primary,
                fontWeight: FontWeight.w800,
              ),
        ),
      ),
    );
  }
}

class _TyreSelectionPrompt extends StatelessWidget {
  const _TyreSelectionPrompt({required this.message});

  final String message;

  @override
  Widget build(BuildContext context) {
    final TpPalette palette = TpPalette.of(context);
    return TpCard(
      padding: const EdgeInsets.symmetric(
        horizontal: TpSpace.md,
        vertical: TpSpace.sm,
      ),
      child: Row(
        children: <Widget>[
          Icon(
            Icons.touch_app_outlined,
            size: TpSizing.iconMd,
            color: palette.primary,
          ),
          const SizedBox(width: TpSpace.sm),
          Expanded(
            child: Text(
              message,
              style: Theme.of(context).textTheme.bodySmall?.copyWith(
                    color: palette.textSecondary,
                    fontWeight: FontWeight.w600,
                  ),
            ),
          ),
        ],
      ),
    );
  }
}

/// The selected wheel, laid out like the approved inspection bottom panel:
/// title and status, position and serial, three recorded-value tiles, notes
/// and photo, then previous / next through the layout.
///
/// Every value is the one recorded on this inspection, or `-` when it was
/// not recorded. There is deliberately no minimum tread, recommended
/// pressure or gauge bar: no reference value exists in the data, and a
/// made-up one would read as an engineering limit.
class _SelectedInspectionTyreCard extends StatelessWidget {
  const _SelectedInspectionTyreCard({
    required this.position,
    required this.vehicleType,
    required this.reading,
    required this.installedTyre,
    required this.index,
    required this.total,
    required this.previousPosition,
    required this.nextPosition,
    required this.onSelect,
    required this.onEdit,
  });

  final String position;
  final String vehicleType;
  final TyrePositionReading reading;
  final TyreFitment? installedTyre;

  /// Zero-based place of [position] in layout order.
  final int index;
  final int total;
  final String? previousPosition;
  final String? nextPosition;
  final ValueChanged<String> onSelect;
  final VoidCallback onEdit;

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final TpPalette palette = TpPalette.of(context);
    final TyreCondition? condition =
        reading.isTouched ? normaliseCondition(reading.condition) : null;
    final TpStatus status =
        condition == null ? TpStatus.unknown : tyreConditionStatus(condition);
    final TpStatusColors statusColors = palette.forStatus(status);
    final String conditionLabel = condition == null
        ? l10n.tyreDiagramListNotRecorded
        : tyreConditionLabel(l10n, condition);
    final String description = _inspectionPositionDescription(
      l10n,
      position,
    );
    final String canonicalCode = legacyPositionCode(vehicleType, position);
    final String? trimmedSerial = reading.serialNumber?.trim();
    final String? serialValue = trimmedSerial == null || trimmedSerial.isEmpty
        ? installedTyre?.serialNo
        : trimmedSerial;
    final String serial = serialValue ?? l10n.tyreDetailFieldNotRecorded;
    final String? fitment =
        installedTyre?.brand != null || installedTyre?.size != null
            ? <String?>[installedTyre?.brand, installedTyre?.size]
                .whereType<String>()
                .join(' · ')
            : null;
    final Color? valueColor =
        status == TpStatus.critical || status == TpStatus.warning
            ? statusColors.base
            : null;

    return TpCard(
      key: NewInspectionScreenKeys.tyreSelectedCard,
      padding: const EdgeInsets.all(TpSpace.md),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: <Widget>[
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: <Widget>[
              DecoratedBox(
                decoration: BoxDecoration(
                  color: palette.surfaceAlt,
                  borderRadius: BorderRadius.circular(TpRadius.md),
                ),
                child: SizedBox(
                  width: 48,
                  height: 48,
                  child: Icon(
                    Icons.tire_repair_outlined,
                    size: TpSizing.iconLg,
                    color: palette.textSecondary,
                  ),
                ),
              ),
              const SizedBox(width: TpSpace.md),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: <Widget>[
                    Row(
                      children: <Widget>[
                        Flexible(
                          child: TpIdentifierText(
                            canonicalCode,
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: Theme.of(context)
                                .textTheme
                                .titleMedium
                                ?.copyWith(fontWeight: FontWeight.w800),
                          ),
                        ),
                        const SizedBox(width: TpSpace.sm),
                        TpStatusChip(
                          status: status,
                          label: conditionLabel,
                          isCompact: true,
                        ),
                      ],
                    ),
                    const SizedBox(height: TpSpace.xs),
                    _PanelFact(
                      label: l10n.tyreReplacePositionLabel,
                      value: description,
                    ),
                    const SizedBox(height: 2),
                    _PanelFact(
                      label: l10n.inspectionSerialLabel,
                      value: serial,
                      isIdentifier: serialValue != null,
                    ),
                    if (fitment != null) ...<Widget>[
                      const SizedBox(height: 2),
                      Text(
                        fitment,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: Theme.of(context)
                            .textTheme
                            .labelSmall
                            ?.copyWith(color: palette.textSecondary),
                      ),
                    ],
                  ],
                ),
              ),
            ],
          ),
          const SizedBox(height: TpSpace.md),
          IntrinsicHeight(
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: <Widget>[
                Expanded(
                  child: _PanelValueTile(
                    label: l10n.inspectionConditionLabel,
                    value: condition == null ? '-' : conditionLabel,
                    valueColor: valueColor,
                  ),
                ),
                const SizedBox(width: TpSpace.sm),
                Expanded(
                  child: _PanelValueTile(
                    label: l10n.tyreDetailStatTread,
                    value: reading.treadDepthMm == null
                        ? '-'
                        : l10n.tyreDiagramListTreadValue(
                            _formatMeasurement(reading.treadDepthMm!),
                          ),
                    valueColor: valueColor,
                  ),
                ),
                const SizedBox(width: TpSpace.sm),
                Expanded(
                  child: _PanelValueTile(
                    label: l10n.tyreDetailStatPressure,
                    value: reading.pressurePsi == null
                        ? '-'
                        : l10n.tyreDiagramListPressureValue(
                            _formatMeasurement(reading.pressurePsi!),
                          ),
                    valueColor: valueColor,
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(height: TpSpace.sm),
          IntrinsicHeight(
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: <Widget>[
                Expanded(
                  child: _PanelActionTile(
                    label: l10n.inspectionNotesLabel,
                    icon: Icons.edit_outlined,
                    onTap: onEdit,
                    child: Text(
                      reading.notes ?? '-',
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                      style: Theme.of(context).textTheme.bodySmall?.copyWith(
                            color: palette.text,
                            fontWeight: FontWeight.w600,
                          ),
                    ),
                  ),
                ),
                const SizedBox(width: TpSpace.sm),
                Expanded(
                  child: _PanelActionTile(
                    key: NewInspectionScreenKeys.tyreEvidenceRow,
                    label: l10n.inspectionPhotoLabel,
                    icon: Icons.photo_camera_outlined,
                    onTap: onEdit,
                    child: reading.hasPhoto
                        ? Icon(
                            Icons.check_circle_rounded,
                            color: palette.ok.base,
                            size: TpSizing.iconMd,
                          )
                        : Text(
                            l10n.inspectionAddEvidencePhoto,
                            maxLines: 2,
                            overflow: TextOverflow.ellipsis,
                            style:
                                Theme.of(context).textTheme.bodySmall?.copyWith(
                                      color: palette.primary,
                                      fontWeight: FontWeight.w700,
                                    ),
                          ),
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(height: TpSpace.sm),
          Row(
            children: <Widget>[
              Expanded(
                child: _PanelNavButton(
                  key: const Key('inspection.tyres.previous_tyre'),
                  icon: Icons.chevron_left_rounded,
                  leading: true,
                  code: previousPosition == null
                      ? null
                      : legacyPositionCode(vehicleType, previousPosition!),
                  semanticsLabel: previousPosition == null
                      ? null
                      : '${l10n.inspectionPreviousTyre}, '
                          '${_inspectionPositionDescription(
                          l10n,
                          previousPosition!,
                        )}',
                  onTap: previousPosition == null
                      ? null
                      : () => onSelect(previousPosition!),
                ),
              ),
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: TpSpace.sm),
                child: Column(
                  children: <Widget>[
                    Text(
                      '${index + 1} / $total',
                      key: const Key('inspection.tyres.position_counter'),
                      textDirection: TextDirection.ltr,
                      style: Theme.of(context).textTheme.titleMedium?.copyWith(
                            fontWeight: FontWeight.w800,
                          ),
                    ),
                    Text(
                      l10n.inspectionTyresLabel,
                      style: Theme.of(context).textTheme.labelSmall?.copyWith(
                            color: palette.textSecondary,
                          ),
                    ),
                  ],
                ),
              ),
              Expanded(
                child: _PanelNavButton(
                  key: const Key('inspection.tyres.next_tyre'),
                  icon: Icons.chevron_right_rounded,
                  leading: false,
                  code: nextPosition == null
                      ? null
                      : legacyPositionCode(vehicleType, nextPosition!),
                  semanticsLabel: nextPosition == null
                      ? null
                      : '${l10n.inspectionNextTyre}, '
                          '${_inspectionPositionDescription(l10n, nextPosition!)}',
                  onTap: nextPosition == null
                      ? null
                      : () => onSelect(nextPosition!),
                ),
              ),
            ],
          ),
          const SizedBox(height: TpSpace.md),
          TpButton.primary(
            label: l10n.tyreDetailEditDetailsButton,
            icon: Icons.edit_outlined,
            isFullWidth: true,
            onPressed: onEdit,
          ),
        ],
      ),
    );
  }
}

class _PanelFact extends StatelessWidget {
  const _PanelFact({
    required this.label,
    required this.value,
    this.isIdentifier = false,
  });

  final String label;
  final String value;
  final bool isIdentifier;

  @override
  Widget build(BuildContext context) {
    final TpPalette palette = TpPalette.of(context);
    final TextStyle? valueStyle =
        Theme.of(context).textTheme.bodySmall?.copyWith(
              color: palette.text,
              fontWeight: FontWeight.w700,
            );
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: <Widget>[
        Text(
          label,
          style: Theme.of(context).textTheme.labelSmall?.copyWith(
                color: palette.textSecondary,
              ),
        ),
        if (isIdentifier)
          TpIdentifierText(
            value,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: valueStyle,
          )
        else
          Text(
            value,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: valueStyle,
          ),
      ],
    );
  }
}

class _PanelValueTile extends StatelessWidget {
  const _PanelValueTile({
    required this.label,
    required this.value,
    required this.valueColor,
  });

  final String label;
  final String value;
  final Color? valueColor;

  @override
  Widget build(BuildContext context) {
    final TpPalette palette = TpPalette.of(context);
    return DecoratedBox(
      decoration: BoxDecoration(
        color: palette.surface,
        borderRadius: BorderRadius.circular(TpRadius.md),
        border: Border.all(color: palette.border),
      ),
      child: Padding(
        padding: const EdgeInsets.all(TpSpace.sm),
        child: Column(
          children: <Widget>[
            Text(
              label,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              textAlign: TextAlign.center,
              style: Theme.of(context).textTheme.labelSmall?.copyWith(
                    color: palette.textSecondary,
                  ),
            ),
            const SizedBox(height: TpSpace.xs),
            Text(
              value,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              textAlign: TextAlign.center,
              style: Theme.of(context).textTheme.titleSmall?.copyWith(
                    color: value == '-'
                        ? palette.textMuted
                        : (valueColor ?? palette.text),
                    fontWeight: FontWeight.w800,
                  ),
            ),
          ],
        ),
      ),
    );
  }
}

class _PanelActionTile extends StatelessWidget {
  const _PanelActionTile({
    required this.label,
    required this.icon,
    required this.onTap,
    required this.child,
    super.key,
  });

  final String label;
  final IconData icon;
  final VoidCallback onTap;
  final Widget child;

  @override
  Widget build(BuildContext context) {
    final TpPalette palette = TpPalette.of(context);
    return Material(
      color: palette.surface,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(TpRadius.md),
        side: BorderSide(color: palette.border),
      ),
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: onTap,
        child: ConstrainedBox(
          constraints: const BoxConstraints(
            minHeight: TpSizing.minTouchTarget,
          ),
          child: Padding(
            padding: const EdgeInsets.all(TpSpace.sm),
            child: Row(
              children: <Widget>[
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: <Widget>[
                      Text(
                        label,
                        style: Theme.of(context).textTheme.labelSmall?.copyWith(
                              color: palette.textSecondary,
                            ),
                      ),
                      const SizedBox(height: 2),
                      child,
                    ],
                  ),
                ),
                const SizedBox(width: TpSpace.xs),
                Icon(icon, size: TpSizing.iconSm, color: palette.textSecondary),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _PanelNavButton extends StatelessWidget {
  const _PanelNavButton({
    required this.icon,
    required this.leading,
    required this.code,
    required this.semanticsLabel,
    required this.onTap,
    super.key,
  });

  final IconData icon;

  /// `true` when the chevron sits before the code (the previous wheel).
  final bool leading;
  final String? code;
  final String? semanticsLabel;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final TpPalette palette = TpPalette.of(context);
    final bool enabled = onTap != null && code != null;
    final Widget chevron = Icon(
      icon,
      size: TpSizing.iconMd,
      color: enabled ? palette.textSecondary : palette.textMuted,
    );
    final Widget label = Flexible(
      child: TpIdentifierText(
        code ?? '-',
        maxLines: 1,
        overflow: TextOverflow.ellipsis,
        style: Theme.of(context).textTheme.labelLarge?.copyWith(
              color: enabled ? palette.text : palette.textMuted,
              fontWeight: FontWeight.w700,
            ),
      ),
    );
    return Semantics(
      button: true,
      enabled: enabled,
      label: semanticsLabel == null || code == null
          ? null
          : '${TpDirection.isolateLtr(code!)}, $semanticsLabel',
      excludeSemantics: true,
      child: Material(
        color: palette.surface,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(TpRadius.md),
          side: BorderSide(color: palette.border),
        ),
        clipBehavior: Clip.antiAlias,
        child: InkWell(
          onTap: enabled ? onTap : null,
          child: ConstrainedBox(
            constraints: const BoxConstraints(
              minHeight: TpSizing.minTouchTarget,
            ),
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: TpSpace.sm),
              child: Row(
                mainAxisAlignment:
                    leading ? MainAxisAlignment.start : MainAxisAlignment.end,
                children: leading
                    ? <Widget>[chevron, const SizedBox(width: 2), label]
                    : <Widget>[label, const SizedBox(width: 2), chevron],
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class _InspectionEvidenceRow extends StatelessWidget {
  const _InspectionEvidenceRow({
    required this.reading,
    required this.enabled,
    required this.onTap,
  });

  final TyrePositionReading? reading;
  final bool enabled;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final TpPalette palette = TpPalette.of(context);
    return Opacity(
      opacity: enabled ? 1 : 0.55,
      child: TpCard(
        key: NewInspectionScreenKeys.tyreEvidenceRow,
        background: palette.surfaceAlt,
        padding: EdgeInsets.zero,
        child: InkWell(
          onTap: onTap,
          borderRadius: BorderRadius.circular(TpRadius.md),
          child: ConstrainedBox(
            constraints: const BoxConstraints(
              minHeight: TpSizing.minTouchTarget,
            ),
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: TpSpace.md),
              child: Row(
                children: <Widget>[
                  Icon(
                    Icons.add_a_photo_outlined,
                    color: enabled ? palette.primary : palette.textMuted,
                    size: TpSizing.iconMd,
                  ),
                  const SizedBox(width: TpSpace.sm),
                  Expanded(
                    child: Text(
                      l10n.inspectionAddEvidencePhoto,
                      style: Theme.of(context).textTheme.labelLarge?.copyWith(
                            color:
                                enabled ? palette.primary : palette.textMuted,
                            fontWeight: FontWeight.w700,
                          ),
                    ),
                  ),
                  Icon(
                    reading?.hasPhoto == true
                        ? Icons.check_circle_rounded
                        : Icons.keyboard_arrow_down_rounded,
                    color: reading?.hasPhoto == true
                        ? palette.ok.base
                        : palette.textSecondary,
                    size: TpSizing.iconMd,
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}

String _inspectionPositionDescription(
  AppLocalizations l10n,
  String position,
) {
  final PositionStruct parsed = parsePositionStruct(position);
  return switch ((parsed.kind, parsed.side, parsed.role)) {
    (PositionKind.steer, PositionSide.left, _) => l10n.inspectionFrontLeft,
    (PositionKind.steer, PositionSide.right, _) => l10n.inspectionFrontRight,
    (PositionKind.drive, PositionSide.left, PositionRole.inner) =>
      l10n.inspectionInnerLeft,
    (PositionKind.drive, PositionSide.left, PositionRole.outer) =>
      l10n.inspectionOuterLeft,
    (PositionKind.drive, PositionSide.right, PositionRole.inner) =>
      l10n.inspectionInnerRight,
    (PositionKind.drive, PositionSide.right, PositionRole.outer) =>
      l10n.inspectionOuterRight,
    (PositionKind.drive, PositionSide.left, _) => l10n.inspectionRearLeft,
    (PositionKind.drive, PositionSide.right, _) => l10n.inspectionRearRight,
    _ => l10n.inspectionTyrePositionFallback,
  };
}

String _formatMeasurement(double value) {
  return value == value.roundToDouble()
      ? value.toInt().toString()
      : value.toStringAsFixed(1);
}

enum _InspectionWorkflowStage { notStarted, inProgress, readyForReview }

_InspectionWorkflowStage _workflowStage({
  required int checked,
  required int total,
  required bool readyForReview,
}) {
  if (checked <= 0 || total <= 0) {
    return _InspectionWorkflowStage.notStarted;
  }
  if (readyForReview) {
    return _InspectionWorkflowStage.readyForReview;
  }
  return _InspectionWorkflowStage.inProgress;
}

TpStatus _workflowTone(_InspectionWorkflowStage stage) => switch (stage) {
      _InspectionWorkflowStage.notStarted => TpStatus.unknown,
      _InspectionWorkflowStage.inProgress => TpStatus.info,
      _InspectionWorkflowStage.readyForReview => TpStatus.ok,
    };

String _workflowLabel(
  AppLocalizations l10n,
  _InspectionWorkflowStage stage,
) =>
    switch (stage) {
      _InspectionWorkflowStage.notStarted => l10n.inspectionWorkflowNotStarted,
      _InspectionWorkflowStage.inProgress => l10n.inspectionWorkflowInProgress,
      _InspectionWorkflowStage.readyForReview =>
        l10n.inspectionWorkflowReadyForReview,
    };

/// Keeps every inspection identity surface consistent with the actual tyre
/// diagram resolver. A transit mixer must never be shown with a bus icon, and
/// a bus/pickup/loader/pump must keep the same class from selection through
/// tyre entry and approval.
IconData _vehicleClassIcon(String resolvedClass) {
  return switch (resolvedClass) {
    'Pickup' => Icons.directions_car_outlined,
    'Bus' || 'Tata' || 'Ashok Leyland' => Icons.directions_bus_outlined,
    'Wheel loader' || 'Skid loader' => Icons.precision_manufacturing_outlined,
    'Concrete pump' || 'Line pump' => Icons.construction_outlined,
    'Trailer' => Icons.rv_hookup_outlined,
    'Tri-mixer' ||
    'Canter' ||
    'Truck 6x4' ||
    'Tanker' =>
      Icons.local_shipping_outlined,
    _ => Icons.local_shipping_outlined,
  };
}

class _InspectionTyresActionBar extends StatelessWidget {
  const _InspectionTyresActionBar({
    required this.label,
    required this.enabled,
    required this.onPressed,
  });

  final String label;
  final bool enabled;
  final VoidCallback onPressed;

  @override
  Widget build(BuildContext context) {
    final TpPalette palette = TpPalette.of(context);
    return DecoratedBox(
      decoration: BoxDecoration(
        color: palette.surface,
        border: Border(top: BorderSide(color: palette.border)),
      ),
      child: SafeArea(
        top: false,
        child: Padding(
          padding: const EdgeInsets.fromLTRB(
            TpSpace.lg,
            TpSpace.sm,
            TpSpace.lg,
            TpSpace.sm,
          ),
          child: TpButton.primary(
            label: label,
            isFullWidth: true,
            onPressed: enabled ? onPressed : null,
          ),
        ),
      ),
    );
  }
}

class _GpsChip extends StatelessWidget {
  const _GpsChip({required this.state, required this.controller});

  final InspectionWizardState state;
  final InspectionWizardController controller;

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final TpPalette palette = TpPalette.of(context);
    final (
      IconData icon,
      TpStatus status,
      String label,
    ) = switch (state.gpsStatus) {
      InspectionGpsStatus.captured => (
          Icons.location_on,
          TpStatus.ok,
          l10n.inspectionGpsCaptured,
        ),
      InspectionGpsStatus.unavailable => (
          Icons.location_off,
          TpStatus.warning,
          l10n.inspectionGpsUnavailable,
        ),
      InspectionGpsStatus.capturing => (
          Icons.my_location,
          TpStatus.info,
          l10n.inspectionGpsCapturing,
        ),
      InspectionGpsStatus.idle => (
          Icons.my_location,
          TpStatus.neutral,
          l10n.inspectionGpsCapturing,
        ),
    };
    final TpStatusColors colors = palette.forStatus(status);
    return Tooltip(
      message: state.gpsStatus == InspectionGpsStatus.unavailable
          ? '$label. ${l10n.inspectionGpsRetry}'
          : label,
      child: IconButton(
        visualDensity: VisualDensity.compact,
        constraints: const BoxConstraints.tightFor(width: 40, height: 40),
        padding: EdgeInsets.zero,
        onPressed: state.gpsStatus == InspectionGpsStatus.unavailable
            ? controller.retryGps
            : null,
        icon: Icon(icon, color: colors.base, size: TpSizing.iconMd),
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Review step
// ---------------------------------------------------------------------------

class _ReviewStep extends ConsumerWidget {
  const _ReviewStep({required this.state});

  final InspectionWizardState state;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final controller = ref.read(inspectionWizardControllerProvider.notifier);
    final List<InspectionSubmitIssue> issues = state.submitIssues;
    final bool canSubmit = issues.isEmpty && !state.isSubmitting;

    return TpScaffold(
      backFallback: TpBackFallbacks.forRoute(const NewInspectionRoute()),
      appBar: TpAppBar(
        title: l10n.inspectionReviewTitle,
        onBack: () => controller.backToTyres(),
        actions: const <Widget>[
          Padding(
            padding: EdgeInsets.only(right: TpSpace.lg),
            child: Center(child: _StepTrack(current: 3)),
          ),
        ],
      ),
      body: ListView(
        padding: const EdgeInsets.all(TpSpace.lg),
        children: <Widget>[
          TpCard(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                Text(
                  '${state.selectedAssetNo} - ${state.selectedVehicleType}',
                  style: Theme.of(context).textTheme.titleMedium,
                ),
                Text(state.selectedSite),
                Text(
                  l10n.inspectionPositionsRecorded(
                    state.touchedCount,
                    state.positions.length,
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(height: TpSpace.lg),
          TpInput(
            label: l10n.inspectionObservationsLabel,
            hint: l10n.inspectionObservationsPlaceholder,
            maxLines: 4,
            onChanged: controller.setHeaderNotes,
          ),
          const SizedBox(height: TpSpace.lg),
          Text(
            l10n.inspectionInspectorSignatureLabel,
            style: Theme.of(context).textTheme.labelMedium,
          ),
          const SizedBox(height: TpSpace.sm),
          InspectionSignaturePad(
            value: state.inspectorSignature,
            onChanged: (capture) => controller.setSignature(capture?.dataUrl),
          ),
          const SizedBox(height: TpSpace.xl),
          TpButton.primary(
            label: l10n.inspectionSubmitForApproval,
            icon: Icons.cloud_upload_outlined,
            isFullWidth: true,
            isBusy: state.isSubmitting,
            onPressed: canSubmit ? () => controller.submit() : null,
          ),
          if (issues.contains(InspectionSubmitIssue.missingSignature))
            Padding(
              padding: const EdgeInsets.only(top: TpSpace.sm),
              child: Text(
                l10n.inspectionSignatureRequiredMsg,
                style: Theme.of(context)
                    .textTheme
                    .bodySmall
                    ?.copyWith(color: TpPalette.of(context).critical.base),
              ),
              // `.critical.base` matches the confirmed `TpStatusColors`
              // member set (`.base`/`.soft`/`.onBase`/`.onSoft`), same as
              // every other status-tone read in this file.
            ),
        ],
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Submitted step
// ---------------------------------------------------------------------------

class _SubmittedStep extends ConsumerWidget {
  const _SubmittedStep({required this.state});

  final InspectionWizardState state;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final controller = ref.read(inspectionWizardControllerProvider.notifier);
    final TpPalette palette = TpPalette.of(context);

    final String title = switch (state.submitOutcome) {
      InspectionSubmitOutcome.deliveredNow =>
        l10n.inspectionSubmittedForApprovalTitle,
      InspectionSubmitOutcome.queued => l10n.inspectionQueuedTitle,
      InspectionSubmitOutcome.queuedWithWarning =>
        l10n.inspectionQueuedWithWarningTitle,
      null => l10n.inspectionSubmittedForApprovalTitle,
    };

    return TpScaffold(
      body: Center(
        child: Padding(
          padding: const EdgeInsets.all(TpSpace.xxl),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: <Widget>[
              Icon(
                Icons.verified_outlined,
                size: TpSizing.iconState,
                color: palette.primary,
              ),
              const SizedBox(height: TpSpace.lg),
              Text(
                title,
                textAlign: TextAlign.center,
                style: Theme.of(context).textTheme.headlineSmall,
              ),
              const SizedBox(height: TpSpace.sm),
              Text(
                '${state.selectedAssetNo} - ${state.selectedSite}',
                textAlign: TextAlign.center,
              ),
              if (state.submitWarning != null) ...<Widget>[
                const SizedBox(height: TpSpace.md),
                Text(
                  state.submitWarning!.message,
                  textAlign: TextAlign.center,
                  style: Theme.of(context)
                      .textTheme
                      .bodySmall
                      ?.copyWith(color: palette.warning.base),
                ),
              ],
              const SizedBox(height: TpSpace.xl),
              TpButton.primary(
                label: l10n.inspectionBackHome,
                icon: Icons.home_outlined,
                onPressed: () {
                  controller.startNew();
                  GoRouter.of(context).go(const HomeRoute().location);
                },
              ),
              const SizedBox(height: TpSpace.sm),
              TpButton.secondary(
                label: l10n.inspectionNewInspection,
                icon: Icons.add_circle_outline,
                onPressed: controller.startNew,
              ),
            ],
          ),
        ),
      ),
    );
  }
}
