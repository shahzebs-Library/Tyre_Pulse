/// Reusable presentation pieces for the accident-report intake only.
library;

import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:mobile_scanner/mobile_scanner.dart';
import 'package:tyre_pulse/app/localization/tp_direction.dart';
import 'package:tyre_pulse/app/localization/tp_localizations.dart';
import 'package:tyre_pulse/app/theme/tp_colors.dart';
import 'package:tyre_pulse/app/theme/tp_spacing.dart';
import 'package:tyre_pulse/core/design_system/design_system.dart';
import 'package:tyre_pulse/features/accidents/data/accident_report_vehicle_photo.dart';
import 'package:tyre_pulse/features/accidents/domain/accident_report_intake.dart';
import 'package:tyre_pulse/features/assets/domain/vehicle_asset.dart';
import 'package:tyre_pulse/features/assets/presentation/vehicle_photo_resolver.dart';
import 'package:tyre_pulse/features/scanning/domain/scan_payload.dart';

/// The wizard pages are the validation groups themselves, numbered by
/// `reportWizardSteps`, so there is exactly one "Step N of 7" in the app.
/// The alias keeps existing callers and tests readable.
typedef AccidentIntakePage = AccidentReportStep;

/// The exact fleet-master note printed under the locked fields (M7).
String accidentFleetMasterLockNote(BuildContext context) =>
    AppLocalizations.of(context).accIntakeFleetMasterLockNote;

/// The sub-text under "Where did the incident occur?" (M7).
String accidentIncidentSiteHelp(BuildContext context) =>
    AppLocalizations.of(context).accIntakeIncidentSiteHelp;

/// Wide capture canvas for the image-led intake pages.
class AccidentIntakeCanvas extends StatelessWidget {
  const AccidentIntakeCanvas({
    required this.title,
    required this.icon,
    required this.child,
    this.eyebrow,
    this.subtitle,
    super.key,
  });
  final String title;
  final String? eyebrow;
  final String? subtitle;
  final IconData icon;
  final Widget child;

  @override
  Widget build(BuildContext context) {
    final TpPalette palette = TpPalette.of(context);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: <Widget>[
        if (eyebrow?.isNotEmpty == true) ...<Widget>[
          Text(
            eyebrow!,
            style: Theme.of(context).textTheme.labelLarge?.copyWith(
                  color: palette.primary,
                  fontWeight: FontWeight.w800,
                ),
          ),
          const SizedBox(height: TpSpace.xs),
        ],
        Text(title, style: Theme.of(context).textTheme.headlineSmall),
        if (subtitle?.isNotEmpty == true) ...<Widget>[
          const SizedBox(height: TpSpace.xs),
          Text(subtitle!, style: Theme.of(context).textTheme.bodyMedium),
        ],
        const SizedBox(height: TpSpace.md),
        child,
      ],
    );
  }
}

abstract final class AccidentReportIntakeKeys {
  static const ValueKey<String> progress =
      ValueKey<String>('accident.report.progress');
  static const ValueKey<String> eyebrow =
      ValueKey<String>('accident.report.eyebrow');
  static ValueKey<String> step(AccidentReportStep step) =>
      ValueKey<String>('accident.report.step.${step.name}');
  static ValueKey<String> evidence(String key) =>
      ValueKey<String>('accident.report.evidence.$key');
  static const ValueKey<String> assetMaster =
      ValueKey<String>('accident.report.assetMaster');
  static const ValueKey<String> matchCount =
      ValueKey<String>('accident.report.matchCount');
  static const ValueKey<String> clearAssetSearch =
      ValueKey<String>('accident.report.assetSearch.clear');
  static const ValueKey<String> browseFleet =
      ValueKey<String>('accident.report.browseFleet');
  static const ValueKey<String> matchOverflow =
      ValueKey<String>('accident.report.matchOverflow');
  static ValueKey<String> matchRow(String assetId) =>
      ValueKey<String>('accident.report.match.$assetId');
  static const ValueKey<String> incidentSite =
      ValueKey<String>('accident.report.incidentSite');
  static ValueKey<String> siteChip(String site) =>
      ValueKey<String>('accident.report.siteChip.$site');
  static const ValueKey<String> lockNote =
      ValueKey<String>('accident.report.lockNote');
  static const ValueKey<String> autoFilled =
      ValueKey<String>('accident.report.autoFilled');
  static const ValueKey<String> changeAsset =
      ValueKey<String>('accident.report.changeAsset');
  static const ValueKey<String> scanAsset =
      ValueKey<String>('accident.report.scanAsset');
  static const ValueKey<String> scanCodeField =
      ValueKey<String>('accident.report.scanCode');
  static const ValueKey<String> incidentSiteField =
      ValueKey<String>('accident.report.incidentSite.field');
  static const ValueKey<String> useTypedSite =
      ValueKey<String>('accident.report.incidentSite.useTyped');
  static const ValueKey<String> reportTitle =
      ValueKey<String>('accident.report.title');
}

/// The localized label of a wizard step (the domain keeps the English
/// vocabulary for the web parity checks).
String accidentReportStepLabel(BuildContext context, AccidentReportStep step) {
  final AppLocalizations l10n = AppLocalizations.of(context);
  return switch (step) {
    AccidentReportStep.identifyAsset => l10n.designAccReportStepIdentifyAsset,
    AccidentReportStep.incident => l10n.designAccReportStepIncident,
    AccidentReportStep.peopleAuthority => l10n.designAccReportStepPeople,
    AccidentReportStep.damage => l10n.designAccReportStepDamage,
    AccidentReportStep.evidence => l10n.designAccReportStepEvidence,
    AccidentReportStep.documents => l10n.designAccReportStepDocuments,
    AccidentReportStep.review => l10n.designAccReportStepReview,
  };
}

/// Where a step sits relative to the current one.
enum AccidentReportStepState { completed, current, upcoming }

/// The mock's progress header: a "**Step N** of 7: Label" eyebrow over a
/// seven-segment bar. Completed, current and upcoming segments differ in
/// fill, outline and height, not colour alone, and each segment is a 48dp
/// tap target announced as a selectable step.
class AccidentReportProgress extends StatelessWidget {
  const AccidentReportProgress({
    required this.current,
    required this.onSelect,
    super.key,
  });

