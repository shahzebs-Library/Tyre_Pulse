/// "Checklists" - the templates this operator may fill, their open
/// assignments, and any unfinished work worth resuming.
library;

import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:tyre_pulse/app/localization/tp_localizations.dart';
import 'package:tyre_pulse/app/router/routes.dart';
import 'package:tyre_pulse/app/theme/tp_colors.dart';
import 'package:tyre_pulse/app/theme/tp_spacing.dart';
import 'package:tyre_pulse/core/design_system/design_system.dart';
import 'package:tyre_pulse/core/workspace/workspace_providers.dart';
import 'package:tyre_pulse/features/checklists/checklists_providers.dart';
import 'package:tyre_pulse/features/checklists/data/checklist_draft_repository.dart';
import 'package:tyre_pulse/features/checklists/data/checklist_remote_models.dart';

class ChecklistsHomeScreen extends ConsumerStatefulWidget {
  const ChecklistsHomeScreen({super.key});

  @override
  ConsumerState<ChecklistsHomeScreen> createState() =>
      _ChecklistsHomeScreenState();
}

class _ChecklistsHomeScreenState extends ConsumerState<ChecklistsHomeScreen> {
  bool _loading = true;
  String? _errorMessage;
  List<ChecklistTemplateRecord> _templates = const <ChecklistTemplateRecord>[];
  List<ChecklistAssignmentRecord> _assignments =
      const <ChecklistAssignmentRecord>[];
  List<ChecklistDraftHeader> _drafts = const <ChecklistDraftHeader>[];

