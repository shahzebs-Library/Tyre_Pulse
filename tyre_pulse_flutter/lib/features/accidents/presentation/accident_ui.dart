library;

import 'package:flutter/material.dart';
import 'package:tyre_pulse/app/theme/tp_colors.dart';
import 'package:tyre_pulse/app/theme/tp_spacing.dart';
import 'package:tyre_pulse/core/design_system/design_system.dart';
import 'package:tyre_pulse/core/errors/app_error.dart';
import 'package:tyre_pulse/core/network/supabase_error_mapper.dart';
import 'package:tyre_pulse/features/accidents/domain/accident_models.dart';
import 'package:tyre_pulse/features/accidents/presentation/accident_copy.dart';

AppError accidentAppError(Object error, AccidentCopy copy) => switch (error) {
      final SupabaseFailure failure => failure.error,
      final AppError appError => appError,
      _ => AppError(
          kind: AppErrorKind.unknown,
          message: copy('loadFailed'),
        ),
    };

TpStatus accidentTone(String? token) {
  final String value = token?.trim().toLowerCase() ?? '';
  if (value.contains('fatal') ||
      value.contains('severe') ||
      value.contains('reject') ||
      value.contains('overdue')) {
    return TpStatus.critical;
  }
  if (value.contains('minor') ||
      value == 'completed' ||
      value == 'closed' ||
      value == 'approved' ||
      value == 'recovered') {
    return TpStatus.ok;
  }
  if (value.contains('wait') ||
      value.contains('pending') ||
      value.contains('hold') ||
      value.contains('progress') ||
      value.contains('moderate')) {
    return TpStatus.warning;
  }
  return value.isEmpty ? TpStatus.unknown : TpStatus.info;
}

class AccidentHero extends StatelessWidget {
  const AccidentHero({
    required this.eyebrow,
    required this.title,
    required this.message,
    required this.icon,
    this.trailing,
    super.key,
  });
  final String eyebrow;
  final String title;
  final String message;
  final IconData icon;
  final Widget? trailing;

  @override
  Widget build(BuildContext context) {
    final TpPalette palette = TpPalette.of(context);
    return Semantics(
      container: true,
      header: true,
      child: DecoratedBox(
        decoration: BoxDecoration(
          color: palette.info.soft,
          borderRadius: BorderRadius.circular(TpRadius.xl),
          border: Border.all(color: palette.info.base),
        ),
        child: Padding(
          padding: const EdgeInsets.all(TpSpace.xl),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: <Widget>[
              DecoratedBox(
                decoration: BoxDecoration(
                  color: palette.info.base,
                  borderRadius: BorderRadius.circular(TpRadius.md),
                ),
                child: Padding(
                  padding: const EdgeInsets.all(TpSpace.md),
                  child: Icon(icon, color: palette.info.onBase),
                ),
              ),
              const SizedBox(width: TpSpace.md),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: <Widget>[
                    Text(
                      eyebrow.toUpperCase(),
                      style: Theme.of(context).textTheme.labelSmall?.copyWith(
                            color: palette.info.onSoft,
                            letterSpacing: 1.2,
                            fontWeight: FontWeight.w800,
                          ),
                    ),
                    const SizedBox(height: TpSpace.xs),
                    Text(title, style: Theme.of(context).textTheme.titleLarge),
                    const SizedBox(height: TpSpace.xs),
                    Text(
                      message,
                      style: Theme.of(context).textTheme.bodyMedium,
                    ),
                  ],
                ),
              ),
              if (trailing != null) ...<Widget>[
                const SizedBox(width: TpSpace.sm),
                trailing!,
              ],
            ],
          ),
        ),
      ),
    );
  }
}

class AccidentSection extends StatelessWidget {
  const AccidentSection({
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
  Widget build(BuildContext context) => TpCard(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            Row(
              children: <Widget>[
                Icon(icon, size: 20),
                const SizedBox(width: TpSpace.sm),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: <Widget>[
                      Text(
                        title,
                        style: Theme.of(context).textTheme.titleMedium,
                      ),
                      if (subtitle != null)
                        Text(
                          subtitle!,
                          style: Theme.of(context).textTheme.bodySmall,
                        ),
                    ],
                  ),
                ),
              ],
            ),
            const SizedBox(height: TpSpace.lg),
            child,
          ],
        ),
      );
}