  final AccidentReportStep current;
  final ValueChanged<AccidentReportStep> onSelect;

  static AccidentReportStepState stateOf(
    AccidentReportStep step,
    AccidentReportStep current,
  ) =>
      step == current
          ? AccidentReportStepState.current
          : step.index < current.index
              ? AccidentReportStepState.completed
              : AccidentReportStepState.upcoming;

  @override
  Widget build(BuildContext context) {
    final TpPalette palette = TpPalette.of(context);
    final AppLocalizations l10n = AppLocalizations.of(context);
    final TextTheme text = Theme.of(context).textTheme;
    final int total = AccidentReportStep.values.length;
    final String lead = l10n.designAccReportStepLead(current.number);
    final String tail = l10n.designAccReportStepTail(
      total,
      accidentReportStepLabel(context, current),
    );
    return Column(
      key: AccidentReportIntakeKeys.progress,
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: <Widget>[
        Semantics(
          header: true,
          child: Text.rich(
            TextSpan(
              children: <InlineSpan>[
                TextSpan(
                  text: lead,
                  style: TextStyle(
                    color: palette.primary,
                    fontWeight: FontWeight.w800,
                  ),
                ),
                TextSpan(text: tail),
              ],
            ),
            key: AccidentReportIntakeKeys.eyebrow,
            style: text.titleMedium?.copyWith(color: palette.textSecondary),
          ),
        ),
        const SizedBox(height: TpSpace.xs),
        Row(
          children: <Widget>[
            for (final AccidentReportStep step in AccidentReportStep.values)
              Expanded(
                child: _StepSegment(
                  step: step,
                  total: total,
                  state: stateOf(step, current),
                  onTap: () => onSelect(step),
                ),
              ),
          ],
        ),
      ],
    );
  }
}

class _StepSegment extends StatelessWidget {
  const _StepSegment({
    required this.step,
    required this.total,
    required this.state,
    required this.onTap,
  });

  final AccidentReportStep step;
  final int total;
  final AccidentReportStepState state;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final TpPalette palette = TpPalette.of(context);
    final AppLocalizations l10n = AppLocalizations.of(context);
    final String stateLabel = switch (state) {
      AccidentReportStepState.completed => l10n.designAccReportStepDone,
      AccidentReportStepState.current => l10n.designAccReportStepCurrent,
      AccidentReportStepState.upcoming => l10n.designAccReportStepTodo,
    };
    final String label = '${l10n.designAccReportStepLead(step.number)}'
        '${l10n.designAccReportStepTail(total, accidentReportStepLabel(context, step))}'
        ', $stateLabel';
    final bool isCurrent = state == AccidentReportStepState.current;
    final BoxDecoration bar = switch (state) {
      AccidentReportStepState.completed => BoxDecoration(
          color: palette.primary,
          borderRadius: BorderRadius.circular(TpRadius.pill),
        ),
      AccidentReportStepState.current => BoxDecoration(
          color: palette.primarySoft,
          borderRadius: BorderRadius.circular(TpRadius.pill),
          border: Border.all(
            color: palette.primary,
            width: TpBorderWidth.strong,
          ),
        ),
      AccidentReportStepState.upcoming => BoxDecoration(
          color: palette.surfaceSunken,
          borderRadius: BorderRadius.circular(TpRadius.pill),
          border: Border.all(color: palette.borderStrong),
        ),
    };
    return Semantics(
      button: true,
      selected: isCurrent,
      inMutuallyExclusiveGroup: true,
      label: label,
      onTap: onTap,
      excludeSemantics: true,
      child: InkWell(
        key: AccidentReportIntakeKeys.step(step),
        onTap: onTap,
        borderRadius: BorderRadius.circular(TpRadius.sm),
        child: SizedBox(
          height: TpSizing.minTouchTarget,
          child: Center(
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 2),
              child: AnimatedContainer(
                key: ValueKey<String>(
                  'accident.report.segment.${step.name}.${state.name}',
                ),
                duration: MediaQuery.disableAnimationsOf(context)
                    ? Duration.zero
                    : const Duration(milliseconds: 180),
                height: isCurrent ? 10 : 6,
                decoration: bar,
              ),
            ),
          ),
        ),
      ),
    );
  }
}

/// The app-bar draft state (M1): a cloud icon beside two short lines, as in
/// the mock ("Draft saved / on device"). Colour follows the state but the
/// icon and the words carry it too, so colour is never the only signal.
class AccidentDraftStatus extends StatelessWidget {
  const AccidentDraftStatus({
    required this.label,
    required this.saving,
    required this.failed,
    this.maxLines = 1,
    super.key,
  });

  final String label;
  final bool saving;
  final bool failed;

  /// Two lets the app-bar placement wrap "Draft saved on device" like the
  /// mock instead of truncating it.
  final int maxLines;

  @override
  Widget build(BuildContext context) {
    final TpPalette palette = TpPalette.of(context);
    final Color ink = failed
        ? palette.critical.base
        : saving
            ? palette.warning.base
            : palette.primary;
    return Semantics(
      liveRegion: true,
      label: label,
      excludeSemantics: true,
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: <Widget>[
          if (saving)
            SizedBox.square(
              dimension: TpSizing.iconMd,
              child: CircularProgressIndicator(strokeWidth: 2, color: ink),
            )
          else
            Icon(
              failed ? Icons.cloud_off_outlined : Icons.cloud_done_outlined,
              size: TpSizing.iconLg,
              color: ink,
            ),
          const SizedBox(width: TpSpace.xs),
          Flexible(
            child: Text(
              label,
              maxLines: maxLines,
              overflow: TextOverflow.ellipsis,
              style: Theme.of(context).textTheme.labelMedium?.copyWith(
                    color: ink,
                    fontWeight: FontWeight.w600,
                    height: 1.2,
                  ),
            ),
          ),
        ],
      ),
    );
  }
}

/// The picture of one fleet asset, in the order the whole app uses: its own
/// uploaded photo, then the class photo for its type/make/model, then a
/// neutral icon. Never a different vehicle.
class AccidentVehicleImageView extends ConsumerWidget {
  const AccidentVehicleImageView({
    required this.asset,
    required this.semanticLabel,
    this.placeholderSize = 32,
    super.key,
  });

