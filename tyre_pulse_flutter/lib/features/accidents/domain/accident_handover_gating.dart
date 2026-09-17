/// Pure rules for the M2 "Dispatch & Handover (external workshop)" workspace.
///
/// Everything here is decidable from an [AccidentDispatch] row, a vendor
/// block and a clock the caller supplies. No I/O, no widget, no locale. The
/// widget renders what these functions return; the repository stores the
/// rows these functions read. That split is what lets the gating be tested
/// without Supabase and rendered without re-deriving it.
///
/// Times are NEVER invented: a duration is only computed when both ends are
/// recorded (or when one end is genuinely "now" for a clock that is still
/// running). A missing time yields null and the caller prints "Not set".
library;

import 'package:flutter/foundation.dart' show immutable;
import 'package:tyre_pulse/features/accidents/domain/accident_case_vocab.dart';

/// One `accident_dispatches` row (2026-09-16 parity migration, NOT APPLIED).
@immutable
final class AccidentDispatch {
  const AccidentDispatch({
    required this.id,
    required this.accidentId,
    this.repairOrderId,
    this.sentByName,
    this.departureAt,
    this.carrier,
    this.driverName,
    this.recoveryVehicle,
    this.origin,
    this.destination,
    this.etaAt,
    this.liveStatus = 'preparing',
    this.outOdometerKm,
    this.outEngineHours,
    this.outFuelPct,
    this.keysCount,
    this.documentsSent = const <String>[],
    this.accessories = const <String>[],
    this.outgoingPhotos = const <String>[],
    this.outgoingSignedBy,
    this.outgoingSignedAt,
    this.outgoingSignature,
    this.arrivedAt,
    this.receivedByName,
    this.receivedByDesignation,
    this.inOdometerKm,
    this.inEngineHours,
    this.inFuelPct,
    this.conditionMatches,
    this.additionalDamageRemarks,
    this.receivingPhotos = const <String>[],
    this.handoverPaperRef,
    this.receiverSignature,
    this.senderSignature,
    this.custodyAccepted = false,
    this.acceptedAt,
    this.createdAt,
  });

  factory AccidentDispatch.fromRow(Map<String, Object?> row) =>
      AccidentDispatch(
        id: _text(row['id']) ?? '',
        accidentId: _text(row['accident_id']) ?? '',
        repairOrderId: _text(row['repair_order_id']),
        sentByName: _text(row['sent_by_name']),
        departureAt: _time(row['departure_at']),
        carrier: _text(row['carrier']),
        driverName: _text(row['driver_name']),
        recoveryVehicle: _text(row['recovery_vehicle']),
        origin: _text(row['origin']),
        destination: _text(row['destination']),
        etaAt: _time(row['eta_at']),
        liveStatus: _text(row['live_status']) ?? 'preparing',
        outOdometerKm: _num(row['out_odometer_km']),
        outEngineHours: _num(row['out_engine_hours']),
        outFuelPct: _num(row['out_fuel_pct']),
        keysCount: _num(row['keys_count'])?.toInt(),
        documentsSent: _strings(row['documents_sent']),
        accessories: _strings(row['accessories']),
        outgoingPhotos: _strings(row['outgoing_photos']),
        outgoingSignedBy: _text(row['outgoing_signed_by']),
        outgoingSignedAt: _time(row['outgoing_signed_at']),
        outgoingSignature: _text(row['outgoing_signature']),
        arrivedAt: _time(row['arrived_at']),
        receivedByName: _text(row['received_by_name']),
        receivedByDesignation: _text(row['received_by_designation']),
        inOdometerKm: _num(row['in_odometer_km']),
        inEngineHours: _num(row['in_engine_hours']),
        inFuelPct: _num(row['in_fuel_pct']),
        conditionMatches: _bool(row['condition_matches']),
        additionalDamageRemarks: _text(row['additional_damage_remarks']),
        receivingPhotos: _strings(row['receiving_photos']),
        handoverPaperRef: _text(row['handover_paper_ref']),
        receiverSignature: _text(row['receiver_signature']),
        senderSignature: _text(row['sender_signature']),
        custodyAccepted: row['custody_accepted'] == true,
        acceptedAt: _time(row['accepted_at']),
        createdAt: _time(row['created_at']),
      );

