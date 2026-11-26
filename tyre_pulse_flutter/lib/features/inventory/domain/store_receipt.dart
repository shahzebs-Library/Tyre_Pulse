/// Goods received on the phone by a store keeper, against one open purchase
/// order line (`inv_store_receipt_*`, migration 20261126180000).
///
/// The phone only RECORDS the delivery. Every rule is the server's: the PO
/// must be approved or ordered, the site must be named in the keeper's own
/// list (never "all sites"), the quantity cannot exceed what is open, no price
/// is ever sent, and stock moves only when a different person approves.
library;

num? _num(Object? v) => v is num ? v : num.tryParse(v?.toString() ?? '');
String? _str(Object? v) {
  final String s = v?.toString().trim() ?? '';
  return s.isEmpty ? null : s;
}

/// One open purchase order line the keeper may receive for.
final class OpenPoLine {
  const OpenPoLine({
    required this.poLineId,
    required this.poNumber,
    required this.qtyOrdered,
    required this.qtyOpen,
    this.poId,
    this.supplier,
    this.site,
    this.lineNo,
    this.itemCode,
    this.itemName,
    this.uom,
    this.qtyAccepted = 0,
    this.locationId,
  });

  factory OpenPoLine.fromJson(Map<String, dynamic> j) => OpenPoLine(
        poLineId: j['po_line_id']?.toString() ?? '',
        poId: _str(j['po_id']),
        poNumber: _str(j['po_number']) ?? '-',
        supplier: _str(j['supplier']),
        site: _str(j['site']),
        lineNo: _num(j['line_no'])?.toInt(),
        itemCode: _str(j['item_code']),
        itemName: _str(j['item_name']),
        uom: _str(j['uom']),
        qtyOrdered: _num(j['qty_ordered']) ?? 0,
        qtyAccepted: _num(j['qty_accepted']) ?? 0,
        qtyOpen: _num(j['qty_open']) ?? 0,
        locationId: _str(j['location_id']),
      );

  final String poLineId;
  final String? poId;
  final String poNumber;
  final String? supplier;
  final String? site;
  final int? lineNo;
  final String? itemCode;
  final String? itemName;
  final String? uom;
  final num qtyOrdered;
  final num qtyAccepted;
  final num qtyOpen;
  final String? locationId;

  String get itemLabel => <String>[
        if (itemCode != null) itemCode!,
        if (itemName != null) itemName!,
      ].join(' ');
}

/// A receiving location at one of the keeper's named sites.
final class ReceivingLocation {
  const ReceivingLocation({
    required this.id,
    required this.code,
    this.name,
    this.site,
  });

  factory ReceivingLocation.fromJson(Map<String, dynamic> j) =>
      ReceivingLocation(
        id: j['id']?.toString() ?? '',
        code: _str(j['code']) ?? '-',
        name: _str(j['name']),
        site: _str(j['site']),
      );

  final String id;
  final String code;
  final String? name;
  final String? site;

  String get label => name == null ? code : '$code · $name';
}

/// A receipt this keeper recorded, with its decision.
final class MyStoreReceipt {
  const MyStoreReceipt({
    required this.id,
    required this.status,
    this.poNumber,
    this.itemCode,
    this.itemName,
    this.qtyReceived = 0,
    this.qtyRejected = 0,
    this.site,
    this.decisionNote,
  });

  factory MyStoreReceipt.fromJson(Map<String, dynamic> j) => MyStoreReceipt(
        id: j['id']?.toString() ?? '',
        status: _str(j['status']) ?? 'pending',
        poNumber: _str(j['po_number']),
        itemCode: _str(j['item_code']),
        itemName: _str(j['item_name']),
        qtyReceived: _num(j['qty_received']) ?? 0,
        qtyRejected: _num(j['qty_rejected']) ?? 0,
        site: _str(j['site']),
        decisionNote: _str(j['decision_note']),
      );

  final String id;
  final String status;
  final String? poNumber;
  final String? itemCode;
  final String? itemName;
  final num qtyReceived;
  final num qtyRejected;
  final String? site;
  final String? decisionNote;

  bool get isPending => status == 'pending';
}

/// What `inv_store_receipt_open_lines` returns.
final class StoreReceiptBoard {
  const StoreReceiptBoard({
    this.lines = const <OpenPoLine>[],
    this.locations = const <ReceivingLocation>[],
    this.mine = const <MyStoreReceipt>[],
  });

