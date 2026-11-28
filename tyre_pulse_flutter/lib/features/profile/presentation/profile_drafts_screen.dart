/// Profile's "Drafts": every unfinished checklist and inspection with real
/// content stored on this phone for the signed-in person, newest first.
///
/// Opened from Profile's "Pending drafts" tile and "Offline drafts" row, and
/// pushed with [Navigator] so no route table file changes. The list is the
/// SAME set Profile counts (`profileDraftEntriesProvider`, which the count
/// derives from), so the number on Profile and the rows here never disagree.
///
/// Resume reuses the routes the app already resumes drafts through:
/// a checklist opens [ChecklistFillRoute] with its `draftKey`, exactly like
/// the checklists hub; an inspection opens [NewInspectionRoute] for its
/// asset, exactly like Home's "Resume inspection" row (the inspection draft
/// key is `userId|ASSET`, so the wizard finds it). Discard goes through the
/// existing draft delete path after a confirmation.
library;

import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart' show DateFormat;
import 'package:tyre_pulse/app/localization/tp_localizations.dart';
import 'package:tyre_pulse/app/router/routes.dart';
import 'package:tyre_pulse/app/theme/tp_colors.dart';
import 'package:tyre_pulse/app/theme/tp_spacing.dart';
import 'package:tyre_pulse/core/design_system/design_system.dart';
import 'package:tyre_pulse/features/profile/profile_providers.dart';

/// Opens the drafts screen.
Future<void> openProfileDrafts(BuildContext context) {
  return Navigator.of(context).push<void>(
    MaterialPageRoute<void>(
      builder: (BuildContext _) => const ProfileDraftsScreen(),
    ),
  );
}

/// Stable finders for tests.
@visibleForTesting
abstract final class ProfileDraftsScreenKeys {
  static const Key empty = Key('profileDrafts.empty');
  static const Key error = Key('profileDrafts.error');
  static ValueKey<String> item(String key) =>
      ValueKey<String>('profileDrafts.$key');
  static ValueKey<String> resume(String key) =>
      ValueKey<String>('profileDrafts.resume.$key');
  static ValueKey<String> discard(String key) =>
      ValueKey<String>('profileDrafts.discard.$key');
  static const Key confirmDiscard = Key('profileDrafts.confirmDiscard');
  static const Key cancelDiscard = Key('profileDrafts.cancelDiscard');
}

/// Where a draft resumes. Pure so a test can check the location without a
/// router.
String profileDraftResumeLocation(ProfileDraftEntry entry) {
  final String asset = entry.assetNo.trim();
  switch (entry.kind) {
    case ProfileDraftKind.checklist:
      return ChecklistFillRoute(
        templateId: TemplateId(entry.templateId ?? ''),
        assetNo: asset.isEmpty ? null : AssetNo(asset),
        draftKey: DraftKey(entry.draftKey),
      ).location;
    case ProfileDraftKind.inspection:
      final String? site = entry.site?.trim();
      return NewInspectionRoute(
        assetNo: AssetNo(asset),
        siteName: site == null || site.isEmpty ? null : SiteName(site),
      ).location;
  }
}

/// Opens [entry] where it resumes, through [router]. Shared with the quick
/// drafts sheet.
Future<void> resumeProfileDraft(
  GoRouter router,
  ProfileDraftEntry entry,
) async {
  final String location = profileDraftResumeLocation(entry);
  switch (entry.kind) {
    case ProfileDraftKind.checklist:
      // Same call the checklists hub makes; back returns here.
      await router.push<Object?>(location);
    case ProfileDraftKind.inspection:
      // Same call Home's "Resume inspection" row makes: the wizard lives on
      // the Inspect branch.
      router.go(location);
  }
}

