/// The asset's most recent inspection, so Vehicle 360 draws the same tyre
/// map as the inspection screens with the readings that were last recorded
/// instead of a layout where every wheel reads "not recorded".
library;

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_riverpod/misc.dart' show FutureProviderFamily;
import 'package:tyre_pulse/core/network/supabase_client_provider.dart';
import 'package:tyre_pulse/core/network/supabase_tables.dart';
import 'package:tyre_pulse/core/permissions/module_registry.dart';
import 'package:tyre_pulse/core/permissions/permission_providers.dart';
import 'package:tyre_pulse/features/assets/data/asset_insights_repository.dart';
import 'package:tyre_pulse/features/inspections/domain/inspection_record.dart';

/// Null when the user cannot open inspections, the asset has none, or the
/// read fails. The map then falls back to the layout alone and says so,
/// which is honest; a failed read never blocks the Vehicle 360 screen.
final FutureProviderFamily<InspectionRecord?, AssetScope>
    assetLatestInspectionProvider =
    FutureProvider.autoDispose.family<InspectionRecord?, AssetScope>(
  (ref, AssetScope scope) async {
    if (!ref.watch(canAccessModuleProvider(ModuleKey.inspect))) return null;
    try {
      var query = ref
          .watch(supabaseClientProvider)
          .from(SupabaseTables.inspections)
          .select(inspectionRecordColumns)
          .eq('asset_no', scope.assetNo);
      final String? country = scope.country;
      if (country != null && country.isNotEmpty) {
        query = query.eq('country', country);
      }
      final String? org = scope.organisationId;
      if (org != null && org.isNotEmpty) {
        query = query.eq('organisation_id', org);
      }
      final List<Map<String, dynamic>> rows = await query
          .order('inspection_date', ascending: false)
          .order('created_at', ascending: false)
          .limit(1);
      if (rows.isEmpty) return null;
      return InspectionRecord.fromRow(rows.first);
    } on Object {
      return null;
    }
  },
);
