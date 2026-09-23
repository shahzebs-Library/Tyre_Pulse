import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:tyre_pulse/core/network/supabase_client_provider.dart';
import 'package:tyre_pulse/core/network/supabase_gateway.dart';
import 'package:tyre_pulse/core/network/supabase_tables.dart';
import 'package:tyre_pulse/features/accidents/data/accident_claim_dto.dart';
import 'package:tyre_pulse/features/accidents/domain/accident_claim.dart';

typedef AccidentClaimRead = Future<Map<String, dynamic>?> Function(
  String accidentId,
);
typedef AccidentClaimRpc = Future<dynamic> Function(
  String name,
  Map<String, dynamic> params,
);

final accidentClaimRepositoryProvider =
    Provider<AccidentClaimRepository>((ref) {
  final client = ref.watch(supabaseClientProvider);
  return AccidentClaimRepository(
    (accidentId) async {
      final row = await client
          .from(SupabaseTables.accidentInsuranceClaims)
          .select(
            'id,insurer,policy_no,claim_no,deductible,approved_amount,decision',
          )
          .eq('accident_id', accidentId)
          .order('created_at', ascending: false)
          .order('id', ascending: false)
          .limit(1)
          .maybeSingle();
      if (row == null) return null;
      final accident = await client
          .from(SupabaseTables.accidents)
          .select('claim_amount')
          .eq('id', accidentId)
          .single();
      return <String, dynamic>{
        ...row,
        'case_claim_amount': accident['claim_amount'],
      };
    },
    (name, params) => client.rpc(name, params: params),
  );
});

/// Online-only insurance operations. The live RPC verifies the current actor's
/// edit_insurance capability and parent case org/country/site in one transaction.
/// Verified: docs/accident-module/14_INSURANCE.sql + live function definitions.
class AccidentClaimRepository with SupabaseGateway {
  AccidentClaimRepository(this._read, this._rpc);
  final AccidentClaimRead _read;
  final AccidentClaimRpc _rpc;

  Future<AccidentClaim?> latest(String accidentId) => guard(() async {
        final row = await _read(accidentId);
        return row == null ? null : AccidentClaimDto(row).toDomain();
      });

  Future<AccidentClaim> register({
    required String accidentId,
    required String insurer,
    required String policyNo,
    required String claimNo,
    required num claimAmount,
    num? deductible,
  }) async {
    if (accidentId.trim().isEmpty ||
        insurer.trim().isEmpty ||
        policyNo.trim().isEmpty ||
        claimNo.trim().isEmpty ||
        !claimAmount.isFinite ||
        claimAmount < 0 ||
        (deductible != null && (!deductible.isFinite || deductible < 0))) {
      throw ArgumentError(
        'Enter claim identifiers and nonnegative finite amounts',
      );
    }
    return guard(() async {
      final dynamic result =
          await _rpc('accident_claim_register', <String, dynamic>{
        'p_accident_id': accidentId,
        'p_insurer': insurer.trim(),
        'p_policy_no': policyNo.trim(),
        'p_claim_no': claimNo.trim(),
        'p_claim_amount': claimAmount,
        'p_deductible': deductible,
      });
      if (result is! Map || result['ok'] != true || result['claim'] is! Map) {
        throw const FormatException('Claim registration not confirmed');
      }
      return AccidentClaimDto(Map<String, dynamic>.from(result['claim'] as Map))
          .toDomain();
    });
  }
}
