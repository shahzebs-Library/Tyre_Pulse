/// Small building blocks shared by the mock M4/M5 workspaces: numbered
/// section cards, fact rows, money formatting in the case currency, the
/// notify-role chip strip, the evidence source picker and error wording.
library;

import 'package:flutter/material.dart';
import 'package:intl/intl.dart' show DateFormat, NumberFormat;
import 'package:tyre_pulse/app/localization/tp_direction.dart';
import 'package:tyre_pulse/app/localization/tp_localizations.dart';
import 'package:tyre_pulse/app/theme/tp_colors.dart';
import 'package:tyre_pulse/app/theme/tp_spacing.dart';
import 'package:tyre_pulse/core/design_system/design_system.dart';
import 'package:tyre_pulse/core/errors/app_error.dart';
import 'package:tyre_pulse/core/network/supabase_error_mapper.dart';
import 'package:tyre_pulse/features/accidents/data/accident_photo_capture.dart';
import 'package:tyre_pulse/features/accidents/domain/accident_case_vocab.dart';
import 'package:tyre_pulse/features/accidents/domain/accident_claim_package.dart';
import 'package:tyre_pulse/features/accidents/domain/accident_models.dart';

/// The localized "Not set" read-out for a field nobody has recorded.
String accidentWsNotSet(BuildContext context) =>
    AppLocalizations.of(context).accNotSet;

/// Money in the case country's currency. The currency code comes from the
/// workspace (server `country_currency`), never from a default; with no
/// code the number stands alone rather than wearing a guessed label.
String accidentWsMoney(BuildContext context, num? value, String? currency) {
  if (value == null || !value.isFinite) return accidentWsNotSet(context);
  final String locale = Localizations.localeOf(context).toLanguageTag();
  final String number = NumberFormat('#,##0.00', locale).format(value);
  final String code = currency?.trim() ?? '';
  final String text = code.isEmpty ? number : '$code $number';
  return TpDirection.isRtl(context) ? TpDirection.isolateLtr(text) : text;
}

String accidentWsDateTime(BuildContext context, DateTime? value) {
  if (value == null) return accidentWsNotSet(context);
  final String locale = Localizations.localeOf(context).toLanguageTag();
  return '${DateFormat('d MMM y', locale).format(value)} '
      '${DateFormat.Hm(locale).format(value)}';
}

String accidentWsText(BuildContext context, String? value) {
  final String text = value?.trim() ?? '';
  return text.isEmpty ? accidentWsNotSet(context) : text;
}

/// A safe sentence for a failed action. Never the driver message.
String accidentWsErrorText(BuildContext context, Object error) {
  final AppLocalizations l10n = AppLocalizations.of(context);
  return switch (error) {
    final SupabaseFailure failure => failure.error.message,
    final AppError appError => appError.message,
    final UnsupportedError unsupported =>
      unsupported.message ?? l10n.accErrorFileUnsupported,
    final ArgumentError argument =>
      argument.message?.toString() ?? l10n.accErrorCheckValues,
    _ => l10n.accErrorGeneric,
  };
}

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
          // ListTile-family rows (checklists, notify toggles) paint their
          // ink on the nearest Material; without this one they would try to
          // paint through the card's decorated background and Flutter's
          // debug check refuses the tree.
          Material(
            type: MaterialType.transparency,
            child: Padding(
              padding: const EdgeInsets.all(TpSpace.md),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: children,
              ),
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

/// The two footer actions the mocks draw side by side (an outlined save
/// next to the filled primary). They stay side by side while both labels
/// fit their half; when either would be cut short with an ellipsis they
/// stack full width instead, so an action is never only half readable.
class AccidentWsFooterPair extends StatelessWidget {
  const AccidentWsFooterPair({
    required this.first,
    required this.second,
    required this.labels,
    super.key,
  });

  final Widget first;
  final Widget second;

  /// The two button labels, used only to measure whether they fit.
  final List<String> labels;

  @override
  Widget build(BuildContext context) {
    final TextStyle style = Theme.of(context).textTheme.labelLarge ??
        const TextStyle(fontWeight: FontWeight.w700);
    final TextScaler scaler = MediaQuery.textScalerOf(context);
    final TextDirection direction = Directionality.of(context);
    double widest = 0;
    for (final String label in labels) {
      final TextPainter painter = TextPainter(
        text: TextSpan(text: label, style: style),
        textDirection: direction,
        textScaler: scaler,
        maxLines: 1,
      )..layout();
      if (painter.width > widest) widest = painter.width;
      painter.dispose();
    }
    // Icon, its gap and the button's own horizontal padding.
    final double needed =
        widest + TpSizing.iconMd + TpSpace.sm + TpSpace.lg * 2 + 2;
    return LayoutBuilder(
      builder: (BuildContext context, BoxConstraints constraints) {
        final double half = (constraints.maxWidth - TpSpace.sm) / 2;
        if (half >= needed) {
          return Row(
            children: <Widget>[
              Expanded(child: first),
              const SizedBox(width: TpSpace.sm),
              Expanded(child: second),
            ],
          );
        }
        return Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: <Widget>[
            first,
            const SizedBox(height: TpSpace.sm),
            second,
          ],
        );
      },
    );
  }
}

