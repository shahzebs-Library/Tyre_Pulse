import 'package:tyre_pulse/core/errors/app_error.dart';
import 'package:tyre_pulse/features/fleet_supervisor/data/fleet_team_repository.dart';
import 'package:tyre_pulse/features/fleet_supervisor/domain/fleet_team.dart';

const FleetTeamDriver adil = FleetTeamDriver(
  id: 'd-adil',
  employeeId: '10012816',
  name: 'ADIL ABBAS SYED',
  country: 'KSA',
  site: 'QIDDIYA-UPPER PLATEAU',
  status: 'active',
  loginLinked: true,
  vehicleId: 'v-tm655',
  assetNo: 'TM655',
  registrationNo: '8448 G X A',
  vehicleType: 'TR-MIXER',
  openCharges: 1,
  openFines: 2,
  lastKm: 127702,
  lastKmDate: null,
);

const FleetTeamDriver rahim = FleetTeamDriver(
  id: 'd-rahim',
  employeeId: '10013377',
  name: 'ABDUL RAHIM KHAN',
  country: 'KSA',
  site: 'NHC',
  status: 'active',
  loginLinked: true,
  vehicleId: 'v-tm514',
  assetNo: 'TM514',
  registrationNo: '2190 B R A',
);

const FleetTeamDriver sarfaraj = FleetTeamDriver(
  id: 'd-sarfaraj',
  employeeId: '10014021',
  name: 'SARFARAJ TASLIM',
  country: 'KSA',
  status: 'active',
);

final class FakeFleetTeamRepository implements FleetTeamRepository {
  FakeFleetTeamRepository({
    this.mine = const <FleetTeamDriver>[adil],
    this.available = const <FleetTeamDriver>[sarfaraj],
    this.failWith,
    this.conflictFirst = false,
  });

  final List<FleetTeamDriver> mine;
  final List<FleetTeamDriver> available;
  final Exception? failWith;
  bool conflictFirst;
  final List<(String, Map<String, Object?>)> commands =
      <(String, Map<String, Object?>)>[];
  final List<Map<String, Object?>> charges = <Map<String, Object?>>[];
  final List<Map<String, Object?>> fines = <Map<String, Object?>>[];

  @override
  Future<FleetTeamPage> drivers({
    required FleetTeamView view,
    String search = '',
    int offset = 0,
  }) async {
    if (failWith != null) throw failWith!;
    final List<FleetTeamDriver> src =
        view == FleetTeamView.mine ? mine : available;
    return FleetTeamPage(
      rows: src
          .where(
            (FleetTeamDriver d) =>
                search.isEmpty ||
                d.name.toLowerCase().contains(search.toLowerCase()),
          )
          .toList(),
      hasMore: false,
    );
  }

  @override
  Future<List<FleetAssignment>> history(String driverId) async =>
      <FleetAssignment>[
        FleetAssignment(
          id: 'a2',
          startsAt: DateTime(2026, 11, 27),
          reason: 'Daily mixer for Qiddiya pours',
          assetNo: 'TM655',
          supervisorName: 'Firozuddin Kayal',
          assignedByName: 'Firozuddin Kayal',
        ),
        FleetAssignment(
          id: 'a1',
          startsAt: DateTime(2026, 11, 20),
          endsAt: DateTime(2026, 11, 27),
          reason: 'Joins my team',
          supervisorName: 'Firozuddin Kayal',
          assignedByName: 'Firozuddin Kayal',
        ),
      ];

  @override
  Future<List<FleetVehicleOption>> vehicles({
    required String? country,
    String search = '',
  }) async =>
      const <FleetVehicleOption>[
        FleetVehicleOption(
          id: 'v-tm655',
          assetNo: 'TM655',
          registrationNo: '8448 G X A',
          vehicleType: 'TR-MIXER',
          site: 'QIDDIYA-UPPER PLATEAU',
        ),
        FleetVehicleOption(
          id: 'v-tm514',
          assetNo: 'TM514',
          registrationNo: '2190 B R A',
          vehicleType: 'TR-MIXER',
          site: 'NHC',
        ),
      ];

  @override
  Future<FleetCommandOutcome> command(
    String action,
    Map<String, Object?> payload,
    String requestId,
  ) async {
    commands.add((action, payload));
    if (conflictFirst && !payload.containsKey('move_from_driver')) {
      return const FleetVehicleConflict(
        driverId: 'd-adil',
        driverName: 'ADIL ABBAS SYED',
        assetNo: 'TM655',
      );
    }
    return const FleetCommandDone();
  }

  @override
  Future<void> issueCharge(
    Map<String, Object?> payload,
    String requestId,
  ) async {
    if (failWith != null) throw failWith!;
    charges.add(payload);
  }

  @override
  Future<void> createFine(
    Map<String, Object?> payload,
    String requestId,
  ) async {
    fines.add(payload);
  }

  @override
  Future<String> uploadChargePhoto({
    required String localPath,
    required String driverId,
  }) async =>
      'tp-storage://tyre-photos/modules/driver-charge/$driverId/1.jpg';
}

const AppError deniedError = AppError.authorization(message: 'Access denied');
