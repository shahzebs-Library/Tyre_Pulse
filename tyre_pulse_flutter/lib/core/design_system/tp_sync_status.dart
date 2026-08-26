/// Offline and sync status.
///
/// Spec section 17 asks for meaningful status and names the exact shapes:
///
/// ```text
/// Offline
/// 12 changes waiting to sync
/// ```
/// ```text
/// Syncing
/// 8 of 12
/// ```
/// ```text
/// 3 items need attention
/// ```
///
/// > Do not show a permanent spinner.
///
/// Both widgets here take their data as a PARAMETER rather than reading a
/// provider. The sync engine belongs to another layer, and a design system
/// widget that reaches into application state cannot be rendered in a test or
/// reused on a screen that already has the numbers.
library;

import 'package:flutter/material.dart';
import 'package:tyre_pulse/app/localization/tp_localizations.dart';
import 'package:tyre_pulse/app/theme/tp_colors.dart';
import 'package:tyre_pulse/app/theme/tp_spacing.dart';

/// What the device knows about its connection.
enum TpConnectivity {
  online,
  offline,

  /// Connectivity could not be determined.
  ///
  /// A real third value. "We could not look" and "there is no connection" are
  /// different claims and are said differently, the same way an unmeasured KPI
  /// is not a zero.
  unknown,
}

/// A snapshot of the offline queue.
@immutable
class TpSyncSummary {
  const TpSyncSummary({
    required this.connectivity,
    this.pendingCount = 0,
    this.syncingCompleted,
    this.syncingTotal,
    this.attentionCount = 0,
  });

  /// Nothing is known yet.
  const TpSyncSummary.unknown()
      : connectivity = TpConnectivity.unknown,
        pendingCount = 0,
        syncingCompleted = null,
        syncingTotal = null,
        attentionCount = 0;

  final TpConnectivity connectivity;

  /// Commands queued on this device and not yet accepted by the server.
  final int pendingCount;

  final int? syncingCompleted;
  final int? syncingTotal;

  /// Items that failed and need a person: a conflict, a rejected write, a photo
  /// that will not upload.
  final int attentionCount;

  bool get isOffline => connectivity == TpConnectivity.offline;

  bool get isSyncing {
    final int? total = syncingTotal;
    return total != null && total > 0;
  }

  /// Whether there is anything worth telling the user about at all.
  bool get isQuiet =>
      connectivity == TpConnectivity.online &&
      pendingCount == 0 &&
      attentionCount == 0 &&
      !isSyncing;
}

/// A full-width bar for the top of a screen.
///
/// Renders NOTHING when everything is fine. A permanent banner is a banner
/// nobody reads, and the absence of it is itself the signal that the queue is
/// clear.
class TpOfflineBanner extends StatelessWidget {
  const TpOfflineBanner({required this.summary, this.onTap, super.key});

  final TpSyncSummary summary;

  /// Usually opens Profile, which is where sync, retry and clear live.
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    if (summary.isQuiet) return const SizedBox.shrink();

    final AppLocalizations l10n = AppLocalizations.of(context);
    final TpPalette palette = TpPalette.of(context);
    final _BannerContent content = _resolve(l10n, summary);
    final TpStatusColors colors = palette.forStatus(content.tone);

