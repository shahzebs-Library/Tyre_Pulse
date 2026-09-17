/// Online reads and writes for the M2 "Dispatch & Handover" workspace.
///
/// Three objects: the `accident_dispatches` leg (AUTHORED, NOT APPLIED
/// migration - every read catches a schema mismatch and reports "not
/// provisioned" instead of pretending the leg is empty), the vendor block on
/// `accident_repair_orders` (base columns live since V417, contact columns
/// from the same unapplied migration), and the legacy
/// `accident_handover_inspections` row that the old flow still reads, which
/// is written alongside every custody acceptance so the two never disagree.
///
/// Writes are ONLINE: a signed vehicle acceptance is a legal act against a
/// live row, and queueing it offline would let two receipts race.
library;

import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

import 'package:flutter/foundation.dart' show immutable;
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:supabase_flutter/supabase_flutter.dart';
import 'package:tyre_pulse/core/errors/app_error.dart';
import 'package:tyre_pulse/core/network/supabase_client_provider.dart';
import 'package:tyre_pulse/core/network/supabase_error_mapper.dart';
import 'package:tyre_pulse/core/network/supabase_gateway.dart';
import 'package:tyre_pulse/core/network/supabase_tables.dart';
import 'package:tyre_pulse/features/accidents/domain/accident_handover_gating.dart';

final accidentDispatchRepositoryProvider =
    Provider<AccidentDispatchRepository>(
  (ref) => AccidentDispatchRepository(
    SupabaseAccidentDispatchRemote(ref.watch(supabaseClientProvider)),
  ),
);

/// The private bucket every accident evidence upload already lands in.
const String accidentDispatchEvidenceBucket = 'accident-photos';

/// The vendor columns the parity migration adds. Read as a second attempt
/// so a database without them still returns the live base columns.
const List<String> accidentVendorColumns = <String>[
  'vendor_city',
  'vendor_contact_name',
  'vendor_contact_phone',
  'vendor_contact_email',
  'vendor_registration_no',
  'vendor_inspector_name',
  'quotation_status',
];

const List<String> _repairOrderBaseColumns = <String>[
  'id',
  'accident_id',
  'repair_route',
  'workshop_type',
  'workshop_name',
  'external_workshop',
  'status',
];

/// The narrow remote surface, so a test can drive the repository with maps.
abstract interface class AccidentDispatchRemote {
  Future<Map<String, Object?>?> latestDispatch(String accidentId);
  Future<Map<String, Object?>?> latestRepairOrder(
    String accidentId,
    List<String> columns,
  );
  Future<Map<String, Object?>> insertDispatch(Map<String, Object?> row);
  Future<Map<String, Object?>> updateDispatch(
    String id,
    Map<String, Object?> patch,
  );
  Future<Map<String, Object?>> insertRepairOrder(Map<String, Object?> row);
  Future<Map<String, Object?>> updateRepairOrder(
    String id,
    Map<String, Object?> patch,
  );
  Future<void> insertHandoverInspection(Map<String, Object?> row);

  /// Running / decided SLA instances for the case (live since V417).
  Future<List<Map<String, Object?>>> slaInstances(String accidentId);

  /// Uploads [bytes] under the signed-in user's namespace and returns the
  /// opaque `tp-storage://` reference the database stores.
  Future<String> uploadBytes({
    required String fileName,
    required Uint8List bytes,
    required String contentType,
  });

  Future<Uint8List> readLocalBytes(String path);
  String? currentUserId();
}

final class SupabaseAccidentDispatchRemote implements AccidentDispatchRemote {
  const SupabaseAccidentDispatchRemote(this._client);
  final SupabaseClient _client;

  @override
  Future<Map<String, Object?>?> latestDispatch(String accidentId) async {
    final Map<String, dynamic>? row = await _client
        .from(SupabaseTables.accidentDispatches)
        .select()
        .eq('accident_id', accidentId)
        .order('created_at', ascending: false)
        .order('id', ascending: false)
        .limit(1)
        .maybeSingle();
    return row == null ? null : Map<String, Object?>.from(row);
  }

