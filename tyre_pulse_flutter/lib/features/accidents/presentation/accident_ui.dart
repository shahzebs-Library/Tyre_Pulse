library;

import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/intl.dart' show DateFormat;
import 'package:tyre_pulse/app/localization/tp_localizations.dart';
import 'package:tyre_pulse/app/theme/tp_colors.dart';
import 'package:tyre_pulse/app/theme/tp_spacing.dart';
import 'package:tyre_pulse/core/design_system/design_system.dart';
import 'package:tyre_pulse/core/errors/app_error.dart';
import 'package:tyre_pulse/core/network/supabase_error_mapper.dart';
import 'package:tyre_pulse/core/storage/private_storage_reference_resolver.dart';
import 'package:tyre_pulse/features/accidents/accidents_providers.dart';
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
      value.contains('review') ||
      value.contains('progress') ||
      value.contains('moderate')) {
    return TpStatus.warning;
  }
  return value.isEmpty ? TpStatus.unknown : TpStatus.info;
}

/// Formats a persisted incident timestamp for the compact accident mocks.
/// Unparseable production values remain visible verbatim rather than being
/// replaced with a guessed date.
String formatAccidentIncidentDate(
  BuildContext context,
  String raw, {
  bool includeTime = false,
}) {
  final String source = raw.trim();
  final DateTime? parsed = DateTime.tryParse(source);
  if (parsed == null) return source;
  final String locale = Localizations.localeOf(context).toLanguageTag();
  final String date = DateFormat('d MMM y', locale).format(parsed);
  if (!includeTime) return date;
  return '$date • ${DateFormat.Hm(locale).format(parsed)}';
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
            // The label column carries the icon AND its wrapped text, so it
            // needs far more of the row than the thin connecting line does.
            // Giving both an equal `Expanded` (flex 1) - the previous shape -
            // squeezed every label into 1/(2n-1) of the row width, which is
            // why even single, short words such as "Insurance" wrapped
            // mid-word instead of matching the approved mock's one-line
            // labels.
            Expanded(
              flex: 4,
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
    final AccidentCopy copy = AccidentCopy.of(context);
    final String stateLabel = switch (step.state) {
      AccidentProgressState.done => copy('done'),
      AccidentProgressState.current => copy('inProgress'),
      AccidentProgressState.pending => copy('pending'),
      AccidentProgressState.unknown => copy('notRecorded'),
    };
    return Semantics(
      label: '${step.label}, $stateLabel',
      excludeSemantics: true,
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
              index: index,
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

class _EvidenceTile extends ConsumerWidget {
  const _EvidenceTile({
    required this.index,
    required this.reference,
    required this.label,
  });

  final int index;
  final String reference;
  final String label;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final Uri? uri = Uri.tryParse(reference);
    final bool isHttpImage = uri != null &&
        uri.host.isNotEmpty &&
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
            child: PrivateStorageReference.tryParse(reference) != null
                ? _privateImage(ref)
                : isHttpImage
                    ? Image.network(
                        reference,
                        key: Key('accident.evidence.image.$index'),
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

  Widget _privateImage(WidgetRef ref) {
    final AsyncValue<String> resolved =
        ref.watch(accidentEvidenceUrlProvider(reference));
    return resolved.when(
      data: (String signedUrl) => _resolvedPrivateImage(
        signedUrl,
        ref,
      ),
      loading: () => _EvidenceReferenceState(
        key: Key('accident.evidence.loading.$index'),
        label: label,
        loading: true,
      ),
      error: (Object error, StackTrace stackTrace) => _EvidenceReferenceState(
        key: Key('accident.evidence.error.$index'),
        label: label,
        retryKey: Key('accident.evidence.retry.$index'),
        onRetry: () => ref.invalidate(accidentEvidenceUrlProvider(reference)),
      ),
    );
  }

  Widget _resolvedPrivateImage(
    String signedUrl,
    WidgetRef ref,
  ) {
    // Supabase returns HTTPS in production. Accepting an image data URI keeps
    // the resolver contract independently testable without bypassing it.
    final Uint8List? bytes = _dataImageBytes(signedUrl);
    if (bytes != null) {
      return Image.memory(
        bytes,
        key: Key('accident.evidence.image.$index'),
        fit: BoxFit.cover,
        errorBuilder: (_, __, ___) => _EvidenceReferenceState(
          key: Key('accident.evidence.error.$index'),
          label: label,
          retryKey: Key('accident.evidence.retry.$index'),
          onRetry: () => ref.invalidate(accidentEvidenceUrlProvider(reference)),
        ),
      );
    }

    final Uri? uri = Uri.tryParse(signedUrl);
    if (uri == null ||
        uri.host.isEmpty ||
        (uri.scheme.toLowerCase() != 'https' &&
            uri.scheme.toLowerCase() != 'http')) {
      return _EvidenceReferenceState(
        key: Key('accident.evidence.error.$index'),
        label: label,
        retryKey: Key('accident.evidence.retry.$index'),
        onRetry: () => ref.invalidate(accidentEvidenceUrlProvider(reference)),
      );
    }
    return Image.network(
      signedUrl,
      key: Key('accident.evidence.image.$index'),
      fit: BoxFit.cover,
      loadingBuilder: (
        BuildContext context,
        Widget child,
        ImageChunkEvent? progress,
      ) {
        if (progress == null) return child;
        return _EvidenceReferenceState(
          key: Key('accident.evidence.loading.$index'),
          label: label,
          loading: true,
        );
      },
      errorBuilder: (_, __, ___) => _EvidenceReferenceState(
        key: Key('accident.evidence.error.$index'),
        label: label,
        retryKey: Key('accident.evidence.retry.$index'),
        onRetry: () => ref.invalidate(accidentEvidenceUrlProvider(reference)),
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

class _EvidenceReferenceState extends StatelessWidget {
  const _EvidenceReferenceState({
    required this.label,
    this.loading = false,
    this.onRetry,
    this.retryKey,
    super.key,
  });

  final String label;
  final bool loading;
  final VoidCallback? onRetry;
  final Key? retryKey;

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final TpPalette palette = TpPalette.of(context);
    return Stack(
      fit: StackFit.expand,
      children: <Widget>[
        Center(
          child: Padding(
            padding: const EdgeInsets.all(TpSpace.xs),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: <Widget>[
                if (loading)
                  SizedBox.square(
                    dimension: TpSizing.iconSm,
                    child: CircularProgressIndicator(
                      strokeWidth: TpBorderWidth.strong,
                      color: palette.primary,
                    ),
                  )
                else
                  Icon(
                    Icons.broken_image_outlined,
                    color: palette.textMuted,
                    size: TpSizing.iconSm,
                  ),
                const SizedBox(height: TpSpace.xs),
                Text(
                  loading
                      ? AccidentCopy.of(context)('loading')
                      : l10n.valueUnavailable,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  textAlign: TextAlign.center,
                  style: Theme.of(context).textTheme.labelSmall?.copyWith(
                        color: palette.textMuted,
                      ),
                ),
              ],
            ),
          ),
        ),
        if (onRetry != null)
          PositionedDirectional(
            end: 0,
            bottom: 0,
            child: SizedBox.square(
              dimension: TpSizing.iconLg,
              child: IconButton(
                key: retryKey,
                onPressed: onRetry,
                tooltip: l10n.actionRetry,
                padding: EdgeInsets.zero,
                visualDensity: VisualDensity.compact,
                iconSize: TpSizing.iconSm,
                icon: const Icon(Icons.refresh_rounded),
              ),
            ),
          ),
      ],
    );
  }
}

Uint8List? _dataImageBytes(String reference) {
  final Uri? uri = Uri.tryParse(reference);
  if (uri == null || uri.scheme.toLowerCase() != 'data') return null;
  try {
    final UriData? data = uri.data;
    if (data == null || !data.mimeType.toLowerCase().startsWith('image/')) {
      return null;
    }
    return Uint8List.fromList(data.contentAsBytes());
  } on FormatException {
    return null;
  }
}
