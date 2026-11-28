/// The quick drafts sheet: one tap from Profile's "Pending drafts", see the
/// newest drafts, resume one, done.
///
/// [openProfileDraftsQuick] decides what a tap does: with no drafts it only
/// shows a short "No drafts" message (nothing opens); otherwise a compact
/// sheet lists up to [profileDraftsSheetMaxItems] drafts with Resume, and
/// "See all (N)" opens the full [ProfileDraftsScreen] (where drafts are also
/// discarded) only when there are more. The list is the same
/// `profileDraftEntriesProvider` Profile counts, so the two never disagree.
library;

import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart' show DateFormat;
import 'package:tyre_pulse/app/localization/tp_localizations.dart';
import 'package:tyre_pulse/app/theme/tp_colors.dart';
import 'package:tyre_pulse/app/theme/tp_spacing.dart';
import 'package:tyre_pulse/core/design_system/design_system.dart';
import 'package:tyre_pulse/features/profile/presentation/profile_drafts_screen.dart';
import 'package:tyre_pulse/features/profile/profile_providers.dart';

/// How many drafts the sheet lists before it offers "See all".
const int profileDraftsSheetMaxItems = 3;

/// Stable finders for tests.
@visibleForTesting
abstract final class ProfileDraftsSheetKeys {
  static const Key sheet = Key('draftsSheet');
  static const Key seeAll = Key('draftsSheet.seeAll');
  static const Key error = Key('draftsSheet.error');
  static ValueKey<String> item(String key) =>
      ValueKey<String>('draftsSheet.$key');
  static ValueKey<String> resume(String key) =>
      ValueKey<String>('draftsSheet.resume.$key');
}

/// What a tap on "Pending drafts" does. Reads the drafts once: none means a
/// short "No drafts" message and nothing opens; any (or a read that failed,
/// which the sheet reports with a Retry) opens the quick sheet.
Future<void> openProfileDraftsQuick(BuildContext context, WidgetRef ref) async {
  List<ProfileDraftEntry>? drafts;
  try {
    drafts = await ref.read(profileDraftEntriesProvider.future);
  } on Object {
    drafts = null;
  }
  if (!context.mounted) return;
  if (drafts != null && drafts.isEmpty) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    ScaffoldMessenger.maybeOf(context)
      ?..hideCurrentSnackBar()
      ..showSnackBar(SnackBar(content: Text(l10n.profileDraftsEmptyTitle)));
    return;
  }
  await showProfileDraftsSheet(context);
}

/// Opens the quick drafts sheet over [context].
Future<void> showProfileDraftsSheet(BuildContext context) {
  final AppLocalizations l10n = AppLocalizations.of(context);
  final GoRouter? router = GoRouter.maybeOf(context);
  return TpBottomSheet.show<void>(
    context: context,
    title: l10n.profileDraftsTitle,
    builder: (BuildContext sheetContext) => ProfileDraftsSheet(
      onResume: (ProfileDraftEntry entry) {
        Navigator.of(sheetContext).pop();
        if (router != null) unawaited(resumeProfileDraft(router, entry));
      },
      onSeeAll: () {
        Navigator.of(sheetContext).pop();
        if (context.mounted) unawaited(openProfileDrafts(context));
      },
    ),
  );
}

class ProfileDraftsSheet extends ConsumerWidget {
  const ProfileDraftsSheet({
    required this.onResume,
    required this.onSeeAll,
    super.key,
  });

  /// Closes the sheet and resumes the draft.
  final ValueChanged<ProfileDraftEntry> onResume;

  /// Closes the sheet and opens the full Drafts screen.
  final VoidCallback onSeeAll;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final TpPalette palette = TpPalette.of(context);
    final AsyncValue<List<ProfileDraftEntry>> drafts =
        ref.watch(profileDraftEntriesProvider);
    final double maxHeight = MediaQuery.sizeOf(context).height * 0.6;