    final Widget body = DecoratedBox(
      decoration: BoxDecoration(
        color: colors.soft,
        border: Border(
          bottom: BorderSide(color: colors.base, width: TpBorderWidth.hairline),
        ),
      ),
      child: Padding(
        padding: const EdgeInsets.symmetric(
          horizontal: TpSpace.lg,
          vertical: TpSpace.md,
        ),
        child: Row(
          children: <Widget>[
            Icon(content.icon, size: TpSizing.iconMd, color: colors.onSoft),
            const SizedBox(width: TpSpace.md),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                mainAxisSize: MainAxisSize.min,
                children: <Widget>[
                  Text(
                    content.title,
                    style: Theme.of(context)
                        .textTheme
                        .labelLarge
                        ?.copyWith(color: colors.onSoft),
                  ),
                  if (content.detail != null)
                    Text(
                      content.detail!,
                      style: Theme.of(context)
                          .textTheme
                          .labelSmall
                          ?.copyWith(color: colors.onSoft),
                    ),
                ],
              ),
            ),
          ],
        ),
      ),
    );

    if (onTap == null) return body;
    return InkWell(onTap: onTap, child: body);
  }

  static _BannerContent _resolve(AppLocalizations l10n, TpSyncSummary summary) {
    if (summary.attentionCount > 0) {
      return _BannerContent(
        icon: Icons.priority_high,
        tone: TpStatus.critical,
        title: l10n.syncNeedsAttention(summary.attentionCount),
        detail: summary.pendingCount > 0
            ? l10n.syncPendingChanges(summary.pendingCount)
            : null,
      );
    }

    if (summary.isSyncing) {
      final int total = summary.syncingTotal ?? 0;
      final int done = summary.syncingCompleted ?? 0;
      return _BannerContent(
        icon: Icons.sync,
        tone: TpStatus.info,
        title: l10n.syncInProgress(done, total),
        detail: null,
      );
    }

    if (summary.isOffline) {
      return _BannerContent(
        icon: Icons.cloud_off,
        tone: TpStatus.warning,
        title: l10n.offlineTitle,
        detail: summary.pendingCount > 0
            ? l10n.syncPendingChanges(summary.pendingCount)
            : l10n.offlineMessage,
      );
    }

    if (summary.connectivity == TpConnectivity.unknown) {
      return _BannerContent(
        icon: Icons.help_outline,
        tone: TpStatus.unknown,
        title: l10n.syncStatusUnknown,
        detail: summary.pendingCount > 0
            ? l10n.syncPendingChanges(summary.pendingCount)
            : null,
      );
    }

    // Online, nothing failing, but work is still queued.
    return _BannerContent(
      icon: Icons.cloud_upload_outlined,
      tone: TpStatus.info,
      title: l10n.syncPendingChanges(summary.pendingCount),
      detail: null,
    );
  }
}

@immutable
class _BannerContent {
  const _BannerContent({
    required this.icon,
    required this.tone,
    required this.title,
    required this.detail,
  });

  final IconData icon;
  final TpStatus tone;
  final String title;
  final String? detail;
}

/// A compact inline status, for an app bar action or a list header.
class TpSyncIndicator extends StatelessWidget {
  const TpSyncIndicator({required this.summary, this.onTap, super.key});

  final TpSyncSummary summary;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final TpPalette palette = TpPalette.of(context);

    final _IndicatorContent content = _resolveIndicator(l10n, summary);
    final IconData icon = content.icon;
    final String label = content.label;
    final TpStatusColors colors = palette.forStatus(content.tone);

    final Widget body = Padding(
      padding: const EdgeInsets.symmetric(
        horizontal: TpSpace.sm,
        vertical: TpSpace.xs,
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: <Widget>[
          Icon(icon, size: TpSizing.iconSm, color: colors.onSoft),
          const SizedBox(width: TpSpace.xs),
          Text(
            label,
            style: Theme.of(context)
                .textTheme
                .labelMedium
                ?.copyWith(color: colors.onSoft),
          ),
        ],
      ),
    );

    if (onTap == null) return body;
    return InkWell(onTap: onTap, child: body);
  }

  /// Ordered by urgency. Attention first, because a failed write is the only
  /// one of these a person has to do something about.
  static _IndicatorContent _resolveIndicator(
    AppLocalizations l10n,
    TpSyncSummary summary,
  ) {
    if (summary.attentionCount > 0) {
      return _IndicatorContent(
        icon: Icons.priority_high,
        tone: TpStatus.critical,
        label: '${summary.attentionCount}',
      );
    }
    if (summary.isSyncing) {
      return _IndicatorContent(
        icon: Icons.sync,
        tone: TpStatus.info,
        label: '${summary.syncingCompleted ?? 0}/${summary.syncingTotal ?? 0}',
      );
    }
    if (summary.isOffline) {
      return _IndicatorContent(
        icon: Icons.cloud_off,
        tone: TpStatus.warning,
        label: summary.pendingCount > 0
            ? '${summary.pendingCount}'
            : l10n.offlineTitle,
      );
    }
    if (summary.pendingCount > 0) {
      return _IndicatorContent(
        icon: Icons.cloud_upload_outlined,
        tone: TpStatus.info,
        label: '${summary.pendingCount}',
      );
    }
    if (summary.connectivity == TpConnectivity.unknown) {
      return _IndicatorContent(
        icon: Icons.help_outline,
        tone: TpStatus.unknown,
        label: l10n.valueNotMeasured,
      );
    }
    return _IndicatorContent(
      icon: Icons.cloud_done_outlined,
      tone: TpStatus.ok,
      label: l10n.syncAllSynced,
    );
  }
}

@immutable
class _IndicatorContent {
  const _IndicatorContent({
    required this.icon,
    required this.tone,
    required this.label,
  });

  final IconData icon;
  final TpStatus tone;
  final String label;
}
