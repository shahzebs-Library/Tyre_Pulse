/// Pure domain types and rules behind Home's "Today's work" and
/// "Your recent inspections" sections.
///
/// No Flutter widgets, no Supabase, no Drift. Everything here is decided from
/// values a repository already read, so every rule is unit-testable on its
/// own and the screen only renders what these functions return.
library;

import 'package:flutter/foundation.dart';
import 'package:tyre_pulse/app/theme/tp_colors.dart';
import 'package:tyre_pulse/core/workspace/workspace_context.dart';
import 'package:tyre_pulse/features/tyre_diagram/domain/tyre_completeness.dart';
import 'package:tyre_pulse/features/tyre_diagram/domain/tyre_condition.dart';

/// Pending inspection sign-offs, counted exactly by the server.
///
/// [count] is a PostgREST `count=exact` head count, not the length of a
/// bounded page: a queue of 140 must read 140, not 100.
@immutable
class HomePendingApprovals {
  const HomePendingApprovals({required this.count, this.newestAt});

  final int count;

  /// `created_at` of the newest pending row, or null when there is none or
  /// the value could not be parsed.
  final DateTime? newestAt;
}

/// The worst tyre condition recorded on one inspection.
enum HomeAssetHealth { good, attention, critical, notChecked }

/// One asset the signed-in user inspected recently.
@immutable
class HomeRecentAsset {
  const HomeRecentAsset({
    required this.assetNo,
    required this.health,
    this.vehicleType,
    this.site,
    this.inspectionDate,
  });

  final String assetNo;
  final String? vehicleType;
  final String? site;
  final String? inspectionDate;

  /// From THAT inspection's recorded tyre conditions, never from anything
  /// newer: the strip is labelled "Your recent inspections" and says what
  /// the person found, not the vehicle's current state.
  final HomeAssetHealth health;
}

/// The worst condition among the wheels an inspection actually recorded.
///
/// Reuses the tyre diagram's own reading of an entry (`wheelStatusFor`), so a
/// seeded "Good" with no evidence counts as not checked here exactly as it
/// does on the diagram. No recorded wheel at all is [HomeAssetHealth.notChecked],
/// never "Good" - an absence of findings is not a clean bill of health.
HomeAssetHealth healthFromTyreConditions(Object? tyreConditions) {
  bool anyMeasured = false;
  bool attention = false;
  for (final TyreEntryPair pair in readTyreEntries(tyreConditions)) {
    switch (wheelStatusFor(pair.entry)) {
      case TpStatus.critical:
        return HomeAssetHealth.critical;
      case TpStatus.warning:
        attention = true;
        anyMeasured = true;
      case TpStatus.ok:
        anyMeasured = true;
      default:
        break;
    }
  }
  if (attention) return HomeAssetHealth.attention;
  return anyMeasured ? HomeAssetHealth.good : HomeAssetHealth.notChecked;
}

/// Distinct assets from `inspections` rows already ordered newest first.
///
/// The first row seen for an asset wins, so each asset shows the condition
/// from its latest inspection by this user. Asset codes are compared trimmed
/// and upper-cased, the same normalisation the draft store applies, so
/// `tm514` and `TM514` are one card. Rows with no asset are skipped.
List<HomeRecentAsset> recentAssetsFromInspections(
  Iterable<Map<String, Object?>> rows, {
  int limit = 6,
}) {
  final List<HomeRecentAsset> out = <HomeRecentAsset>[];
  final Set<String> seen = <String>{};
  for (final Map<String, Object?> row in rows) {
    if (out.length >= limit) break;
    final String asset = (row['asset_no'] as String? ?? '').trim();
    if (asset.isEmpty) continue;
    if (!seen.add(asset.toUpperCase())) continue;
    out.add(
      HomeRecentAsset(
        assetNo: asset,
        vehicleType: _textOrNull(row['vehicle_type']),
        site: _textOrNull(row['site']),
        inspectionDate: _textOrNull(row['inspection_date']),
        health: healthFromTyreConditions(row['tyre_conditions']),
      ),
    );
  }
  return out;
}

/// The `workspace_id` values a draft of [workspace] may have been saved
/// under.
///
/// Two derivations exist in this tree and both are accepted: the offline
/// queue's `workspaceIdFor` (a blank `companyId` falls back to `tenantId`)
/// and the inspection wizard's own `companyId ?? tenantId` (a blank but
/// non-null `companyId` is stored as-is). They agree on every healthy
/// profile; accepting both means a data-quality gap cannot hide a person's
/// own unfinished work. Blank values are never included, so an empty set
/// matches nothing rather than everything.
Set<String> homeDraftWorkspaceIds(WorkspaceContext workspace) {
  final String? company = workspace.companyId;
  final String? tenant = workspace.tenantId;
  final Set<String> ids = <String>{};
  final String wizard = company ?? tenant ?? '';
  if (wizard.trim().isNotEmpty) ids.add(wizard);
  final String queue = (company?.trim().isNotEmpty ?? false)
      ? company!.trim()
      : (tenant?.trim() ?? '');
  if (queue.isNotEmpty) ids.add(queue);
  return ids;
}

/// Whether a draft recorded under [draftCountry] belongs on Home while
/// [activeCountry] is selected.
///
/// A draft's workspace is the ORGANISATION, which spans countries, so the
/// workspace filter alone cannot keep a UAE draft of `CP045` off a KSA Home
/// (the same asset code is usually a different machine in another country).
/// A draft with no country, or a Home with no active country (the
/// all-countries view), matches - the same null-is-visible convention every
/// country filter in this app uses.
bool draftMatchesActiveCountry({
  required String? draftCountry,
  required String? activeCountry,
}) {
  final String draft = draftCountry?.trim().toLowerCase() ?? '';
  final String active = activeCountry?.trim().toLowerCase() ?? '';
  if (draft.isEmpty || active.isEmpty || active == 'all') return true;
  return draft == active;
}

String? _textOrNull(Object? value) {
  final String text = value?.toString().trim() ?? '';
  return text.isEmpty ? null : text;
}
