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
      final String? role = workspace.role.rawValue.isEmpty
          ? null
          : workspace.role.rawValue;

      final List<ChecklistTemplateRecord> templates = await remote
          .listTemplates(
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
        _errorMessage =
            'Checklists could not be loaded. Pull down to try '
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
        assetNo: assignment.assetNo == null
            ? null
            : AssetNo(assignment.assetNo!),
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
            _SectionHeader(label: l10n.checklistsAvailableSection),
            for (final ChecklistTemplateRecord t in _templates)
              _TemplateRow(record: t, onTap: () => _openTemplate(t)),
          ],
        ],
      ),
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
        style: Theme.of(context).textTheme.labelLarge
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
    final TpStatusColors colors = TpPalette.of(context)
        .forStatus(TpStatus.warning);
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
              style: Theme.of(context).textTheme.bodySmall
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
    return TpCard(
      margin: const EdgeInsets.only(bottom: TpSpace.sm),
      onTap: onTap,
      child: Row(
        children: <Widget>[
          Icon(
            Icons.edit_note_outlined,
            color: TpPalette.of(context).info.base,
          ),
          const SizedBox(width: TpSpace.md),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                Text(
                  draft.templateName,
                  style: Theme.of(context).textTheme.titleSmall,
                ),
                Text(
                  draft.assetNo.isEmpty
                      ? l10n.checklistNoAssetLabel
                      : draft.assetNo,
                  style: Theme.of(context).textTheme.bodySmall,
                ),
                Text(
                  l10n.checklistResumeProgress(draft.filled, draft.total),
                  style: Theme.of(context).textTheme.labelSmall,
                ),
              ],
            ),
          ),
          const Icon(Icons.chevron_right),
        ],
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
    final List<String> subtitleParts = <String>[
      for (final String? v in <String?>[assignment.assetNo, assignment.site])
        if (v != null && v.isNotEmpty) v,
    ];
    return TpCard(
      margin: const EdgeInsets.only(bottom: TpSpace.sm),
      onTap: onTap,
      child: Row(
        children: <Widget>[
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                Text(
                  assignment.templateName ?? '',
                  style: Theme.of(context).textTheme.titleSmall,
                ),
                Text(
                  subtitleParts.join(' - '),
                  style: Theme.of(context).textTheme.bodySmall,
                ),
              ],
            ),
          ),
          TpStatusChip(
            status: assignment.status == 'overdue'
                ? TpStatus.critical
                : TpStatus.info,
            label: assignment.status ?? 'pending',
            isCompact: true,
          ),
        ],
      ),
    );
  }
}

class _TemplateRow extends StatelessWidget {
  const _TemplateRow({required this.record, required this.onTap});

  final ChecklistTemplateRecord record;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return TpCard(
      margin: const EdgeInsets.only(bottom: TpSpace.sm),
      onTap: onTap,
      child: Row(
        children: <Widget>[
          Icon(Icons.assignment_outlined, color: TpPalette.of(context).primary),
          const SizedBox(width: TpSpace.md),
          Expanded(
            child: Text(
              record.template.name ?? '',
              style: Theme.of(context).textTheme.titleSmall,
            ),
          ),
          const Icon(Icons.chevron_right),
        ],
      ),
    );
  }
}
