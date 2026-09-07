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

/// Presentation steps only; the persisted draft and submission groups stay
/// unchanged so existing device drafts continue to restore.
enum AccidentIntakePage {
  identifyAsset,
  incident,
  peopleAuthority,
  damage,
  evidence,
  documents,
  review,
}

/// Wide capture canvas for the two image-led intake pages.
class AccidentIntakeCanvas extends StatelessWidget {
  const AccidentIntakeCanvas({
    required this.title,
    required this.icon,
    required this.child,
    this.subtitle,
    super.key,
  });
  final String title;
  final String? subtitle;
  final IconData icon;
  final Widget child;

  @override
  Widget build(BuildContext context) => Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: <Widget>[
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

abstract final class AccidentReportIntakeKeys {
  static const ValueKey<String> progress =
      ValueKey<String>('accident.report.progress');
  static ValueKey<String> step(AccidentIntakePage step) =>
      ValueKey<String>('accident.report.step.${step.name}');
  static ValueKey<String> evidence(String key) =>
      ValueKey<String>('accident.report.evidence.$key');
  static const ValueKey<String> assetMaster =
      ValueKey<String>('accident.report.assetMaster');
}

class AccidentReportProgress extends StatelessWidget {
  const AccidentReportProgress({
    required this.current,
    required this.onSelect,
    super.key,
  });

  final AccidentIntakePage current;
  final ValueChanged<AccidentIntakePage> onSelect;

  static const Map<AccidentIntakePage, String> labels =
      <AccidentIntakePage, String>{
    AccidentIntakePage.identifyAsset: 'Identify asset',
    AccidentIntakePage.incident: 'Incident',
    AccidentIntakePage.peopleAuthority: 'People & authority',
    AccidentIntakePage.damage: 'Damage mapping',
    AccidentIntakePage.evidence: 'Evidence photos',
    AccidentIntakePage.documents: 'Documents',
    AccidentIntakePage.review: 'Review',
  };

  @override
  Widget build(BuildContext context) {
    final TpPalette palette = TpPalette.of(context);
    final int currentIndex = current.index;
    return Semantics(
      key: AccidentReportIntakeKeys.progress,
      container: true,
      label: 'Step ${currentIndex + 1} of ${AccidentIntakePage.values.length}: '
          '${labels[current]}',
      child: TpCard(
        padding: const EdgeInsets.all(TpSpace.md),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            Row(
              children: <Widget>[
                Expanded(
                  child: Text(
                    'Step ${currentIndex + 1} of '
                    '${AccidentIntakePage.values.length}',
                    style: Theme.of(context).textTheme.labelLarge?.copyWith(
                          color: palette.primary,
                          fontWeight: FontWeight.w800,
                        ),
                  ),
                ),
                Flexible(
                  child: Text(
                    labels[current]!,
                    style: Theme.of(context).textTheme.labelMedium,
                  ),
                ),
              ],
            ),
            const SizedBox(height: TpSpace.sm),
            Wrap(
              spacing: TpSpace.xs,
              runSpacing: TpSpace.xs,
              children: <Widget>[
                for (final AccidentIntakePage step
                    in AccidentIntakePage.values) ...<Widget>[
                  _StepDot(
                    step: step,
                    label: labels[step]!,
                    selected: step == current,
                    completed: false,
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
    required this.label,
    required this.selected,
    required this.completed,
    required this.onTap,
  });

  final AccidentIntakePage step;
  final String label;
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
      label: '${step.index + 1}. $label',
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
                  label,
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
              Row(
                children: <Widget>[
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: <Widget>[
                        TpIdentifierText(
                          asset.displayIdentity ?? unavailableLabel,
                          style: Theme.of(context).textTheme.titleLarge,
                        ),
                        Text(_shown(asset.vehicleType, unavailableLabel)),
                      ],
                    ),
                  ),
                  TextButton(onPressed: onChange, child: Text(changeLabel)),
                ],
              ),
            ],
          ),
        ),
        const SizedBox(height: TpSpace.md),
        Text(
          'Auto-filled from fleet master · Read-only',
          style: Theme.of(context).textTheme.titleSmall,
        ),
        const SizedBox(height: TpSpace.sm),
        LayoutBuilder(
          builder: (BuildContext context, BoxConstraints constraints) {
            final bool compact = constraints.maxWidth < 560;
            final List<Widget> values = <Widget>[
              ReadOnlyAssetValue(
                label: 'Asset no.',
                value: _shown(
                  asset.assetNo ?? asset.fleetNumber,
                  unavailableLabel,
                ),
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
                label: 'Home site',
                value: _shown(asset.site, unavailableLabel),
              ),
              ReadOnlyAssetValue(label: 'Current meter', value: meter),
              ReadOnlyAssetValue(
                label: 'Fleet status',
                value: _shown(asset.status, unavailableLabel),
              ),
              ReadOnlyAssetValue(
                label: 'Assigned driver',
                value: _shown(asset.operatorName, unavailableLabel),
              ),
              ReadOnlyAssetValue(
                label: 'Country',
                value: _shown(asset.country, unavailableLabel),
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

String _shown(String? value, String fallback) {
  final String clean = value?.trim() ?? '';
  return clean.isEmpty ? fallback : clean;
}