  @override
  void initState() {
    super.initState();
    unawaited(_load());
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _errorMessage = null;
    });

    final workspace = ref.read(workspaceContextProvider);
    if (workspace == null) {
      setState(() {
        _loading = false;
        _errorMessage = 'Your workspace is still loading.';
      });
      return;
    }

    try {
      final remote = ref.read(checklistRemoteRepositoryProvider);
      final drafts = ref.read(checklistDraftRepositoryProvider);
      final String? role =
          workspace.role.rawValue.isEmpty ? null : workspace.role.rawValue;

      final List<ChecklistTemplateRecord> templates =
          await remote.listTemplates(
        country: workspace.activeCountry,
        role: role,
        isSuperAdmin: workspace.isSuperAdmin,
      );
      final List<ChecklistAssignmentRecord> assignments =
          (await remote.listAssignments(
        country: workspace.activeCountry,
        role: role,
        isSuperAdmin: workspace.isSuperAdmin,
      ))
              .where((ChecklistAssignmentRecord a) => a.isOpen)
              .toList(growable: false);
      final List<ChecklistDraftHeader> allDrafts = await drafts.draftsForUser(
        workspace.userId,
      );

      final List<ChecklistDraftHeader> realDrafts = <ChecklistDraftHeader>[];
      for (final ChecklistDraftHeader d in allDrafts) {
        final bool hasContent = await drafts.hasContent(d.draftKey);
        if (hasContent) realDrafts.add(d);
      }

      if (!mounted) return;
      setState(() {
        _templates = templates;
        _assignments = assignments;
        _drafts = realDrafts;
        _loading = false;
      });
    } on Object {
      if (!mounted) return;
      setState(() {
        _loading = false;
        _errorMessage = 'Checklists could not be loaded. Pull down to try '
            'again.';
      });
    }
  }

  void _openTemplate(ChecklistTemplateRecord record) {
    final String? id = record.template.id;
    if (id == null) return;
    GoRouter.of(context)
        .push(ChecklistFillRoute(templateId: TemplateId(id)).location);
  }

  void _openAssignment(ChecklistAssignmentRecord assignment) {
    final String? templateId = assignment.templateId;
    if (templateId == null) return;
    GoRouter.of(context).push(
      ChecklistFillRoute(
        templateId: TemplateId(templateId),
        assignmentId: AssignmentId(assignment.id),
        siteName: assignment.site == null ? null : SiteName(assignment.site!),
        assetNo:
            assignment.assetNo == null ? null : AssetNo(assignment.assetNo!),
      ).location,
    );
  }

  void _resumeDraft(ChecklistDraftHeader draft) {
    GoRouter.of(context).push(
      ChecklistFillRoute(
        templateId: TemplateId(draft.templateId),
        assetNo: draft.assetNo.isEmpty ? null : AssetNo(draft.assetNo),
        draftKey: DraftKey(draft.draftKey),
      ).location,
    );
  }

  void _openHistory() {
    GoRouter.of(context).push(const ChecklistHistoryRoute().location);
  }

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);

    return TpScaffold(
      backFallback: TpRoutePaths.home,
      appBar: TpAppBar(
        title: l10n.checklistsHomeTitle,
        backFallback: TpRoutePaths.home,
        actions: <Widget>[
          IconButton(
            icon: const Icon(Icons.history),
            tooltip: l10n.checklistsHistoryAction,
            onPressed: _openHistory,
          ),
        ],
      ),
      body: _body(l10n),
    );
  }

  Widget _body(AppLocalizations l10n) {
    if (_loading) return const TpLoadingState();

    final bool nothingAtAll =
        _templates.isEmpty && _assignments.isEmpty && _drafts.isEmpty;

    return RefreshIndicator(
      onRefresh: _load,
      child: ListView(
        padding: const EdgeInsets.fromLTRB(
          TpSpace.lg,
          TpSpace.lg,
          TpSpace.lg,
          TpSpace.xxl,
        ),
        children: <Widget>[
          if (_errorMessage != null)
            Padding(
              padding: const EdgeInsets.only(bottom: TpSpace.lg),
              child: _InlineWarning(message: _errorMessage!, onRetry: _load),
            ),
          if (nothingAtAll && _errorMessage == null)
            SizedBox(
              height: MediaQuery.sizeOf(context).height * 0.6,
              child: TpEmptyState(
                title: l10n.checklistsEmptyTitle,
                message: l10n.checklistsEmptyMessage,
                icon: Icons.checklist_outlined,
              ),
            ),
          if (!nothingAtAll) ...<Widget>[
            _LibraryIntro(count: _templates.length, l10n: l10n),
            const SizedBox(height: TpSpace.lg),
          ],
          if (_drafts.isNotEmpty) ...<Widget>[
            _SectionHeader(label: l10n.checklistsUnfinishedSection),
            for (final ChecklistDraftHeader d in _drafts)
              _DraftRow(draft: d, onTap: () => _resumeDraft(d)),
            const SizedBox(height: TpSpace.lg),
          ],
          if (_assignments.isNotEmpty) ...<Widget>[
            _SectionHeader(label: l10n.checklistsAssignmentsSection),
            for (final ChecklistAssignmentRecord a in _assignments)
              _AssignmentRow(assignment: a, onTap: () => _openAssignment(a)),
            const SizedBox(height: TpSpace.lg),
          ],
          if (_templates.isNotEmpty) ...<Widget>[
            if (_drafts.isNotEmpty || _assignments.isNotEmpty)
              _SectionHeader(label: l10n.checklistsAvailableSection),
            for (final ChecklistTemplateRecord t in _templates)
              _TemplateRow(
                record: t,
                l10n: l10n,
                onTap: () => _openTemplate(t),
              ),
          ],
        ],
      ),
    );
  }
}

class _LibraryIntro extends StatelessWidget {
  const _LibraryIntro({required this.count, required this.l10n});

  final int count;
  final AppLocalizations l10n;

  @override
  Widget build(BuildContext context) {
    final TpPalette palette = TpPalette.of(context);
    return Row(
      crossAxisAlignment: CrossAxisAlignment.center,
      children: <Widget>[
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: <Widget>[
              Text(
                l10n.checklistsLibraryTitle,
                style: Theme.of(context).textTheme.headlineSmall?.copyWith(
                      color: palette.text,
                      fontWeight: FontWeight.w800,
                      fontSize: 21,
                      height: 27 / 21,
                      letterSpacing: -0.2,
                    ),
              ),
              const SizedBox(height: TpSpace.xs),
              Text(
                l10n.checklistsLibrarySubtitle,
                style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                      color: palette.textSecondary,
                      fontWeight: FontWeight.w500,
                      fontSize: 15,
                      height: 22 / 15,
                    ),
              ),
            ],
          ),
        ),
        const SizedBox(width: TpSpace.sm),
        _CountChip(
          label: l10n.checklistsAvailableCount(count).toUpperCase(),
          status: TpStatus.info,
        ),
      ],
    );
  }
}

