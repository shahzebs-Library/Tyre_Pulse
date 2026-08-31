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
import 'package:tyre_pulse/features/assets/domain/vehicle_asset.dart';
import 'package:tyre_pulse/features/assets/presentation/vehicle_fleet_providers.dart';
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
    final String? selectedClass = state.hasVehicle
        ? resolveVehicleType(
            state.selectedVehicleType,
            state.selectedAssetNo,
          )
        : null;

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
                      const SizedBox(height: TpSpace.lg),
                      _SetupSection(
                        key: NewInspectionScreenKeys.vehicleSection,
                        title: l10n.vehiclesTitle,
                        icon: selectedClass == null
                            ? Icons.directions_car_outlined
                            : _vehicleClassIcon(selectedClass),
                        iconKey: NewInspectionScreenKeys.vehicleSectionIcon,
                        status: TpStatus.info,
                        child: state.hasVehicle
                            ? _SelectedVehicle(
                                state: state,
                                onChange: () => controller.pickVehicleByAssetNo(
                                  assetNo: '',
                                ),
                              )
                            : _VehiclePicker(
                                onPicked: controller.pickVehicleByAssetNo,
                              ),
                      ),
                      const SizedBox(height: TpSpace.lg),
                      _SetupSection(
                        key: NewInspectionScreenKeys.detailsSection,
                        title: l10n.inspectionDetailTitle,
                        icon: Icons.assignment_outlined,
                        status: TpStatus.neutral,
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.stretch,
                          children: <Widget>[
                            _SiteField(state: state, controller: controller),
                            const SizedBox(height: TpSpace.lg),
                            LayoutBuilder(
                              builder: (
                                BuildContext context,
                                BoxConstraints fieldConstraints,
                              ) {
                                final bool sideBySide =
                                    fieldConstraints.maxWidth >= 520;
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
                                    keyboardType:
                                        const TextInputType.numberWithOptions(
                                      decimal: true,
                                    ),
                                    onChanged: controller.setHourMeter,
                                  ),
                                );

                                if (sideBySide) {
                                  return Row(
                                    crossAxisAlignment:
                                        CrossAxisAlignment.start,
                                    children: <Widget>[
                                      Expanded(child: odometer),
                                      const SizedBox(width: TpSpace.md),
                                      Expanded(child: hourMeter),
                                    ],
                                  );
                                }
                                return Column(
                                  crossAxisAlignment:
                                      CrossAxisAlignment.stretch,
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
                      ),
                      const SizedBox(height: TpSpace.xl),
                      TpButton.primary(
                        label: l10n.inspectionNextButton,
                        icon: Icons.arrow_forward,
                        isFullWidth: true,
                        onPressed: (state.selectedSite.trim().isEmpty ||
                                !state.hasVehicle)
                            ? null
                            : () => controller.advanceToTyres(),
                      ),
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

class _SelectedVehicle extends StatelessWidget {
  const _SelectedVehicle({required this.state, required this.onChange});

  final InspectionWizardState state;
  final VoidCallback onChange;

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final TpPalette palette = TpPalette.of(context);
    final String resolvedClass = resolveVehicleType(
      state.selectedVehicleType,
      state.selectedAssetNo,
    );
    return TpCard(
      background: palette.primarySoft,
      borderColor: palette.primary.withValues(alpha: 0.42),
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
                  state.selectedAssetNo,
                  style: Theme.of(context).textTheme.titleMedium,
                ),
                Text(
                  resolvedClass,
                  key: NewInspectionScreenKeys.selectedVehicleClass,
                  style: Theme.of(context).textTheme.bodySmall,
                ),
              ],
            ),
          ),
          TpButton.text(
            label: l10n.inspectionChangeVehicleButton,
            onPressed: onChange,
          ),
        ],
      ),
    );
  }
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

class _VehiclePickerState extends ConsumerState<_VehiclePicker> {
  final TextEditingController _search = TextEditingController();
  bool _manual = false;
  final TextEditingController _manualAsset = TextEditingController();