  final VehicleAsset asset;
  final String semanticLabel;
  final double placeholderSize;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final String? uploaded = asset.id.isEmpty
        ? null
        : ref.watch(accidentUploadedVehiclePhotoUrlProvider(asset.id)).value;
    final AccidentVehicleImage image = resolveAccidentVehicleImage(
      uploadedUrl: uploaded,
      classPhotoAsset: vehiclePhotoAsset(asset),
    );
    final Widget placeholder = Icon(
      Icons.local_shipping_outlined,
      size: placeholderSize,
      color: TpPalette.of(context).textMuted,
      semanticLabel: semanticLabel,
    );
    return switch (image) {
      AccidentVehicleUploadedPhoto(url: final String url) => Image.network(
          url,
          fit: BoxFit.contain,
          semanticLabel: semanticLabel,
          errorBuilder: (_, __, ___) {
            final String? art = vehiclePhotoAsset(asset);
            return art == null
                ? placeholder
                : Image.asset(
                    art,
                    fit: BoxFit.contain,
                    semanticLabel: semanticLabel,
                  );
          },
        ),
      AccidentVehicleClassPhoto(assetPath: final String path) => Image.asset(
          path,
          fit: BoxFit.contain,
          width: double.infinity,
          height: double.infinity,
          semanticLabel: semanticLabel,
        ),
      AccidentVehiclePlaceholder() => placeholder,
    };
  }
}

/// One Step 1 match row (mock M1): vehicle picture on the leading panel,
/// the asset number, the vehicle type and a "Plate ..." chip. The selected
/// row is tinted with a green border and a filled check; others show a
/// chevron. Selection is also announced, so colour is not the only signal.
class AccidentAssetMatchRow extends StatelessWidget {
  const AccidentAssetMatchRow({
    required this.asset,
    required this.unavailableLabel,
    required this.onTap,
    this.selected = false,
    super.key,
  });

