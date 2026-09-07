/// Nullable monetary values stay unrecorded rather than becoming zero.
class AccidentClaim {
  const AccidentClaim({
    required this.id,
    this.insurer,
    this.policyNo,
    this.claimNo,
    this.deductible,
    this.approvedAmount,
    this.decision,
    this.claimAmount,
  });
  final String id;
  final String? insurer;
  final String? policyNo;
  final String? claimNo;
  final num? deductible;
  final num? approvedAmount;
  final String? decision;

  /// Loaded from the parent accidents row, not accident_insurance_claims.
  final num? claimAmount;
}