  @override
  void dispose() {
    _search.dispose();
    _manualAsset.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);

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

    final query = _search.text.trim().toLowerCase();
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: <Widget>[
        TpSearchField(
          controller: _search,
          hint: l10n.inspectionVehicleSearchPlaceholder,
          onChanged: (_) => setState(() {}),
        ),
        const SizedBox(height: TpSpace.sm),
        if (query.isEmpty)
          Text(
            l10n.inspectionSearchToBeginHint,
            style: Theme.of(context).textTheme.bodySmall,
          )
        else
          Consumer(
            builder: (context, ref, _) {
              final asyncFleet = ref.watch(vehicleFleetListProvider);
              final List<VehicleAsset> assets = asyncFleet.maybeWhen(
                data: (outcome) => switch (outcome) {
                  VehicleFleetListLoaded(:final assets) => assets,
                  VehicleFleetListFromCache(:final assets) => assets,
                  VehicleFleetListFailed() => const <VehicleAsset>[],
                },
                orElse: () => const <VehicleAsset>[],
              );
              // The fleet view can contain more than one source row for the
              // same business asset number. An inspector must never see two
              // identical choices and risk starting the draft against an
              // arbitrary duplicate, so collapse matches by the normalized
              // asset number while preserving the repository's stable order.
              final Map<String, VehicleAsset> uniqueMatches =
                  <String, VehicleAsset>{};
              for (final VehicleAsset asset in assets) {
                if (!asset.hasNavigableAssetNo) continue;
                final bool matchesQuery = asset.assetNo!
                        .toLowerCase()
                        .contains(query) ||
                    (asset.vehicleType?.toLowerCase().contains(query) ?? false);
                if (!matchesQuery) continue;
                final String key = asset.assetNo!.trim().toUpperCase();
                uniqueMatches.putIfAbsent(key, () => asset);
                if (uniqueMatches.length == 30) break;
              }
              final List<VehicleAsset> matches =
                  uniqueMatches.values.toList(growable: false);
              if (matches.isEmpty) {
                return Text(
                  l10n.inspectionVehicleNoMatch,
                  style: Theme.of(context).textTheme.bodySmall,
                );
              }
              return Wrap(
                spacing: TpSpace.sm,
                runSpacing: TpSpace.sm,
                children: <Widget>[
                  for (final VehicleAsset v in matches)
                    _VehicleChip(
                      asset: v,
                      onTap: () => widget.onPicked(
                        assetNo: v.assetNo!,
                        vehicleType: v.vehicleType,
                        site: v.site,
                      ),
                    ),
                ],
              );
            },
          ),
        const SizedBox(height: TpSpace.sm),
        TpButton.text(
          label: l10n.inspectionEnterAssetManually,
          icon: Icons.edit_outlined,
          onPressed: () => setState(() => _manual = true),
        ),
      ],
    );
  }
}

class _VehicleChip extends StatelessWidget {
  const _VehicleChip({required this.asset, required this.onTap});

