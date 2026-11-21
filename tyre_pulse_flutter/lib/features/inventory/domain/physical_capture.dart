/// Physical inventory capture (discovery) - pure model and rules.
///
/// Mirrors the draft server contract in
/// `supabase/pending_migrations/20261122100000_inv_physical_inventory_master.sql`
/// (`inv_pi_capture`, `inv_pi_photo_attach`). A capture is EVIDENCE of what
/// was found on a shelf: it never changes official stock. It is idempotent on
/// [PendingCapture.clientUuid], so an offline phone can replay it any number
/// of times and the server stores it once.
library;

const List<String> piConditions = <String>[
  'new',
  'used',
  'refurbished',
  'repairable',
  'damaged',
  'scrap',
  'unknown',
];
const List<String> piOwnerships = <String>[
  'owned',
  'consignment',
  'supplier',
  'customer',
  'unknown',
];
const List<String> piPhotoRoles = <String>[
  'item',
  'label',
  'location',
  'packaging',
  'damage',
  'other',
];

/// Same rule as SQL `material_ref_norm()`: upper case, letters and digits.
String? normRef(String? value) {
  final String s =
      (value ?? '').replaceAll(RegExp('[^A-Za-z0-9]'), '').toUpperCase();
  return s.isEmpty ? null : s;
}

/// Parses a typed quantity ("2", "2.5", "2,5"). Null when it is not a
/// number of zero or more. Zero is a real count.
double? parseQty(String text) {
  final double? v = double.tryParse(text.trim().replaceAll(',', '.'));
  if (v == null || v.isNaN || v.isInfinite || v < 0) return null;
  return v;
}

/// What kind of capture this is, from what the person entered.
String captureKindFor({
  required String? canonicalId,
  required Map<String, String> refs,
}) {
  if (canonicalId != null && canonicalId.isNotEmpty) return 'identified';
  for (final String k in <String>[
    'description',
    'oem',
    'aftermarket',
    'company_sku',
  ]) {
    if ((refs[k] ?? '').trim().isNotEmpty) return 'proposed_new';
  }
  return 'unidentified';
}

/// One photo waiting to reach the server.
final class PendingPhoto {
  const PendingPhoto({
    required this.clientUuid,
    required this.localPath,
    required this.role,
    this.storagePath,
    this.attached = false,
    this.lost = false,
  });

  factory PendingPhoto.fromJson(Map<String, Object?> j) => PendingPhoto(
        clientUuid: '${j['client_uuid'] ?? ''}',
        localPath: '${j['local_path'] ?? ''}',
        role: '${j['role'] ?? 'item'}',
        storagePath: j['storage_path'] as String?,
        attached: j['attached'] == true,
        lost: j['lost'] == true,
      );

  final String clientUuid;
  final String localPath;
  final String role;

  /// Set once the bytes are in storage (upload is skipped on a retry).
  final String? storagePath;

  /// True once `inv_pi_photo_attach` confirmed the link.
  final bool attached;

  /// True when the local file no longer exists (cleared by the OS). It is
  /// NOT attached: the capture stays in the outbox, flagged, until the person
  /// acknowledges the loss ([PhysicalCaptureOutbox.dismiss]).
  final bool lost;

  PendingPhoto copyWith({String? storagePath, bool? attached, bool? lost}) =>
      PendingPhoto(
        clientUuid: clientUuid,
        localPath: localPath,
        role: role,
        storagePath: storagePath ?? this.storagePath,
        attached: attached ?? this.attached,
        lost: lost ?? this.lost,
      );

  Map<String, Object?> toJson() => <String, Object?>{
        'client_uuid': clientUuid,
        'local_path': localPath,
        'role': role,
        'storage_path': storagePath,
        'attached': attached,
        'lost': lost,
      };
}

