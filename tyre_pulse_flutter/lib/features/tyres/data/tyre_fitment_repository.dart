library;

import 'package:supabase_flutter/supabase_flutter.dart';
import 'package:tyre_pulse/core/network/supabase_gateway.dart';
import 'package:tyre_pulse/core/network/supabase_tables.dart';
import 'package:tyre_pulse/features/tyres/domain/tyre_fitment.dart';

const String _fitmentColumns = 'id,serial_no,serial_number,tyre_serial,brand,'
    'size,position,tyre_position,asset_no,status,issue_date';

abstract interface class TyreFitmentRepository {
  Future<List<TyreFitment>> activeForAsset({
    required String assetNo,
    String? country,
  });
}

final class SupabaseTyreFitmentRepository
    with SupabaseGateway
    implements TyreFitmentRepository {
  SupabaseTyreFitmentRepository(this._client);

  final SupabaseClient _client;

  @override
  Future<List<TyreFitment>> activeForAsset({
    required String assetNo,
    String? country,
  }) {
    return guard<List<TyreFitment>>(() async {
      var query = _client
          .from(SupabaseTables.tyreRecords)
          .select(_fitmentColumns)
          .eq('asset_no', assetNo.trim())
          .eq('status', 'Active');
      final String? scope = country?.trim();
      if (scope != null && scope.isNotEmpty) {
        query = query.or('country.is.null,country.eq.$scope');
      }
      final List<Map<String, dynamic>> rows = await query
          .order('issue_date', ascending: true)
          .order('id', ascending: true)
          .limit(100);
      return rows.map(TyreFitment.fromRow).toList(growable: false);
    });
  }
}