  final String id;
  final String accidentId;
  final String? repairOrderId;
  final String? sentByName;
  final DateTime? departureAt;
  final String? carrier;
  final String? driverName;
  final String? recoveryVehicle;
  final String? origin;
  final String? destination;
  final DateTime? etaAt;
  final String liveStatus;
  final num? outOdometerKm;
  final num? outEngineHours;
  final num? outFuelPct;
  final int? keysCount;
  final List<String> documentsSent;
  final List<String> accessories;
  final List<String> outgoingPhotos;
  final String? outgoingSignedBy;
  final DateTime? outgoingSignedAt;
  final String? outgoingSignature;
  final DateTime? arrivedAt;
  final String? receivedByName;
  final String? receivedByDesignation;
  final num? inOdometerKm;
  final num? inEngineHours;
  final num? inFuelPct;
  final bool? conditionMatches;
  final String? additionalDamageRemarks;
  final List<String> receivingPhotos;
  final String? handoverPaperRef;
  final String? receiverSignature;
  final String? senderSignature;
  final bool custodyAccepted;
  final DateTime? acceptedAt;
  final DateTime? createdAt;

  bool get isInTransit => liveStatus == 'in_transit';
  bool get hasArrived =>
      liveStatus == 'arrived' || liveStatus == 'accepted' || arrivedAt != null;
}

/// The vendor block of `accident_repair_orders` (base columns are live; the
/// contact columns are from the parity migration).
@immutable
final class AccidentVendorDetails {
  const AccidentVendorDetails({
    this.repairOrderId,
    this.repairRoute,
    this.workshopType,
    this.workshopName,
    this.externalWorkshop,
    this.vendorCity,
    this.contactName,
    this.contactPhone,
    this.contactEmail,
    this.registrationNo,
    this.inspectorName,
    this.quotationStatus,
  });

  factory AccidentVendorDetails.fromRow(Map<String, Object?> row) =>
      AccidentVendorDetails(
        repairOrderId: _text(row['id']),
        repairRoute: _text(row['repair_route']),
        workshopType: _text(row['workshop_type']),
        workshopName: _text(row['workshop_name']),
        externalWorkshop: _text(row['external_workshop']),
        vendorCity: _text(row['vendor_city']),
        contactName: _text(row['vendor_contact_name']),
        contactPhone: _text(row['vendor_contact_phone']),
        contactEmail: _text(row['vendor_contact_email']),
        registrationNo: _text(row['vendor_registration_no']),
        inspectorName: _text(row['vendor_inspector_name']),
        quotationStatus: _text(row['quotation_status']),
      );

  final String? repairOrderId;
  final String? repairRoute;
  final String? workshopType;
  final String? workshopName;
  final String? externalWorkshop;
  final String? vendorCity;
  final String? contactName;
  final String? contactPhone;
  final String? contactEmail;
  final String? registrationNo;
  final String? inspectorName;
  final String? quotationStatus;

  /// The name the workshop is known by: the vendor's own name first, then the
  /// generic workshop_name column.
  String? get displayName => externalWorkshop ?? workshopName;
}

/// What the vendor types into "4 Workshop receipt" before pressing "Sign and
/// accept vehicle". Field keys mirror `accident_dispatches` columns and the
/// [receiptRequired] vocabulary exactly, so the gate and the write agree.
@immutable
final class HandoverReceiptDraft {
  const HandoverReceiptDraft({
    this.arrivedAt,
    this.receivedByName = '',
    this.receivedByDesignation = '',
    this.inOdometerKm,
    this.inEngineHours,
    this.inFuelPct,
    this.conditionMatches,
    this.additionalDamageRemarks = '',
    this.receivingPhotos = const <String>[],
    this.handoverPaperRef,
    this.receiverSignature,
    this.senderSignature,
    this.custodyAccepted = false,
  });

