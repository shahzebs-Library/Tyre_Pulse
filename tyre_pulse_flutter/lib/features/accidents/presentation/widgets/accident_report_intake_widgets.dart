/// Reusable presentation pieces for the accident-report intake only.
library;

import 'package:flutter/material.dart';
import 'package:tyre_pulse/app/localization/tp_direction.dart';
import 'package:tyre_pulse/app/theme/tp_colors.dart';
import 'package:tyre_pulse/app/theme/tp_spacing.dart';
import 'package:tyre_pulse/core/design_system/design_system.dart';
import 'package:tyre_pulse/features/accidents/domain/accident_report_intake.dart';
import 'package:tyre_pulse/features/assets/domain/vehicle_asset.dart';
import 'package:tyre_pulse/features/assets/presentation/vehicle_photo_resolver.dart';

/// The wizard pages are the validation groups themselves, numbered by
/// `reportWizardSteps`, so there is exactly one "Step N of 7" in the app.
/// The alias keeps existing callers and tests readable.
typedef AccidentIntakePage = AccidentReportStep;

/// The exact fleet-master note printed under the locked fields (M7).
const String accidentFleetMasterLockNote =
    'These details are sourced from fleet master and cannot be edited here. '
    'If any detail is incorrect, please update it in the fleet system.';

/// The sub-text under "Where did the incident occur?" (M7).
const String accidentIncidentSiteHelp =
    'Select the site/location of this incident. This may be different from '
    "the asset's home site.";

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
}

class AccidentReportProgress extends StatelessWidget {
  const AccidentReportProgress({
    required this.current,
    required this.onSelect,
    super.key,
  });

  final AccidentReportStep current;
  final ValueChanged<AccidentReportStep> onSelect;

  @override
  Widget build(BuildContext context) {
    final TpPalette palette = TpPalette.of(context);
    return Semantics(
      key: AccidentReportIntakeKeys.progress,
      container: true,
      label: current.eyebrow,
      child: TpCard(
        padding: const EdgeInsets.all(TpSpace.md),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            Text(
              current.eyebrow,
              key: AccidentReportIntakeKeys.eyebrow,
              style: Theme.of(context).textTheme.labelLarge?.copyWith(
                    color: palette.primary,
                    fontWeight: FontWeight.w800,
                  ),
            ),
            const SizedBox(height: TpSpace.sm),
            Wrap(
              spacing: TpSpace.xs,
              runSpacing: TpSpace.xs,
              children: <Widget>[
                for (final AccidentReportStep step
                    in AccidentReportStep.values) ...<Widget>[
                  _StepDot(
                    step: step,
                    selected: step == current,
                    completed: step.index < current.index,
                    onTap: () => onSelect(step),
                  ),
                ],
              ],
            ),
          ],
        ),
      ),
    );
  }
}

class _StepDot extends StatelessWidget {
  const _StepDot({
    required this.step,
    required this.selected,
    required this.completed,
    required this.onTap,
  });

