import 'package:tyre_pulse/features/accidents/domain/accident_claim.dart';

class AccidentClaimDto {
  AccidentClaimDto(this.row);
  final Map<String, dynamic> row;

  AccidentClaim toDomain() {
    final dynamic id = row['id'];
    if (id is! String || id.isEmpty) {
      throw const FormatException('Claim has no identity');
    }
    return AccidentClaim(
      id: id,
      insurer: row['insurer'] as String?,
      policyNo: row['policy_no'] as String?,
      claimNo: row['claim_no'] as String?,
      deductible: row['deductible'] as num?,
      approvedAmount: row['approved_amount'] as num?,
      decision: row['decision'] as String?,
      claimAmount: row['case_claim_amount'] as num?,
    );
  }
}