  @override
  Future<Map<String, Object?>?> latestRepairOrder(
    String accidentId,
    List<String> columns,
  ) async {
    final Map<String, dynamic>? row = await _client
        .from(SupabaseTables.accidentRepairOrders)
        .select(columns.join(','))
        .eq('accident_id', accidentId)
        .order('created_at', ascending: false)
        .order('id', ascending: false)
        .limit(1)
        .maybeSingle();
    return row == null ? null : Map<String, Object?>.from(row);
  }

  @override
  Future<Map<String, Object?>> insertDispatch(Map<String, Object?> row) async {
    final Map<String, dynamic> saved = await _client
        .from(SupabaseTables.accidentDispatches)
        .insert(row)
        .select()
        .single();
    return Map<String, Object?>.from(saved);
  }

  @override
  Future<Map<String, Object?>> updateDispatch(
    String id,
    Map<String, Object?> patch,
  ) async {
    final Map<String, dynamic> saved = await _client
        .from(SupabaseTables.accidentDispatches)
        .update(patch)
        .eq('id', id)
        .select()
        .single();
    return Map<String, Object?>.from(saved);
  }

  @override
  Future<Map<String, Object?>> insertRepairOrder(
    Map<String, Object?> row,
  ) async {
    final Map<String, dynamic> saved = await _client
        .from(SupabaseTables.accidentRepairOrders)
        .insert(row)
        .select()
        .single();
    return Map<String, Object?>.from(saved);
  }

  @override
  Future<Map<String, Object?>> updateRepairOrder(
    String id,
    Map<String, Object?> patch,
  ) async {
    final Map<String, dynamic> saved = await _client
        .from(SupabaseTables.accidentRepairOrders)
        .update(patch)
        .eq('id', id)
        .select()
        .single();
    return Map<String, Object?>.from(saved);
  }

  @override
  Future<void> insertHandoverInspection(Map<String, Object?> row) async {
    await _client.from(SupabaseTables.accidentHandoverInspections).insert(row);
  }

  @override
  Future<List<Map<String, Object?>>> slaInstances(String accidentId) async {
    final List<Map<String, dynamic>> rows = await _client
        .from(SupabaseTables.accidentSlaInstances)
        .select('id,sla_key,name,workstream_key,team,start_at,due_at,state')
        .eq('accident_id', accidentId)
        .order('start_at', ascending: false)
        .order('id', ascending: false)
        .limit(50);
    return rows
        .map((Map<String, dynamic> r) => Map<String, Object?>.from(r))
        .toList(growable: false);
  }

  @override
  Future<String> uploadBytes({
    required String fileName,
    required Uint8List bytes,
    required String contentType,
  }) async {
    final String user = currentUserId() ?? 'anonymous';
    // The production application's canonical `accidents/<user>/<file>`
    // namespace - the same one queued accident evidence lands in.
    final String path = 'accidents/$user/$fileName';
    await _client.storage.from(accidentDispatchEvidenceBucket).uploadBinary(
          path,
          bytes,
          fileOptions: FileOptions(contentType: contentType, upsert: false),
        );
    return 'tp-storage://$accidentDispatchEvidenceBucket/$path';
  }

  @override
  Future<Uint8List> readLocalBytes(String path) => File(path).readAsBytes();

  @override
  String? currentUserId() => _client.auth.currentUser?.id;
}

/// What the workspace reads in one go.
@immutable
final class AccidentDispatchBundle {
  const AccidentDispatchBundle({
    this.dispatch,
    this.vendor,
    this.vendorSla,
    this.dispatchesProvisioned = true,
    this.vendorFieldsProvisioned = true,
    this.slaReadFailed = false,
  });

  final AccidentDispatch? dispatch;
  final AccidentVendorDetails? vendor;

  /// The SLA instance on the repair or handover workstream, if any. The chip
  /// still reads "Not started" until custody is accepted whatever this holds.
  final VendorSlaSnapshot? vendorSla;

  /// True when the SLA ledger could not be read; the chip then says so
  /// instead of implying there is no SLA.
  final bool slaReadFailed;

  /// False when `accident_dispatches` does not exist on this database yet.
  final bool dispatchesProvisioned;

  /// False when the vendor contact columns do not exist yet (base vendor
  /// data is still returned).
  final bool vendorFieldsProvisioned;
}

/// The editable vendor block ("Edit vendor details").
@immutable
final class AccidentVendorInput {
  const AccidentVendorInput({
    required this.workshopName,
    this.city,
    this.contactName,
    this.contactPhone,
    this.contactEmail,
    this.registrationNo,
    this.inspectorName,
  });