/// One capture waiting to reach the server (or waiting for its photos).
final class PendingCapture {
  const PendingCapture({
    required this.clientUuid,
    required this.userId,
    required this.sessionId,
    required this.kind,
    required this.quantity,
    required this.capturedAt,
    this.canonicalId,
    this.variantId,
    this.label,
    this.refs = const <String, String>{},
    this.scannedCode,
    this.uom,
    this.condition = 'unknown',
    this.ownership = 'owned',
    this.locationId,
    this.locationHint,
    this.remarks,
    this.photos = const <PendingPhoto>[],
    this.serverId,
    this.tempRef,
    this.lastError,
  });

  factory PendingCapture.fromJson(Map<String, Object?> j) => PendingCapture(
        clientUuid: '${j['client_uuid'] ?? ''}',
        userId: '${j['user_id'] ?? ''}',
        sessionId: '${j['session_id'] ?? ''}',
        kind: '${j['kind'] ?? 'unidentified'}',
        quantity: (j['quantity'] as num?)?.toDouble() ?? 0,
        capturedAt: DateTime.tryParse('${j['captured_at']}') ?? DateTime.now(),
        canonicalId: j['canonical_id'] as String?,
        variantId: j['variant_id'] as String?,
        label: j['label'] as String?,
        refs: <String, String>{
          for (final MapEntry<Object?, Object?> e
              in ((j['refs'] as Map?) ?? const <Object?, Object?>{}).entries)
            '${e.key}': '${e.value}',
        },
        scannedCode: j['scanned_code'] as String?,
        uom: j['uom'] as String?,
        condition: '${j['condition'] ?? 'unknown'}',
        ownership: '${j['ownership'] ?? 'owned'}',
        locationId: j['location_id'] as String?,
        locationHint: j['location_hint'] as String?,
        remarks: j['remarks'] as String?,
        photos: <PendingPhoto>[
          for (final Object? p in (j['photos'] as List?) ?? const <Object?>[])
            if (p is Map) PendingPhoto.fromJson(Map<String, Object?>.from(p)),
        ],
        serverId: j['server_id'] as String?,
        tempRef: j['temp_ref'] as String?,
        lastError: j['last_error'] as String?,
      );

  final String clientUuid;
  final String userId;
  final String sessionId;
  final String kind;
  final double quantity;
  final DateTime capturedAt;
  final String? canonicalId;
  final String? variantId;
  final String? label;
  final Map<String, String> refs;
  final String? scannedCode;
  final String? uom;
  final String condition;
  final String ownership;
  final String? locationId;
  final String? locationHint;
  final String? remarks;
  final List<PendingPhoto> photos;

  /// Set once the server accepted the capture.
  final String? serverId;
  final String? tempRef;

  /// The last refusal the server gave (kept, never silently dropped).
  final String? lastError;

  bool get captureSent => serverId != null;
  bool get done => captureSent && photos.every((PendingPhoto p) => p.attached);

  PendingCapture copyWith({
    String? serverId,
    String? tempRef,
    List<PendingPhoto>? photos,
    String? lastError,
    bool clearError = false,
  }) =>
      PendingCapture(
        clientUuid: clientUuid,
        userId: userId,
        sessionId: sessionId,
        kind: kind,
        quantity: quantity,
        capturedAt: capturedAt,
        canonicalId: canonicalId,
        variantId: variantId,
        label: label,
        refs: refs,
        scannedCode: scannedCode,
        uom: uom,
        condition: condition,
        ownership: ownership,
        locationId: locationId,
        locationHint: locationHint,
        remarks: remarks,
        photos: photos ?? this.photos,
        serverId: serverId ?? this.serverId,
        tempRef: tempRef ?? this.tempRef,
        lastError: clearError ? null : (lastError ?? this.lastError),
      );

  /// The `inv_pi_capture` payload. Idempotent on client_uuid.
  Map<String, Object?> toPayload({String? deviceId}) => <String, Object?>{
        'idempotency_key': clientUuid,
        'session_id': sessionId,
        'client_uuid': clientUuid,
        'kind': kind,
        'canonical_id': canonicalId,
        'variant_id': variantId,
        'refs': refs,
        'scanned_code': scannedCode,
        'quantity': quantity,
        'uom': uom,
        'condition': piConditions.contains(condition) ? condition : 'unknown',
        'ownership': piOwnerships.contains(ownership) ? ownership : 'owned',
        'location_id': locationId,
        'location_hint': locationHint,
        'remarks': remarks,
        'device_id': deviceId,
        'captured_at': capturedAt.toUtc().toIso8601String(),
      };