  final DateTime? arrivedAt;
  final String receivedByName;
  final String receivedByDesignation;
  final num? inOdometerKm;
  final num? inEngineHours;
  final num? inFuelPct;
  final bool? conditionMatches;
  final String additionalDamageRemarks;

  /// Local device paths (before upload) or storage references (after).
  final List<String> receivingPhotos;

  /// Local device path or storage reference of the signed handover paper.
  final String? handoverPaperRef;

  /// `data:image/png;base64,...` from the signature pad, or a storage ref.
  final String? receiverSignature;
  final String? senderSignature;
  final bool custodyAccepted;

  HandoverReceiptDraft copyWith({
    DateTime? arrivedAt,
    bool clearArrivedAt = false,
    String? receivedByName,
    String? receivedByDesignation,
    num? inOdometerKm,
    bool clearInOdometerKm = false,
    num? inEngineHours,
    bool clearInEngineHours = false,
    num? inFuelPct,
    bool clearInFuelPct = false,
    bool? conditionMatches,
    bool clearConditionMatches = false,
    String? additionalDamageRemarks,
    List<String>? receivingPhotos,
    String? handoverPaperRef,
    bool clearHandoverPaperRef = false,
    String? receiverSignature,
    bool clearReceiverSignature = false,
    String? senderSignature,
    bool clearSenderSignature = false,
    bool? custodyAccepted,
  }) =>
      HandoverReceiptDraft(
        arrivedAt: clearArrivedAt ? null : (arrivedAt ?? this.arrivedAt),
        receivedByName: receivedByName ?? this.receivedByName,
        receivedByDesignation:
            receivedByDesignation ?? this.receivedByDesignation,
        inOdometerKm:
            clearInOdometerKm ? null : (inOdometerKm ?? this.inOdometerKm),
        inEngineHours:
            clearInEngineHours ? null : (inEngineHours ?? this.inEngineHours),
        inFuelPct: clearInFuelPct ? null : (inFuelPct ?? this.inFuelPct),
        conditionMatches: clearConditionMatches
            ? null
            : (conditionMatches ?? this.conditionMatches),
        additionalDamageRemarks:
            additionalDamageRemarks ?? this.additionalDamageRemarks,
        receivingPhotos: receivingPhotos ?? this.receivingPhotos,
        handoverPaperRef: clearHandoverPaperRef
            ? null
            : (handoverPaperRef ?? this.handoverPaperRef),
        receiverSignature: clearReceiverSignature
            ? null
            : (receiverSignature ?? this.receiverSignature),
        senderSignature: clearSenderSignature
            ? null
            : (senderSignature ?? this.senderSignature),
        custodyAccepted: custodyAccepted ?? this.custodyAccepted,
      );

  /// The draft keyed by the column names [receiptRequired] uses.
  Map<String, Object?> toFieldMap() => <String, Object?>{
        'arrived_at': arrivedAt,
        'received_by_name': receivedByName,
        'received_by_designation': receivedByDesignation,
        'in_odometer_km': inOdometerKm,
        'in_engine_hours': inEngineHours,
        'in_fuel_pct': inFuelPct,
        'condition_matches': conditionMatches,
        'additional_damage_remarks': additionalDamageRemarks,
        'receiving_photos': receivingPhotos,
        'handover_paper_ref': handoverPaperRef,
        'receiver_signature': receiverSignature,
        'sender_signature': senderSignature,
        'custody_accepted': custodyAccepted,
      };
}

/// The [receiptRequired] keys that are still blank in [fields].
///
/// A blank is: null, an empty or whitespace string, an empty list, or a
/// boolean false (the custody checkbox). Everything else counts as provided.
List<String> receiptMissing(Map<String, Object?> fields) {
  final List<String> missing = <String>[];
  for (final String key in receiptRequired) {
    if (_isBlank(fields[key])) missing.add(key);
  }
  return List<String>.unmodifiable(missing);
}