  factory StoreReceiptBoard.fromJson(Object? value) {
    final Map<String, dynamic> m =
        value is Map ? Map<String, dynamic>.from(value) : <String, dynamic>{};
    List<T> list<T>(String key, T Function(Map<String, dynamic>) f) => <T>[
          if (m[key] is List)
            for (final Object? row in m[key] as List)
              if (row is Map) f(Map<String, dynamic>.from(row)),
        ];
    return StoreReceiptBoard(
      lines: list('lines', OpenPoLine.fromJson)
          .where((OpenPoLine l) => l.poLineId.isNotEmpty)
          .toList(growable: false),
      locations: list('locations', ReceivingLocation.fromJson)
          .where((ReceivingLocation l) => l.id.isNotEmpty)
          .toList(growable: false),
      mine: list('mine', MyStoreReceipt.fromJson),
    );
  }

  final List<OpenPoLine> lines;
  final List<ReceivingLocation> locations;
  final List<MyStoreReceipt> mine;

  /// Locations at [line]'s site, the line's own location first.
  List<ReceivingLocation> locationsFor(OpenPoLine line) {
    final List<ReceivingLocation> at = <ReceivingLocation>[
      for (final ReceivingLocation l in locations)
        if (line.site == null || l.site == line.site) l,
    ];
    at.sort((ReceivingLocation a, ReceivingLocation b) {
      if (a.id == line.locationId) return -1;
      if (b.id == line.locationId) return 1;
      return a.code.compareTo(b.code);
    });
    return at;
  }
}

/// The form the keeper fills for one line. No price field exists on purpose.
final class StoreReceiptDraft {
  const StoreReceiptDraft({
    required this.line,
    required this.qtyReceived,
    this.qtyRejected = 0,
    this.locationId,
    this.rejectionReason = '',
    this.deliveryNoteNo = '',
    this.notes = '',
    this.deliveryNotePath,
  });

  final OpenPoLine line;
  final num? qtyReceived;
  final num? qtyRejected;
  final String? locationId;
  final String rejectionReason;
  final String deliveryNoteNo;
  final String notes;

  /// Storage path of an uploaded delivery-note photo, if any.
  final String? deliveryNotePath;

  num get accepted => (qtyReceived ?? 0) - (qtyRejected ?? 0);

  /// A copy key for the first problem, or null when it can be sent. The
  /// server repeats every check; this only saves a round trip.
  String? validate() {
    final num? q = qtyReceived;
    if (q == null) return 'sr_qtyRequired';
    if (q <= 0) return 'sr_qtyPositive';
    if (q > 100000) return 'sr_qtyTooLarge';
    final num r = qtyRejected ?? -1;
    if (r < 0 || r > q) return 'sr_rejectedRange';
    if (r > 0 && rejectionReason.trim().isEmpty) return 'sr_reasonRequired';
    if (accepted > line.qtyOpen) return 'sr_overOpen';
    if ((locationId ?? '').isEmpty) return 'sr_locationRequired';
    if (deliveryNoteNo.trim().length > 120) return 'sr_noteTooLong';
    return null;
  }

  /// Identity of the request, for "same request -> same key" retries.
  String get signature => <Object?>[
        line.poLineId,
        qtyReceived,
        qtyRejected,
        locationId,
        rejectionReason.trim(),
        deliveryNoteNo.trim(),
        notes.trim(),
        deliveryNotePath,
      ].join('|');

  Map<String, Object?> toPayload(String clientUuid) => <String, Object?>{
        'client_uuid': clientUuid,
        'po_line_id': line.poLineId,
        'location_id': locationId,
        'qty_received': qtyReceived,
        'qty_rejected': qtyRejected ?? 0,
        if (rejectionReason.trim().isNotEmpty)
          'rejection_reason': rejectionReason.trim(),
        if (deliveryNoteNo.trim().isNotEmpty)
          'delivery_note_no': deliveryNoteNo.trim(),
        if (notes.trim().isNotEmpty) 'notes': notes.trim(),
        if (deliveryNotePath != null) 'delivery_note_path': deliveryNotePath,
      };
}

/// Where a delivery-note photo is stored (the server checks the prefix).
String storeReceiptPhotoPath(String orgId, String clientUuid) =>
    'store_receipts/$orgId/$clientUuid.jpg';

num? parseReceiptQty(String text) {
  final String t = text.trim().replaceAll(',', '.');
  if (t.isEmpty) return null;
  return num.tryParse(t);
}
