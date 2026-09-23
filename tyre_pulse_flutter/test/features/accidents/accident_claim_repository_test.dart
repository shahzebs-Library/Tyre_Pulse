import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/core/network/supabase_error_mapper.dart';
import 'package:tyre_pulse/features/accidents/data/accident_claim_repository.dart';

void main() {
  test(
      'registration sends exact verified RPC parameters without inventing claim columns',
      () async {
    Map<String, dynamic>? sent;
    final repo =
        AccidentClaimRepository((id) async => null, (name, params) async {
      expect(name, 'accident_claim_register');
      sent = params;
      return <String, dynamic>{
        'ok': true,
        'claim': <String, dynamic>{
          'id': 'claim',
          'insurer': 'Insurer',
          'decision': 'registered',
        },
      };
    });
    final claim = await repo.register(
      accidentId: 'case',
      insurer: ' Insurer ',
      policyNo: ' P1 ',
      claimNo: ' C1 ',
      claimAmount: 1250.50,
    );
    expect(claim.id, 'claim');
    expect(sent, <String, dynamic>{
      'p_accident_id': 'case',
      'p_insurer': 'Insurer',
      'p_policy_no': 'P1',
      'p_claim_no': 'C1',
      'p_claim_amount': 1250.50,
      'p_deductible': null,
    });
    expect(claim.approvedAmount, isNull);
  });

  test('invalid or nonfinite money never reaches the server', () async {
    var calls = 0;
    final repo =
        AccidentClaimRepository((id) async => null, (name, params) async {
      calls++;
      return null;
    });
    for (final amount in <num>[-1, double.nan, double.infinity]) {
      await expectLater(
        repo.register(
          accidentId: 'case',
          insurer: 'I',
          policyNo: 'P',
          claimNo: 'C',
          claimAmount: amount,
        ),
        throwsArgumentError,
      );
    }
    expect(calls, 0);
  });

  test('loads parent claim amount separately and preserves unrecorded amounts',
      () async {
    final repo = AccidentClaimRepository(
      (id) async => <String, dynamic>{
        'id': 'claim',
        'case_claim_amount': 1250,
        'deductible': null,
      },
      (name, params) async => null,
    );
    final claim = await repo.latest('case');
    expect(claim!.claimAmount, 1250);
    expect(claim.deductible, isNull);
  });

  test('does not present an unconfirmed response as saved', () async {
    final repo = AccidentClaimRepository(
      (id) async => null,
      (name, params) async => <String, dynamic>{'ok': false},
    );
    await expectLater(
      repo.register(
        accidentId: 'case',
        insurer: 'I',
        policyNo: 'P',
        claimNo: 'C',
        claimAmount: 0,
      ),
      throwsA(isA<SupabaseFailure>()),
    );
  });
}