  final VehicleAsset asset;
  final String unavailableLabel;
  final VoidCallback onTap;
  final bool selected;

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final TpPalette palette = TpPalette.of(context);
    final TextTheme text = Theme.of(context).textTheme;
    final String identity = asset.displayIdentity ?? unavailableLabel;
    final String? plate = _clean(asset.registrationNo);
    final String? kind = _clean(asset.vehicleType) ??
        _clean(
          <String?>[asset.make, asset.model]
              .whereType<String>()
              .map((String value) => value.trim())
              .where((String value) => value.isNotEmpty)
              .join(' '),
        );
    final Color edge = selected ? palette.primary : palette.border;
    return Semantics(
      button: true,
      selected: selected,
      child: Material(
        key: AccidentReportIntakeKeys.matchRow(asset.id),
        color: selected ? palette.primarySoft : palette.surface,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(TpRadius.md),
          side: BorderSide(
            color: edge,
            width: selected ? TpBorderWidth.strong : TpBorderWidth.hairline,
          ),
        ),
        clipBehavior: Clip.antiAlias,
        child: InkWell(
          onTap: onTap,
          child: ConstrainedBox(
            constraints: const BoxConstraints(minHeight: 96),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.center,
              children: <Widget>[
                Container(
                  width: 112,
                  height: 96,
                  padding: const EdgeInsets.all(TpSpace.xs),
                  decoration: BoxDecoration(
                    color: palette.surface,
                    border: BorderDirectional(end: BorderSide(color: edge)),
                  ),
                  child: AccidentVehicleImageView(
                    asset: asset,
                    semanticLabel: identity,
                  ),
                ),
                Expanded(
                  child: Padding(
                    padding: const EdgeInsets.symmetric(
                      horizontal: TpSpace.md,
                      vertical: TpSpace.sm,
                    ),
                    child: Column(
                      mainAxisAlignment: MainAxisAlignment.center,
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: <Widget>[
                        Directionality(
                          textDirection: TextDirection.ltr,
                          child: Text(
                            identity,
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: text.titleSmall
                                ?.copyWith(fontWeight: FontWeight.w800),
                          ),
                        ),
                        if (kind != null) ...<Widget>[
                          const SizedBox(height: 2),
                          Text(
                            kind,
                            maxLines: 2,
                            overflow: TextOverflow.ellipsis,
                            style: text.bodyMedium,
                          ),
                        ],
                        if (plate != null) ...<Widget>[
                          const SizedBox(height: TpSpace.xs),
                          _PlateChip(label: l10n.accRptPlateChip(plate)),
                        ],
                      ],
                    ),
                  ),
                ),
                Padding(
                  padding: const EdgeInsetsDirectional.only(end: TpSpace.md),
                  child: Center(
                    child: selected
                        ? Icon(
                            Icons.check_circle,
                            color: palette.primary,
                            size: 28,
                            semanticLabel: l10n.accRptSelectedAsset,
                          )
                        : Icon(
                            Icons.chevron_right_rounded,
                            color: palette.textSecondary,
                          ),
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _PlateChip extends StatelessWidget {
  const _PlateChip({required this.label});

  final String label;

  @override
  Widget build(BuildContext context) {
    final TpPalette palette = TpPalette.of(context);
    return DecoratedBox(
      decoration: BoxDecoration(
        border: Border.all(color: palette.borderStrong),
        borderRadius: BorderRadius.circular(TpRadius.sm),
      ),
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
        child: Text(
          label,
          maxLines: 1,
          overflow: TextOverflow.ellipsis,
          style: Theme.of(context)
              .textTheme
              .labelMedium
              ?.copyWith(color: palette.textSecondary),
        ),
      ),
    );
  }
}

/// The asset status word the mock shows as a pill: the operational status
/// when the register carries one, otherwise the fleet status.
String? accidentAssetStatusWord(VehicleAsset asset) =>
    _clean(asset.opsStatus) ?? _clean(asset.status);

/// Mock M1 "Asset loaded from fleet master" card followed by the separate
/// "Auto-filled from fleet master" read-only card. Every value is the
/// register's own; a missing value reads [unavailableLabel], never a guess,
/// and a missing meter is never shown as 0.
class AccidentFleetMasterCard extends StatelessWidget {
  const AccidentFleetMasterCard({
    required this.asset,
    required this.onChange,
    required this.changeLabel,
    required this.unavailableLabel,
    super.key,
  });

  final VehicleAsset asset;
  final VoidCallback onChange;
  final String changeLabel;
  final String unavailableLabel;

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final TpPalette palette = TpPalette.of(context);
    final TextTheme text = Theme.of(context).textTheme;
    final String meter = asset.currentKm == null
        ? unavailableLabel
        : l10n.accKmValue(formatVehicleOdometer(asset.currentKm!));
    final String makeModel = <String?>[asset.make, asset.model]
        .whereType<String>()
        .map((String value) => value.trim())
        .where((String value) => value.isNotEmpty)
        .join(' ');
    final String assetNo =
        _shown(asset.assetNo ?? asset.fleetNumber, unavailableLabel);
    final String plate = _shown(asset.registrationNo, unavailableLabel);
    final String? statusWord = accidentAssetStatusWord(asset);
    final String homeSite = _shown(asset.site, unavailableLabel);
    final String homeSiteWithCountry = <String?>[
      _clean(asset.site),
      _clean(asset.country),
    ].whereType<String>().join(', ');

    final List<(String, String, bool)> identity = <(String, String, bool)>[
      (l10n.accIntakeAssetNo, assetNo, true),
      (
        l10n.accIntakeVehicleType,
        _shown(asset.vehicleType, unavailableLabel),
        false,
      ),
      (l10n.accPlate, plate, true),
      (l10n.accIntakeMakeModel, _shown(makeModel, unavailableLabel), false),
      (l10n.accIntakeHomeSite, homeSite, false),
      (l10n.accIntakeCountry, _shown(asset.country, unavailableLabel), false),
    ];

    Widget valueRow(String label, Widget value) => Padding(
          padding: const EdgeInsets.symmetric(vertical: 3),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: <Widget>[
              Expanded(
                flex: 4,
                child: Text(
                  label,
                  style: text.bodyMedium?.copyWith(color: palette.textMuted),
                ),
              ),
              const SizedBox(width: TpSpace.sm),
              Expanded(flex: 5, child: value),
            ],
          ),
        );
    final TextStyle? strong =
        text.bodyLarge?.copyWith(fontWeight: FontWeight.w700);

    final Widget values = Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: <Widget>[
        for (final (String label, String value, bool isId) in identity)
          valueRow(
            label,
            isId
                ? TpIdentifierText(value, style: strong)
                : Text(value, style: strong),
          ),
        const Divider(height: TpSpace.lg),
        valueRow(l10n.accIntakeCurrentMeter, Text(meter, style: strong)),
        valueRow(
          l10n.accIntakeStatus,
          Align(
            alignment: AlignmentDirectional.centerStart,
            child: TpStatusChip(
              status: vehicleStatusTone(statusWord),
              label: statusWord ?? unavailableLabel,
              isCompact: true,
            ),
          ),
        ),
      ],
    );

    final Widget photo = SizedBox(
      key: const ValueKey<String>('accident.report.assetPhoto'),
      height: 150,
      child: AccidentVehicleImageView(
        asset: asset,
        semanticLabel: asset.displayIdentity ?? unavailableLabel,
        placeholderSize: 72,
      ),
    );

    final List<Widget> locked = <Widget>[
      ReadOnlyAssetValue(
        label: l10n.accIntakeAssetNo,
        value: assetNo,
        identifier: true,
      ),
      ReadOnlyAssetValue(label: l10n.accPlate, value: plate, identifier: true),
      ReadOnlyAssetValue(
        label: l10n.accIntakeMakeModel,
        value: _shown(makeModel, unavailableLabel),
      ),
      ReadOnlyAssetValue(
        label: l10n.accIntakeVehicleType,
        value: _shown(asset.vehicleType, unavailableLabel),
      ),
      ReadOnlyAssetValue(
        label: l10n.accIntakeHomeSite,
        value: homeSiteWithCountry.isEmpty
            ? unavailableLabel
            : homeSiteWithCountry,
      ),
      ReadOnlyAssetValue(label: l10n.accIntakeCurrentMeter, value: meter),
      ReadOnlyAssetValue(
        label: l10n.accIntakeStatus,
        value: statusWord ?? unavailableLabel,
      ),
    ];

    return Column(
      key: AccidentReportIntakeKeys.assetMaster,
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: <Widget>[
        TpCard(
          padding: const EdgeInsets.all(TpSpace.md),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: <Widget>[
              LayoutBuilder(
                builder: (BuildContext context, BoxConstraints constraints) {
                  final Widget title = Row(
                    children: <Widget>[
                      Icon(
                        Icons.check_circle,
                        color: palette.primary,
                        size: TpSizing.iconLg,
                      ),
                      const SizedBox(width: TpSpace.sm),
                      Expanded(
                        child: Semantics(
                          header: true,
                          child: Text(
                            l10n.accIntakeAssetLoaded,
                            style: text.titleSmall
                                ?.copyWith(fontWeight: FontWeight.w700),
                          ),
                        ),
                      ),
                    ],
                  );
                  final Widget change = TextButton.icon(
                    key: AccidentReportIntakeKeys.changeAsset,
                    onPressed: onChange,
                    icon: const Icon(Icons.edit_outlined),
                    label: Text(changeLabel),
                  );
                  // A narrow phone keeps the title whole and moves the action
                  // under it rather than squeezing the heading to one word.
                  if (constraints.maxWidth <
                      300 * MediaQuery.textScalerOf(context).scale(1)) {
                    return Column(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: <Widget>[
                        title,
                        Align(
                          alignment: AlignmentDirectional.centerEnd,
                          child: change,
                        ),
                      ],
                    );
                  }
                  return Row(
                    children: <Widget>[
                      Expanded(child: title),
                      change,
                    ],
                  );
                },
              ),
              const SizedBox(height: TpSpace.sm),
              LayoutBuilder(
                builder: (BuildContext context, BoxConstraints constraints) {
                  if (constraints.maxWidth < 360) {
                    return Column(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: <Widget>[
                        photo,
                        const SizedBox(height: TpSpace.sm),
                        values,
                      ],
                    );
                  }
                  return Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: <Widget>[
                      Expanded(flex: 5, child: photo),
                      const SizedBox(width: TpSpace.md),
                      Expanded(flex: 6, child: values),
                    ],
                  );
                },
              ),
            ],
          ),
        ),
        const SizedBox(height: TpSpace.md),
        TpCard(
          key: AccidentReportIntakeKeys.autoFilled,
          padding: const EdgeInsets.all(TpSpace.md),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: <Widget>[
              Row(
                children: <Widget>[
                  Icon(
                    Icons.check_circle_outline,
                    color: palette.primary,
                    size: TpSizing.iconLg,
                  ),
                  const SizedBox(width: TpSpace.sm),
                  Expanded(
                    child: Semantics(
                      header: true,
                      child: Text(
                        l10n.accIntakeAutoFilled,
                        style: text.titleSmall
                            ?.copyWith(fontWeight: FontWeight.w700),
                      ),
                    ),
                  ),
                  Icon(
                    Icons.lock,
                    size: TpSizing.iconSm,
                    color: palette.textSecondary,
                  ),
                  const SizedBox(width: TpSpace.xs),
                  Text(
                    l10n.accRptReadOnly,
                    style: text.labelMedium
                        ?.copyWith(color: palette.textSecondary),
                  ),
                ],
              ),
              const SizedBox(height: TpSpace.sm),
              LayoutBuilder(
                builder: (BuildContext context, BoxConstraints constraints) {
                  final int perRow = constraints.maxWidth >= 560
                      ? 4
                      : constraints.maxWidth >= 300
                          ? 2
                          : 1;
                  final double width =
                      (constraints.maxWidth - TpSpace.sm * (perRow - 1)) /
                          perRow;
                  return Wrap(
                    spacing: TpSpace.sm,
                    runSpacing: TpSpace.sm,
                    children: <Widget>[
                      for (final Widget value in locked)
                        SizedBox(width: width, child: value),
                    ],
                  );
                },
              ),
              const SizedBox(height: TpSpace.sm),
              Text(
                accidentFleetMasterLockNote(context),
                key: AccidentReportIntakeKeys.lockNote,
                style: text.bodySmall?.copyWith(color: palette.textSecondary),
              ),
            ],
          ),
        ),
      ],
    );
  }
}