class AccidentInfoRow extends StatelessWidget {
  const AccidentInfoRow(this.label, this.value, {super.key});
  final String label;
  final Object? value;

  @override
  Widget build(BuildContext context) {
    final String shown = value?.toString().trim() ?? '';
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: TpSpace.xs),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Expanded(
            child: Text(label, style: Theme.of(context).textTheme.bodySmall),
          ),
          const SizedBox(width: TpSpace.md),
          Expanded(
            flex: 2,
            child: Text(
              shown.isEmpty ? AccidentCopy.of(context)('notRecorded') : shown,
              textAlign: TextAlign.end,
              style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                    fontWeight: FontWeight.w600,
                  ),
            ),
          ),
        ],
      ),
    );
  }
}

String workstreamLabel(AccidentCopy copy, String key) => switch (key) {
      'incident_evidence' => copy('wsIncident'),
      'fleet_validation' => copy('wsFleet'),
      'liability' => copy('wsLiability'),
      'insurance' => copy('wsInsurance'),
      'assessment' => copy('wsAssessment'),
      'repair' => copy('wsRepair'),
      'workshop_qc' => copy('wsQc'),
      'handover' => copy('wsHandover'),
      'finance' => copy('wsFinance'),
      'corrective' => copy('wsCorrective'),
      _ => humaniseAccidentToken(key),
    };

enum AccidentProgressState { done, current, pending, unknown }

@immutable
final class AccidentProgressStep {
  const AccidentProgressStep({required this.label, required this.state});

  final String label;
  final AccidentProgressState state;
}

/// The compact five-stage ladder used by the approved Accident Case mock.
///
/// Every state is supplied by the caller from a real accident/workstream row.
/// This widget never assumes that a missing workstream has completed.
class AccidentProgressLadder extends StatelessWidget {
  const AccidentProgressLadder({required this.steps, super.key});

  final List<AccidentProgressStep> steps;

  @override
  Widget build(BuildContext context) {
    final TpPalette palette = TpPalette.of(context);
    return Semantics(
      container: true,
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          for (int index = 0; index < steps.length; index++) ...<Widget>[
            Expanded(
              child: _ProgressNode(
                step: steps[index],
                palette: palette,
              ),
            ),
            if (index < steps.length - 1)
              Expanded(
                child: Padding(
                  padding: const EdgeInsets.only(top: 14),
                  child: Container(
                    height: TpBorderWidth.strong,
                    color: _stepIsReached(steps[index].state)
                        ? palette.primary
                        : palette.borderStrong,
                  ),
                ),
              ),
          ],
        ],
      ),
    );
  }

  static bool _stepIsReached(AccidentProgressState state) =>
      state == AccidentProgressState.done ||
      state == AccidentProgressState.current;
}

class _ProgressNode extends StatelessWidget {
  const _ProgressNode({required this.step, required this.palette});

  final AccidentProgressStep step;
  final TpPalette palette;

  @override
  Widget build(BuildContext context) {
    final bool active = step.state == AccidentProgressState.done ||
        step.state == AccidentProgressState.current;
    final bool unknown = step.state == AccidentProgressState.unknown;
    final Color foreground = active ? palette.onPrimary : palette.textMuted;
    return Semantics(
      label: step.label,
      selected: step.state == AccidentProgressState.current,
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: <Widget>[
          Container(
            width: 28,
            height: 28,
            decoration: BoxDecoration(
              color: active ? palette.primary : palette.surface,
              shape: BoxShape.circle,
              border: Border.all(
                color: active
                    ? palette.primary
                    : unknown
                        ? palette.unknown.base
                        : palette.borderStrong,
                width: unknown ? TpBorderWidth.strong : TpBorderWidth.hairline,
              ),
            ),
            child: Icon(
              switch (step.state) {
                AccidentProgressState.done => Icons.check_rounded,
                AccidentProgressState.current => Icons.more_horiz_rounded,
                AccidentProgressState.pending => Icons.chevron_right_rounded,
                AccidentProgressState.unknown => Icons.remove_rounded,
              },
              color: foreground,
              size: 16,
            ),
          ),
          const SizedBox(height: TpSpace.xs),
          Text(
            step.label,
            maxLines: 2,
            overflow: TextOverflow.ellipsis,
            textAlign: TextAlign.center,
            style: Theme.of(context).textTheme.labelSmall?.copyWith(
                  color: active ? palette.text : palette.textSecondary,
                  fontWeight: active ? FontWeight.w700 : FontWeight.w500,
                ),
          ),
        ],
      ),
    );
  }
}