/// The title a draft is listed under: the checklist's own title, else its
/// template, else the kind; an inspection's asset.
String profileDraftTitle(AppLocalizations l10n, ProfileDraftEntry entry) {
  final String asset = entry.assetNo.trim();
  if (entry.kind == ProfileDraftKind.inspection) {
    return asset.isEmpty ? l10n.profileDraftKindInspection : asset;
  }
  final String customTitle = entry.title?.trim() ?? '';
  if (customTitle.isNotEmpty) return customTitle;
  final String templateName = entry.templateName?.trim() ?? '';
  return templateName.isNotEmpty
      ? templateName
      : l10n.profileDraftKindChecklist;
}

class ProfileDraftsScreen extends ConsumerStatefulWidget {
  const ProfileDraftsScreen({super.key});

  @override
  ConsumerState<ProfileDraftsScreen> createState() =>
      _ProfileDraftsScreenState();
}

class _ProfileDraftsScreenState extends ConsumerState<ProfileDraftsScreen> {
  final Set<String> _discarding = <String>{};

  void _refresh() => ref.invalidate(profileDraftEntriesProvider);

  void _showMessage(String message) {
    ScaffoldMessenger.maybeOf(context)
      ?..hideCurrentSnackBar()
      ..showSnackBar(SnackBar(content: Text(message)));
  }

  Future<void> _resume(ProfileDraftEntry entry) async {
    await resumeProfileDraft(GoRouter.of(context), entry);
    if (mounted) _refresh();
  }

  Future<void> _discard(ProfileDraftEntry entry) async {
    if (_discarding.contains(entry.draftKey)) return;
    final AppLocalizations l10n = AppLocalizations.of(context);
    final bool? confirmed = await showDialog<bool>(
      context: context,
      builder: (BuildContext dialogContext) => AlertDialog(
        title: Text(l10n.profileDraftDiscardTitle),
        content: Text(l10n.profileDraftDiscardMessage),
        actions: <Widget>[
          TextButton(
            key: ProfileDraftsScreenKeys.cancelDiscard,
            onPressed: () => Navigator.of(dialogContext).pop(false),
            child: Text(l10n.actionCancel),
          ),
          TextButton(
            key: ProfileDraftsScreenKeys.confirmDiscard,
            onPressed: () => Navigator.of(dialogContext).pop(true),
            child: Text(l10n.profileDraftDiscard),
          ),
        ],
      ),
    );
    if (confirmed != true || !mounted) return;
    setState(() => _discarding.add(entry.draftKey));
    try {
      await ref.read(profileDraftDiscardProvider)(entry);
      if (!mounted) return;
      _refresh();
      _showMessage(l10n.profileDraftDiscarded);
    } on Object {
      if (mounted) _showMessage(l10n.profileDraftDiscardFailed);
    } finally {
      if (mounted) setState(() => _discarding.remove(entry.draftKey));
    }
  }

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final AsyncValue<List<ProfileDraftEntry>> drafts = ref.watch(
      profileDraftEntriesProvider,
    );

    return TpScaffold(
      appBar: TpAppBar(
        title: l10n.profileDraftsTitle,
        onBack: () => unawaited(Navigator.of(context).maybePop()),
      ),
      body: drafts.when(
        loading: () => const TpLoadingState(),
        error: (Object error, StackTrace stackTrace) => TpStateView(
          key: ProfileDraftsScreenKeys.error,
          icon: Icons.error_outline_rounded,
          tone: TpStatus.critical,
          title: l10n.profileDraftsLoadFailedTitle,
          message: l10n.profileDraftsLoadFailedMessage,
          primaryActionLabel: l10n.actionRetry,
          onPrimaryAction: _refresh,
        ),
        data: (List<ProfileDraftEntry> entries) {
          if (entries.isEmpty) {
            return TpStateView(
              key: ProfileDraftsScreenKeys.empty,
              icon: Icons.description_outlined,
              title: l10n.profileDraftsEmptyTitle,
              message: l10n.profileDraftsEmptyMessage,
            );
          }
          return RefreshIndicator(
            onRefresh: () async => _refresh(),
            child: ListView.separated(
              padding: const EdgeInsets.all(TpSpace.lg),
              itemCount: entries.length,
              separatorBuilder: (BuildContext _, int __) =>
                  const SizedBox(height: TpSpace.sm),
              itemBuilder: (BuildContext context, int index) {
                final ProfileDraftEntry entry = entries[index];
                return _DraftCard(
                  entry: entry,
                  isDiscarding: _discarding.contains(entry.draftKey),
                  onResume: () => unawaited(_resume(entry)),
                  onDiscard: () => unawaited(_discard(entry)),
                );
              },
            ),
          );
        },
      ),
    );
  }
}

