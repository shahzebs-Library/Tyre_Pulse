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
import 'package:tyre_pulse/features/tyre_diagram/presentation/tyre_detail_screen.dart';
import 'package:tyre_pulse/features/tyre_diagram/presentation/tyre_diagram_board.dart';
import 'package:tyre_pulse/features/tyre_diagram/presentation/tyre_diagram_pending.dart';

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

    return TpScaffold(
      backFallback: TpBackFallbacks.forRoute(const NewInspectionRoute()),
      appBar: TpAppBar(
        title: l10n.inspectionNavTitle,
        backFallback: TpBackFallbacks.forRoute(const NewInspectionRoute()),
        actions: const <Widget>[
          Padding(
            padding: EdgeInsets.only(right: TpSpace.lg),
            child: Center(child: _StepTrack(current: 1)),
          ),
        ],
      ),
      body: ListView(
        padding: const EdgeInsets.all(TpSpace.lg),
        children: <Widget>[
          if (state.unfinishedDrafts.isNotEmpty &&
              !state.hasVehicle) ...<Widget>[
            Text(
              l10n.inspectionResumeTitle,
              style: Theme.of(context).textTheme.titleMedium,
            ),
            const SizedBox(height: TpSpace.sm),
            for (final InspectionDraftSummary draft in state.unfinishedDrafts)
              TpCard(
                margin: const EdgeInsets.only(bottom: TpSpace.sm),
                onTap: () => controller.pickVehicleByAssetNo(
                  assetNo: draft.assetNo,
                  vehicleType: draft.vehicleType,
                  site: draft.site,
                ),
                child: Row(
                  children: <Widget>[
                    Icon(Icons.history, color: TpPalette.of(context).primary),
                    const SizedBox(width: TpSpace.md),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: <Widget>[
                          Text(
                            draft.assetNo,
                            style: Theme.of(context).textTheme.titleSmall,
                          ),
                          Text(
                            l10n.inspectionResumeProgress(
                              draft.filled,
                              draft.total,
                            ),
                            style: Theme.of(context).textTheme.bodySmall,
                          ),
                        ],
                      ),
                    ),
                    const Icon(Icons.chevron_right),
                  ],
                ),
              ),
            const SizedBox(height: TpSpace.xl),
          ],
          if (state.hasVehicle)
            TpCard(
              margin: const EdgeInsets.only(bottom: TpSpace.lg),
              borderColor: TpPalette.of(context).primary,
              child: Row(
                children: <Widget>[
                  Icon(
                    Icons.directions_bus_outlined,
                    color: TpPalette.of(context).primary,
                  ),
                  const SizedBox(width: TpSpace.md),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: <Widget>[
                        Text(
                          state.selectedAssetNo,
                          style: Theme.of(context).textTheme.titleMedium,
                        ),
                        Text(
                          state.selectedVehicleType,
                          style: Theme.of(context).textTheme.bodySmall,
                        ),
                      ],
                    ),
                  ),
                  TpButton.text(
                    label: l10n.inspectionChangeVehicleButton,
                    onPressed: () =>
                        controller.pickVehicleByAssetNo(assetNo: ''),
                  ),
                ],
              ),
            )
          else
            _VehiclePicker(onPicked: controller.pickVehicleByAssetNo),
          const SizedBox(height: TpSpace.lg),
          _SiteField(state: state, controller: controller),
          const SizedBox(height: TpSpace.lg),
          Row(
            children: <Widget>[
              Expanded(
                child: TpInput(
                  label: l10n.inspectionOdometerLabel,
                  hint: l10n.inspectionOdometerHint,
                  keyboardType: TextInputType.number,
                  onChanged: controller.setOdometer,
                ),
              ),
              const SizedBox(width: TpSpace.md),
              Expanded(
                child: TpInput(
                  label: l10n.inspectionHourMeterLabel,
                  hint: l10n.inspectionHourMeterHint,
                  keyboardType: const TextInputType.numberWithOptions(
                    decimal: true,
                  ),
                  onChanged: controller.setHourMeter,
                ),
              ),
            ],
          ),
          const SizedBox(height: TpSpace.xxl),
          TpButton.primary(
            label: l10n.inspectionNextButton,
            isFullWidth: true,
            onPressed: (state.selectedSite.trim().isEmpty || !state.hasVehicle)
                ? null
                : () => controller.advanceToTyres(),
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
              final matches = assets
                  .where(
                    (v) =>
                        (v.assetNo?.toLowerCase().contains(query) ?? false) ||
                        (v.vehicleType?.toLowerCase().contains(query) ?? false),
                  )
                  .take(30)
                  .toList(growable: false);
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
                    if (v.hasNavigableAssetNo)
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
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            mainAxisSize: MainAxisSize.min,
            children: <Widget>[
              Text(
                asset.assetNo ?? '',
                style: Theme.of(context).textTheme.labelLarge,
              ),
              Text(
                asset.vehicleType ?? '',
                style: Theme.of(context).textTheme.labelSmall,
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

class _TyresStep extends ConsumerWidget {
  const _TyresStep({required this.state});

  final InspectionWizardState state;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final controller = ref.read(inspectionWizardControllerProvider.notifier);
    final TpPalette palette = TpPalette.of(context);

    return TpScaffold(
      backFallback: TpBackFallbacks.forRoute(const NewInspectionRoute()),
      appBar: TpAppBar(
        title: l10n.inspectionTyrePositionsTitle,
        subtitle: '${state.selectedAssetNo} - ${state.selectedSite}',
        onBack: () => controller.backToHeader(),
        actions: const <Widget>[
          Padding(
            padding: EdgeInsets.only(right: TpSpace.lg),
            child: Center(child: _StepTrack(current: 2)),
          ),
        ],
      ),
      body: ListView(
        padding: const EdgeInsets.all(TpSpace.lg),
        children: <Widget>[
          TyreDiagramBoard(
            vehicleType: state.selectedVehicleType,
            assetNo: state.selectedAssetNo,
            positions: state.positions,
            tyreData: <String, Map<String, Object?>>{
              for (final entry in state.tyreConditions.entries)
                entry.key: entry.value.toEntry(),
            },
            selectedPosition: state.activePosition,
            onPositionTap: (String position) =>
                _openTyreDetail(context, ref, position),
            pending: TyreDiagramPending.fromCompleteness(state.completeness),
            width: MediaQuery.sizeOf(context).width - (TpSpace.lg * 2),
          ),
          const SizedBox(height: TpSpace.lg),
          _GpsChip(state: state, controller: controller),
          const SizedBox(height: TpSpace.lg),
          if (state.touchedCount == 0 || !state.completeness.ok)
            Padding(
              padding: const EdgeInsets.only(bottom: TpSpace.md),
              child: Text(
                state.touchedCount == 0
                    ? l10n.inspectionValidationRecordTyre
                    : l10n.inspectionTyresIncompleteLead(
                        state.completeness.pending.length,
                        state.completeness.expected ??
                            state.completeness.pending.length,
                      ),
                style: Theme.of(context)
                    .textTheme
                    .bodySmall
                    ?.copyWith(color: palette.warning.base),
              ),
            ),
          TpButton.primary(
            label: l10n.inspectionReviewButton,
            isFullWidth: true,
            onPressed: (state.touchedCount == 0 || !state.completeness.ok)
                ? null
                : () => controller.advanceToReview(),
          ),
        ],
      ),
    );
  }

  /// Tapping a wheel (in either the Layout or the List view) opens the Tyre
  /// Detail screen first, rather than jumping straight to the editor - the
  /// same "detail, then take action" flow the read-only inspection/approval
  /// screens use. [_openEditor] (the existing, proven recording sheet) is
  /// still the ONE place a reading is actually written; Take Action's
  /// "Adjust reading" row only bridges into it once both pushed screens are
  /// popped back to this one.
  void _openTyreDetail(BuildContext context, WidgetRef ref, String position) {
    final Map<String, Object?>? entry =
        state.tyreConditions[position]?.toEntry();
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

class _GpsChip extends StatelessWidget {
  const _GpsChip({required this.state, required this.controller});

  final InspectionWizardState state;
  final InspectionWizardController controller;

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
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
    return Row(
      children: <Widget>[
        TpStatusChip(status: status, label: label, icon: icon),
        if (state.gpsStatus == InspectionGpsStatus.unavailable) ...<Widget>[
          const SizedBox(width: TpSpace.sm),
          TpButton.text(
            label: l10n.inspectionGpsRetry,
            onPressed: () => controller.retryGps(),
          ),
        ],
      ],
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