  final String workshopName;
  final String? city;
  final String? contactName;
  final String? contactPhone;
  final String? contactEmail;
  final String? registrationNo;
  final String? inspectorName;
}

/// "2 Dispatch details" + "3 Vehicle handover condition", recorded when the
/// vehicle leaves.
@immutable
final class AccidentDispatchInput {
  const AccidentDispatchInput({
    required this.departureAt,
    required this.destination,
    this.carrier,
    this.driverName,
    this.recoveryVehicle,
    this.origin,
    this.etaAt,
    this.outOdometerKm,
    this.outEngineHours,
    this.outFuelPct,
    this.keysCount,
    this.documentsSent = const <String>[],
    this.accessories = const <String>[],
    this.outgoingPhotoPaths = const <String>[],
    this.outgoingSignedBy,
    this.outgoingSignatureDataUrl,
  });

  final DateTime departureAt;
  final String destination;
  final String? carrier;
  final String? driverName;
  final String? recoveryVehicle;
  final String? origin;
  final DateTime? etaAt;
  final num? outOdometerKm;
  final num? outEngineHours;
  final num? outFuelPct;
  final int? keysCount;
  final List<String> documentsSent;
  final List<String> accessories;
  final List<String> outgoingPhotoPaths;
  final String? outgoingSignedBy;
  final String? outgoingSignatureDataUrl;
}

class AccidentDispatchRepository with SupabaseGateway {
  AccidentDispatchRepository(this._remote, {DateTime Function()? clock})
      : _clock = clock ?? DateTime.now;

  final AccidentDispatchRemote _remote;
  final DateTime Function() _clock;

  Future<AccidentDispatchBundle> load(String accidentId) async {
    if (accidentId.trim().isEmpty) {
      throw ArgumentError('An accident id is required');
    }
    AccidentDispatch? dispatch;
    bool dispatchesProvisioned = true;
    try {
      final Map<String, Object?>? row =
          await guard(() => _remote.latestDispatch(accidentId));
      dispatch = row == null ? null : AccidentDispatch.fromRow(row);
    } on SupabaseFailure catch (failure) {
      if (!failure.isSchemaMismatch) rethrow;
      dispatchesProvisioned = false;
    }

    AccidentVendorDetails? vendor;
    bool vendorFieldsProvisioned = true;
    try {
      final Map<String, Object?>? row = await guard(
        () => _remote.latestRepairOrder(
          accidentId,
          <String>[..._repairOrderBaseColumns, ...accidentVendorColumns],
        ),
      );
      vendor = row == null ? null : AccidentVendorDetails.fromRow(row);
    } on SupabaseFailure catch (failure) {
      if (!failure.isSchemaMismatch) rethrow;
      vendorFieldsProvisioned = false;
      final Map<String, Object?>? row = await guard(
        () => _remote.latestRepairOrder(accidentId, _repairOrderBaseColumns),
      );
      vendor = row == null ? null : AccidentVendorDetails.fromRow(row);
    }
    VendorSlaSnapshot? vendorSla;
    bool slaReadFailed = false;
    try {
      final List<Map<String, Object?>> rows =
          await guard(() => _remote.slaInstances(accidentId));
      vendorSla = _vendorSla(rows);
    } on SupabaseFailure {
      slaReadFailed = true;
    }
    return AccidentDispatchBundle(
      dispatch: dispatch,
      vendor: vendor,
      vendorSla: vendorSla,
      dispatchesProvisioned: dispatchesProvisioned,
      vendorFieldsProvisioned: vendorFieldsProvisioned,
      slaReadFailed: slaReadFailed,
    );
  }

  /// The newest SLA on the repair workstream, else on handover. Rows are
  /// already newest-first from the remote.
  static VendorSlaSnapshot? _vendorSla(List<Map<String, Object?>> rows) {
    for (final String key in const <String>['repair', 'handover']) {
      for (final Map<String, Object?> row in rows) {
        if (row['workstream_key'] == key) {
          return VendorSlaSnapshot(
            state: row['state']?.toString() ?? 'running',
            name: row['name']?.toString(),
            dueAt: _time(row['due_at']),
            startAt: _time(row['start_at']),
          );
        }
      }
    }
    return null;
  }