/// The [receiptRequired] keys still blank on a STORED dispatch row.
List<String> receiptMissingOnDispatch(AccidentDispatch dispatch) =>
    receiptMissing(<String, Object?>{
      'arrived_at': dispatch.arrivedAt,
      'received_by_name': dispatch.receivedByName,
      'received_by_designation': dispatch.receivedByDesignation,
      'receiving_photos': dispatch.receivingPhotos,
      'handover_paper_ref': dispatch.handoverPaperRef,
      'receiver_signature': dispatch.receiverSignature,
      'custody_accepted': dispatch.custodyAccepted,
    });

/// "Sign and accept vehicle" is enabled only when every asterisked field is
/// provided AND a dispatch leg exists to accept against.
bool canSignAndAccept(
  HandoverReceiptDraft draft, {
  AccidentDispatch? dispatch,
}) {
  if (dispatch == null || dispatch.id.isEmpty) return false;
  if (dispatch.custodyAccepted) return false;
  return receiptMissing(draft.toFieldMap()).isEmpty;
}

/// Time in transit: departure to arrival when arrival is recorded, departure
/// to [now] while the leg is still moving. Null when there is no departure or
/// the leg never left (`preparing`).
Duration? transitElapsed(AccidentDispatch? dispatch, DateTime now) {
  if (dispatch == null) return null;
  final DateTime? start = dispatch.departureAt;
  if (start == null || dispatch.liveStatus == 'preparing') return null;
  final DateTime end = dispatch.arrivedAt ?? dispatch.acceptedAt ?? now;
  final Duration elapsed = end.difference(start);
  return elapsed.isNegative ? Duration.zero : elapsed;
}

/// Whether the transit timer is still counting (departed, not yet arrived).
bool transitTimerRunning(AccidentDispatch? dispatch) =>
    dispatch != null &&
    dispatch.departureAt != null &&
    dispatch.liveStatus == 'in_transit' &&
    dispatch.arrivedAt == null;

/// One `accident_sla_instances` row, narrowed to what the chips need.
@immutable
final class VendorSlaSnapshot {
  const VendorSlaSnapshot({
    required this.state,
    this.name,
    this.dueAt,
    this.startAt,
  });

  /// running | paused | met | breached | cancelled
  final String state;
  final String? name;
  final DateTime? dueAt;
  final DateTime? startAt;
}

enum VendorSlaTone { neutral, running, warning, ok, critical }

/// The "Vendor repair SLA" header chip.
@immutable
final class VendorSlaChip {
  const VendorSlaChip({required this.label, required this.tone});
  final String label;
  final VendorSlaTone tone;
}

/// The mock's rule: "Vendor SLA starts only after signed vehicle acceptance."
///
/// Before custody is accepted the chip ALWAYS reads Not started, whatever the
/// SLA table says - a running instance without a signed acceptance would be
/// a clock nobody agreed to. After acceptance the SLA instance decides; with
/// no instance the chip states that honestly rather than inventing a due
/// time from the acceptance timestamp.
VendorSlaChip vendorSlaChip(
  AccidentDispatch? dispatch,
  VendorSlaSnapshot? sla,
  DateTime now,
) {
  if (dispatch == null || !dispatch.custodyAccepted) {
    return const VendorSlaChip(
      label: 'Not started',
      tone: VendorSlaTone.neutral,
    );
  }
  if (sla == null) {
    return const VendorSlaChip(
      label: 'Started, no SLA target',
      tone: VendorSlaTone.running,
    );
  }
  switch (sla.state) {
    case 'met':
      return const VendorSlaChip(label: 'Met', tone: VendorSlaTone.ok);
    case 'breached':
      return const VendorSlaChip(
        label: 'Breached',
        tone: VendorSlaTone.critical,
      );
    case 'cancelled':
      return const VendorSlaChip(
        label: 'Cancelled',
        tone: VendorSlaTone.neutral,
      );
    case 'paused':
      return const VendorSlaChip(label: 'Paused', tone: VendorSlaTone.warning);
    default:
      final DateTime? due = sla.dueAt;
      if (due == null) {
        return const VendorSlaChip(
          label: 'Running',
          tone: VendorSlaTone.running,
        );
      }
      final Duration left = due.difference(now);
      if (left.isNegative) {
        return VendorSlaChip(
          label: 'Overdue by ${formatElapsed(-left)}',
          tone: VendorSlaTone.critical,
        );
      }
      return VendorSlaChip(
        label: 'Due in ${formatElapsed(left)}',
        tone: VendorSlaTone.running,
      );
  }
}

