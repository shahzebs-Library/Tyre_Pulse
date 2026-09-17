/// Small building blocks shared by the mock M4/M5 workspaces: numbered
/// section cards, fact rows, money formatting in the case currency, the
/// notify-role chip strip, the evidence source picker and error wording.
library;

import 'package:flutter/material.dart';
import 'package:intl/intl.dart' show DateFormat, NumberFormat;
import 'package:tyre_pulse/app/localization/tp_direction.dart';
import 'package:tyre_pulse/app/theme/tp_colors.dart';
import 'package:tyre_pulse/app/theme/tp_spacing.dart';
import 'package:tyre_pulse/core/design_system/design_system.dart';
import 'package:tyre_pulse/core/errors/app_error.dart';
import 'package:tyre_pulse/core/network/supabase_error_mapper.dart';
import 'package:tyre_pulse/features/accidents/data/accident_photo_capture.dart';
import 'package:tyre_pulse/features/accidents/domain/accident_case_vocab.dart';
import 'package:tyre_pulse/features/accidents/domain/accident_claim_package.dart';
import 'package:tyre_pulse/features/accidents/domain/accident_models.dart';

const String accidentWsNotSet = 'Not set';

/// Money in the case country's currency. The currency code comes from the
/// workspace (server `country_currency`), never from a default; with no
/// code the number stands alone rather than wearing a guessed label.
String accidentWsMoney(BuildContext context, num? value, String? currency) {
  if (value == null || !value.isFinite) return accidentWsNotSet;
  final String locale = Localizations.localeOf(context).toLanguageTag();
  final String number = NumberFormat('#,##0.00', locale).format(value);
  final String code = currency?.trim() ?? '';
  final String text = code.isEmpty ? number : '$code $number';
  return TpDirection.isRtl(context) ? TpDirection.isolateLtr(text) : text;
}

String accidentWsDateTime(BuildContext context, DateTime? value) {
  if (value == null) return accidentWsNotSet;
  final String locale = Localizations.localeOf(context).toLanguageTag();
  return '${DateFormat('d MMM y', locale).format(value)} '
      '${DateFormat.Hm(locale).format(value)}';
}

String accidentWsText(String? value) {
  final String text = value?.trim() ?? '';
  return text.isEmpty ? accidentWsNotSet : text;
}

/// A safe sentence for a failed action. Never the driver message.
String accidentWsErrorText(Object error) => switch (error) {
      final SupabaseFailure failure => failure.error.message,
      final AppError appError => appError.message,
      final UnsupportedError unsupported =>
        unsupported.message ?? 'That file is not supported.',
      final ArgumentError argument =>
        argument.message?.toString() ?? 'Check the values and try again.',
      _ => 'Something went wrong. Please try again.',
    };

/// The owner role a notify chip resolves to from the case workstreams.
String? accidentWsOwnerRole(AccidentCaseSnapshot snapshot, String roleKey) {
  final String? workstream = notifyRoleWorkstream[roleKey];
  if (workstream == null) return null;
  for (final AccidentWorkstream w in snapshot.workstreams) {
    if (w.key == workstream) return w.ownerRole;
  }
  return null;
}

class AccidentWsSection extends StatelessWidget {
  const AccidentWsSection({
    required this.title,
    required this.children,
    this.number,
    this.trailing,
    super.key,
  });

  final int? number;
  final String title;
  final Widget? trailing;
  final List<Widget> children;