class _DraftCard extends StatelessWidget {
  const _DraftCard({
    required this.entry,
    required this.isDiscarding,
    required this.onResume,
    required this.onDiscard,
  });

  final ProfileDraftEntry entry;
  final bool isDiscarding;
  final VoidCallback onResume;
  final VoidCallback onDiscard;

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final TpPalette palette = TpPalette.of(context);
    final TextTheme text = Theme.of(context).textTheme;
    final bool isChecklist = entry.kind == ProfileDraftKind.checklist;
    final String asset = entry.assetNo.trim();
    final String title = profileDraftTitle(l10n, entry);
    final List<String> detail = <String>[
      if (isChecklist) (asset.isEmpty ? l10n.profileDraftNoAsset : asset),
      if (!isChecklist && (entry.vehicleType?.trim().isNotEmpty ?? false))
        entry.vehicleType!.trim(),
      if (entry.site?.trim().isNotEmpty ?? false) entry.site!.trim(),
      if (entry.total > 0)
        l10n.inspectionResumeProgress(entry.filled, entry.total),
    ];
    final String locale = Localizations.localeOf(context).toLanguageTag();
    final String edited = DateFormat(
      'd MMM, HH:mm',
      locale,
    ).format(entry.updatedAt.toLocal());

    return TpCard(
      key: ProfileDraftsScreenKeys.item(entry.draftKey),
      onTap: isDiscarding ? null : onResume,
      padding: const EdgeInsets.all(TpSpace.md),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: <Widget>[
          Row(
            children: <Widget>[
              TpIcon(
                isChecklist
                    ? Icons.fact_check_outlined
                    : Icons.tire_repair_outlined,
                size: 22,
                color: palette.primary,
              ),
              const SizedBox(width: TpSpace.sm),
              Expanded(
                child: Text(
                  title,
                  style: text.bodyMedium?.copyWith(
                    color: palette.text,
                    fontWeight: FontWeight.w600,
                  ),
                ),
              ),
              const SizedBox(width: TpSpace.sm),
              TpStatusChip(
                status: TpStatus.info,
                label: isChecklist
                    ? l10n.profileDraftKindChecklist
                    : l10n.profileDraftKindInspection,
                isCompact: true,
              ),
            ],
          ),
          if (detail.isNotEmpty) ...<Widget>[
            const SizedBox(height: TpSpace.xs),
            Text(
              detail.join(' · '),
              style: text.bodySmall?.copyWith(color: palette.textSecondary),
            ),
          ],
          const SizedBox(height: TpSpace.xs),
          Text(
            l10n.profileDraftEdited(edited),
            style: text.bodySmall?.copyWith(color: palette.textMuted),
          ),
          const SizedBox(height: TpSpace.sm),
          Wrap(
            alignment: WrapAlignment.end,
            spacing: TpSpace.sm,
            runSpacing: TpSpace.xs,
            children: <Widget>[
              TpButton(
                key: ProfileDraftsScreenKeys.discard(entry.draftKey),
                label: l10n.profileDraftDiscard,
                icon: Icons.delete_outline_rounded,
                variant: TpButtonVariant.secondary,
                isCompact: true,
                isBusy: isDiscarding,
                onPressed: isDiscarding ? null : onDiscard,
              ),
              TpButton(
                key: ProfileDraftsScreenKeys.resume(entry.draftKey),
                label: l10n.profileDraftResume,
                icon: Icons.play_arrow_rounded,
                isCompact: true,
                onPressed: isDiscarding ? null : onResume,
              ),
            ],
          ),
        ],
      ),
    );
  }
}