class ReadOnlyAssetValue extends StatelessWidget {
  const ReadOnlyAssetValue({
    required this.label,
    required this.value,
    this.identifier = false,
    super.key,
  });

  final String label;
  final String value;
  final bool identifier;

  @override
  Widget build(BuildContext context) {
    final TpPalette palette = TpPalette.of(context);
    final AppLocalizations l10n = AppLocalizations.of(context);
    final TextStyle? style = Theme.of(context).textTheme.bodyMedium;
    return Semantics(
      label: '$label, $value, ${l10n.accRptReadOnly}',
      excludeSemantics: true,
      child: DecoratedBox(
        decoration: BoxDecoration(
          color: palette.surface,
          borderRadius: BorderRadius.circular(TpRadius.md),
          border: Border.all(color: palette.border),
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
                      style: Theme.of(context).textTheme.labelMedium?.copyWith(
                            color: palette.textSecondary,
                          ),
                    ),
                    const SizedBox(height: 2),
                    if (identifier)
                      TpIdentifierText(
                        value,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: style,
                      )
                    else
                      Text(
                        value,
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                        style: style,
                      ),
                  ],
                ),
              ),
              const SizedBox(width: TpSpace.xs),
              Icon(
                Icons.lock_outline,
                size: TpSizing.iconSm,
                color: palette.textMuted,
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// Mock M1 "Where did the incident occur?" card. The incident site is its
/// own statement, separate from the asset's home site: the row stays empty
/// until the reporter chooses, and the fleet register never fills it. The
/// picker offers the home site and the other fleet sites, and accepts a
/// typed site or location that is not in the list.
class AccidentIncidentSiteSelector extends StatelessWidget {
  const AccidentIncidentSiteSelector({
    required this.value,
    required this.knownSites,
    required this.onSiteChosen,
    this.homeSite,
    super.key,
  });

  /// The chosen incident site; blank shows the prompt.
  final String value;

  /// Distinct site names from the loaded fleet cache, already sorted.
  final List<String> knownSites;

  final ValueChanged<String> onSiteChosen;

  /// The selected asset's home site, offered first and labelled.
  final String? homeSite;

  Future<void> _pick(BuildContext context) async {
    final String? chosen = await showModalBottomSheet<String>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      showDragHandle: true,
      builder: (BuildContext context) => _IncidentSiteSheet(
        initial: value,
        knownSites: knownSites,
        homeSite: _clean(homeSite),
      ),
    );
    final String? cleaned = _clean(chosen);
    if (cleaned != null) onSiteChosen(cleaned);
  }

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final TpPalette palette = TpPalette.of(context);
    final TextTheme text = Theme.of(context).textTheme;
    final String? chosen = _clean(value);
    return TpCard(
      padding: const EdgeInsets.all(TpSpace.md),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: <Widget>[
          Semantics(
            header: true,
            child: Text(
              l10n.accIntakeWhereOccurred,
              style: text.titleMedium?.copyWith(fontWeight: FontWeight.w700),
            ),
          ),
          const SizedBox(height: TpSpace.xs),
          Row(
            crossAxisAlignment: CrossAxisAlignment.end,
            children: <Widget>[
              Expanded(
                child: Text(
                  accidentIncidentSiteHelp(context),
                  style:
                      text.bodyMedium?.copyWith(color: palette.textSecondary),
                ),
              ),
              Tooltip(
                message: l10n.accRptIncidentSiteInfo,
                triggerMode: TooltipTriggerMode.tap,
                child: Semantics(
                  button: true,
                  label: l10n.accRptIncidentSiteInfo,
                  excludeSemantics: true,
                  child: SizedBox.square(
                    dimension: TpSizing.minTouchTarget,
                    child: Icon(
                      Icons.info_outline,
                      size: TpSizing.iconMd,
                      color: palette.textSecondary,
                    ),
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: TpSpace.sm),
          Semantics(
            button: true,
            label: chosen == null
                ? l10n.accRptSelectIncidentSite
                : '${l10n.accReportIncidentSite}: $chosen',
            excludeSemantics: true,
            child: Material(
              key: AccidentReportIntakeKeys.incidentSite,
              color: palette.surface,
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(TpRadius.md),
                side: BorderSide(color: palette.border),
              ),
              clipBehavior: Clip.antiAlias,
              child: InkWell(
                onTap: () => _pick(context),
                child: ConstrainedBox(
                  constraints: const BoxConstraints(
                    minHeight: TpSizing.controlHeight,
                  ),
                  child: Padding(
                    padding: const EdgeInsets.symmetric(
                      horizontal: TpSpace.md,
                      vertical: TpSpace.sm,
                    ),
                    child: Row(
                      children: <Widget>[
                        Icon(
                          Icons.location_on_outlined,
                          color: chosen == null
                              ? palette.textSecondary
                              : palette.primary,
                        ),
                        const SizedBox(width: TpSpace.md),
                        Expanded(
                          child: Text(
                            chosen ?? l10n.accRptSelectIncidentSite,
                            style: text.bodyLarge?.copyWith(
                              color: chosen == null
                                  ? palette.textSecondary
                                  : palette.text,
                              fontWeight: chosen == null
                                  ? FontWeight.w400
                                  : FontWeight.w700,
                            ),
                          ),
                        ),
                        Icon(
                          Icons.chevron_right_rounded,
                          color: palette.textSecondary,
                        ),
                      ],
                    ),
                  ),
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

/// Owns its own text controller for exactly as long as the sheet route is
/// mounted, like the fleet picker: the reverse animation can outlive the
/// sheet's future.
class _IncidentSiteSheet extends StatefulWidget {
  const _IncidentSiteSheet({
    required this.initial,
    required this.knownSites,
    this.homeSite,
  });

  final String initial;
  final List<String> knownSites;
  final String? homeSite;

  @override
  State<_IncidentSiteSheet> createState() => _IncidentSiteSheetState();
}

class _IncidentSiteSheetState extends State<_IncidentSiteSheet> {
  late final TextEditingController _text =
      TextEditingController(text: widget.initial.trim());

  @override
  void dispose() {
    _text.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final TextTheme text = Theme.of(context).textTheme;
    final String typed = _text.text.trim();
    final String needle = typed.toLowerCase();
    final List<String> sites = <String>[
      if (widget.homeSite != null) widget.homeSite!,
      for (final String site in widget.knownSites)
        if (site != widget.homeSite) site,
    ]
        .where(
          (String site) =>
              needle.isEmpty || site.toLowerCase().contains(needle),
        )
        .toList(growable: false);
    final bool typedIsListed = sites.any(
      (String site) => site.toLowerCase() == needle,
    );
    return Padding(
      padding: EdgeInsets.only(
        left: TpSpace.lg,
        right: TpSpace.lg,
        bottom: MediaQuery.viewInsetsOf(context).bottom + TpSpace.lg,
      ),
      child: SizedBox(
        height: MediaQuery.sizeOf(context).height * .7,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: <Widget>[
            Semantics(
              header: true,
              child: Text(l10n.accRptSiteSheetTitle, style: text.titleLarge),
            ),
            const SizedBox(height: TpSpace.xs),
            Text(accidentIncidentSiteHelp(context), style: text.bodySmall),
            const SizedBox(height: TpSpace.md),
            TextField(
              key: AccidentReportIntakeKeys.incidentSiteField,
              controller: _text,
              autofocus: widget.knownSites.isEmpty,
              textCapitalization: TextCapitalization.words,
              textInputAction: TextInputAction.done,
              decoration: InputDecoration(
                labelText: l10n.accReportIncidentSite,
                hintText: l10n.accRptSiteSheetHint,
                prefixIcon: const Icon(Icons.search),
              ),
              onChanged: (_) => setState(() {}),
              onSubmitted: (String value) {
                if (value.trim().isNotEmpty) {
                  Navigator.of(context).pop(value.trim());
                }
              },
            ),
            if (typed.isNotEmpty && !typedIsListed) ...<Widget>[
              const SizedBox(height: TpSpace.sm),
              TpButton.secondary(
                key: AccidentReportIntakeKeys.useTypedSite,
                label: l10n.accRptUseTypedSite(typed),
                icon: Icons.check_rounded,
                onPressed: () => Navigator.of(context).pop(typed),
                isFullWidth: true,
              ),
            ],
            const SizedBox(height: TpSpace.md),
            Text(l10n.accRptFleetSites, style: text.labelLarge),
            const SizedBox(height: TpSpace.xs),
            Expanded(
              child: sites.isEmpty
                  ? Text(l10n.accRptNoFleetSites, style: text.bodyMedium)
                  : ListView.builder(
                      itemCount: sites.length,
                      itemBuilder: (BuildContext context, int index) {
                        final String site = sites[index];
                        final bool isHome = site == widget.homeSite;
                        return ListTile(
                          key: AccidentReportIntakeKeys.siteChip(site),
                          leading: Icon(
                            isHome
                                ? Icons.home_work_outlined
                                : Icons.location_on_outlined,
                          ),
                          title: Text(
                            isHome ? l10n.accIntakeHomeSiteChip(site) : site,
                          ),
                          selected: site == widget.initial.trim(),
                          onTap: () => Navigator.of(context).pop(site),
                        );
                      },
                    ),
            ),
          ],
        ),
      ),
    );
  }
}

/// Scans an asset QR code or barcode inside the report and returns the
/// extracted code, so the report can select the asset from the fleet it
/// already loaded. A typed code is the fallback when the camera cannot run.
class AccidentAssetScanSheet extends StatefulWidget {
  const AccidentAssetScanSheet({super.key});

  @override
  State<AccidentAssetScanSheet> createState() => _AccidentAssetScanSheetState();
}

class _AccidentAssetScanSheetState extends State<AccidentAssetScanSheet> {
  final MobileScannerController _camera = MobileScannerController();
  final TextEditingController _code = TextEditingController();
  bool _done = false;

  @override
  void dispose() {
    unawaited(_camera.dispose());
    _code.dispose();
    super.dispose();
  }

  void _finish(String raw) {
    if (_done) return;
    final String code = extractScanCode(raw);
    if (code.isEmpty) return;
    _done = true;
    Navigator.of(context).pop(code);
  }

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final TextTheme text = Theme.of(context).textTheme;
    return Padding(
      padding: EdgeInsets.only(
        left: TpSpace.lg,
        right: TpSpace.lg,
        bottom: MediaQuery.viewInsetsOf(context).bottom + TpSpace.lg,
      ),
      child: SingleChildScrollView(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: <Widget>[
            Semantics(
              header: true,
              child: Text(l10n.accRptScanAsset, style: text.titleLarge),
            ),
            const SizedBox(height: TpSpace.xs),
            Text(l10n.accRptScanHint, style: text.bodySmall),
            const SizedBox(height: TpSpace.md),
            ClipRRect(
              borderRadius: BorderRadius.circular(TpRadius.lg),
              child: SizedBox(
                height: 240,
                child: MobileScanner(
                  controller: _camera,
                  onDetect: (BarcodeCapture capture) {
                    for (final Barcode barcode in capture.barcodes) {
                      final String raw = barcode.rawValue?.trim() ?? '';
                      if (raw.isNotEmpty) {
                        _finish(raw);
                        return;
                      }
                    }
                  },
                  errorBuilder:
                      (BuildContext context, MobileScannerException error) =>
                          Center(
                    child: Padding(
                      padding: const EdgeInsets.all(TpSpace.lg),
                      child: Text(
                        l10n.accRptScanCameraUnavailable,
                        textAlign: TextAlign.center,
                      ),
                    ),
                  ),
                ),
              ),
            ),
            const SizedBox(height: TpSpace.md),
            TextField(
              key: AccidentReportIntakeKeys.scanCodeField,
              controller: _code,
              textCapitalization: TextCapitalization.characters,
              decoration: InputDecoration(
                labelText: l10n.accRptScanTypeCode,
                prefixIcon: const Icon(Icons.pin_outlined),
              ),
              onSubmitted: _finish,
            ),
            const SizedBox(height: TpSpace.sm),
            TpButton.primary(
              label: l10n.accRptScanFindAsset,
              icon: Icons.search,
              onPressed: () => _finish(_code.text),
              isFullWidth: true,
            ),
          ],
        ),
      ),
    );
  }
}

/// Distinct, sorted site names from the loaded fleet, bounded so a large
/// register does not render hundreds of chips.
List<String> knownSitesFrom(List<VehicleAsset> assets, {int limit = 24}) {
  final Set<String> sites = <String>{};
  for (final VehicleAsset asset in assets) {
    final String? site = _clean(asset.site);
    if (site != null) sites.add(site);
  }
  final List<String> sorted = sites.toList()..sort();
  return List<String>.unmodifiable(sorted.take(limit < 0 ? 0 : limit));
}

class AccidentYesNoField extends StatelessWidget {
  const AccidentYesNoField({
    required this.label,
    required this.value,
    required this.onChanged,
    this.helper,
    super.key,
  });

  final String label;
  final bool? value;
  final ValueChanged<bool> onChanged;
  final String? helper;

  @override
  Widget build(BuildContext context) => Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Text(label, style: Theme.of(context).textTheme.labelMedium),
          if (helper != null) ...<Widget>[
            const SizedBox(height: 2),
            Text(helper!, style: Theme.of(context).textTheme.bodySmall),
          ],
          const SizedBox(height: TpSpace.xs),
          TpSegmented<bool?>(
            value: value,
            expanded: true,
            options: <TpSegmentedOption<bool?>>[
              TpSegmentedOption<bool?>(
                value: true,
                label: AppLocalizations.of(context).accYes,
                icon: Icons.check_rounded,
              ),
              TpSegmentedOption<bool?>(
                value: false,
                label: AppLocalizations.of(context).accNo,
                icon: Icons.close_rounded,
              ),
            ],
            onChanged: (bool? next) {
              if (next != null) onChanged(next);
            },
          ),
        ],
      );
}

class AccidentEvidenceChecklist extends StatelessWidget {
  const AccidentEvidenceChecklist({
    required this.requirements,
    required this.paths,
    required this.busyKey,
    required this.onCamera,
    required this.onGallery,
    required this.onRemove,
    super.key,
  });

  final List<AccidentEvidenceRequirement> requirements;
  final Map<String, String> paths;
  final String? busyKey;
  final ValueChanged<AccidentEvidenceRequirement> onCamera;
  final ValueChanged<AccidentEvidenceRequirement> onGallery;
  final ValueChanged<AccidentEvidenceRequirement> onRemove;

  @override
  Widget build(BuildContext context) {
    final int complete = requirements
        .where(
          (AccidentEvidenceRequirement item) =>
              paths[item.key]?.trim().isNotEmpty == true,
        )
        .length;
    final int total = requirements.length;
    final AppLocalizations l10n = AppLocalizations.of(context);
    final TpPalette palette = TpPalette.of(context);
    final bool done = complete == total;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: <Widget>[
        Row(
          children: <Widget>[
            Expanded(
              child: Text(
                l10n.accIntakeRequiredPhotos(complete, total),
                style: Theme.of(context).textTheme.titleSmall,
              ),
            ),
            TpStatusChip(
              status: done ? TpStatus.ok : TpStatus.warning,
              label: done
                  ? l10n.accReportComplete
                  : l10n.accIntakeMissingCount(total - complete),
              icon: done ? Icons.check_circle_outline : Icons.warning_amber,
              isCompact: true,
            ),
          ],
        ),
        const SizedBox(height: TpSpace.sm),
        ClipRRect(
          borderRadius: BorderRadius.circular(TpRadius.pill),
          child: LinearProgressIndicator(
            value: total == 0 ? 1 : complete / total,
            minHeight: 8,
            color: done ? palette.ok.base : palette.warning.base,
            backgroundColor: palette.surfaceSunken,
          ),
        ),
        const SizedBox(height: TpSpace.md),
        for (final AccidentEvidenceRequirement item in requirements)
          Padding(
            padding: const EdgeInsets.only(bottom: TpSpace.sm),
            child: _EvidenceRequirementTile(
              key: AccidentReportIntakeKeys.evidence(item.key),
              requirement: item,
              attached: paths[item.key]?.trim().isNotEmpty == true,
              busy: busyKey == item.key,
              onCamera: () => onCamera(item),
              onGallery: () => onGallery(item),
              onRemove: () => onRemove(item),
            ),
          ),
      ],
    );
  }
}

class _EvidenceRequirementTile extends StatelessWidget {
  const _EvidenceRequirementTile({
    required this.requirement,
    required this.attached,
    required this.busy,
    required this.onCamera,
    required this.onGallery,
    required this.onRemove,
    super.key,
  });

  final AccidentEvidenceRequirement requirement;
  final bool attached;
  final bool busy;
  final VoidCallback onCamera;
  final VoidCallback onGallery;
  final VoidCallback onRemove;

  @override
  Widget build(BuildContext context) {
    final TpPalette palette = TpPalette.of(context);
    return TpCard(
      padding: const EdgeInsets.all(TpSpace.sm),
      borderColor: attached ? palette.ok.base : palette.warning.base,
      child: Row(
        children: <Widget>[
          Container(
            width: 52,
            height: 52,
            alignment: Alignment.center,
            decoration: BoxDecoration(
              color: attached ? palette.ok.soft : palette.surfaceAlt,
              borderRadius: BorderRadius.circular(TpRadius.sm),
            ),
            child: busy
                ? SizedBox.square(
                    dimension: 22,
                    child: CircularProgressIndicator(
                      strokeWidth: 2,
                      color: palette.primary,
                    ),
                  )
                : Icon(
                    attached
                        ? Icons.check_circle_rounded
                        : Icons.add_a_photo_outlined,
                    color: attached ? palette.ok.base : palette.textMuted,
                  ),
          ),
          const SizedBox(width: TpSpace.sm),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                Text(
                  requirement.label,
                  style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                        fontWeight: FontWeight.w700,
                      ),
                ),
                Text(
                  attached
                      ? AppLocalizations.of(context).accIntakeAttachedOnDevice
                      : AppLocalizations.of(context)
                          .accIntakeRequiredCategory(requirement.category),
                  style: Theme.of(context).textTheme.bodySmall?.copyWith(
                        color: attached
                            ? palette.ok.onSoft
                            : palette.textSecondary,
                      ),
                ),
              ],
            ),
          ),
          if (attached)
            IconButton(
              tooltip: AppLocalizations.of(context).accIntakeRemovePhoto,
              onPressed: busy ? null : onRemove,
              icon: const Icon(Icons.delete_outline),
            )
          else ...<Widget>[
            IconButton(
              tooltip: AppLocalizations.of(context).accReportChooseGallery,
              onPressed: busy ? null : onGallery,
              icon: const Icon(Icons.photo_outlined),
            ),
            IconButton(
              tooltip: AppLocalizations.of(context).accReportTakePhoto,
              onPressed: busy ? null : onCamera,
              icon: const Icon(Icons.camera_alt_outlined),
            ),
          ],
        ],
      ),
    );
  }
}

class AccidentOptionalDocumentList extends StatelessWidget {
  const AccidentOptionalDocumentList({
    required this.paths,
    required this.busyKey,
    required this.onAdd,
    required this.onRemove,
    super.key,
  });