class _SectionHeader extends StatelessWidget {
  const _SectionHeader({required this.label});

  final String label;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: TpSpace.sm),
      child: Text(
        label,
        style: Theme.of(context)
            .textTheme
            .labelLarge
            ?.copyWith(color: TpPalette.of(context).textMuted),
      ),
    );
  }
}

class _InlineWarning extends StatelessWidget {
  const _InlineWarning({required this.message, required this.onRetry});

  final String message;
  final Future<void> Function() onRetry;

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final TpStatusColors colors =
        TpPalette.of(context).forStatus(TpStatus.warning);
    return Container(
      padding: const EdgeInsets.all(TpSpace.md),
      decoration: BoxDecoration(
        color: colors.soft,
        borderRadius: BorderRadius.circular(TpRadius.md),
        border: Border.all(color: colors.base),
      ),
      child: Row(
        children: <Widget>[
          Icon(Icons.warning_amber_outlined, color: colors.onSoft),
          const SizedBox(width: TpSpace.sm),
          Expanded(
            child: Text(
              message,
              style: Theme.of(context)
                  .textTheme
                  .bodySmall
                  ?.copyWith(color: colors.onSoft),
            ),
          ),
          TpButton.text(label: l10n.actionRetry, onPressed: onRetry),
        ],
      ),
    );
  }
}

class _DraftRow extends StatelessWidget {
  const _DraftRow({required this.draft, required this.onTap});

  final ChecklistDraftHeader draft;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final TpPalette palette = TpPalette.of(context);
    return TpCard(
      margin: const EdgeInsets.only(bottom: TpSpace.md),
      padding: const EdgeInsets.symmetric(
        horizontal: TpSpace.lg,
        vertical: TpSpace.md,
      ),
      onTap: onTap,
      child: _ChecklistRowLayout(
        title: draft.templateName,
        subtitle: draft.assetNo.isEmpty
            ? l10n.checklistNoAssetLabel
            : draft.assetNo,
        footer: l10n.checklistResumeProgress(draft.filled, draft.total),
        chip: _CountChip(
          label: '${draft.filled}/${draft.total}',
          status: TpStatus.info,
        ),
        actionLabel: l10n.checklistStartAction,
        actionColor: palette.primary,
      ),
    );
  }
}

class _AssignmentRow extends StatelessWidget {
  const _AssignmentRow({required this.assignment, required this.onTap});

  final ChecklistAssignmentRecord assignment;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final TpPalette palette = TpPalette.of(context);
    final List<String> subtitleParts = <String>[
      for (final String? v in <String?>[assignment.assetNo, assignment.site])
        if (v != null && v.isNotEmpty) v,
    ];
    final bool overdue = assignment.status == 'overdue';
    return TpCard(
      margin: const EdgeInsets.only(bottom: TpSpace.md),
      padding: const EdgeInsets.symmetric(
        horizontal: TpSpace.lg,
        vertical: TpSpace.md,
      ),
      onTap: onTap,
      child: _ChecklistRowLayout(
        title: assignment.templateName ?? '',
        subtitle: subtitleParts.join('  •  '),
        footer: assignment.dueDate,
        chip: _CountChip(
          label: (assignment.status ?? 'pending').toUpperCase(),
          status: overdue ? TpStatus.critical : TpStatus.warning,
        ),
        actionLabel: l10n.checklistStartAction,
        actionColor: overdue ? palette.critical.base : palette.primary,
      ),
    );
  }
}

class _TemplateRow extends StatelessWidget {
  const _TemplateRow({
    required this.record,
    required this.l10n,
    required this.onTap,
  });

  final ChecklistTemplateRecord record;
  final AppLocalizations l10n;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final TpPalette palette = TpPalette.of(context);
    final int count = record.template.fields
        .where((field) => field.type != 'section')
        .length;
    final String searchable = <String?>[
      record.template.name,
      record.category,
    ].whereType<String>().join(' ').toLowerCase();
    final bool tyreWorkflow = searchable.contains('tyre') ||
        searchable.contains('tire');
    final bool usesPhotos = record.template.fields.any(
      (field) => field.type == 'photo' || field.allowPhoto,
    );
    final TpStatus chipStatus = tyreWorkflow
        ? TpStatus.info
        : count > 24
            ? TpStatus.warning
            : count > 0
                ? TpStatus.ok
                : TpStatus.neutral;
    final String subtitle = record.description ?? record.category ?? '';
    final String? footer = usesPhotos
        ? l10n.checklistPhotosOnFailure
        : (record.docPrefix == null ? null : record.docPrefix);