  final AccidentReportStep step;
  final bool selected;
  final bool completed;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final TpPalette palette = TpPalette.of(context);
    final Color foreground =
        selected || completed ? palette.onPrimary : palette.textSecondary;
    return Semantics(
      button: true,
      selected: selected,
      label: '${step.number}. ${step.label}',
      child: Material(
        color: selected || completed ? palette.primary : palette.surfaceAlt,
        borderRadius: BorderRadius.circular(TpRadius.pill),
        child: InkWell(
          key: AccidentReportIntakeKeys.step(step),
          onTap: onTap,
          borderRadius: BorderRadius.circular(TpRadius.pill),
          child: Padding(
            padding: const EdgeInsets.symmetric(
              horizontal: TpSpace.sm,
              vertical: TpSpace.xs,
            ),
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: <Widget>[
                Icon(
                  completed ? Icons.check_rounded : Icons.circle,
                  color: foreground,
                  size: 13,
                ),
                const SizedBox(width: 4),
                Text(
                  step.label,
                  style: Theme.of(context).textTheme.labelSmall?.copyWith(
                        color: foreground,
                        fontWeight:
                            selected ? FontWeight.w800 : FontWeight.w600,
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

class AccidentDraftStatus extends StatelessWidget {
  const AccidentDraftStatus({
    required this.label,
    required this.saving,
    required this.failed,
    super.key,
  });

  final String label;
  final bool saving;
  final bool failed;

  @override
  Widget build(BuildContext context) {
    final TpPalette palette = TpPalette.of(context);
    final TpStatusColors colors = failed
        ? palette.critical
        : saving
            ? palette.warning
            : palette.ok;
    return Semantics(
      liveRegion: true,
      label: label,
      child: DecoratedBox(
        decoration: BoxDecoration(
          color: colors.soft,
          borderRadius: BorderRadius.circular(TpRadius.pill),
          border: Border.all(color: colors.base),
        ),
        child: Padding(
          padding: const EdgeInsets.symmetric(
            horizontal: TpSpace.sm,
            vertical: TpSpace.xs,
          ),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: <Widget>[
              if (saving)
                SizedBox.square(
                  dimension: TpSizing.iconSm,
                  child: CircularProgressIndicator(
                    strokeWidth: 2,
                    color: colors.base,
                  ),
                )
              else
                Icon(
                  failed ? Icons.cloud_off_outlined : Icons.cloud_done_outlined,
                  size: TpSizing.iconSm,
                  color: colors.onSoft,
                ),
              const SizedBox(width: TpSpace.xs),
              Flexible(
                child: Text(
                  label,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: Theme.of(context).textTheme.labelSmall?.copyWith(
                        color: colors.onSoft,
                        fontWeight: FontWeight.w700,
                      ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// One Step 1 match row (M7): vehicle illustration, asset no, type and a
/// plate chip. The illustration is the shared fleet artwork resolver; an
/// asset with no artwork shows its class icon, never a placeholder image.
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
    final String? photo = vehiclePhotoAsset(asset);
    final String identity = asset.displayIdentity ?? unavailableLabel;
    final String? plate = _clean(asset.registrationNo);
    final String details = <String?>[
      asset.vehicleType,
      asset.make,
      asset.model,
      asset.site,
    ]
        .whereType<String>()
        .map((String value) => value.trim())
        .where((String value) => value.isNotEmpty)
        .join(' · ');
    final TpPalette palette = TpPalette.of(context);
    return TpCard(
      key: AccidentReportIntakeKeys.matchRow(asset.id),
      padding: EdgeInsets.zero,
      child: Material(
        color: Colors.transparent,
        child: ListTile(
          selected: selected,
          selectedTileColor: palette.primarySoft,
          onTap: onTap,
          contentPadding: const EdgeInsets.all(TpSpace.sm),
          leading: Container(
            width: 78,
            height: 62,
            clipBehavior: Clip.antiAlias,
            alignment: Alignment.center,
            decoration: BoxDecoration(
              color: palette.surfaceAlt,
              borderRadius: BorderRadius.circular(TpRadius.sm),
            ),
            child: photo == null
                ? Icon(
                    vehicleFallbackIcon(asset),
                    color: palette.primary,
                    size: 32,
                  )
                : Image.asset(
                    photo,
                    fit: BoxFit.contain,
                    width: double.infinity,
                    height: double.infinity,
                    semanticLabel: identity,
                  ),
          ),
          title: Directionality(
            textDirection: TextDirection.ltr,
            child: Text(
              identity,
              style: Theme.of(context).textTheme.titleSmall?.copyWith(
                    fontWeight: FontWeight.w800,
                  ),
            ),
          ),
          subtitle: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: <Widget>[
              if (details.isNotEmpty)
                Text(
                  details,
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                ),
              if (plate != null)
                Padding(
                  padding: const EdgeInsets.only(top: TpSpace.xs),
                  child: Align(
                    alignment: AlignmentDirectional.centerStart,
                    child: TpStatusChip(
                      status: TpStatus.neutral,
                      label: plate,
                      icon: Icons.badge_outlined,
                      isCompact: true,
                    ),
                  ),
                ),
            ],
          ),
          trailing:
              Icon(selected ? Icons.check_circle : Icons.chevron_right_rounded),
        ),
      ),
    );
  }
}

/// M7 "Asset loaded from fleet master" card plus the read-only auto-filled
/// lock fields. Every value is the register's own; a missing value reads
/// [unavailableLabel], never a guess.
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
    final String? photo = vehiclePhotoAsset(asset);
    final String meter = asset.currentKm == null
        ? unavailableLabel
        : '${formatVehicleOdometer(asset.currentKm!)} km';
    final String makeModel = <String?>[asset.make, asset.model]
        .whereType<String>()
        .map((String value) => value.trim())
        .where((String value) => value.isNotEmpty)
        .join(' ');
    final TpPalette palette = TpPalette.of(context);
    final String assetNo =
        _shown(asset.assetNo ?? asset.fleetNumber, unavailableLabel);
    final List<(String, String)> cardRows = <(String, String)>[
      ('Asset no', assetNo),
      ('Vehicle type', _shown(asset.vehicleType, unavailableLabel)),
      ('Plate', _shown(asset.registrationNo, unavailableLabel)),
      ('Make / model', _shown(makeModel, unavailableLabel)),
      ('Site (home)', _shown(asset.site, unavailableLabel)),
      ('Country', _shown(asset.country, unavailableLabel)),
      ('Current meter', meter),
      ('Status', _shown(asset.status, unavailableLabel)),
    ];
    return Column(
      key: AccidentReportIntakeKeys.assetMaster,
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: <Widget>[
        Row(
          children: <Widget>[
            const Icon(Icons.verified_outlined, size: TpSizing.iconMd),
            const SizedBox(width: TpSpace.sm),
            Expanded(
              child: Text(
                'Asset loaded from fleet master',
                style: Theme.of(context).textTheme.titleSmall,
              ),
            ),
            TpStatusChip(
              status: vehicleStatusTone(asset.status),
              label: _shown(asset.status, unavailableLabel),
              isCompact: true,
            ),
          ],
        ),
        const SizedBox(height: TpSpace.sm),
        TpCard(
          padding: const EdgeInsets.all(TpSpace.sm),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: <Widget>[
              SizedBox(
                key: const ValueKey<String>('accident.report.assetPhoto'),
                height: 164,
                child: photo != null
                    ? Image.asset(
                        photo,
                        fit: BoxFit.contain,
                        semanticLabel:
                            asset.displayIdentity ?? unavailableLabel,
                      )
                    : Icon(vehicleFallbackIcon(asset), size: 72),
              ),
              const SizedBox(height: TpSpace.xs),
              for (final (String label, String value) in cardRows)
                Padding(
                  padding: const EdgeInsets.symmetric(vertical: 2),
                  child: Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: <Widget>[
                      Expanded(
                        child: Text(
                          label,
                          style:
                              Theme.of(context).textTheme.bodySmall?.copyWith(
                                    color: palette.textMuted,
                                  ),
                        ),
                      ),
                      Expanded(
                        flex: 2,
                        child: label == 'Asset no' || label == 'Plate'
                            ? TpIdentifierText(
                                value,
                                style: Theme.of(context)
                                    .textTheme
                                    .bodyMedium
                                    ?.copyWith(fontWeight: FontWeight.w700),
                              )
                            : Text(
                                value,
                                style: Theme.of(context)
                                    .textTheme
                                    .bodyMedium
                                    ?.copyWith(fontWeight: FontWeight.w700),
                              ),
                      ),
                    ],
                  ),
                ),
              const SizedBox(height: TpSpace.xs),
              Align(
                alignment: AlignmentDirectional.centerEnd,
                child: TextButton.icon(
                  onPressed: onChange,
                  icon: const Icon(Icons.swap_horiz_rounded),
                  label: Text(changeLabel),
                ),
              ),
            ],
          ),
        ),
        const SizedBox(height: TpSpace.md),
        Row(
          children: <Widget>[
            Icon(
              Icons.lock_outline,
              size: TpSizing.iconSm,
              color: palette.textMuted,
            ),
            const SizedBox(width: TpSpace.xs),
            Expanded(
              child: Text(
                'Auto-filled from fleet master',
                style: Theme.of(context).textTheme.titleSmall,
              ),
            ),
          ],
        ),
        const SizedBox(height: TpSpace.sm),
        LayoutBuilder(
          builder: (BuildContext context, BoxConstraints constraints) {
            final bool compact = constraints.maxWidth < 560;
            final List<Widget> values = <Widget>[
              ReadOnlyAssetValue(
                label: 'Asset no',
                value: assetNo,
                identifier: true,
              ),
              ReadOnlyAssetValue(
                label: 'Plate',
                value: _shown(asset.registrationNo, unavailableLabel),
                identifier: true,
              ),
              ReadOnlyAssetValue(
                label: 'Make / model',
                value: _shown(makeModel, unavailableLabel),
              ),
              ReadOnlyAssetValue(
                label: 'Vehicle type',
                value: _shown(asset.vehicleType, unavailableLabel),
              ),
              ReadOnlyAssetValue(
                label: 'Site (home)',
                value: _shown(asset.site, unavailableLabel),
              ),
              ReadOnlyAssetValue(label: 'Current meter', value: meter),
              ReadOnlyAssetValue(
                label: 'Status',
                value: _shown(asset.status, unavailableLabel),
              ),
            ];
            if (compact) {
              return Column(
                children: <Widget>[
                  for (int index = 0; index < values.length; index += 2)
                    Padding(
                      padding: const EdgeInsets.only(bottom: TpSpace.sm),
                      child: Row(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: <Widget>[
                          Expanded(child: values[index]),
                          const SizedBox(width: TpSpace.sm),
                          Expanded(
                            child: index + 1 < values.length
                                ? values[index + 1]
                                : const SizedBox.shrink(),
                          ),
                        ],
                      ),
                    ),
                ],
              );
            }
            return Wrap(
              spacing: TpSpace.sm,
              runSpacing: TpSpace.sm,
              children: <Widget>[
                for (final Widget value in values)
                  SizedBox(width: 230, child: value),
              ],
            );
          },
        ),
        const SizedBox(height: TpSpace.xs),
        Text(
          accidentFleetMasterLockNote,
          key: AccidentReportIntakeKeys.lockNote,
          style: Theme.of(context).textTheme.bodySmall?.copyWith(
                color: palette.textSecondary,
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
    return DecoratedBox(
      decoration: BoxDecoration(
        color: palette.surfaceAlt,
        borderRadius: BorderRadius.circular(TpRadius.md),
        border: Border.all(color: palette.border),
      ),
      child: Padding(
        padding: const EdgeInsets.all(TpSpace.sm),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            Row(
              children: <Widget>[
                Expanded(
                  child: Text(
                    label,
                    style: Theme.of(context).textTheme.labelSmall?.copyWith(
                          color: palette.textMuted,
                        ),
                  ),
                ),
                Icon(
                  Icons.lock_outline,
                  size: 13,
                  color: palette.textMuted,
                ),
              ],
            ),
            const SizedBox(height: 2),
            if (identifier)
              TpIdentifierText(
                value,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                      fontWeight: FontWeight.w700,
                    ),
              )
            else
              Text(
                value,
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
                style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                      fontWeight: FontWeight.w700,
                    ),
              ),
          ],
        ),
      ),
    );
  }
}

/// M7 "Where did the incident occur?" - a free-text incident site with the
/// known fleet sites offered as one-tap choices. The text is the report's
/// `site`; the chips only fill it.
class AccidentIncidentSiteSelector extends StatelessWidget {
  const AccidentIncidentSiteSelector({
    required this.controller,
    required this.knownSites,
    required this.onSiteChosen,
    this.homeSite,
    super.key,
  });

  final TextEditingController controller;

  /// Distinct site names from the loaded fleet cache, already sorted.
  final List<String> knownSites;

  /// Called when a chip fills the field, so the host records a user edit.
  final ValueChanged<String> onSiteChosen;

  /// The selected asset's home site, labelled on its chip.
  final String? homeSite;

  @override
  Widget build(BuildContext context) {
    final String current = controller.text.trim();
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: <Widget>[
        Text(
          'Where did the incident occur?',
          style: Theme.of(context).textTheme.titleMedium,
        ),
        const SizedBox(height: TpSpace.xs),
        Text(
          accidentIncidentSiteHelp,
          style: Theme.of(context).textTheme.bodySmall,
        ),
        const SizedBox(height: TpSpace.sm),
        TpInput(
          key: AccidentReportIntakeKeys.incidentSite,
          label: 'Incident site',
          controller: controller,
          isRequired: true,
          prefixIcon: Icons.location_on_outlined,
          hint: 'Site or location name',
        ),
        if (knownSites.isNotEmpty) ...<Widget>[
          const SizedBox(height: TpSpace.sm),
          Wrap(
            spacing: TpSpace.xs,
            runSpacing: TpSpace.xs,
            children: <Widget>[
              for (final String site in knownSites)
                ChoiceChip(
                  key: AccidentReportIntakeKeys.siteChip(site),
                  label: Text(
                    site == homeSite?.trim() ? '$site (home)' : site,
                  ),
                  selected: site == current,
                  onSelected: (bool selected) {
                    if (selected) onSiteChosen(site);
                  },
                ),
            ],
          ),
        ],
      ],
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
            options: const <TpSegmentedOption<bool?>>[
              TpSegmentedOption<bool?>(
                value: true,
                label: 'Yes',
                icon: Icons.check_rounded,
              ),
              TpSegmentedOption<bool?>(
                value: false,
                label: 'No',
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
    final TpPalette palette = TpPalette.of(context);
    final bool done = complete == total;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: <Widget>[
        Row(
          children: <Widget>[
            Expanded(
              child: Text(
                '$complete of $total required photos',
                style: Theme.of(context).textTheme.titleSmall,
              ),
            ),
            TpStatusChip(
              status: done ? TpStatus.ok : TpStatus.warning,
              label: done ? 'Complete' : '${total - complete} missing',
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
                      ? 'Attached on this device'
                      : '${requirement.category} · Required',
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
              tooltip: 'Remove photo',
              onPressed: busy ? null : onRemove,
              icon: const Icon(Icons.delete_outline),
            )
          else ...<Widget>[
            IconButton(
              tooltip: 'Choose from gallery',
              onPressed: busy ? null : onGallery,
              icon: const Icon(Icons.photo_outlined),
            ),
            IconButton(
              tooltip: 'Take photo',
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
            'Supporting documents',
            style: Theme.of(context).textTheme.titleSmall,
          ),
          const SizedBox(height: TpSpace.xs),
          Text(
            'Attach what is available now. Route and country rules may require '
            'more during case review.',
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
                    ? 'Attached on this device'
                    : 'Optional at intake',
              ),
              trailing: busyKey == item.key
                  ? const SizedBox.square(
                      dimension: 22,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    )
                  : paths[item.key]?.trim().isNotEmpty == true
                      ? IconButton(
                          tooltip: 'Remove attachment',
                          onPressed: () => onRemove(item),
                          icon: const Icon(Icons.close),
                        )
                      : IconButton(
                          tooltip: 'Attach document photo',
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
