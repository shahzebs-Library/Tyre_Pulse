/// Renders `checklist_approval.dart`'s [statusSummary] as a
/// [TpStatusChip] - the queue row and the review screen's status bar both
/// need the exact same tone-to-colour and status-to-words mapping, so it
/// lives here once rather than twice.
///
/// # Tone mapping
///
/// Mirrors the mobile RN reference source's own `TONE_KIND` constant in
/// `mobile/app/(app)/checklists/approvals/index.tsx`
/// (`good:'success', bad:'danger', warn:'warning', muted:'neutral'`),
/// translated onto this port's own [TpStatus] vocabulary.
///
/// # Words come from ARB, never from [ApprovalStatusSummary.text]
///
/// [ApprovalStatusSummary.text] is the domain file's OWN pinned, English-
/// only fallback - see `checklist_approval.dart`'s library comment on why
/// it exists at all ("[ApprovalStatusSummary.tone] and
/// [ApprovalStatusSummary.holder] ... are the structured, language-free
/// facts a later UI task should build its own localised copy from"). This
/// widget is that later UI task: it reads ONLY [ApprovalStatusSummary.tone]
/// and [ApprovalStatusSummary.holder] to choose a translated ARB string,
/// and never renders [ApprovalStatusSummary.text] itself. [ApprovalHolder.
/// supervisor] and [ApprovalHolder.anyone] already carry the two-stage
/// distinction as SEPARATE enum values - `statusSummary` decided which one
/// applies, so this widget only has to pick the matching ARB string per
/// value, mirroring `statusKey`'s own `twoStage`-conditioned branch in the
/// same reference file without needing a second parameter of its own to
/// carry that fact across again.
library;

import 'package:flutter/material.dart';
import 'package:tyre_pulse/app/localization/tp_localizations.dart';
import 'package:tyre_pulse/app/theme/tp_colors.dart';
import 'package:tyre_pulse/core/design_system/design_system.dart';
import 'package:tyre_pulse/features/approvals/domain/checklist_approval.dart';

TpStatus _toneToStatus(ApprovalStatusTone tone) => switch (tone) {
      ApprovalStatusTone.good => TpStatus.ok,
      ApprovalStatusTone.bad => TpStatus.critical,
      ApprovalStatusTone.warn => TpStatus.warning,
      ApprovalStatusTone.muted => TpStatus.neutral,
    };

/// The translated words for [summary] - the localisation half
/// [statusSummary] deliberately does not do itself.
String checklistApprovalStatusLabel(
  AppLocalizations l10n,
  ApprovalStatusSummary summary,
) {
  switch (summary.holder) {
    case ApprovalHolder.areaManager:
      return l10n.checklistApprovalsStatusWaitingAreaManager;
    case ApprovalHolder.supervisor:
      return l10n.checklistApprovalsStatusWaitingSupervisor;
    case ApprovalHolder.anyone:
      return l10n.checklistApprovalsStatusWaitingApproval;
    case ApprovalHolder.none:
      switch (summary.tone) {
        case ApprovalStatusTone.good:
          return l10n.checklistApprovalsStatusClosed;
        case ApprovalStatusTone.bad:
          return l10n.checklistApprovalsStatusSentBack;
        case ApprovalStatusTone.warn:
        case ApprovalStatusTone.muted:
          return l10n.checklistApprovalsStatusNoApproval;
      }
  }
}

/// A [TpStatusChip] for [summary].
class ChecklistApprovalStatusChip extends StatelessWidget {
  const ChecklistApprovalStatusChip({
    required this.summary,
    this.isCompact = false,
    super.key,
  });

  final ApprovalStatusSummary summary;
  final bool isCompact;

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    return TpStatusChip(
      status: _toneToStatus(summary.tone),
      label: checklistApprovalStatusLabel(l10n, summary),
      isCompact: isCompact,
    );
  }
}