  final VehicleAsset asset;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final TpPalette palette = TpPalette.of(context);
    final String resolvedClass = resolveVehicleType(
      asset.vehicleType,
      asset.assetNo,
    );
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(TpRadius.md),
      child: DecoratedBox(
        decoration: BoxDecoration(
          color: palette.surface,
          borderRadius: BorderRadius.circular(TpRadius.md),
          border: Border.all(color: palette.border),
        ),
        child: Padding(
          padding: const EdgeInsets.symmetric(
            horizontal: TpSpace.md,
            vertical: TpSpace.sm,
          ),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: <Widget>[
              Icon(
                _vehicleClassIcon(resolvedClass),
                color: palette.primary,
                size: TpSizing.iconSm,
              ),
              const SizedBox(width: TpSpace.sm),
              Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                mainAxisSize: MainAxisSize.min,
                children: <Widget>[
                  TpIdentifierText(
                    asset.assetNo ?? '',
                    style: Theme.of(context).textTheme.labelLarge,
                  ),
                  Text(
                    resolvedClass,
                    key: NewInspectionScreenKeys.pickerVehicleClass(
                      asset.assetNo!,
                    ),
                    style: Theme.of(context).textTheme.labelSmall,
                  ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }
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
              for (final entry in state.tyreConditions.entries)
                if (entry.value.isTouched) entry.key: entry.value.toEntry(),
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
          if (selectedPosition == null || selectedReading == null)
            _TyreSelectionPrompt(
              message: l10n.inspectionWorkflowTapTyre,
            )
          else
            _SelectedInspectionTyreCard(
              position: selectedPosition,
              reading: selectedReading,
              onTap: () => _openEditor(context, ref, selectedPosition),
            ),
          const SizedBox(height: TpSpace.sm),
          _InspectionEvidenceRow(
            reading: selectedReading,
            enabled: selectedPosition != null,
            onTap: selectedPosition == null
                ? null
                : () => _openEditor(context, ref, selectedPosition),
          ),
        ],
      ),
    );
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
  });

  final InspectionWizardState state;
  final String resolvedClass;
  final InspectionWizardController controller;

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
          Text(
            l10n.inspectionStepOfTotal(2, 4),
            style: Theme.of(context).textTheme.titleSmall?.copyWith(
                  color: palette.textSecondary,
                  fontWeight: FontWeight.w700,
                ),
          ),
          const SizedBox(height: TpSpace.sm),
          Row(
            children: <Widget>[
              for (int index = 0;
                  index < (total == 0 ? 1 : total);
                  index++) ...<Widget>[
                Expanded(
                  child: Container(
                    height: 5,
                    decoration: BoxDecoration(
                      color: index < checked
                          ? palette.primary
                          : palette.surfaceSunken,
                      borderRadius: BorderRadius.circular(TpRadius.pill),
                    ),
                  ),
                ),
                if (index < (total == 0 ? 0 : total - 1))
                  const SizedBox(width: 4),
              ],
            ],
          ),
          const SizedBox(height: TpSpace.sm),
          Row(
            children: <Widget>[
              Expanded(
                child: Text(
                  helper,
                  key: NewInspectionScreenKeys.tyreWorkflowHelper,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: Theme.of(context).textTheme.labelSmall?.copyWith(
                        color:
                            workflow == _InspectionWorkflowStage.readyForReview
                                ? palette.ok.onSoft
                                : palette.textSecondary,
                      ),
                ),
              ),
              const SizedBox(width: TpSpace.sm),
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
        ],
      ),
    );
  }
}