  static DateTime? _time(Object? value) {
    if (value is DateTime) return value;
    if (value is String && value.trim().isNotEmpty) {
      return DateTime.tryParse(value.trim());
    }
    return null;
  }

  /// Updates the vendor block on the latest repair order, or creates an
  /// external repair order when the case has none yet.
  Future<AccidentVendorDetails> saveVendorDetails({
    required String accidentId,
    required AccidentVendorInput input,
    String? repairOrderId,
    String? country,
    String? site,
  }) async {
    if (accidentId.trim().isEmpty || input.workshopName.trim().isEmpty) {
      throw ArgumentError('An accident id and workshop name are required');
    }
    final Map<String, Object?> patch = <String, Object?>{
      'external_workshop': input.workshopName.trim(),
      'workshop_name': input.workshopName.trim(),
      'vendor_city': _clean(input.city),
      'vendor_contact_name': _clean(input.contactName),
      'vendor_contact_phone': _clean(input.contactPhone),
      'vendor_contact_email': _clean(input.contactEmail),
      'vendor_registration_no': _clean(input.registrationNo),
      'vendor_inspector_name': _clean(input.inspectorName),
    };
    return guard(() async {
      final Map<String, Object?> saved;
      if (repairOrderId != null && repairOrderId.trim().isNotEmpty) {
        saved = await _remote.updateRepairOrder(repairOrderId.trim(), patch);
      } else {
        saved = await _remote.insertRepairOrder(<String, Object?>{
          'accident_id': accidentId.trim(),
          'country': _clean(country),
          'site': _clean(site),
          'repair_route': 'external',
          'workshop_type': 'external',
          ...patch,
        });
      }
      return AccidentVendorDetails.fromRow(saved);
    });
  }

  /// Records the outgoing leg. The live status is `in_transit` as soon as a
  /// departure time is given - this is the act that starts the transit clock.
  Future<AccidentDispatch> recordDispatch({
    required String accidentId,
    required AccidentDispatchInput input,
    String? repairOrderId,
    String? country,
    String? site,
    String? sentByName,
  }) async {
    if (accidentId.trim().isEmpty || input.destination.trim().isEmpty) {
      throw ArgumentError('An accident id and destination are required');
    }
    return guard(() async {
      final String? actor = _remote.currentUserId();
      if (actor == null || actor.isEmpty) {
        throw const AppError.authentication();
      }
      final List<String> photoRefs = <String>[];
      for (final String path in input.outgoingPhotoPaths) {
        photoRefs.add(await _storeImage(path, 'dispatch-out'));
      }
      final String? signature = input.outgoingSignatureDataUrl == null
          ? null
          : await _storeImage(input.outgoingSignatureDataUrl!, 'dispatch-sig');
      final Map<String, Object?> saved = await _remote.insertDispatch(
        <String, Object?>{
          'accident_id': accidentId.trim(),
          'repair_order_id': _clean(repairOrderId),
          'country': _clean(country),
          'site': _clean(site),
          'sent_by_id': actor,
          'sent_by_name': _clean(sentByName),
          'departure_at': input.departureAt.toUtc().toIso8601String(),
          'carrier': _clean(input.carrier),
          'driver_name': _clean(input.driverName),
          'recovery_vehicle': _clean(input.recoveryVehicle),
          'origin': _clean(input.origin),
          'destination': input.destination.trim(),
          'eta_at': input.etaAt?.toUtc().toIso8601String(),
          'live_status': 'in_transit',
          'out_odometer_km': input.outOdometerKm,
          'out_engine_hours': input.outEngineHours,
          'out_fuel_pct': input.outFuelPct,
          'keys_count': input.keysCount,
          'documents_sent': input.documentsSent,
          'accessories': input.accessories,
          'outgoing_photos': photoRefs,
          'outgoing_signed_by': _clean(input.outgoingSignedBy),
          'outgoing_signed_at': signature == null
              ? null
              : _clock().toUtc().toIso8601String(),
          'outgoing_signature': signature,
        },
      );
      return AccidentDispatch.fromRow(saved);
    });
  }