  @override
  Widget build(BuildContext context) {
    final TpPalette palette = TpPalette.of(context);
    return TpCard(
      padding: EdgeInsets.zero,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: <Widget>[
          Padding(
            padding: const EdgeInsets.all(TpSpace.md),
            child: Row(
              children: <Widget>[
                if (number != null) ...<Widget>[
                  DecoratedBox(
                    decoration: BoxDecoration(
                      color: palette.primarySoft,
                      shape: BoxShape.circle,
                    ),
                    child: SizedBox(
                      width: 28,
                      height: 28,
                      child: Center(
                        child: Text(
                          '$number',
                          style:
                              Theme.of(context).textTheme.labelLarge?.copyWith(
                                    color: palette.primary,
                                    fontWeight: FontWeight.w800,
                                  ),
                        ),
                      ),
                    ),
                  ),
                  const SizedBox(width: TpSpace.sm),
                ],
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: <Widget>[
                      Text(
                        title,
                        style:
                            Theme.of(context).textTheme.titleMedium?.copyWith(
                                  fontWeight: FontWeight.w800,
                                ),
                      ),
                      // Below the title, never beside it: a phone-width row
                      // cannot hold "Claim document package" and "7 of 8
                      // required documents" side by side without clipping.
                      if (trailing != null) ...<Widget>[
                        const SizedBox(height: TpSpace.xs),
                        trailing!,
                      ],
                    ],
                  ),
                ),
              ],
            ),
          ),
          Divider(height: 1, color: palette.border),
          Padding(
            padding: const EdgeInsets.all(TpSpace.md),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: children,
            ),
          ),
        ],
      ),
    );
  }
}

class AccidentWsFact extends StatelessWidget {
  const AccidentWsFact({
    required this.label,
    required this.value,
    this.icon,
    this.trailing,
    this.emphasis = false,
    super.key,
  });

  final String label;
  final String value;
  final IconData? icon;
  final Widget? trailing;
  final bool emphasis;

  @override
  Widget build(BuildContext context) {
    final TpPalette palette = TpPalette.of(context);
    final TextTheme text = Theme.of(context).textTheme;
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: TpSpace.xs),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          if (icon != null) ...<Widget>[
            Icon(icon, size: TpSizing.iconSm, color: palette.textSecondary),
            const SizedBox(width: TpSpace.sm),
          ],
          Expanded(
            child: Text(
              label,
              style: text.bodyMedium?.copyWith(color: palette.textSecondary),
            ),
          ),
          const SizedBox(width: TpSpace.sm),
          Flexible(
            child: Text(
              value,
              textAlign: TextAlign.end,
              style: text.bodyMedium?.copyWith(
                fontWeight: emphasis ? FontWeight.w800 : FontWeight.w600,
              ),
            ),
          ),
          if (trailing != null) ...<Widget>[
            const SizedBox(width: TpSpace.xs),
            trailing!,
          ],
        ],
      ),
    );
  }
}

class AccidentWsWarning extends StatelessWidget {
  const AccidentWsWarning({
    required this.message,
    this.tone = TpStatus.warning,
    super.key,
  });

  final String message;
  final TpStatus tone;