    return TpCard(
      margin: const EdgeInsets.only(bottom: TpSpace.md),
      padding: const EdgeInsets.symmetric(
        horizontal: TpSpace.lg,
        vertical: TpSpace.md,
      ),
      onTap: onTap,
      child: _ChecklistRowLayout(
        title: record.template.name ?? '',
        subtitle: subtitle,
        footer: footer,
        chip: _CountChip(
          label: (tyreWorkflow
                  ? l10n.checklistPositionCount(count)
                  : l10n.checklistItemCount(count))
              .toUpperCase(),
          status: chipStatus,
        ),
        actionLabel: l10n.checklistStartAction,
        actionColor: palette.primary,
      ),
    );
  }
}

class _ChecklistRowLayout extends StatelessWidget {
  const _ChecklistRowLayout({
    required this.title,
    required this.subtitle,
    required this.footer,
    required this.chip,
    required this.actionLabel,
    required this.actionColor,
  });

  final String title;
  final String subtitle;
  final String? footer;
  final Widget chip;
  final String actionLabel;
  final Color actionColor;

  @override
  Widget build(BuildContext context) {
    final TpPalette palette = TpPalette.of(context);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: <Widget>[
        Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: <Widget>[
                  Text(
                    title,
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                    style: Theme.of(context).textTheme.titleMedium?.copyWith(
                          color: palette.text,
                          fontWeight: FontWeight.w700,
                          height: 22 / 16,
                        ),
                  ),
                  if (subtitle.trim().isNotEmpty) ...<Widget>[
                    const SizedBox(height: 2),
                    Text(
                      subtitle,
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                      style: Theme.of(context).textTheme.labelSmall?.copyWith(
                            color: palette.textMuted,
                            fontWeight: FontWeight.w600,
                            height: 16 / 12,
                            letterSpacing: 0.2,
                          ),
                    ),
                  ],
                ],
              ),
            ),
            const SizedBox(width: TpSpace.sm),
            chip,
          ],
        ),
        const SizedBox(height: TpSpace.sm),
        Row(
          children: <Widget>[
            Expanded(
              child: Text(
                footer ?? '',
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: Theme.of(context).textTheme.labelSmall?.copyWith(
                      color: palette.textSecondary,
                      fontWeight: FontWeight.w600,
                      height: 16 / 12,
                      letterSpacing: 0.2,
                    ),
              ),
            ),
            const SizedBox(width: TpSpace.sm),
            Text(
              actionLabel.toUpperCase(),
              style: Theme.of(context).textTheme.labelMedium?.copyWith(
                    color: actionColor,
                    fontWeight: FontWeight.w800,
                    fontSize: 13,
                    height: 17 / 13,
                    letterSpacing: 0.2,
                  ),
            ),
            const SizedBox(width: TpSpace.xs),
            Icon(
              Directionality.of(context) == TextDirection.rtl
                  ? Icons.arrow_back_rounded
                  : Icons.arrow_forward_rounded,
              color: actionColor,
              size: TpSizing.iconSm,
            ),
          ],
        ),
      ],
    );
  }
}

class _CountChip extends StatelessWidget {
  const _CountChip({required this.label, required this.status});

  final String label;
  final TpStatus status;

  @override
  Widget build(BuildContext context) {
    final TpStatusColors colors = TpPalette.of(context).forStatus(status);
    return DecoratedBox(
      decoration: BoxDecoration(
        color: colors.soft,
        borderRadius: BorderRadius.circular(TpRadius.pill),
      ),
      child: Padding(
        padding: const EdgeInsets.symmetric(
          horizontal: TpSpace.sm,
          vertical: 6,
        ),
        child: Text(
          label,
          style: Theme.of(context).textTheme.labelSmall?.copyWith(
                color: colors.onSoft,
                fontWeight: FontWeight.w700,
                height: 16 / 12,
                letterSpacing: 0.2,
              ),
        ),
      ),
    );
  }
}