    return ConstrainedBox(
      key: ProfileDraftsSheetKeys.sheet,
      constraints: BoxConstraints(maxHeight: maxHeight),
      child: SingleChildScrollView(
        padding: const EdgeInsets.symmetric(horizontal: TpSpace.xl),
        child: drafts.when(
          loading: () => const Padding(
            padding: EdgeInsets.symmetric(vertical: TpSpace.lg),
            child: Center(child: CircularProgressIndicator()),
          ),
          error: (Object error, StackTrace stackTrace) => Row(
            key: ProfileDraftsSheetKeys.error,
            children: <Widget>[
              TpIcon(
                Icons.error_outline_rounded,
                size: 22,
                color: palette.critical.base,
              ),
              const SizedBox(width: TpSpace.sm),
              Expanded(child: Text(l10n.profileDraftsLoadFailedTitle)),
              TpButton.text(
                label: l10n.actionRetry,
                onPressed: () => ref.invalidate(profileDraftEntriesProvider),
              ),
            ],
          ),
          data: (List<ProfileDraftEntry> entries) {
            if (entries.isEmpty) {
              return Text(
                l10n.profileDraftsEmptyTitle,
                style: Theme.of(context).textTheme.bodyMedium,
              );
            }
            final List<ProfileDraftEntry> shown =
                entries.take(profileDraftsSheetMaxItems).toList();
            return Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: <Widget>[
                for (final ProfileDraftEntry entry in shown)
                  _DraftRow(entry: entry, onResume: () => onResume(entry)),
                if (entries.length > shown.length) ...<Widget>[
                  const SizedBox(height: TpSpace.xs),
                  Align(
                    alignment: AlignmentDirectional.centerEnd,
                    child: TpButton.text(
                      key: ProfileDraftsSheetKeys.seeAll,
                      label: l10n.sheetSeeAll(entries.length),
                      onPressed: onSeeAll,
                    ),
                  ),
                ],
              ],
            );
          },
        ),
      ),
    );
  }
}

class _DraftRow extends StatelessWidget {
  const _DraftRow({required this.entry, required this.onResume});

  final ProfileDraftEntry entry;
  final VoidCallback onResume;

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final TpPalette palette = TpPalette.of(context);
    final TextTheme text = Theme.of(context).textTheme;
    final bool isChecklist = entry.kind == ProfileDraftKind.checklist;
    final String locale = Localizations.localeOf(context).toLanguageTag();
    final String edited = DateFormat(
      'd MMM, HH:mm',
      locale,
    ).format(entry.updatedAt.toLocal());
    final List<String> detail = <String>[
      if (isChecklist)
        l10n.profileDraftKindChecklist
      else
        l10n.profileDraftKindInspection,
      if (entry.total > 0)
        l10n.inspectionResumeProgress(entry.filled, entry.total),
      l10n.profileDraftEdited(edited),
    ];

    return Padding(
      key: ProfileDraftsSheetKeys.item(entry.draftKey),
      padding: const EdgeInsets.symmetric(vertical: TpSpace.xs),
      child: Row(
        children: <Widget>[
          TpIcon(
            isChecklist
                ? Icons.fact_check_outlined
                : Icons.tire_repair_outlined,
            size: 20,
            color: palette.primary,
          ),
          const SizedBox(width: TpSpace.sm),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                Text(
                  profileDraftTitle(l10n, entry),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: text.bodyMedium?.copyWith(color: palette.text),
                ),
                Text(
                  detail.join(' · '),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: text.bodySmall?.copyWith(color: palette.textMuted),
                ),
              ],
            ),
          ),
          const SizedBox(width: TpSpace.sm),
          TpButton(
            key: ProfileDraftsSheetKeys.resume(entry.draftKey),
            label: l10n.profileDraftResume,
            icon: Icons.play_arrow_rounded,
            isCompact: true,
            onPressed: onResume,
          ),
        ],
      ),
    );
  }
}