/// Team label for a notify role key, shared by the claim and assessment
/// notify cards so both print the same words.
String accidentWsTeamLabel(AppLocalizations l10n, String key) => switch (key) {
      'fleet' => l10n.accClaimTeamFleet,
      'workshop' => l10n.accClaimTeamWorkshop,
      'command_center' => l10n.accClaimTeamCommandCenter,
      'pmv_manager' => l10n.accClaimTeamPmvManager,
      'insurance' => l10n.accClaimTeamInsurance,
      _ => key,
    };

/// One "after submit, notify" card as the mocks draw it: a person glyph,
/// who is told on the first line and their team (or "For visibility")
/// underneath. Roles, never invented names, when no person is resolved.
class AccidentWsPersonTile extends StatelessWidget {
  const AccidentWsPersonTile({
    required this.who,
    required this.team,
    this.visibilityOnly = false,
    this.tooltip = '',
    super.key,
  });

  final String who;
  final String team;
  final bool visibilityOnly;
  final String tooltip;

  @override
  Widget build(BuildContext context) {
    final TpPalette palette = TpPalette.of(context);
    return MergeSemantics(
      child: Tooltip(
        message: tooltip,
        child: DecoratedBox(
          decoration: BoxDecoration(
            border: Border.all(color: palette.border),
            borderRadius: BorderRadius.circular(TpRadius.md),
          ),
          child: ConstrainedBox(
            constraints:
                const BoxConstraints(minHeight: TpSizing.minTouchTarget),
            child: Padding(
              padding: const EdgeInsets.all(TpSpace.sm),
              child: Row(
                children: <Widget>[
                  Icon(
                    visibilityOnly
                        ? Icons.visibility_outlined
                        : Icons.person_outline_rounded,
                    size: TpSizing.iconMd,
                    color: palette.textSecondary,
                  ),
                  const SizedBox(width: TpSpace.sm),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: <Widget>[
                        Text(
                          who,
                          style: Theme.of(context)
                              .textTheme
                              .bodyMedium
                              ?.copyWith(fontWeight: FontWeight.w700),
                        ),
                        Text(
                          team,
                          style: Theme.of(context)
                              .textTheme
                              .bodySmall
                              ?.copyWith(color: palette.textSecondary),
                        ),
                      ],
                    ),
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

/// Two cards per row when there is room, one per row on a narrow phone.
class AccidentWsTwoUp extends StatelessWidget {
  const AccidentWsTwoUp({required this.children, super.key});

  final List<Widget> children;

  @override
  Widget build(BuildContext context) => LayoutBuilder(
        builder: (BuildContext context, BoxConstraints constraints) {
          final bool twoUp = constraints.maxWidth >= 340;
          final double width = twoUp
              ? (constraints.maxWidth - TpSpace.sm) / 2
              : constraints.maxWidth;
          return Wrap(
            spacing: TpSpace.sm,
            runSpacing: TpSpace.sm,
            children: <Widget>[
              for (final Widget child in children)
                SizedBox(width: width, child: child),
            ],
          );
        },
      );
}

/// The "notify" block: one person card per role in [keys], named by the
/// case's owner role when the workstream carries one. PMV Manager stays a
/// visibility-only card, as the mock prints.
class AccidentWsNotifyChips extends StatelessWidget {
  const AccidentWsNotifyChips({
    required this.snapshot,
    required this.keys,
    super.key,
  });

  final AccidentCaseSnapshot snapshot;
  final List<String> keys;

  String _who(NotifyRole role) {
    final String owner = accidentWsOwnerRole(snapshot, role.key)?.trim() ?? '';
    if (owner.isNotEmpty) return owner;
    return role.roles.isEmpty ? role.label : role.roles.first;
  }

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    return AccidentWsTwoUp(
      children: <Widget>[
        for (final NotifyRole role in notifyRoles)
          if (keys.contains(role.key))
            AccidentWsPersonTile(
              who: _who(role),
              team: role.visibilityOnly
                  ? l10n.accClaimNotifyVisibility
                  : accidentWsTeamLabel(l10n, role.key),
              visibilityOnly: role.visibilityOnly,
            ),
      ],
    );
  }
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
              title: Text(AppLocalizations.of(sheet).accTakePhoto),
              onTap: () => Navigator.of(sheet).pop(AccidentPhotoSource.camera),
            ),
            ListTile(
              leading: const Icon(Icons.folder_open_outlined),
              title: Text(AppLocalizations.of(sheet).accChooseDeviceFile),
              onTap: () => Navigator.of(sheet).pop(AccidentPhotoSource.gallery),
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
    final AppLocalizations l10n = AppLocalizations.of(context);
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
                ? accidentWsNotSet(context)
                : v
                    ? l10n.accYes
                    : l10n.accNo,
            style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                  fontWeight: FontWeight.w800,
                  color: colors.onSoft,
                ),
          )
        else if (v != null)
          TpSegmented<bool>(
            options: <TpSegmentedOption<bool>>[
              TpSegmentedOption<bool>(value: true, label: l10n.accYes),
              TpSegmentedOption<bool>(value: false, label: l10n.accNo),
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
                label: l10n.accYes,
                isCompact: true,
                onPressed: () => onChanged!(true),
              ),
              const SizedBox(width: TpSpace.xs),
              TpButton.secondary(
                label: l10n.accNo,
                isCompact: true,
                onPressed: () => onChanged!(false),
              ),
            ],
          ),
      ],
    );
  }
}