  /// "Sign and accept vehicle". Refuses locally unless every asterisked
  /// field is present, uploads the signatures and photos, stamps custody on
  /// the leg, and ALSO writes the legacy accepted handover-inspection row so
  /// the older workflow reads the same decision.
  Future<AccidentDispatch> acceptCustody({
    required AccidentDispatch dispatch,
    required HandoverReceiptDraft receipt,
    String? country,
    String? site,
  }) async {
    if (!canSignAndAccept(receipt, dispatch: dispatch)) {
      throw ArgumentError('Complete all required fields to enable');
    }
    return guard(() async {
      final String? actor = _remote.currentUserId();
      if (actor == null || actor.isEmpty) {
        throw const AppError.authentication();
      }
      final List<String> photoRefs = <String>[];
      for (final String path in receipt.receivingPhotos) {
        photoRefs.add(await _storeImage(path, 'receipt-photo'));
      }
      final String paper =
          await _storeImage(receipt.handoverPaperRef!, 'handover-paper');
      final String receiverSig =
          await _storeImage(receipt.receiverSignature!, 'receiver-sig');
      final String? senderSig = receipt.senderSignature == null
          ? null
          : await _storeImage(receipt.senderSignature!, 'sender-sig');
      final String acceptedAt = _clock().toUtc().toIso8601String();
      final Map<String, Object?> saved = await _remote.updateDispatch(
        dispatch.id,
        <String, Object?>{
          'arrived_at': receipt.arrivedAt!.toUtc().toIso8601String(),
          'received_by_name': receipt.receivedByName.trim(),
          'received_by_designation': receipt.receivedByDesignation.trim(),
          'in_odometer_km': receipt.inOdometerKm,
          'in_engine_hours': receipt.inEngineHours,
          'in_fuel_pct': receipt.inFuelPct,
          'condition_matches': receipt.conditionMatches,
          'additional_damage_remarks': _clean(receipt.additionalDamageRemarks),
          'receiving_photos': photoRefs,
          'handover_paper_ref': paper,
          'receiver_signature': receiverSig,
          'sender_signature': senderSig,
          'custody_accepted': true,
          'accepted_at': acceptedAt,
          'accepted_by_id': actor,
          'live_status': 'accepted',
        },
      );
      final AccidentDispatch updated = AccidentDispatch.fromRow(saved);
      if (!updated.custodyAccepted) {
        throw StateError('The server did not confirm custody acceptance');
      }
      await _remote.insertHandoverInspection(<String, Object?>{
        'accident_id': dispatch.accidentId,
        'country': _clean(country),
        'site': _clean(site),
        'inspector_id': actor,
        'inspector_name': receipt.receivedByName.trim(),
        'inspected_at': receipt.arrivedAt!.toUtc().toIso8601String(),
        'matches_approved_scope': receipt.conditionMatches,
        'decision': 'accepted',
        'remarks': _clean(receipt.additionalDamageRemarks),
        'photos': photoRefs,
      });
      return updated;
    });
  }

  /// A value that is already a storage reference is kept byte-for-byte; a
  /// `data:image/png;base64,` URL (the signature pad) is decoded and
  /// uploaded; anything else is read from the device as an image file.
  Future<String> _storeImage(String value, String kind) async {
    if (value.startsWith('tp-storage://')) return value;
    final String stamp = _clock().toUtc().millisecondsSinceEpoch.toString();
    if (value.startsWith('data:image/png;base64,')) {
      final Uint8List bytes =
          base64Decode(value.substring('data:image/png;base64,'.length));
      return _remote.uploadBytes(
        fileName: '$kind-$stamp.png',
        bytes: bytes,
        contentType: 'image/png',
      );
    }
    final Uint8List bytes = await _remote.readLocalBytes(value);
    final String extension = _imageExtension(bytes);
    if (extension.isEmpty) {
      throw const FormatException('Choose a PNG or JPEG image.');
    }
    return _remote.uploadBytes(
      fileName: '$kind-$stamp.$extension',
      bytes: bytes,
      contentType: extension == 'png' ? 'image/png' : 'image/jpeg',
    );
  }

  static String _imageExtension(Uint8List bytes) {
    if (bytes.length < 4) return '';
    if (bytes[0] == 137 && bytes[1] == 80) return 'png';
    if (bytes[0] == 255 && bytes[1] == 216) return 'jpg';
    return '';
  }

  static String? _clean(String? value) {
    final String text = value?.trim() ?? '';
    return text.isEmpty ? null : text;
  }
}