  @override
  Widget build(BuildContext context) {
    final TpStatusColors colors = TpPalette.of(context).forStatus(tone);
    return DecoratedBox(
      decoration: BoxDecoration(
        color: colors.soft,
        borderRadius: BorderRadius.circular(TpRadius.md),
        border: Border.all(color: colors.base),
      ),
      child: Padding(
        padding: const EdgeInsets.all(TpSpace.md),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            Icon(
              tone == TpStatus.info
                  ? Icons.info_outline_rounded
                  : Icons.warning_amber_rounded,
              size: TpSizing.iconMd,
              color: colors.onSoft,
            ),
            const SizedBox(width: TpSpace.sm),
            Expanded(
              child: Text(
                message,
                style: Theme.of(context)
                    .textTheme
                    .bodyMedium
                    ?.copyWith(color: colors.onSoft),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// "Not provisioned yet" notes from a repository read, one line each.
class AccidentWsNotes extends StatelessWidget {
  const AccidentWsNotes({required this.notes, super.key});
  final List<String> notes;

  @override
  Widget build(BuildContext context) => Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: <Widget>[
          for (final String note in notes) ...<Widget>[
            AccidentWsWarning(message: note, tone: TpStatus.info),
            const SizedBox(height: TpSpace.sm),
          ],
        ],
      );
}

/// The "notify" strip: one chip per role in [keys], resolved to the case's
/// owner role when the workstream carries one. PMV Manager stays a
/// visibility-only chip, as the mock prints.
class AccidentWsNotifyChips extends StatelessWidget {
  const AccidentWsNotifyChips({
    required this.snapshot,
    required this.keys,
    super.key,
  });

  final AccidentCaseSnapshot snapshot;
  final List<String> keys;

  String _chipLabel(NotifyRole role) {
    final String text =
        notifyChipText(role, accidentWsOwnerRole(snapshot, role.key));
    return role.visibilityOnly ? '$text (for visibility)' : text;
  }

  @override
  Widget build(BuildContext context) => Wrap(
        spacing: TpSpace.sm,
        runSpacing: TpSpace.xs,
        children: <Widget>[
          for (final NotifyRole role in notifyRoles)
            if (keys.contains(role.key))
              TpStatusChip(
                status: role.visibilityOnly ? TpStatus.neutral : TpStatus.info,
                icon: role.visibilityOnly
                    ? Icons.visibility_outlined
                    : Icons.notifications_active_outlined,
                label: _chipLabel(role),
                isCompact: true,
              ),
        ],
      );
}

/// Camera or gallery, the two sources the existing capture helper offers.
Future<AccidentPhotoSource?> pickAccidentEvidenceSource(
  BuildContext context,
  String title,
) =>
    showModalBottomSheet<AccidentPhotoSource>(
      context: context,
      builder: (BuildContext sheet) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: <Widget>[
            Padding(
              padding: const EdgeInsets.all(TpSpace.md),
              child: Text(
                title,
                style: Theme.of(sheet).textTheme.titleMedium?.copyWith(
                      fontWeight: FontWeight.w800,
                    ),
              ),
            ),
            ListTile(
              leading: const Icon(Icons.photo_camera_outlined),
              title: const Text('Take a photo'),
              onTap: () =>
                  Navigator.of(sheet).pop(AccidentPhotoSource.camera),
            ),
            ListTile(
              leading: const Icon(Icons.folder_open_outlined),
              title: const Text('Choose a file from the device'),
              onTap: () =>
                  Navigator.of(sheet).pop(AccidentPhotoSource.gallery),
            ),
            const SizedBox(height: TpSpace.sm),
          ],
        ),
      ),
    );

class AccidentWsYesNo extends StatelessWidget {
  const AccidentWsYesNo({
    required this.label,
    required this.value,
    required this.riskWhen,
    this.onChanged,
    super.key,
  });

  final String label;
  final bool? value;

  /// The answer that reads as a risk (red); the other reads green.
  final bool riskWhen;
  final ValueChanged<bool>? onChanged;

  @override
  Widget build(BuildContext context) {
    final TpPalette palette = TpPalette.of(context);
    final bool? v = value;
    final TpStatusColors colors = v == null
        ? palette.forStatus(TpStatus.unknown)
        : palette.forStatus(v == riskWhen ? TpStatus.critical : TpStatus.ok);
    final IconData icon = v == null
        ? Icons.help_outline_rounded
        : v == riskWhen
            ? Icons.cancel_rounded
            : Icons.check_circle_rounded;
    return Row(
      children: <Widget>[
        Icon(icon, color: colors.base, size: TpSizing.iconLg),
        const SizedBox(width: TpSpace.sm),
        Expanded(child: Text(label)),
        if (onChanged == null)
          Text(
            v == null
                ? accidentWsNotSet
                : v
                    ? 'Yes'
                    : 'No',
            style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                  fontWeight: FontWeight.w800,
                  color: colors.onSoft,
                ),
          )
        else if (v != null)
          TpSegmented<bool>(
            options: const <TpSegmentedOption<bool>>[
              TpSegmentedOption<bool>(value: true, label: 'Yes'),
              TpSegmentedOption<bool>(value: false, label: 'No'),
            ],
            value: v,
            onChanged: onChanged,
          )
        else
          // Nothing recorded yet: two plain choices, neither pre-selected,
          // so an unanswered question never reads as an answer.
          Row(
            mainAxisSize: MainAxisSize.min,
            children: <Widget>[
              TpButton.secondary(
                label: 'Yes',
                isCompact: true,
                onPressed: () => onChanged!(true),
              ),
              const SizedBox(width: TpSpace.xs),
              TpButton.secondary(
                label: 'No',
                isCompact: true,
                onPressed: () => onChanged!(false),
              ),
            ],
          ),
      ],
    );
  }
}