class _InspectionConditionLegend extends StatelessWidget {
  const _InspectionConditionLegend();

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final TpPalette palette = TpPalette.of(context);
    return TpCard(
      padding: const EdgeInsets.symmetric(
        horizontal: TpSpace.sm,
        vertical: TpSpace.sm,
      ),
      child: Row(
        children: <Widget>[
          Expanded(
            child: _ConditionLegendItem(
              icon: Icons.check_circle_rounded,
              color: palette.ok.base,
              label: l10n.tyreConditionGood,
            ),
          ),
          Expanded(
            child: _ConditionLegendItem(
              icon: Icons.error_rounded,
              color: palette.warning.base,
              label: l10n.statusWarning,
            ),
          ),
          Expanded(
            child: _ConditionLegendItem(
              icon: Icons.warning_rounded,
              color: palette.critical.base,
              label: l10n.statusCritical,
            ),
          ),
          Expanded(
            child: _ConditionLegendItem(
              icon: Icons.remove_circle_rounded,
              color: palette.unknown.base,
              label: l10n.tyreDetailAddDetailsButton,
            ),
          ),
        ],
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
  Widget build(BuildContext context) => Column(
        mainAxisSize: MainAxisSize.min,
        children: <Widget>[
          Icon(icon, color: color, size: TpSizing.iconMd),
          const SizedBox(height: 4),
          Text(
            label,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            textAlign: TextAlign.center,
            style: Theme.of(context).textTheme.labelSmall?.copyWith(
                  color: TpPalette.of(context).textSecondary,
                  fontSize: 10,
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

class _SelectedInspectionTyreCard extends StatelessWidget {
  const _SelectedInspectionTyreCard({
    required this.position,
    required this.reading,
    required this.onTap,
  });

  final String position;
  final TyrePositionReading reading;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final TpPalette palette = TpPalette.of(context);
    final TyreCondition? condition =
        reading.isTouched ? normaliseCondition(reading.condition) : null;
    final TpStatus status =
        condition == null ? TpStatus.unknown : tyreConditionStatus(condition);
    final String conditionLabel = condition == null
        ? l10n.tyreDiagramListNotRecorded
        : tyreConditionLabel(l10n, condition);
    final String description = _inspectionPositionDescription(
      l10n,
      position,
    );

    return TpCard(
      key: NewInspectionScreenKeys.tyreSelectedCard,
      padding: EdgeInsets.zero,
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(TpRadius.md),
        child: Padding(
          padding: const EdgeInsets.all(TpSpace.md),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: <Widget>[
              Text(
                l10n.inspectionSelectedTyre,
                style: Theme.of(context).textTheme.labelSmall?.copyWith(
                      color: palette.textSecondary,
                      fontWeight: FontWeight.w700,
                    ),
              ),
              const SizedBox(height: TpSpace.xs),
              Row(
                children: <Widget>[
                  TpIdentifierText(
                    position,
                    style: Theme.of(context).textTheme.titleMedium?.copyWith(
                          fontWeight: FontWeight.w800,
                        ),
                  ),
                  Expanded(
                    child: Text(
                      ' • $description',
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: Theme.of(context).textTheme.titleMedium?.copyWith(
                            fontWeight: FontWeight.w800,
                          ),
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
              const SizedBox(height: TpSpace.md),
              Row(
                children: <Widget>[
                  Expanded(
                    child: _TyreReadingMetric(
                      label: l10n.inspectionPressureShort,
                      value: reading.pressurePsi == null
                          ? '-'
                          : '${_formatMeasurement(reading.pressurePsi!)} PSI',
                    ),
                  ),
                  SizedBox(
                    height: 44,
                    child: VerticalDivider(color: palette.border),
                  ),
                  Expanded(
                    child: _TyreReadingMetric(
                      label: l10n.inspectionTreadDepthShort,
                      value: reading.treadDepthMm == null
                          ? '-'
                          : '${_formatMeasurement(reading.treadDepthMm!)} mm',
                    ),
                  ),
                ],
              ),
              const SizedBox(height: TpSpace.sm),
              Row(
                children: <Widget>[
                  Text(
                    l10n.inspectionConditionLabel,
                    style: Theme.of(context).textTheme.labelMedium?.copyWith(
                          color: palette.textSecondary,
                        ),
                  ),
                  const Spacer(),
                  Text(
                    conditionLabel,
                    style: Theme.of(context).textTheme.labelLarge?.copyWith(
                          fontWeight: FontWeight.w800,
                        ),
                  ),
                  const SizedBox(width: TpSpace.xs),
                  Icon(
                    Icons.keyboard_arrow_down_rounded,
                    color: palette.textSecondary,
                  ),
                ],
              ),
              const SizedBox(height: TpSpace.md),
              TpButton.primary(
                label: l10n.tyreDetailEditDetailsButton,
                icon: Icons.edit_outlined,
                isFullWidth: true,
                onPressed: onTap,
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _TyreReadingMetric extends StatelessWidget {
  const _TyreReadingMetric({required this.label, required this.value});

  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    final TpPalette palette = TpPalette.of(context);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: <Widget>[
        Text(
          label,
          style: Theme.of(context).textTheme.labelSmall?.copyWith(
                color: palette.textSecondary,
              ),
        ),
        const SizedBox(height: 2),
        Text(
          value,
          style: Theme.of(context).textTheme.titleSmall?.copyWith(
                fontWeight: FontWeight.w800,
              ),
        ),
      ],
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