/// Mock-matched evidence strip. It displays only real stored references.
class AccidentEvidenceStrip extends StatelessWidget {
  const AccidentEvidenceStrip({
    required this.photos,
    required this.emptyLabel,
    required this.evidenceLabel,
    super.key,
  });

  final List<String> photos;
  final String emptyLabel;
  final String evidenceLabel;

  @override
  Widget build(BuildContext context) {
    if (photos.isEmpty) {
      return TpCard(
        isDashed: true,
        padding: const EdgeInsets.all(TpSpace.md),
        child: Row(
          children: <Widget>[
            const Icon(Icons.photo_library_outlined),
            const SizedBox(width: TpSpace.sm),
            Expanded(child: Text(emptyLabel)),
          ],
        ),
      );
    }

    final int visible = photos.length.clamp(0, 3);
    return Row(
      children: <Widget>[
        for (int index = 0; index < visible; index++) ...<Widget>[
          Expanded(
            child: _EvidenceTile(
              reference: photos[index],
              label: '$evidenceLabel ${index + 1}',
            ),
          ),
          if (index < visible - 1) const SizedBox(width: TpSpace.sm),
        ],
        if (photos.length > visible) ...<Widget>[
          const SizedBox(width: TpSpace.sm),
          Expanded(
            child: AspectRatio(
              aspectRatio: 1,
              child: DecoratedBox(
                decoration: BoxDecoration(
                  color: TpPalette.of(context).surfaceAlt,
                  borderRadius: BorderRadius.circular(TpRadius.sm),
                  border: Border.all(color: TpPalette.of(context).border),
                ),
                child: Center(
                  child: Text(
                    '+${photos.length - visible}',
                    style: Theme.of(context).textTheme.titleMedium,
                  ),
                ),
              ),
            ),
          ),
        ],
      ],
    );
  }
}

class _EvidenceTile extends StatelessWidget {
  const _EvidenceTile({required this.reference, required this.label});

  final String reference;
  final String label;

  @override
  Widget build(BuildContext context) {
    final Uri? uri = Uri.tryParse(reference);
    final bool canRender = uri != null &&
        (uri.scheme.toLowerCase() == 'https' ||
            uri.scheme.toLowerCase() == 'http');
    final TpPalette palette = TpPalette.of(context);
    return Semantics(
      image: true,
      label: label,
      child: AspectRatio(
        aspectRatio: 1,
        child: ClipRRect(
          borderRadius: BorderRadius.circular(TpRadius.sm),
          child: DecoratedBox(
            decoration: BoxDecoration(
              color: palette.surfaceAlt,
              border: Border.all(color: palette.border),
            ),
            child: canRender
                ? Image.network(
                    reference,
                    fit: BoxFit.cover,
                    errorBuilder: (_, __, ___) => _EvidenceReferenceIcon(
                      color: palette.textMuted,
                    ),
                  )
                : _EvidenceReferenceIcon(color: palette.textMuted),
          ),
        ),
      ),
    );
  }
}

class _EvidenceReferenceIcon extends StatelessWidget {
  const _EvidenceReferenceIcon({required this.color});

  final Color color;

  @override
  Widget build(BuildContext context) => Center(
        child: Icon(Icons.image_outlined, color: color),
      );
}