enum DispatchStepState { complete, next, pending }

/// The 1..4 stepper. `dispatched` is complete once the leg left; `arrived`
/// once arrival is recorded; `signed_acceptance` once custody is accepted;
/// `vendor_assessment` is never marked complete here (it lives in the
/// vendor's own workspace) and reads Next once acceptance is signed.
DispatchStepState dispatchStepState(String stepKey, AccidentDispatch? d) {
  final bool dispatched = d != null &&
      d.departureAt != null &&
      d.liveStatus != 'preparing';
  final bool arrived = d != null && (d.arrivedAt != null || d.hasArrived);
  final bool accepted = d != null && d.custodyAccepted;
  switch (stepKey) {
    case 'dispatched':
      return dispatched
          ? DispatchStepState.complete
          : DispatchStepState.next;
    case 'arrived':
      if (arrived) return DispatchStepState.complete;
      return dispatched ? DispatchStepState.next : DispatchStepState.pending;
    case 'signed_acceptance':
      if (accepted) return DispatchStepState.complete;
      return arrived ? DispatchStepState.next : DispatchStepState.pending;
    default:
      return accepted ? DispatchStepState.next : DispatchStepState.pending;
  }
}

/// The recorded time a stepper node should print, or null.
DateTime? dispatchStepTime(String stepKey, AccidentDispatch? d) {
  if (d == null) return null;
  return switch (stepKey) {
    'dispatched' => d.liveStatus == 'preparing' ? null : d.departureAt,
    'arrived' => d.arrivedAt,
    'signed_acceptance' => d.acceptedAt,
    _ => null,
  };
}

/// The label for the live-status pill, from [dispatchLiveStates].
String dispatchLiveStateLabel(String? token) {
  for (final VocabItem s in dispatchLiveStates) {
    if (s.key == token) return s.label;
  }
  return '';
}

/// "1h 08m", "4d 6h", "52m", "0m". Never negative.
String formatElapsed(Duration d) {
  final Duration v = d.isNegative ? Duration.zero : d;
  final int days = v.inDays;
  final int hours = v.inHours % 24;
  final int minutes = v.inMinutes % 60;
  if (days > 0) return '${days}d ${hours}h';
  if (hours > 0) return '${hours}h ${minutes.toString().padLeft(2, '0')}m';
  return '${minutes}m';
}

bool _isBlank(Object? value) {
  if (value == null) return true;
  if (value is String) return value.trim().isEmpty;
  if (value is Iterable<Object?>) return value.isEmpty;
  if (value is bool) return !value;
  return false;
}

String? _text(Object? value) {
  final String s = value?.toString().trim() ?? '';
  return s.isEmpty ? null : s;
}

bool? _bool(Object? value) => value is bool ? value : null;

num? _num(Object? value) {
  if (value is num) return value;
  if (value is String) return num.tryParse(value.trim());
  return null;
}

DateTime? _time(Object? value) {
  if (value is DateTime) return value;
  if (value is String && value.trim().isNotEmpty) {
    return DateTime.tryParse(value.trim());
  }
  return null;
}

List<String> _strings(Object? value) {
  if (value is! List<Object?>) return const <String>[];
  return List<String>.unmodifiable(
    value.map((Object? e) => e?.toString().trim() ?? '').where(
          (String e) => e.isNotEmpty,
        ),
  );
}