  Map<String, Object?> toJson() => <String, Object?>{
        'client_uuid': clientUuid,
        'user_id': userId,
        'session_id': sessionId,
        'kind': kind,
        'quantity': quantity,
        'captured_at': capturedAt.toIso8601String(),
        'canonical_id': canonicalId,
        'variant_id': variantId,
        'label': label,
        'refs': refs,
        'scanned_code': scannedCode,
        'uom': uom,
        'condition': condition,
        'ownership': ownership,
        'location_id': locationId,
        'location_hint': locationHint,
        'remarks': remarks,
        'photos': <Object?>[for (final PendingPhoto p in photos) p.toJson()],
        'server_id': serverId,
        'temp_ref': tempRef,
        'last_error': lastError,
      };
}

/// Storage path of a photo: always inside the company folder the server
/// accepts (`physical_inventory/<org>/...`).
String piPhotoPath(String orgId, String sessionId, String clientUuid) =>
    'physical_inventory/$orgId/$sessionId/$clientUuid.jpg';

/// A physical inventory session (store visit).
final class PhysicalSession {
  const PhysicalSession({
    required this.id,
    required this.reference,
    required this.site,
    required this.status,
    this.country,
    this.locationId,
    this.startedAt,
  });

  factory PhysicalSession.fromJson(Map<String, Object?> j) => PhysicalSession(
        id: '${j['id'] ?? ''}',
        reference: '${j['reference'] ?? ''}',
        site: '${j['site'] ?? ''}',
        status: '${j['status'] ?? 'open'}',
        country: j['country'] as String?,
        locationId: j['location_id'] as String?,
        startedAt: DateTime.tryParse('${j['started_at']}'),
      );

  final String id;
  final String reference;
  final String site;
  final String status;
  final String? country;
  final String? locationId;
  final DateTime? startedAt;

  bool get isOpen => status == 'open';
}

/// One search hit the person can pick (a material, optionally a variant).
final class MaterialPick {
  const MaterialPick({
    required this.canonicalId,
    required this.label,
    this.variantId,
    this.classification,
  });

  final String canonicalId;
  final String? variantId;
  final String label;

  /// genuine / oes / aftermarket / unknown (null for the material itself).
  final String? classification;

  /// Flattens `inv_material_search` results; genuine first, aftermarket after.
  static List<MaterialPick> fromSearch(Object? data) {
    final List<MaterialPick> out = <MaterialPick>[];
    final Object? results = data is Map ? data['results'] : null;
    if (results is! List) return out;
    const List<String> order = <String>[
      'genuine',
      'oes',
      'aftermarket',
      'unknown',
    ];
    for (final Object? r in results) {
      if (r is! Map || r['status'] != 'active') continue;
      final String id = '${r['canonical_id']}';
      final String desc = '${r['description'] ?? ''}';
      final List<Map<Object?, Object?>> variants = <Map<Object?, Object?>>[
        for (final Object? v in (r['variants'] as List?) ?? const <Object?>[])
          if (v is Map && v['status'] == 'active') v,
      ]..sort(
          (Map<Object?, Object?> a, Map<Object?, Object?> b) =>
              order.indexOf('${a['classification']}').compareTo(
                    order.indexOf('${b['classification']}'),
                  ),
        );
      for (final Map<Object?, Object?> v in variants) {
        out.add(
          MaterialPick(
            canonicalId: id,
            variantId: '${v['variant_id']}',
            classification: '${v['classification'] ?? 'unknown'}',
            label:
                '$desc / ${v['manufacturer'] ?? ''} ${v['part_number'] ?? ''}'
                    .trim(),
          ),
        );
      }
      out.add(MaterialPick(canonicalId: id, label: desc));
    }
    return out;
  }
}