  final Map<String, String> paths;
  final String? busyKey;
  final ValueChanged<AccidentEvidenceRequirement> onAdd;
  final ValueChanged<AccidentEvidenceRequirement> onRemove;

  @override
  Widget build(BuildContext context) => Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: <Widget>[
          Text(
            AppLocalizations.of(context).accIntakeSupportingDocuments,
            style: Theme.of(context).textTheme.titleSmall,
          ),
          const SizedBox(height: TpSpace.xs),
          Text(
            AppLocalizations.of(context).accIntakeSupportingDocumentsHelp,
            style: Theme.of(context).textTheme.bodySmall,
          ),
          const SizedBox(height: TpSpace.sm),
          for (final AccidentEvidenceRequirement item
              in accidentOptionalDocuments)
            ListTile(
              dense: true,
              contentPadding: EdgeInsets.zero,
              leading: Icon(
                paths[item.key]?.trim().isNotEmpty == true
                    ? Icons.description_rounded
                    : Icons.note_add_outlined,
              ),
              title: Text(item.label),
              subtitle: Text(
                paths[item.key]?.trim().isNotEmpty == true
                    ? AppLocalizations.of(context).accIntakeAttachedOnDevice
                    : AppLocalizations.of(context).accIntakeOptionalAtIntake,
              ),
              trailing: busyKey == item.key
                  ? const SizedBox.square(
                      dimension: 22,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    )
                  : paths[item.key]?.trim().isNotEmpty == true
                      ? IconButton(
                          tooltip: AppLocalizations.of(context)
                              .accIntakeRemoveAttachment,
                          onPressed: () => onRemove(item),
                          icon: const Icon(Icons.close),
                        )
                      : IconButton(
                          tooltip: AppLocalizations.of(context)
                              .accIntakeAttachDocumentPhoto,
                          onPressed: () => onAdd(item),
                          icon: const Icon(Icons.attach_file),
                        ),
            ),
        ],
      );
}

class AccidentReviewRow extends StatelessWidget {
  const AccidentReviewRow({
    required this.label,
    required this.value,
    this.icon,
    super.key,
  });

  final String label;
  final String value;
  final IconData? icon;

  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.symmetric(vertical: TpSpace.xs),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            if (icon != null) ...<Widget>[
              Icon(icon, size: TpSizing.iconSm),
              const SizedBox(width: TpSpace.sm),
            ],
            Expanded(
              child: Text(
                label,
                style: Theme.of(context).textTheme.bodySmall,
              ),
            ),
            const SizedBox(width: TpSpace.md),
            Expanded(
              flex: 2,
              child: Text(
                value,
                textAlign: TextAlign.end,
                style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                      fontWeight: FontWeight.w700,
                    ),
              ),
            ),
          ],
        ),
      );
}

String _shown(String? value, String fallback) => _clean(value) ?? fallback;

String? _clean(String? value) {
  final String clean = value?.trim() ?? '';
  return clean.isEmpty ? null : clean;
}
