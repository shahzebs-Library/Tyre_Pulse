// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'app_database.dart';

// ignore_for_file: type=lint
class $WorkspaceScopesTable extends WorkspaceScopes
    with TableInfo<$WorkspaceScopesTable, WorkspaceScopeRow> {
  @override
  final GeneratedDatabase attachedDatabase;
  final String? _alias;
  $WorkspaceScopesTable(this.attachedDatabase, [this._alias]);
  static const VerificationMeta _workspaceIdMeta =
      const VerificationMeta('workspaceId');
  @override
  late final GeneratedColumn<String> workspaceId = GeneratedColumn<String>(
      'workspace_id', aliasedName, false,
      type: DriftSqlType.string, requiredDuringInsert: true);
  static const VerificationMeta _tenantIdMeta =
      const VerificationMeta('tenantId');
  @override
  late final GeneratedColumn<String> tenantId = GeneratedColumn<String>(
      'tenant_id', aliasedName, true,
      type: DriftSqlType.string, requiredDuringInsert: false);
  static const VerificationMeta _companyNameMeta =
      const VerificationMeta('companyName');
  @override
  late final GeneratedColumn<String> companyName = GeneratedColumn<String>(
      'company_name', aliasedName, true,
      type: DriftSqlType.string, requiredDuringInsert: false);
  static const VerificationMeta _countryMeta =
      const VerificationMeta('country');
  @override
  late final GeneratedColumn<String> country = GeneratedColumn<String>(
      'country', aliasedName, true,
      type: DriftSqlType.string, requiredDuringInsert: false);
  static const VerificationMeta _currencyMeta =
      const VerificationMeta('currency');
  @override
  late final GeneratedColumn<String> currency = GeneratedColumn<String>(
      'currency', aliasedName, true,
      type: DriftSqlType.string, requiredDuringInsert: false);
  static const VerificationMeta _siteIdsJsonMeta =
      const VerificationMeta('siteIdsJson');
  @override
  late final GeneratedColumn<String> siteIdsJson = GeneratedColumn<String>(
      'site_ids_json', aliasedName, false,
      type: DriftSqlType.string, requiredDuringInsert: true);
  static const VerificationMeta _userIdMeta = const VerificationMeta('userId');
  @override
  late final GeneratedColumn<String> userId = GeneratedColumn<String>(
      'user_id', aliasedName, false,
      type: DriftSqlType.string, requiredDuringInsert: true);
  static const VerificationMeta _roleMeta = const VerificationMeta('role');
  @override
  late final GeneratedColumn<String> role = GeneratedColumn<String>(
      'role', aliasedName, false,
      type: DriftSqlType.string, requiredDuringInsert: true);
  static const VerificationMeta _isSuperAdminMeta =
      const VerificationMeta('isSuperAdmin');
  @override
  late final GeneratedColumn<bool> isSuperAdmin = GeneratedColumn<bool>(
      'is_super_admin', aliasedName, false,
      type: DriftSqlType.bool,
      requiredDuringInsert: false,
      defaultConstraints: GeneratedColumn.constraintIsAlways(
          'CHECK ("is_super_admin" IN (0, 1))'),
      defaultValue: const Constant(false));
  static const VerificationMeta _isActiveMeta =
      const VerificationMeta('isActive');
  @override
  late final GeneratedColumn<bool> isActive = GeneratedColumn<bool>(
      'is_active', aliasedName, false,
      type: DriftSqlType.bool,
      requiredDuringInsert: false,
      defaultConstraints:
          GeneratedColumn.constraintIsAlways('CHECK ("is_active" IN (0, 1))'),
      defaultValue: const Constant(false));
  static const VerificationMeta _lastVerifiedAtMeta =
      const VerificationMeta('lastVerifiedAt');
  @override
  late final GeneratedColumn<DateTime> lastVerifiedAt =
      GeneratedColumn<DateTime>('last_verified_at', aliasedName, false,
          type: DriftSqlType.dateTime, requiredDuringInsert: true);
  @override
  List<GeneratedColumn> get $columns => [
        workspaceId,
        tenantId,
        companyName,
        country,
        currency,
        siteIdsJson,
        userId,
        role,
        isSuperAdmin,
        isActive,
        lastVerifiedAt
      ];
  @override
  String get aliasedName => _alias ?? actualTableName;
  @override
  String get actualTableName => $name;
  static const String $name = 'workspace_scope';
  @override
  VerificationContext validateIntegrity(Insertable<WorkspaceScopeRow> instance,
      {bool isInserting = false}) {
    final context = VerificationContext();
    final data = instance.toColumns(true);
    if (data.containsKey('workspace_id')) {
      context.handle(
          _workspaceIdMeta,
          workspaceId.isAcceptableOrUnknown(
              data['workspace_id']!, _workspaceIdMeta));
    } else if (isInserting) {
      context.missing(_workspaceIdMeta);
    }
    if (data.containsKey('tenant_id')) {
      context.handle(_tenantIdMeta,
          tenantId.isAcceptableOrUnknown(data['tenant_id']!, _tenantIdMeta));
    }
    if (data.containsKey('company_name')) {
      context.handle(
          _companyNameMeta,
          companyName.isAcceptableOrUnknown(
              data['company_name']!, _companyNameMeta));
    }
    if (data.containsKey('country')) {
      context.handle(_countryMeta,
          country.isAcceptableOrUnknown(data['country']!, _countryMeta));
    }
    if (data.containsKey('currency')) {
      context.handle(_currencyMeta,
          currency.isAcceptableOrUnknown(data['currency']!, _currencyMeta));
    }
    if (data.containsKey('site_ids_json')) {
      context.handle(
          _siteIdsJsonMeta,
          siteIdsJson.isAcceptableOrUnknown(
              data['site_ids_json']!, _siteIdsJsonMeta));
    } else if (isInserting) {
      context.missing(_siteIdsJsonMeta);
    }
    if (data.containsKey('user_id')) {
      context.handle(_userIdMeta,
          userId.isAcceptableOrUnknown(data['user_id']!, _userIdMeta));
    } else if (isInserting) {
      context.missing(_userIdMeta);
    }
    if (data.containsKey('role')) {
      context.handle(
          _roleMeta, role.isAcceptableOrUnknown(data['role']!, _roleMeta));
    } else if (isInserting) {
      context.missing(_roleMeta);
    }
    if (data.containsKey('is_super_admin')) {
      context.handle(
          _isSuperAdminMeta,
          isSuperAdmin.isAcceptableOrUnknown(
              data['is_super_admin']!, _isSuperAdminMeta));
    }
    if (data.containsKey('is_active')) {
      context.handle(_isActiveMeta,
          isActive.isAcceptableOrUnknown(data['is_active']!, _isActiveMeta));
    }
    if (data.containsKey('last_verified_at')) {
      context.handle(
          _lastVerifiedAtMeta,
          lastVerifiedAt.isAcceptableOrUnknown(
              data['last_verified_at']!, _lastVerifiedAtMeta));
    } else if (isInserting) {
      context.missing(_lastVerifiedAtMeta);
    }
    return context;
  }

  @override
  Set<GeneratedColumn> get $primaryKey => {workspaceId};
  @override
  WorkspaceScopeRow map(Map<String, dynamic> data, {String? tablePrefix}) {
    final effectivePrefix = tablePrefix != null ? '$tablePrefix.' : '';
    return WorkspaceScopeRow(
      workspaceId: attachedDatabase.typeMapping
          .read(DriftSqlType.string, data['${effectivePrefix}workspace_id'])!,
      tenantId: attachedDatabase.typeMapping
          .read(DriftSqlType.string, data['${effectivePrefix}tenant_id']),
      companyName: attachedDatabase.typeMapping
          .read(DriftSqlType.string, data['${effectivePrefix}company_name']),
      country: attachedDatabase.typeMapping
          .read(DriftSqlType.string, data['${effectivePrefix}country']),
      currency: attachedDatabase.typeMapping
          .read(DriftSqlType.string, data['${effectivePrefix}currency']),
      siteIdsJson: attachedDatabase.typeMapping
          .read(DriftSqlType.string, data['${effectivePrefix}site_ids_json'])!,
      userId: attachedDatabase.typeMapping
          .read(DriftSqlType.string, data['${effectivePrefix}user_id'])!,
      role: attachedDatabase.typeMapping
          .read(DriftSqlType.string, data['${effectivePrefix}role'])!,
      isSuperAdmin: attachedDatabase.typeMapping
          .read(DriftSqlType.bool, data['${effectivePrefix}is_super_admin'])!,
      isActive: attachedDatabase.typeMapping
          .read(DriftSqlType.bool, data['${effectivePrefix}is_active'])!,
      lastVerifiedAt: attachedDatabase.typeMapping.read(
          DriftSqlType.dateTime, data['${effectivePrefix}last_verified_at'])!,
    );
  }

  @override
  $WorkspaceScopesTable createAlias(String alias) {
    return $WorkspaceScopesTable(attachedDatabase, alias);
  }
}

class WorkspaceScopeRow extends DataClass
    implements Insertable<WorkspaceScopeRow> {
  /// `organisation_id`. The tenant boundary every cached row is filtered by.
  final String workspaceId;

  /// Spec section 8. UNVERIFIED whether the server exposes a tenant above
  /// organisation, so this is nullable and nothing depends on it yet.
  final String? tenantId;
  final String? companyName;

  /// The active country. Null means every country this user may see, which is
  /// a real state and not a missing value.
  final String? country;
  final String? currency;

  /// JSON array. The `profiles.sites` scope array; the sentinel `ALL` means
  /// org-wide. Stored as received - an empty array and the sentinel mean
  /// opposite things and a mapper that coalesces one to the other is how a
  /// user loses every site or gains all of them.
  final String siteIdsJson;
  final String userId;

  /// `profiles.role`, in the Title Case the server stores. Not normalised: the
  /// server compares this value literally.
  final String role;
  final bool isSuperAdmin;

  /// Exactly one row is true. The app asks "which workspace am I in" on every
  /// navigation build, which is why this column is indexed.
  final bool isActive;

  /// When the server last confirmed this context.
  final DateTime lastVerifiedAt;
  const WorkspaceScopeRow(
      {required this.workspaceId,
      this.tenantId,
      this.companyName,
      this.country,
      this.currency,
      required this.siteIdsJson,
      required this.userId,
      required this.role,
      required this.isSuperAdmin,
      required this.isActive,
      required this.lastVerifiedAt});
  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    map['workspace_id'] = Variable<String>(workspaceId);
    if (!nullToAbsent || tenantId != null) {
      map['tenant_id'] = Variable<String>(tenantId);
    }
    if (!nullToAbsent || companyName != null) {
      map['company_name'] = Variable<String>(companyName);
    }
    if (!nullToAbsent || country != null) {
      map['country'] = Variable<String>(country);
    }
    if (!nullToAbsent || currency != null) {
      map['currency'] = Variable<String>(currency);
    }
    map['site_ids_json'] = Variable<String>(siteIdsJson);
    map['user_id'] = Variable<String>(userId);
    map['role'] = Variable<String>(role);
    map['is_super_admin'] = Variable<bool>(isSuperAdmin);
    map['is_active'] = Variable<bool>(isActive);
    map['last_verified_at'] = Variable<DateTime>(lastVerifiedAt);
    return map;
  }

  WorkspaceScopesCompanion toCompanion(bool nullToAbsent) {
    return WorkspaceScopesCompanion(
      workspaceId: Value(workspaceId),
      tenantId: tenantId == null && nullToAbsent
          ? const Value.absent()
          : Value(tenantId),
      companyName: companyName == null && nullToAbsent
          ? const Value.absent()
          : Value(companyName),
      country: country == null && nullToAbsent
          ? const Value.absent()
          : Value(country),
      currency: currency == null && nullToAbsent
          ? const Value.absent()
          : Value(currency),
      siteIdsJson: Value(siteIdsJson),
      userId: Value(userId),
      role: Value(role),
      isSuperAdmin: Value(isSuperAdmin),
      isActive: Value(isActive),
      lastVerifiedAt: Value(lastVerifiedAt),
    );
  }

  factory WorkspaceScopeRow.fromJson(Map<String, dynamic> json,
      {ValueSerializer? serializer}) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return WorkspaceScopeRow(
      workspaceId: serializer.fromJson<String>(json['workspaceId']),
      tenantId: serializer.fromJson<String?>(json['tenantId']),
      companyName: serializer.fromJson<String?>(json['companyName']),
      country: serializer.fromJson<String?>(json['country']),
      currency: serializer.fromJson<String?>(json['currency']),
      siteIdsJson: serializer.fromJson<String>(json['siteIdsJson']),
      userId: serializer.fromJson<String>(json['userId']),
      role: serializer.fromJson<String>(json['role']),
      isSuperAdmin: serializer.fromJson<bool>(json['isSuperAdmin']),
      isActive: serializer.fromJson<bool>(json['isActive']),
      lastVerifiedAt: serializer.fromJson<DateTime>(json['lastVerifiedAt']),
    );
  }
  @override
  Map<String, dynamic> toJson({ValueSerializer? serializer}) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return <String, dynamic>{
      'workspaceId': serializer.toJson<String>(workspaceId),
      'tenantId': serializer.toJson<String?>(tenantId),
      'companyName': serializer.toJson<String?>(companyName),
      'country': serializer.toJson<String?>(country),
      'currency': serializer.toJson<String?>(currency),
      'siteIdsJson': serializer.toJson<String>(siteIdsJson),
      'userId': serializer.toJson<String>(userId),
      'role': serializer.toJson<String>(role),
      'isSuperAdmin': serializer.toJson<bool>(isSuperAdmin),
      'isActive': serializer.toJson<bool>(isActive),
      'lastVerifiedAt': serializer.toJson<DateTime>(lastVerifiedAt),
    };
  }

  WorkspaceScopeRow copyWith(
          {String? workspaceId,
          Value<String?> tenantId = const Value.absent(),
          Value<String?> companyName = const Value.absent(),
          Value<String?> country = const Value.absent(),
          Value<String?> currency = const Value.absent(),
          String? siteIdsJson,
          String? userId,
          String? role,
          bool? isSuperAdmin,
          bool? isActive,
          DateTime? lastVerifiedAt}) =>
      WorkspaceScopeRow(
        workspaceId: workspaceId ?? this.workspaceId,
        tenantId: tenantId.present ? tenantId.value : this.tenantId,
        companyName: companyName.present ? companyName.value : this.companyName,
        country: country.present ? country.value : this.country,
        currency: currency.present ? currency.value : this.currency,
        siteIdsJson: siteIdsJson ?? this.siteIdsJson,
        userId: userId ?? this.userId,
        role: role ?? this.role,
        isSuperAdmin: isSuperAdmin ?? this.isSuperAdmin,
        isActive: isActive ?? this.isActive,
        lastVerifiedAt: lastVerifiedAt ?? this.lastVerifiedAt,
      );
  WorkspaceScopeRow copyWithCompanion(WorkspaceScopesCompanion data) {
    return WorkspaceScopeRow(
      workspaceId:
          data.workspaceId.present ? data.workspaceId.value : this.workspaceId,
      tenantId: data.tenantId.present ? data.tenantId.value : this.tenantId,
      companyName:
          data.companyName.present ? data.companyName.value : this.companyName,
      country: data.country.present ? data.country.value : this.country,
      currency: data.currency.present ? data.currency.value : this.currency,
      siteIdsJson:
          data.siteIdsJson.present ? data.siteIdsJson.value : this.siteIdsJson,
      userId: data.userId.present ? data.userId.value : this.userId,
      role: data.role.present ? data.role.value : this.role,
      isSuperAdmin: data.isSuperAdmin.present
          ? data.isSuperAdmin.value
          : this.isSuperAdmin,
      isActive: data.isActive.present ? data.isActive.value : this.isActive,
      lastVerifiedAt: data.lastVerifiedAt.present
          ? data.lastVerifiedAt.value
          : this.lastVerifiedAt,
    );
  }

  @override
  String toString() {
    return (StringBuffer('WorkspaceScopeRow(')
          ..write('workspaceId: $workspaceId, ')
          ..write('tenantId: $tenantId, ')
          ..write('companyName: $companyName, ')
          ..write('country: $country, ')
          ..write('currency: $currency, ')
          ..write('siteIdsJson: $siteIdsJson, ')
          ..write('userId: $userId, ')
          ..write('role: $role, ')
          ..write('isSuperAdmin: $isSuperAdmin, ')
          ..write('isActive: $isActive, ')
          ..write('lastVerifiedAt: $lastVerifiedAt')
          ..write(')'))
        .toString();
  }

  @override
  int get hashCode => Object.hash(
      workspaceId,
      tenantId,
      companyName,
      country,
      currency,
      siteIdsJson,
      userId,
      role,
      isSuperAdmin,
      isActive,
      lastVerifiedAt);
  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      (other is WorkspaceScopeRow &&
          other.workspaceId == this.workspaceId &&
          other.tenantId == this.tenantId &&
          other.companyName == this.companyName &&
          other.country == this.country &&
          other.currency == this.currency &&
          other.siteIdsJson == this.siteIdsJson &&
          other.userId == this.userId &&
          other.role == this.role &&
          other.isSuperAdmin == this.isSuperAdmin &&
          other.isActive == this.isActive &&
          other.lastVerifiedAt == this.lastVerifiedAt);
}

class WorkspaceScopesCompanion extends UpdateCompanion<WorkspaceScopeRow> {
  final Value<String> workspaceId;
  final Value<String?> tenantId;
  final Value<String?> companyName;
  final Value<String?> country;
  final Value<String?> currency;
  final Value<String> siteIdsJson;
  final Value<String> userId;
  final Value<String> role;
  final Value<bool> isSuperAdmin;
  final Value<bool> isActive;
  final Value<DateTime> lastVerifiedAt;
  final Value<int> rowid;
  const WorkspaceScopesCompanion({
    this.workspaceId = const Value.absent(),
    this.tenantId = const Value.absent(),
    this.companyName = const Value.absent(),
    this.country = const Value.absent(),
    this.currency = const Value.absent(),
    this.siteIdsJson = const Value.absent(),
    this.userId = const Value.absent(),
    this.role = const Value.absent(),
    this.isSuperAdmin = const Value.absent(),
    this.isActive = const Value.absent(),
    this.lastVerifiedAt = const Value.absent(),
    this.rowid = const Value.absent(),
  });
  WorkspaceScopesCompanion.insert({
    required String workspaceId,
    this.tenantId = const Value.absent(),
    this.companyName = const Value.absent(),
    this.country = const Value.absent(),
    this.currency = const Value.absent(),
    required String siteIdsJson,
    required String userId,
    required String role,
    this.isSuperAdmin = const Value.absent(),
    this.isActive = const Value.absent(),
    required DateTime lastVerifiedAt,
    this.rowid = const Value.absent(),
  })  : workspaceId = Value(workspaceId),
        siteIdsJson = Value(siteIdsJson),
        userId = Value(userId),
        role = Value(role),
        lastVerifiedAt = Value(lastVerifiedAt);
  static Insertable<WorkspaceScopeRow> custom({
    Expression<String>? workspaceId,
    Expression<String>? tenantId,
    Expression<String>? companyName,
    Expression<String>? country,
    Expression<String>? currency,
    Expression<String>? siteIdsJson,
    Expression<String>? userId,
    Expression<String>? role,
    Expression<bool>? isSuperAdmin,
    Expression<bool>? isActive,
    Expression<DateTime>? lastVerifiedAt,
    Expression<int>? rowid,
  }) {
    return RawValuesInsertable({
      if (workspaceId != null) 'workspace_id': workspaceId,
      if (tenantId != null) 'tenant_id': tenantId,
      if (companyName != null) 'company_name': companyName,
      if (country != null) 'country': country,
      if (currency != null) 'currency': currency,
      if (siteIdsJson != null) 'site_ids_json': siteIdsJson,
      if (userId != null) 'user_id': userId,
      if (role != null) 'role': role,
      if (isSuperAdmin != null) 'is_super_admin': isSuperAdmin,
      if (isActive != null) 'is_active': isActive,
      if (lastVerifiedAt != null) 'last_verified_at': lastVerifiedAt,
      if (rowid != null) 'rowid': rowid,
    });
  }

  WorkspaceScopesCompanion copyWith(
      {Value<String>? workspaceId,
      Value<String?>? tenantId,
      Value<String?>? companyName,
      Value<String?>? country,
      Value<String?>? currency,
      Value<String>? siteIdsJson,
      Value<String>? userId,
      Value<String>? role,
      Value<bool>? isSuperAdmin,
      Value<bool>? isActive,
      Value<DateTime>? lastVerifiedAt,
      Value<int>? rowid}) {
    return WorkspaceScopesCompanion(
      workspaceId: workspaceId ?? this.workspaceId,
      tenantId: tenantId ?? this.tenantId,
      companyName: companyName ?? this.companyName,
      country: country ?? this.country,
      currency: currency ?? this.currency,
      siteIdsJson: siteIdsJson ?? this.siteIdsJson,
      userId: userId ?? this.userId,
      role: role ?? this.role,
      isSuperAdmin: isSuperAdmin ?? this.isSuperAdmin,
      isActive: isActive ?? this.isActive,
      lastVerifiedAt: lastVerifiedAt ?? this.lastVerifiedAt,
      rowid: rowid ?? this.rowid,
    );
  }

  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    if (workspaceId.present) {
      map['workspace_id'] = Variable<String>(workspaceId.value);
    }
    if (tenantId.present) {
      map['tenant_id'] = Variable<String>(tenantId.value);
    }
    if (companyName.present) {
      map['company_name'] = Variable<String>(companyName.value);
    }
    if (country.present) {
      map['country'] = Variable<String>(country.value);
    }
    if (currency.present) {
      map['currency'] = Variable<String>(currency.value);
    }
    if (siteIdsJson.present) {
      map['site_ids_json'] = Variable<String>(siteIdsJson.value);
    }
    if (userId.present) {
      map['user_id'] = Variable<String>(userId.value);
    }
    if (role.present) {
      map['role'] = Variable<String>(role.value);
    }
    if (isSuperAdmin.present) {
      map['is_super_admin'] = Variable<bool>(isSuperAdmin.value);
    }
    if (isActive.present) {
      map['is_active'] = Variable<bool>(isActive.value);
    }
    if (lastVerifiedAt.present) {
      map['last_verified_at'] = Variable<DateTime>(lastVerifiedAt.value);
    }
    if (rowid.present) {
      map['rowid'] = Variable<int>(rowid.value);
    }
    return map;
  }

  @override
  String toString() {
    return (StringBuffer('WorkspaceScopesCompanion(')
          ..write('workspaceId: $workspaceId, ')
          ..write('tenantId: $tenantId, ')
          ..write('companyName: $companyName, ')
          ..write('country: $country, ')
          ..write('currency: $currency, ')
          ..write('siteIdsJson: $siteIdsJson, ')
          ..write('userId: $userId, ')
          ..write('role: $role, ')
          ..write('isSuperAdmin: $isSuperAdmin, ')
          ..write('isActive: $isActive, ')
          ..write('lastVerifiedAt: $lastVerifiedAt, ')
          ..write('rowid: $rowid')
          ..write(')'))
        .toString();
  }
}

class $CachedUsersTable extends CachedUsers
    with TableInfo<$CachedUsersTable, CachedUser> {
  @override
  final GeneratedDatabase attachedDatabase;
  final String? _alias;
  $CachedUsersTable(this.attachedDatabase, [this._alias]);
  static const VerificationMeta _idMeta = const VerificationMeta('id');
  @override
  late final GeneratedColumn<String> id = GeneratedColumn<String>(
      'id', aliasedName, false,
      type: DriftSqlType.string, requiredDuringInsert: true);
  static const VerificationMeta _workspaceIdMeta =
      const VerificationMeta('workspaceId');
  @override
  late final GeneratedColumn<String> workspaceId = GeneratedColumn<String>(
      'workspace_id', aliasedName, false,
      type: DriftSqlType.string, requiredDuringInsert: true);
  static const VerificationMeta _countryMeta =
      const VerificationMeta('country');
  @override
  late final GeneratedColumn<String> country = GeneratedColumn<String>(
      'country', aliasedName, true,
      type: DriftSqlType.string, requiredDuringInsert: false);
  static const VerificationMeta _fullNameMeta =
      const VerificationMeta('fullName');
  @override
  late final GeneratedColumn<String> fullName = GeneratedColumn<String>(
      'full_name', aliasedName, true,
      type: DriftSqlType.string, requiredDuringInsert: false);
  static const VerificationMeta _usernameMeta =
      const VerificationMeta('username');
  @override
  late final GeneratedColumn<String> username = GeneratedColumn<String>(
      'username', aliasedName, true,
      type: DriftSqlType.string, requiredDuringInsert: false);
  static const VerificationMeta _roleMeta = const VerificationMeta('role');
  @override
  late final GeneratedColumn<String> role = GeneratedColumn<String>(
      'role', aliasedName, true,
      type: DriftSqlType.string, requiredDuringInsert: false);
  static const VerificationMeta _approvedMeta =
      const VerificationMeta('approved');
  @override
  late final GeneratedColumn<bool> approved = GeneratedColumn<bool>(
      'approved', aliasedName, true,
      type: DriftSqlType.bool,
      requiredDuringInsert: false,
      defaultConstraints:
          GeneratedColumn.constraintIsAlways('CHECK ("approved" IN (0, 1))'));
  static const VerificationMeta _lockedMeta = const VerificationMeta('locked');
  @override
  late final GeneratedColumn<bool> locked = GeneratedColumn<bool>(
      'locked', aliasedName, true,
      type: DriftSqlType.bool,
      requiredDuringInsert: false,
      defaultConstraints:
          GeneratedColumn.constraintIsAlways('CHECK ("locked" IN (0, 1))'));
  static const VerificationMeta _sitesJsonMeta =
      const VerificationMeta('sitesJson');
  @override
  late final GeneratedColumn<String> sitesJson = GeneratedColumn<String>(
      'sites_json', aliasedName, true,
      type: DriftSqlType.string, requiredDuringInsert: false);
  static const VerificationMeta _cachedAtMeta =
      const VerificationMeta('cachedAt');
  @override
  late final GeneratedColumn<DateTime> cachedAt = GeneratedColumn<DateTime>(
      'cached_at', aliasedName, false,
      type: DriftSqlType.dateTime, requiredDuringInsert: true);
  @override
  List<GeneratedColumn> get $columns => [
        id,
        workspaceId,
        country,
        fullName,
        username,
        role,
        approved,
        locked,
        sitesJson,
        cachedAt
      ];
  @override
  String get aliasedName => _alias ?? actualTableName;
  @override
  String get actualTableName => $name;
  static const String $name = 'cached_users';
  @override
  VerificationContext validateIntegrity(Insertable<CachedUser> instance,
      {bool isInserting = false}) {
    final context = VerificationContext();
    final data = instance.toColumns(true);
    if (data.containsKey('id')) {
      context.handle(_idMeta, id.isAcceptableOrUnknown(data['id']!, _idMeta));
    } else if (isInserting) {
      context.missing(_idMeta);
    }
    if (data.containsKey('workspace_id')) {
      context.handle(
          _workspaceIdMeta,
          workspaceId.isAcceptableOrUnknown(
              data['workspace_id']!, _workspaceIdMeta));
    } else if (isInserting) {
      context.missing(_workspaceIdMeta);
    }
    if (data.containsKey('country')) {
      context.handle(_countryMeta,
          country.isAcceptableOrUnknown(data['country']!, _countryMeta));
    }
    if (data.containsKey('full_name')) {
      context.handle(_fullNameMeta,
          fullName.isAcceptableOrUnknown(data['full_name']!, _fullNameMeta));
    }
    if (data.containsKey('username')) {
      context.handle(_usernameMeta,
          username.isAcceptableOrUnknown(data['username']!, _usernameMeta));
    }
    if (data.containsKey('role')) {
      context.handle(
          _roleMeta, role.isAcceptableOrUnknown(data['role']!, _roleMeta));
    }
    if (data.containsKey('approved')) {
      context.handle(_approvedMeta,
          approved.isAcceptableOrUnknown(data['approved']!, _approvedMeta));
    }
    if (data.containsKey('locked')) {
      context.handle(_lockedMeta,
          locked.isAcceptableOrUnknown(data['locked']!, _lockedMeta));
    }
    if (data.containsKey('sites_json')) {
      context.handle(_sitesJsonMeta,
          sitesJson.isAcceptableOrUnknown(data['sites_json']!, _sitesJsonMeta));
    }
    if (data.containsKey('cached_at')) {
      context.handle(_cachedAtMeta,
          cachedAt.isAcceptableOrUnknown(data['cached_at']!, _cachedAtMeta));
    } else if (isInserting) {
      context.missing(_cachedAtMeta);
    }
    return context;
  }

  @override
  Set<GeneratedColumn> get $primaryKey => {id};
  @override
  CachedUser map(Map<String, dynamic> data, {String? tablePrefix}) {
    final effectivePrefix = tablePrefix != null ? '$tablePrefix.' : '';
    return CachedUser(
      id: attachedDatabase.typeMapping
          .read(DriftSqlType.string, data['${effectivePrefix}id'])!,
      workspaceId: attachedDatabase.typeMapping
          .read(DriftSqlType.string, data['${effectivePrefix}workspace_id'])!,
      country: attachedDatabase.typeMapping
          .read(DriftSqlType.string, data['${effectivePrefix}country']),
      fullName: attachedDatabase.typeMapping
          .read(DriftSqlType.string, data['${effectivePrefix}full_name']),
      username: attachedDatabase.typeMapping
          .read(DriftSqlType.string, data['${effectivePrefix}username']),
      role: attachedDatabase.typeMapping
          .read(DriftSqlType.string, data['${effectivePrefix}role']),
      approved: attachedDatabase.typeMapping
          .read(DriftSqlType.bool, data['${effectivePrefix}approved']),
      locked: attachedDatabase.typeMapping
          .read(DriftSqlType.bool, data['${effectivePrefix}locked']),
      sitesJson: attachedDatabase.typeMapping
          .read(DriftSqlType.string, data['${effectivePrefix}sites_json']),
      cachedAt: attachedDatabase.typeMapping
          .read(DriftSqlType.dateTime, data['${effectivePrefix}cached_at'])!,
    );
  }

  @override
  $CachedUsersTable createAlias(String alias) {
    return $CachedUsersTable(attachedDatabase, alias);
  }
}

class CachedUser extends DataClass implements Insertable<CachedUser> {
  /// `profiles.id`, the auth uid.
  final String id;
  final String workspaceId;
  final String? country;
  final String? fullName;
  final String? username;
  final String? role;

  /// Nullable on purpose: unknown is not false. A user whose approval state was
  /// never loaded must not render as "not approved".
  final bool? approved;

  /// Same reasoning as [approved].
  final bool? locked;

  /// JSON array, stored as received.
  final String? sitesJson;
  final DateTime cachedAt;
  const CachedUser(
      {required this.id,
      required this.workspaceId,
      this.country,
      this.fullName,
      this.username,
      this.role,
      this.approved,
      this.locked,
      this.sitesJson,
      required this.cachedAt});
  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    map['id'] = Variable<String>(id);
    map['workspace_id'] = Variable<String>(workspaceId);
    if (!nullToAbsent || country != null) {
      map['country'] = Variable<String>(country);
    }
    if (!nullToAbsent || fullName != null) {
      map['full_name'] = Variable<String>(fullName);
    }
    if (!nullToAbsent || username != null) {
      map['username'] = Variable<String>(username);
    }
    if (!nullToAbsent || role != null) {
      map['role'] = Variable<String>(role);
    }
    if (!nullToAbsent || approved != null) {
      map['approved'] = Variable<bool>(approved);
    }
    if (!nullToAbsent || locked != null) {
      map['locked'] = Variable<bool>(locked);
    }
    if (!nullToAbsent || sitesJson != null) {
      map['sites_json'] = Variable<String>(sitesJson);
    }
    map['cached_at'] = Variable<DateTime>(cachedAt);
    return map;
  }

  CachedUsersCompanion toCompanion(bool nullToAbsent) {
    return CachedUsersCompanion(
      id: Value(id),
      workspaceId: Value(workspaceId),
      country: country == null && nullToAbsent
          ? const Value.absent()
          : Value(country),
      fullName: fullName == null && nullToAbsent
          ? const Value.absent()
          : Value(fullName),
      username: username == null && nullToAbsent
          ? const Value.absent()
          : Value(username),
      role: role == null && nullToAbsent ? const Value.absent() : Value(role),
      approved: approved == null && nullToAbsent
          ? const Value.absent()
          : Value(approved),
      locked:
          locked == null && nullToAbsent ? const Value.absent() : Value(locked),
      sitesJson: sitesJson == null && nullToAbsent
          ? const Value.absent()
          : Value(sitesJson),
      cachedAt: Value(cachedAt),
    );
  }

  factory CachedUser.fromJson(Map<String, dynamic> json,
      {ValueSerializer? serializer}) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return CachedUser(
      id: serializer.fromJson<String>(json['id']),
      workspaceId: serializer.fromJson<String>(json['workspaceId']),
      country: serializer.fromJson<String?>(json['country']),
      fullName: serializer.fromJson<String?>(json['fullName']),
      username: serializer.fromJson<String?>(json['username']),
      role: serializer.fromJson<String?>(json['role']),
      approved: serializer.fromJson<bool?>(json['approved']),
      locked: serializer.fromJson<bool?>(json['locked']),
      sitesJson: serializer.fromJson<String?>(json['sitesJson']),
      cachedAt: serializer.fromJson<DateTime>(json['cachedAt']),
    );
  }
  @override
  Map<String, dynamic> toJson({ValueSerializer? serializer}) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return <String, dynamic>{
      'id': serializer.toJson<String>(id),
      'workspaceId': serializer.toJson<String>(workspaceId),
      'country': serializer.toJson<String?>(country),
      'fullName': serializer.toJson<String?>(fullName),
      'username': serializer.toJson<String?>(username),
      'role': serializer.toJson<String?>(role),
      'approved': serializer.toJson<bool?>(approved),
      'locked': serializer.toJson<bool?>(locked),
      'sitesJson': serializer.toJson<String?>(sitesJson),
      'cachedAt': serializer.toJson<DateTime>(cachedAt),
    };
  }

  CachedUser copyWith(
          {String? id,
          String? workspaceId,
          Value<String?> country = const Value.absent(),
          Value<String?> fullName = const Value.absent(),
          Value<String?> username = const Value.absent(),
          Value<String?> role = const Value.absent(),
          Value<bool?> approved = const Value.absent(),
          Value<bool?> locked = const Value.absent(),
          Value<String?> sitesJson = const Value.absent(),
          DateTime? cachedAt}) =>
      CachedUser(
        id: id ?? this.id,
        workspaceId: workspaceId ?? this.workspaceId,
        country: country.present ? country.value : this.country,
        fullName: fullName.present ? fullName.value : this.fullName,
        username: username.present ? username.value : this.username,
        role: role.present ? role.value : this.role,
        approved: approved.present ? approved.value : this.approved,
        locked: locked.present ? locked.value : this.locked,
        sitesJson: sitesJson.present ? sitesJson.value : this.sitesJson,
        cachedAt: cachedAt ?? this.cachedAt,
      );
  CachedUser copyWithCompanion(CachedUsersCompanion data) {
    return CachedUser(
      id: data.id.present ? data.id.value : this.id,
      workspaceId:
          data.workspaceId.present ? data.workspaceId.value : this.workspaceId,
      country: data.country.present ? data.country.value : this.country,
      fullName: data.fullName.present ? data.fullName.value : this.fullName,
      username: data.username.present ? data.username.value : this.username,
      role: data.role.present ? data.role.value : this.role,
      approved: data.approved.present ? data.approved.value : this.approved,
      locked: data.locked.present ? data.locked.value : this.locked,
      sitesJson: data.sitesJson.present ? data.sitesJson.value : this.sitesJson,
      cachedAt: data.cachedAt.present ? data.cachedAt.value : this.cachedAt,
    );
  }

  @override
  String toString() {
    return (StringBuffer('CachedUser(')
          ..write('id: $id, ')
          ..write('workspaceId: $workspaceId, ')
          ..write('country: $country, ')
          ..write('fullName: $fullName, ')
          ..write('username: $username, ')
          ..write('role: $role, ')
          ..write('approved: $approved, ')
          ..write('locked: $locked, ')
          ..write('sitesJson: $sitesJson, ')
          ..write('cachedAt: $cachedAt')
          ..write(')'))
        .toString();
  }

  @override
  int get hashCode => Object.hash(id, workspaceId, country, fullName, username,
      role, approved, locked, sitesJson, cachedAt);
  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      (other is CachedUser &&
          other.id == this.id &&
          other.workspaceId == this.workspaceId &&
          other.country == this.country &&
          other.fullName == this.fullName &&
          other.username == this.username &&
          other.role == this.role &&
          other.approved == this.approved &&
          other.locked == this.locked &&
          other.sitesJson == this.sitesJson &&
          other.cachedAt == this.cachedAt);
}

class CachedUsersCompanion extends UpdateCompanion<CachedUser> {
  final Value<String> id;
  final Value<String> workspaceId;
  final Value<String?> country;
  final Value<String?> fullName;
  final Value<String?> username;
  final Value<String?> role;
  final Value<bool?> approved;
  final Value<bool?> locked;
  final Value<String?> sitesJson;
  final Value<DateTime> cachedAt;
  final Value<int> rowid;
  const CachedUsersCompanion({
    this.id = const Value.absent(),
    this.workspaceId = const Value.absent(),
    this.country = const Value.absent(),
    this.fullName = const Value.absent(),
    this.username = const Value.absent(),
    this.role = const Value.absent(),
    this.approved = const Value.absent(),
    this.locked = const Value.absent(),
    this.sitesJson = const Value.absent(),
    this.cachedAt = const Value.absent(),
    this.rowid = const Value.absent(),
  });
  CachedUsersCompanion.insert({
    required String id,
    required String workspaceId,
    this.country = const Value.absent(),
    this.fullName = const Value.absent(),
    this.username = const Value.absent(),
    this.role = const Value.absent(),
    this.approved = const Value.absent(),
    this.locked = const Value.absent(),
    this.sitesJson = const Value.absent(),
    required DateTime cachedAt,
    this.rowid = const Value.absent(),
  })  : id = Value(id),
        workspaceId = Value(workspaceId),
        cachedAt = Value(cachedAt);
  static Insertable<CachedUser> custom({
    Expression<String>? id,
    Expression<String>? workspaceId,
    Expression<String>? country,
    Expression<String>? fullName,
    Expression<String>? username,
    Expression<String>? role,
    Expression<bool>? approved,
    Expression<bool>? locked,
    Expression<String>? sitesJson,
    Expression<DateTime>? cachedAt,
    Expression<int>? rowid,
  }) {
    return RawValuesInsertable({
      if (id != null) 'id': id,
      if (workspaceId != null) 'workspace_id': workspaceId,
      if (country != null) 'country': country,
      if (fullName != null) 'full_name': fullName,
      if (username != null) 'username': username,
      if (role != null) 'role': role,
      if (approved != null) 'approved': approved,
      if (locked != null) 'locked': locked,
      if (sitesJson != null) 'sites_json': sitesJson,
      if (cachedAt != null) 'cached_at': cachedAt,
      if (rowid != null) 'rowid': rowid,
    });
  }

  CachedUsersCompanion copyWith(
      {Value<String>? id,
      Value<String>? workspaceId,
      Value<String?>? country,
      Value<String?>? fullName,
      Value<String?>? username,
      Value<String?>? role,
      Value<bool?>? approved,
      Value<bool?>? locked,
      Value<String?>? sitesJson,
      Value<DateTime>? cachedAt,
      Value<int>? rowid}) {
    return CachedUsersCompanion(
      id: id ?? this.id,
      workspaceId: workspaceId ?? this.workspaceId,
      country: country ?? this.country,
      fullName: fullName ?? this.fullName,
      username: username ?? this.username,
      role: role ?? this.role,
      approved: approved ?? this.approved,
      locked: locked ?? this.locked,
      sitesJson: sitesJson ?? this.sitesJson,
      cachedAt: cachedAt ?? this.cachedAt,
      rowid: rowid ?? this.rowid,
    );
  }

  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    if (id.present) {
      map['id'] = Variable<String>(id.value);
    }
    if (workspaceId.present) {
      map['workspace_id'] = Variable<String>(workspaceId.value);
    }
    if (country.present) {
      map['country'] = Variable<String>(country.value);
    }
    if (fullName.present) {
      map['full_name'] = Variable<String>(fullName.value);
    }
    if (username.present) {
      map['username'] = Variable<String>(username.value);
    }
    if (role.present) {
      map['role'] = Variable<String>(role.value);
    }
    if (approved.present) {
      map['approved'] = Variable<bool>(approved.value);
    }
    if (locked.present) {
      map['locked'] = Variable<bool>(locked.value);
    }
    if (sitesJson.present) {
      map['sites_json'] = Variable<String>(sitesJson.value);
    }
    if (cachedAt.present) {
      map['cached_at'] = Variable<DateTime>(cachedAt.value);
    }
    if (rowid.present) {
      map['rowid'] = Variable<int>(rowid.value);
    }
    return map;
  }

  @override
  String toString() {
    return (StringBuffer('CachedUsersCompanion(')
          ..write('id: $id, ')
          ..write('workspaceId: $workspaceId, ')
          ..write('country: $country, ')
          ..write('fullName: $fullName, ')
          ..write('username: $username, ')
          ..write('role: $role, ')
          ..write('approved: $approved, ')
          ..write('locked: $locked, ')
          ..write('sitesJson: $sitesJson, ')
          ..write('cachedAt: $cachedAt, ')
          ..write('rowid: $rowid')
          ..write(')'))
        .toString();
  }
}

class $CachedSitesTable extends CachedSites
    with TableInfo<$CachedSitesTable, CachedSite> {
  @override
  final GeneratedDatabase attachedDatabase;
  final String? _alias;
  $CachedSitesTable(this.attachedDatabase, [this._alias]);
  static const VerificationMeta _idMeta = const VerificationMeta('id');
  @override
  late final GeneratedColumn<String> id = GeneratedColumn<String>(
      'id', aliasedName, false,
      type: DriftSqlType.string, requiredDuringInsert: true);
  static const VerificationMeta _workspaceIdMeta =
      const VerificationMeta('workspaceId');
  @override
  late final GeneratedColumn<String> workspaceId = GeneratedColumn<String>(
      'workspace_id', aliasedName, false,
      type: DriftSqlType.string, requiredDuringInsert: true);
  static const VerificationMeta _countryMeta =
      const VerificationMeta('country');
  @override
  late final GeneratedColumn<String> country = GeneratedColumn<String>(
      'country', aliasedName, true,
      type: DriftSqlType.string, requiredDuringInsert: false);
  static const VerificationMeta _nameMeta = const VerificationMeta('name');
  @override
  late final GeneratedColumn<String> name = GeneratedColumn<String>(
      'name', aliasedName, false,
      type: DriftSqlType.string, requiredDuringInsert: true);
  static const VerificationMeta _regionMeta = const VerificationMeta('region');
  @override
  late final GeneratedColumn<String> region = GeneratedColumn<String>(
      'region', aliasedName, true,
      type: DriftSqlType.string, requiredDuringInsert: false);
  static const VerificationMeta _activeMeta = const VerificationMeta('active');
  @override
  late final GeneratedColumn<bool> active = GeneratedColumn<bool>(
      'active', aliasedName, true,
      type: DriftSqlType.bool,
      requiredDuringInsert: false,
      defaultConstraints:
          GeneratedColumn.constraintIsAlways('CHECK ("active" IN (0, 1))'));
  static const VerificationMeta _cachedAtMeta =
      const VerificationMeta('cachedAt');
  @override
  late final GeneratedColumn<DateTime> cachedAt = GeneratedColumn<DateTime>(
      'cached_at', aliasedName, false,
      type: DriftSqlType.dateTime, requiredDuringInsert: true);
  @override
  List<GeneratedColumn> get $columns =>
      [id, workspaceId, country, name, region, active, cachedAt];
  @override
  String get aliasedName => _alias ?? actualTableName;
  @override
  String get actualTableName => $name;
  static const String $name = 'cached_sites';
  @override
  VerificationContext validateIntegrity(Insertable<CachedSite> instance,
      {bool isInserting = false}) {
    final context = VerificationContext();
    final data = instance.toColumns(true);
    if (data.containsKey('id')) {
      context.handle(_idMeta, id.isAcceptableOrUnknown(data['id']!, _idMeta));
    } else if (isInserting) {
      context.missing(_idMeta);
    }
    if (data.containsKey('workspace_id')) {
      context.handle(
          _workspaceIdMeta,
          workspaceId.isAcceptableOrUnknown(
              data['workspace_id']!, _workspaceIdMeta));
    } else if (isInserting) {
      context.missing(_workspaceIdMeta);
    }
    if (data.containsKey('country')) {
      context.handle(_countryMeta,
          country.isAcceptableOrUnknown(data['country']!, _countryMeta));
    }
    if (data.containsKey('name')) {
      context.handle(
          _nameMeta, name.isAcceptableOrUnknown(data['name']!, _nameMeta));
    } else if (isInserting) {
      context.missing(_nameMeta);
    }
    if (data.containsKey('region')) {
      context.handle(_regionMeta,
          region.isAcceptableOrUnknown(data['region']!, _regionMeta));
    }
    if (data.containsKey('active')) {
      context.handle(_activeMeta,
          active.isAcceptableOrUnknown(data['active']!, _activeMeta));
    }
    if (data.containsKey('cached_at')) {
      context.handle(_cachedAtMeta,
          cachedAt.isAcceptableOrUnknown(data['cached_at']!, _cachedAtMeta));
    } else if (isInserting) {
      context.missing(_cachedAtMeta);
    }
    return context;
  }

  @override
  Set<GeneratedColumn> get $primaryKey => {id};
  @override
  CachedSite map(Map<String, dynamic> data, {String? tablePrefix}) {
    final effectivePrefix = tablePrefix != null ? '$tablePrefix.' : '';
    return CachedSite(
      id: attachedDatabase.typeMapping
          .read(DriftSqlType.string, data['${effectivePrefix}id'])!,
      workspaceId: attachedDatabase.typeMapping
          .read(DriftSqlType.string, data['${effectivePrefix}workspace_id'])!,
      country: attachedDatabase.typeMapping
          .read(DriftSqlType.string, data['${effectivePrefix}country']),
      name: attachedDatabase.typeMapping
          .read(DriftSqlType.string, data['${effectivePrefix}name'])!,
      region: attachedDatabase.typeMapping
          .read(DriftSqlType.string, data['${effectivePrefix}region']),
      active: attachedDatabase.typeMapping
          .read(DriftSqlType.bool, data['${effectivePrefix}active']),
      cachedAt: attachedDatabase.typeMapping
          .read(DriftSqlType.dateTime, data['${effectivePrefix}cached_at'])!,
    );
  }

  @override
  $CachedSitesTable createAlias(String alias) {
    return $CachedSitesTable(attachedDatabase, alias);
  }
}

class CachedSite extends DataClass implements Insertable<CachedSite> {
  final String id;
  final String workspaceId;
  final String? country;

  /// Stored verbatim as the server returns it.
  ///
  /// The server normalises site casing and applies aliases through triggers. A
  /// client that re-normalised would produce a value the server's own `.eq()`
  /// filters no longer match. The client compares; it does not canonicalise.
  final String name;
  final String? region;
  final bool? active;
  final DateTime cachedAt;
  const CachedSite(
      {required this.id,
      required this.workspaceId,
      this.country,
      required this.name,
      this.region,
      this.active,
      required this.cachedAt});
  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    map['id'] = Variable<String>(id);
    map['workspace_id'] = Variable<String>(workspaceId);
    if (!nullToAbsent || country != null) {
      map['country'] = Variable<String>(country);
    }
    map['name'] = Variable<String>(name);
    if (!nullToAbsent || region != null) {
      map['region'] = Variable<String>(region);
    }
    if (!nullToAbsent || active != null) {
      map['active'] = Variable<bool>(active);
    }
    map['cached_at'] = Variable<DateTime>(cachedAt);
    return map;
  }

  CachedSitesCompanion toCompanion(bool nullToAbsent) {
    return CachedSitesCompanion(
      id: Value(id),
      workspaceId: Value(workspaceId),
      country: country == null && nullToAbsent
          ? const Value.absent()
          : Value(country),
      name: Value(name),
      region:
          region == null && nullToAbsent ? const Value.absent() : Value(region),
      active:
          active == null && nullToAbsent ? const Value.absent() : Value(active),
      cachedAt: Value(cachedAt),
    );
  }

  factory CachedSite.fromJson(Map<String, dynamic> json,
      {ValueSerializer? serializer}) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return CachedSite(
      id: serializer.fromJson<String>(json['id']),
      workspaceId: serializer.fromJson<String>(json['workspaceId']),
      country: serializer.fromJson<String?>(json['country']),
      name: serializer.fromJson<String>(json['name']),
      region: serializer.fromJson<String?>(json['region']),
      active: serializer.fromJson<bool?>(json['active']),
      cachedAt: serializer.fromJson<DateTime>(json['cachedAt']),
    );
  }
  @override
  Map<String, dynamic> toJson({ValueSerializer? serializer}) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return <String, dynamic>{
      'id': serializer.toJson<String>(id),
      'workspaceId': serializer.toJson<String>(workspaceId),
      'country': serializer.toJson<String?>(country),
      'name': serializer.toJson<String>(name),
      'region': serializer.toJson<String?>(region),
      'active': serializer.toJson<bool?>(active),
      'cachedAt': serializer.toJson<DateTime>(cachedAt),
    };
  }

  CachedSite copyWith(
          {String? id,
          String? workspaceId,
          Value<String?> country = const Value.absent(),
          String? name,
          Value<String?> region = const Value.absent(),
          Value<bool?> active = const Value.absent(),
          DateTime? cachedAt}) =>
      CachedSite(
        id: id ?? this.id,
        workspaceId: workspaceId ?? this.workspaceId,
        country: country.present ? country.value : this.country,
        name: name ?? this.name,
        region: region.present ? region.value : this.region,
        active: active.present ? active.value : this.active,
        cachedAt: cachedAt ?? this.cachedAt,
      );
  CachedSite copyWithCompanion(CachedSitesCompanion data) {
    return CachedSite(
      id: data.id.present ? data.id.value : this.id,
      workspaceId:
          data.workspaceId.present ? data.workspaceId.value : this.workspaceId,
      country: data.country.present ? data.country.value : this.country,
      name: data.name.present ? data.name.value : this.name,
      region: data.region.present ? data.region.value : this.region,
      active: data.active.present ? data.active.value : this.active,
      cachedAt: data.cachedAt.present ? data.cachedAt.value : this.cachedAt,
    );
  }

  @override
  String toString() {
    return (StringBuffer('CachedSite(')
          ..write('id: $id, ')
          ..write('workspaceId: $workspaceId, ')
          ..write('country: $country, ')
          ..write('name: $name, ')
          ..write('region: $region, ')
          ..write('active: $active, ')
          ..write('cachedAt: $cachedAt')
          ..write(')'))
        .toString();
  }

  @override
  int get hashCode =>
      Object.hash(id, workspaceId, country, name, region, active, cachedAt);
  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      (other is CachedSite &&
          other.id == this.id &&
          other.workspaceId == this.workspaceId &&
          other.country == this.country &&
          other.name == this.name &&
          other.region == this.region &&
          other.active == this.active &&
          other.cachedAt == this.cachedAt);
}

class CachedSitesCompanion extends UpdateCompanion<CachedSite> {
  final Value<String> id;
  final Value<String> workspaceId;
  final Value<String?> country;
  final Value<String> name;
  final Value<String?> region;
  final Value<bool?> active;
  final Value<DateTime> cachedAt;
  final Value<int> rowid;
  const CachedSitesCompanion({
    this.id = const Value.absent(),
    this.workspaceId = const Value.absent(),
    this.country = const Value.absent(),
    this.name = const Value.absent(),
    this.region = const Value.absent(),
    this.active = const Value.absent(),
    this.cachedAt = const Value.absent(),
    this.rowid = const Value.absent(),
  });
  CachedSitesCompanion.insert({
    required String id,
    required String workspaceId,
    this.country = const Value.absent(),
    required String name,
    this.region = const Value.absent(),
    this.active = const Value.absent(),
    required DateTime cachedAt,
    this.rowid = const Value.absent(),
  })  : id = Value(id),
        workspaceId = Value(workspaceId),
        name = Value(name),
        cachedAt = Value(cachedAt);
  static Insertable<CachedSite> custom({
    Expression<String>? id,
    Expression<String>? workspaceId,
    Expression<String>? country,
    Expression<String>? name,
    Expression<String>? region,
    Expression<bool>? active,
    Expression<DateTime>? cachedAt,
    Expression<int>? rowid,
  }) {
    return RawValuesInsertable({
      if (id != null) 'id': id,
      if (workspaceId != null) 'workspace_id': workspaceId,
      if (country != null) 'country': country,
      if (name != null) 'name': name,
      if (region != null) 'region': region,
      if (active != null) 'active': active,
      if (cachedAt != null) 'cached_at': cachedAt,
      if (rowid != null) 'rowid': rowid,
    });
  }

  CachedSitesCompanion copyWith(
      {Value<String>? id,
      Value<String>? workspaceId,
      Value<String?>? country,
      Value<String>? name,
      Value<String?>? region,
      Value<bool?>? active,
      Value<DateTime>? cachedAt,
      Value<int>? rowid}) {
    return CachedSitesCompanion(
      id: id ?? this.id,
      workspaceId: workspaceId ?? this.workspaceId,
      country: country ?? this.country,
      name: name ?? this.name,
      region: region ?? this.region,
      active: active ?? this.active,
      cachedAt: cachedAt ?? this.cachedAt,
      rowid: rowid ?? this.rowid,
    );
  }

  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    if (id.present) {
      map['id'] = Variable<String>(id.value);
    }
    if (workspaceId.present) {
      map['workspace_id'] = Variable<String>(workspaceId.value);
    }
    if (country.present) {
      map['country'] = Variable<String>(country.value);
    }
    if (name.present) {
      map['name'] = Variable<String>(name.value);
    }
    if (region.present) {
      map['region'] = Variable<String>(region.value);
    }
    if (active.present) {
      map['active'] = Variable<bool>(active.value);
    }
    if (cachedAt.present) {
      map['cached_at'] = Variable<DateTime>(cachedAt.value);
    }
    if (rowid.present) {
      map['rowid'] = Variable<int>(rowid.value);
    }
    return map;
  }

  @override
  String toString() {
    return (StringBuffer('CachedSitesCompanion(')
          ..write('id: $id, ')
          ..write('workspaceId: $workspaceId, ')
          ..write('country: $country, ')
          ..write('name: $name, ')
          ..write('region: $region, ')
          ..write('active: $active, ')
          ..write('cachedAt: $cachedAt, ')
          ..write('rowid: $rowid')
          ..write(')'))
        .toString();
  }
}

class $CachedAssetsTable extends CachedAssets
    with TableInfo<$CachedAssetsTable, CachedAsset> {
  @override
  final GeneratedDatabase attachedDatabase;
  final String? _alias;
  $CachedAssetsTable(this.attachedDatabase, [this._alias]);
  static const VerificationMeta _idMeta = const VerificationMeta('id');
  @override
  late final GeneratedColumn<String> id = GeneratedColumn<String>(
      'id', aliasedName, false,
      type: DriftSqlType.string, requiredDuringInsert: true);
  static const VerificationMeta _workspaceIdMeta =
      const VerificationMeta('workspaceId');
  @override
  late final GeneratedColumn<String> workspaceId = GeneratedColumn<String>(
      'workspace_id', aliasedName, false,
      type: DriftSqlType.string, requiredDuringInsert: true);
  static const VerificationMeta _countryMeta =
      const VerificationMeta('country');
  @override
  late final GeneratedColumn<String> country = GeneratedColumn<String>(
      'country', aliasedName, true,
      type: DriftSqlType.string, requiredDuringInsert: false);
  static const VerificationMeta _assetNoMeta =
      const VerificationMeta('assetNo');
  @override
  late final GeneratedColumn<String> assetNo = GeneratedColumn<String>(
      'asset_no', aliasedName, false,
      type: DriftSqlType.string, requiredDuringInsert: true);
  static const VerificationMeta _assetNoNormMeta =
      const VerificationMeta('assetNoNorm');
  @override
  late final GeneratedColumn<String> assetNoNorm = GeneratedColumn<String>(
      'asset_no_norm', aliasedName, false,
      type: DriftSqlType.string, requiredDuringInsert: true);
  static const VerificationMeta _fleetNumberMeta =
      const VerificationMeta('fleetNumber');
  @override
  late final GeneratedColumn<String> fleetNumber = GeneratedColumn<String>(
      'fleet_number', aliasedName, true,
      type: DriftSqlType.string, requiredDuringInsert: false);
  static const VerificationMeta _registrationNoMeta =
      const VerificationMeta('registrationNo');
  @override
  late final GeneratedColumn<String> registrationNo = GeneratedColumn<String>(
      'registration_no', aliasedName, true,
      type: DriftSqlType.string, requiredDuringInsert: false);
  static const VerificationMeta _chassisNoMeta =
      const VerificationMeta('chassisNo');
  @override
  late final GeneratedColumn<String> chassisNo = GeneratedColumn<String>(
      'chassis_no', aliasedName, true,
      type: DriftSqlType.string, requiredDuringInsert: false);
  static const VerificationMeta _serialNoMeta =
      const VerificationMeta('serialNo');
  @override
  late final GeneratedColumn<String> serialNo = GeneratedColumn<String>(
      'serial_no', aliasedName, true,
      type: DriftSqlType.string, requiredDuringInsert: false);
  static const VerificationMeta _vehicleTypeMeta =
      const VerificationMeta('vehicleType');
  @override
  late final GeneratedColumn<String> vehicleType = GeneratedColumn<String>(
      'vehicle_type', aliasedName, true,
      type: DriftSqlType.string, requiredDuringInsert: false);
  static const VerificationMeta _makeMeta = const VerificationMeta('make');
  @override
  late final GeneratedColumn<String> make = GeneratedColumn<String>(
      'make', aliasedName, true,
      type: DriftSqlType.string, requiredDuringInsert: false);
  static const VerificationMeta _modelMeta = const VerificationMeta('model');
  @override
  late final GeneratedColumn<String> model = GeneratedColumn<String>(
      'model', aliasedName, true,
      type: DriftSqlType.string, requiredDuringInsert: false);
  static const VerificationMeta _siteMeta = const VerificationMeta('site');
  @override
  late final GeneratedColumn<String> site = GeneratedColumn<String>(
      'site', aliasedName, true,
      type: DriftSqlType.string, requiredDuringInsert: false);
  static const VerificationMeta _currentKmMeta =
      const VerificationMeta('currentKm');
  @override
  late final GeneratedColumn<int> currentKm = GeneratedColumn<int>(
      'current_km', aliasedName, true,
      type: DriftSqlType.int, requiredDuringInsert: false);
  static const VerificationMeta _statusMeta = const VerificationMeta('status');
  @override
  late final GeneratedColumn<String> status = GeneratedColumn<String>(
      'status', aliasedName, true,
      type: DriftSqlType.string, requiredDuringInsert: false);
  static const VerificationMeta _opsStatusMeta =
      const VerificationMeta('opsStatus');
  @override
  late final GeneratedColumn<String> opsStatus = GeneratedColumn<String>(
      'ops_status', aliasedName, true,
      type: DriftSqlType.string, requiredDuringInsert: false);
  static const VerificationMeta _cachedAtMeta =
      const VerificationMeta('cachedAt');
  @override
  late final GeneratedColumn<DateTime> cachedAt = GeneratedColumn<DateTime>(
      'cached_at', aliasedName, false,
      type: DriftSqlType.dateTime, requiredDuringInsert: true);
  @override
  List<GeneratedColumn> get $columns => [
        id,
        workspaceId,
        country,
        assetNo,
        assetNoNorm,
        fleetNumber,
        registrationNo,
        chassisNo,
        serialNo,
        vehicleType,
        make,
        model,
        site,
        currentKm,
        status,
        opsStatus,
        cachedAt
      ];
  @override
  String get aliasedName => _alias ?? actualTableName;
  @override
  String get actualTableName => $name;
  static const String $name = 'cached_assets';
  @override
  VerificationContext validateIntegrity(Insertable<CachedAsset> instance,
      {bool isInserting = false}) {
    final context = VerificationContext();
    final data = instance.toColumns(true);
    if (data.containsKey('id')) {
      context.handle(_idMeta, id.isAcceptableOrUnknown(data['id']!, _idMeta));
    } else if (isInserting) {
      context.missing(_idMeta);
    }
    if (data.containsKey('workspace_id')) {
      context.handle(
          _workspaceIdMeta,
          workspaceId.isAcceptableOrUnknown(
              data['workspace_id']!, _workspaceIdMeta));
    } else if (isInserting) {
      context.missing(_workspaceIdMeta);
    }
    if (data.containsKey('country')) {
      context.handle(_countryMeta,
          country.isAcceptableOrUnknown(data['country']!, _countryMeta));
    }
    if (data.containsKey('asset_no')) {
      context.handle(_assetNoMeta,
          assetNo.isAcceptableOrUnknown(data['asset_no']!, _assetNoMeta));
    } else if (isInserting) {
      context.missing(_assetNoMeta);
    }
    if (data.containsKey('asset_no_norm')) {
      context.handle(
          _assetNoNormMeta,
          assetNoNorm.isAcceptableOrUnknown(
              data['asset_no_norm']!, _assetNoNormMeta));
    } else if (isInserting) {
      context.missing(_assetNoNormMeta);
    }
    if (data.containsKey('fleet_number')) {
      context.handle(
          _fleetNumberMeta,
          fleetNumber.isAcceptableOrUnknown(
              data['fleet_number']!, _fleetNumberMeta));
    }
    if (data.containsKey('registration_no')) {
      context.handle(
          _registrationNoMeta,
          registrationNo.isAcceptableOrUnknown(
              data['registration_no']!, _registrationNoMeta));
    }
    if (data.containsKey('chassis_no')) {
      context.handle(_chassisNoMeta,
          chassisNo.isAcceptableOrUnknown(data['chassis_no']!, _chassisNoMeta));
    }
    if (data.containsKey('serial_no')) {
      context.handle(_serialNoMeta,
          serialNo.isAcceptableOrUnknown(data['serial_no']!, _serialNoMeta));
    }
    if (data.containsKey('vehicle_type')) {
      context.handle(
          _vehicleTypeMeta,
          vehicleType.isAcceptableOrUnknown(
              data['vehicle_type']!, _vehicleTypeMeta));
    }
    if (data.containsKey('make')) {
      context.handle(
          _makeMeta, make.isAcceptableOrUnknown(data['make']!, _makeMeta));
    }
    if (data.containsKey('model')) {
      context.handle(
          _modelMeta, model.isAcceptableOrUnknown(data['model']!, _modelMeta));
    }
    if (data.containsKey('site')) {
      context.handle(
          _siteMeta, site.isAcceptableOrUnknown(data['site']!, _siteMeta));
    }
    if (data.containsKey('current_km')) {
      context.handle(_currentKmMeta,
          currentKm.isAcceptableOrUnknown(data['current_km']!, _currentKmMeta));
    }
    if (data.containsKey('status')) {
      context.handle(_statusMeta,
          status.isAcceptableOrUnknown(data['status']!, _statusMeta));
    }
    if (data.containsKey('ops_status')) {
      context.handle(_opsStatusMeta,
          opsStatus.isAcceptableOrUnknown(data['ops_status']!, _opsStatusMeta));
    }
    if (data.containsKey('cached_at')) {
      context.handle(_cachedAtMeta,
          cachedAt.isAcceptableOrUnknown(data['cached_at']!, _cachedAtMeta));
    } else if (isInserting) {
      context.missing(_cachedAtMeta);
    }
    return context;
  }

  @override
  Set<GeneratedColumn> get $primaryKey => {id};
  @override
  CachedAsset map(Map<String, dynamic> data, {String? tablePrefix}) {
    final effectivePrefix = tablePrefix != null ? '$tablePrefix.' : '';
    return CachedAsset(
      id: attachedDatabase.typeMapping
          .read(DriftSqlType.string, data['${effectivePrefix}id'])!,
      workspaceId: attachedDatabase.typeMapping
          .read(DriftSqlType.string, data['${effectivePrefix}workspace_id'])!,
      country: attachedDatabase.typeMapping
          .read(DriftSqlType.string, data['${effectivePrefix}country']),
      assetNo: attachedDatabase.typeMapping
          .read(DriftSqlType.string, data['${effectivePrefix}asset_no'])!,
      assetNoNorm: attachedDatabase.typeMapping
          .read(DriftSqlType.string, data['${effectivePrefix}asset_no_norm'])!,
      fleetNumber: attachedDatabase.typeMapping
          .read(DriftSqlType.string, data['${effectivePrefix}fleet_number']),
      registrationNo: attachedDatabase.typeMapping
          .read(DriftSqlType.string, data['${effectivePrefix}registration_no']),
      chassisNo: attachedDatabase.typeMapping
          .read(DriftSqlType.string, data['${effectivePrefix}chassis_no']),
      serialNo: attachedDatabase.typeMapping
          .read(DriftSqlType.string, data['${effectivePrefix}serial_no']),
      vehicleType: attachedDatabase.typeMapping
          .read(DriftSqlType.string, data['${effectivePrefix}vehicle_type']),
      make: attachedDatabase.typeMapping
          .read(DriftSqlType.string, data['${effectivePrefix}make']),
      model: attachedDatabase.typeMapping
          .read(DriftSqlType.string, data['${effectivePrefix}model']),
      site: attachedDatabase.typeMapping
          .read(DriftSqlType.string, data['${effectivePrefix}site']),
      currentKm: attachedDatabase.typeMapping
          .read(DriftSqlType.int, data['${effectivePrefix}current_km']),
      status: attachedDatabase.typeMapping
          .read(DriftSqlType.string, data['${effectivePrefix}status']),
      opsStatus: attachedDatabase.typeMapping
          .read(DriftSqlType.string, data['${effectivePrefix}ops_status']),
      cachedAt: attachedDatabase.typeMapping
          .read(DriftSqlType.dateTime, data['${effectivePrefix}cached_at'])!,
    );
  }

  @override
  $CachedAssetsTable createAlias(String alias) {
    return $CachedAssetsTable(attachedDatabase, alias);
  }
}

class CachedAsset extends DataClass implements Insertable<CachedAsset> {
  /// `vehicle_fleet.id`.
  final String id;
  final String workspaceId;
  final String? country;

  /// The code a technician types or scans, verbatim from the server.
  final String assetNo;

  /// Trimmed and uppercased, for lookup only.
  ///
  /// It exists so the scanner is an index seek. Matching on `UPPER(TRIM(...))`
  /// at query time cannot use an index and turns every keystroke into a full
  /// scan of 1,617 rows. Never send this form to the server - send [assetNo].
  final String assetNoNorm;
  final String? fleetNumber;

  /// Plate. `vehicle_fleet.registration_no`.
  final String? registrationNo;
  final String? chassisNo;
  final String? serialNo;

  /// Drives the tyre diagram layout.
  final String? vehicleType;
  final String? make;
  final String? model;
  final String? site;

  /// Nullable, and it must stay nullable. RECORDED: `current_km` is set on a
  /// minority of assets, and a fabricated 0 would read as a real odometer.
  final int? currentKm;

  /// Active or Inactive: is this machine on the current fleet.
  final String? status;

  /// What the machine is doing today. Distinct from [status]: a machine can be
  /// Active and broken down at the same time, and merging the two hides
  /// whichever question is being asked.
  final String? opsStatus;
  final DateTime cachedAt;
  const CachedAsset(
      {required this.id,
      required this.workspaceId,
      this.country,
      required this.assetNo,
      required this.assetNoNorm,
      this.fleetNumber,
      this.registrationNo,
      this.chassisNo,
      this.serialNo,
      this.vehicleType,
      this.make,
      this.model,
      this.site,
      this.currentKm,
      this.status,
      this.opsStatus,
      required this.cachedAt});
  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    map['id'] = Variable<String>(id);
    map['workspace_id'] = Variable<String>(workspaceId);
    if (!nullToAbsent || country != null) {
      map['country'] = Variable<String>(country);
    }
    map['asset_no'] = Variable<String>(assetNo);
    map['asset_no_norm'] = Variable<String>(assetNoNorm);
    if (!nullToAbsent || fleetNumber != null) {
      map['fleet_number'] = Variable<String>(fleetNumber);
    }
    if (!nullToAbsent || registrationNo != null) {
      map['registration_no'] = Variable<String>(registrationNo);
    }
    if (!nullToAbsent || chassisNo != null) {
      map['chassis_no'] = Variable<String>(chassisNo);
    }
    if (!nullToAbsent || serialNo != null) {
      map['serial_no'] = Variable<String>(serialNo);
    }
    if (!nullToAbsent || vehicleType != null) {
      map['vehicle_type'] = Variable<String>(vehicleType);
    }
    if (!nullToAbsent || make != null) {
      map['make'] = Variable<String>(make);
    }
    if (!nullToAbsent || model != null) {
      map['model'] = Variable<String>(model);
    }
    if (!nullToAbsent || site != null) {
      map['site'] = Variable<String>(site);
    }
    if (!nullToAbsent || currentKm != null) {
      map['current_km'] = Variable<int>(currentKm);
    }
    if (!nullToAbsent || status != null) {
      map['status'] = Variable<String>(status);
    }
    if (!nullToAbsent || opsStatus != null) {
      map['ops_status'] = Variable<String>(opsStatus);
    }
    map['cached_at'] = Variable<DateTime>(cachedAt);
    return map;
  }

  CachedAssetsCompanion toCompanion(bool nullToAbsent) {
    return CachedAssetsCompanion(
      id: Value(id),
      workspaceId: Value(workspaceId),
      country: country == null && nullToAbsent
          ? const Value.absent()
          : Value(country),
      assetNo: Value(assetNo),
      assetNoNorm: Value(assetNoNorm),
      fleetNumber: fleetNumber == null && nullToAbsent
          ? const Value.absent()
          : Value(fleetNumber),
      registrationNo: registrationNo == null && nullToAbsent
          ? const Value.absent()
          : Value(registrationNo),
      chassisNo: chassisNo == null && nullToAbsent
          ? const Value.absent()
          : Value(chassisNo),
      serialNo: serialNo == null && nullToAbsent
          ? const Value.absent()
          : Value(serialNo),
      vehicleType: vehicleType == null && nullToAbsent
          ? const Value.absent()
          : Value(vehicleType),
      make: make == null && nullToAbsent ? const Value.absent() : Value(make),
      model:
          model == null && nullToAbsent ? const Value.absent() : Value(model),
      site: site == null && nullToAbsent ? const Value.absent() : Value(site),
      currentKm: currentKm == null && nullToAbsent
          ? const Value.absent()
          : Value(currentKm),
      status:
          status == null && nullToAbsent ? const Value.absent() : Value(status),
      opsStatus: opsStatus == null && nullToAbsent
          ? const Value.absent()
          : Value(opsStatus),
      cachedAt: Value(cachedAt),
    );
  }

  factory CachedAsset.fromJson(Map<String, dynamic> json,
      {ValueSerializer? serializer}) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return CachedAsset(
      id: serializer.fromJson<String>(json['id']),
      workspaceId: serializer.fromJson<String>(json['workspaceId']),
      country: serializer.fromJson<String?>(json['country']),
      assetNo: serializer.fromJson<String>(json['assetNo']),
      assetNoNorm: serializer.fromJson<String>(json['assetNoNorm']),
      fleetNumber: serializer.fromJson<String?>(json['fleetNumber']),
      registrationNo: serializer.fromJson<String?>(json['registrationNo']),
      chassisNo: serializer.fromJson<String?>(json['chassisNo']),
      serialNo: serializer.fromJson<String?>(json['serialNo']),
      vehicleType: serializer.fromJson<String?>(json['vehicleType']),
      make: serializer.fromJson<String?>(json['make']),
      model: serializer.fromJson<String?>(json['model']),
      site: serializer.fromJson<String?>(json['site']),
      currentKm: serializer.fromJson<int?>(json['currentKm']),
      status: serializer.fromJson<String?>(json['status']),
      opsStatus: serializer.fromJson<String?>(json['opsStatus']),
      cachedAt: serializer.fromJson<DateTime>(json['cachedAt']),
    );
  }
  @override
  Map<String, dynamic> toJson({ValueSerializer? serializer}) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return <String, dynamic>{
      'id': serializer.toJson<String>(id),
      'workspaceId': serializer.toJson<String>(workspaceId),
      'country': serializer.toJson<String?>(country),
      'assetNo': serializer.toJson<String>(assetNo),
      'assetNoNorm': serializer.toJson<String>(assetNoNorm),
      'fleetNumber': serializer.toJson<String?>(fleetNumber),
      'registrationNo': serializer.toJson<String?>(registrationNo),
      'chassisNo': serializer.toJson<String?>(chassisNo),
      'serialNo': serializer.toJson<String?>(serialNo),
      'vehicleType': serializer.toJson<String?>(vehicleType),
      'make': serializer.toJson<String?>(make),
      'model': serializer.toJson<String?>(model),
      'site': serializer.toJson<String?>(site),
      'currentKm': serializer.toJson<int?>(currentKm),
      'status': serializer.toJson<String?>(status),
      'opsStatus': serializer.toJson<String?>(opsStatus),
      'cachedAt': serializer.toJson<DateTime>(cachedAt),
    };
  }

  CachedAsset copyWith(
          {String? id,
          String? workspaceId,
          Value<String?> country = const Value.absent(),
          String? assetNo,
          String? assetNoNorm,
          Value<String?> fleetNumber = const Value.absent(),
          Value<String?> registrationNo = const Value.absent(),
          Value<String?> chassisNo = const Value.absent(),
          Value<String?> serialNo = const Value.absent(),
          Value<String?> vehicleType = const Value.absent(),
          Value<String?> make = const Value.absent(),
          Value<String?> model = const Value.absent(),
          Value<String?> site = const Value.absent(),
          Value<int?> currentKm = const Value.absent(),
          Value<String?> status = const Value.absent(),
          Value<String?> opsStatus = const Value.absent(),
          DateTime? cachedAt}) =>
      CachedAsset(
        id: id ?? this.id,
        workspaceId: workspaceId ?? this.workspaceId,
        country: country.present ? country.value : this.country,
        assetNo: assetNo ?? this.assetNo,
        assetNoNorm: assetNoNorm ?? this.assetNoNorm,
        fleetNumber: fleetNumber.present ? fleetNumber.value : this.fleetNumber,
        registrationNo:
            registrationNo.present ? registrationNo.value : this.registrationNo,
        chassisNo: chassisNo.present ? chassisNo.value : this.chassisNo,
        serialNo: serialNo.present ? serialNo.value : this.serialNo,
        vehicleType: vehicleType.present ? vehicleType.value : this.vehicleType,
        make: make.present ? make.value : this.make,
        model: model.present ? model.value : this.model,
        site: site.present ? site.value : this.site,
        currentKm: currentKm.present ? currentKm.value : this.currentKm,
        status: status.present ? status.value : this.status,
        opsStatus: opsStatus.present ? opsStatus.value : this.opsStatus,
        cachedAt: cachedAt ?? this.cachedAt,
      );
  CachedAsset copyWithCompanion(CachedAssetsCompanion data) {
    return CachedAsset(
      id: data.id.present ? data.id.value : this.id,
      workspaceId:
          data.workspaceId.present ? data.workspaceId.value : this.workspaceId,
      country: data.country.present ? data.country.value : this.country,
      assetNo: data.assetNo.present ? data.assetNo.value : this.assetNo,
      assetNoNorm:
          data.assetNoNorm.present ? data.assetNoNorm.value : this.assetNoNorm,
      fleetNumber:
          data.fleetNumber.present ? data.fleetNumber.value : this.fleetNumber,
      registrationNo: data.registrationNo.present
          ? data.registrationNo.value
          : this.registrationNo,
      chassisNo: data.chassisNo.present ? data.chassisNo.value : this.chassisNo,
      serialNo: data.serialNo.present ? data.serialNo.value : this.serialNo,
      vehicleType:
          data.vehicleType.present ? data.vehicleType.value : this.vehicleType,
      make: data.make.present ? data.make.value : this.make,
      model: data.model.present ? data.model.value : this.model,
      site: data.site.present ? data.site.value : this.site,
      currentKm: data.currentKm.present ? data.currentKm.value : this.currentKm,
      status: data.status.present ? data.status.value : this.status,
      opsStatus: data.opsStatus.present ? data.opsStatus.value : this.opsStatus,
      cachedAt: data.cachedAt.present ? data.cachedAt.value : this.cachedAt,
    );
  }

  @override
  String toString() {
    return (StringBuffer('CachedAsset(')
          ..write('id: $id, ')
          ..write('workspaceId: $workspaceId, ')
          ..write('country: $country, ')
          ..write('assetNo: $assetNo, ')
          ..write('assetNoNorm: $assetNoNorm, ')
          ..write('fleetNumber: $fleetNumber, ')
          ..write('registrationNo: $registrationNo, ')
          ..write('chassisNo: $chassisNo, ')
          ..write('serialNo: $serialNo, ')
          ..write('vehicleType: $vehicleType, ')
          ..write('make: $make, ')
          ..write('model: $model, ')
          ..write('site: $site, ')
          ..write('currentKm: $currentKm, ')
          ..write('status: $status, ')
          ..write('opsStatus: $opsStatus, ')
          ..write('cachedAt: $cachedAt')
          ..write(')'))
        .toString();
  }

  @override
  int get hashCode => Object.hash(
      id,
      workspaceId,
      country,
      assetNo,
      assetNoNorm,
      fleetNumber,
      registrationNo,
      chassisNo,
      serialNo,
      vehicleType,
      make,
      model,
      site,
      currentKm,
      status,
      opsStatus,
      cachedAt);
  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      (other is CachedAsset &&
          other.id == this.id &&
          other.workspaceId == this.workspaceId &&
          other.country == this.country &&
          other.assetNo == this.assetNo &&
          other.assetNoNorm == this.assetNoNorm &&
          other.fleetNumber == this.fleetNumber &&
          other.registrationNo == this.registrationNo &&
          other.chassisNo == this.chassisNo &&
          other.serialNo == this.serialNo &&
          other.vehicleType == this.vehicleType &&
          other.make == this.make &&
          other.model == this.model &&
          other.site == this.site &&
          other.currentKm == this.currentKm &&
          other.status == this.status &&
          other.opsStatus == this.opsStatus &&
          other.cachedAt == this.cachedAt);
}

class CachedAssetsCompanion extends UpdateCompanion<CachedAsset> {
  final Value<String> id;
  final Value<String> workspaceId;
  final Value<String?> country;
  final Value<String> assetNo;
  final Value<String> assetNoNorm;
  final Value<String?> fleetNumber;
  final Value<String?> registrationNo;
  final Value<String?> chassisNo;
  final Value<String?> serialNo;
  final Value<String?> vehicleType;
  final Value<String?> make;
  final Value<String?> model;
  final Value<String?> site;
  final Value<int?> currentKm;
  final Value<String?> status;
  final Value<String?> opsStatus;
  final Value<DateTime> cachedAt;
  final Value<int> rowid;
  const CachedAssetsCompanion({
    this.id = const Value.absent(),
    this.workspaceId = const Value.absent(),
    this.country = const Value.absent(),
    this.assetNo = const Value.absent(),
    this.assetNoNorm = const Value.absent(),
    this.fleetNumber = const Value.absent(),
    this.registrationNo = const Value.absent(),
    this.chassisNo = const Value.absent(),
    this.serialNo = const Value.absent(),
    this.vehicleType = const Value.absent(),
    this.make = const Value.absent(),
    this.model = const Value.absent(),
    this.site = const Value.absent(),
    this.currentKm = const Value.absent(),
    this.status = const Value.absent(),
    this.opsStatus = const Value.absent(),
    this.cachedAt = const Value.absent(),
    this.rowid = const Value.absent(),
  });
  CachedAssetsCompanion.insert({
    required String id,
    required String workspaceId,
    this.country = const Value.absent(),
    required String assetNo,
    required String assetNoNorm,
    this.fleetNumber = const Value.absent(),
    this.registrationNo = const Value.absent(),
    this.chassisNo = const Value.absent(),
    this.serialNo = const Value.absent(),
    this.vehicleType = const Value.absent(),
    this.make = const Value.absent(),
    this.model = const Value.absent(),
    this.site = const Value.absent(),
    this.currentKm = const Value.absent(),
    this.status = const Value.absent(),
    this.opsStatus = const Value.absent(),
    required DateTime cachedAt,
    this.rowid = const Value.absent(),
  })  : id = Value(id),
        workspaceId = Value(workspaceId),
        assetNo = Value(assetNo),
        assetNoNorm = Value(assetNoNorm),
        cachedAt = Value(cachedAt);
  static Insertable<CachedAsset> custom({
    Expression<String>? id,
    Expression<String>? workspaceId,
    Expression<String>? country,
    Expression<String>? assetNo,
    Expression<String>? assetNoNorm,
    Expression<String>? fleetNumber,
    Expression<String>? registrationNo,
    Expression<String>? chassisNo,
    Expression<String>? serialNo,
    Expression<String>? vehicleType,
    Expression<String>? make,
    Expression<String>? model,
    Expression<String>? site,
    Expression<int>? currentKm,
    Expression<String>? status,
    Expression<String>? opsStatus,
    Expression<DateTime>? cachedAt,
    Expression<int>? rowid,
  }) {
    return RawValuesInsertable({
      if (id != null) 'id': id,
      if (workspaceId != null) 'workspace_id': workspaceId,
      if (country != null) 'country': country,
      if (assetNo != null) 'asset_no': assetNo,
      if (assetNoNorm != null) 'asset_no_norm': assetNoNorm,
      if (fleetNumber != null) 'fleet_number': fleetNumber,
      if (registrationNo != null) 'registration_no': registrationNo,
      if (chassisNo != null) 'chassis_no': chassisNo,
      if (serialNo != null) 'serial_no': serialNo,
      if (vehicleType != null) 'vehicle_type': vehicleType,
      if (make != null) 'make': make,
      if (model != null) 'model': model,
      if (site != null) 'site': site,
      if (currentKm != null) 'current_km': currentKm,
      if (status != null) 'status': status,
      if (opsStatus != null) 'ops_status': opsStatus,
      if (cachedAt != null) 'cached_at': cachedAt,
      if (rowid != null) 'rowid': rowid,
    });
  }

  CachedAssetsCompanion copyWith(
      {Value<String>? id,
      Value<String>? workspaceId,
      Value<String?>? country,
      Value<String>? assetNo,
      Value<String>? assetNoNorm,
      Value<String?>? fleetNumber,
      Value<String?>? registrationNo,
      Value<String?>? chassisNo,
      Value<String?>? serialNo,
      Value<String?>? vehicleType,
      Value<String?>? make,
      Value<String?>? model,
      Value<String?>? site,
      Value<int?>? currentKm,
      Value<String?>? status,
      Value<String?>? opsStatus,
      Value<DateTime>? cachedAt,
      Value<int>? rowid}) {
    return CachedAssetsCompanion(
      id: id ?? this.id,
      workspaceId: workspaceId ?? this.workspaceId,
      country: country ?? this.country,
      assetNo: assetNo ?? this.assetNo,
      assetNoNorm: assetNoNorm ?? this.assetNoNorm,
      fleetNumber: fleetNumber ?? this.fleetNumber,
      registrationNo: registrationNo ?? this.registrationNo,
      chassisNo: chassisNo ?? this.chassisNo,
      serialNo: serialNo ?? this.serialNo,
      vehicleType: vehicleType ?? this.vehicleType,
      make: make ?? this.make,
      model: model ?? this.model,
      site: site ?? this.site,
      currentKm: currentKm ?? this.currentKm,
      status: status ?? this.status,
      opsStatus: opsStatus ?? this.opsStatus,
      cachedAt: cachedAt ?? this.cachedAt,
      rowid: rowid ?? this.rowid,
    );
  }

  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    if (id.present) {
      map['id'] = Variable<String>(id.value);
    }
    if (workspaceId.present) {
      map['workspace_id'] = Variable<String>(workspaceId.value);
    }
    if (country.present) {
      map['country'] = Variable<String>(country.value);
    }
    if (assetNo.present) {
      map['asset_no'] = Variable<String>(assetNo.value);
    }
    if (assetNoNorm.present) {
      map['asset_no_norm'] = Variable<String>(assetNoNorm.value);
    }
    if (fleetNumber.present) {
      map['fleet_number'] = Variable<String>(fleetNumber.value);
    }
    if (registrationNo.present) {
      map['registration_no'] = Variable<String>(registrationNo.value);
    }
    if (chassisNo.present) {
      map['chassis_no'] = Variable<String>(chassisNo.value);
    }
    if (serialNo.present) {
      map['serial_no'] = Variable<String>(serialNo.value);
    }
    if (vehicleType.present) {
      map['vehicle_type'] = Variable<String>(vehicleType.value);
    }
    if (make.present) {
      map['make'] = Variable<String>(make.value);
    }
    if (model.present) {
      map['model'] = Variable<String>(model.value);
    }
    if (site.present) {
      map['site'] = Variable<String>(site.value);
    }
    if (currentKm.present) {
      map['current_km'] = Variable<int>(currentKm.value);
    }
    if (status.present) {
      map['status'] = Variable<String>(status.value);
    }
    if (opsStatus.present) {
      map['ops_status'] = Variable<String>(opsStatus.value);
    }
    if (cachedAt.present) {
      map['cached_at'] = Variable<DateTime>(cachedAt.value);
    }
    if (rowid.present) {
      map['rowid'] = Variable<int>(rowid.value);
    }
    return map;
  }

  @override
  String toString() {
    return (StringBuffer('CachedAssetsCompanion(')
          ..write('id: $id, ')
          ..write('workspaceId: $workspaceId, ')
          ..write('country: $country, ')
          ..write('assetNo: $assetNo, ')
          ..write('assetNoNorm: $assetNoNorm, ')
          ..write('fleetNumber: $fleetNumber, ')
          ..write('registrationNo: $registrationNo, ')
          ..write('chassisNo: $chassisNo, ')
          ..write('serialNo: $serialNo, ')
          ..write('vehicleType: $vehicleType, ')
          ..write('make: $make, ')
          ..write('model: $model, ')
          ..write('site: $site, ')
          ..write('currentKm: $currentKm, ')
          ..write('status: $status, ')
          ..write('opsStatus: $opsStatus, ')
          ..write('cachedAt: $cachedAt, ')
          ..write('rowid: $rowid')
          ..write(')'))
        .toString();
  }
}

class $CachedTyresTable extends CachedTyres
    with TableInfo<$CachedTyresTable, CachedTyre> {
  @override
  final GeneratedDatabase attachedDatabase;
  final String? _alias;
  $CachedTyresTable(this.attachedDatabase, [this._alias]);
  static const VerificationMeta _idMeta = const VerificationMeta('id');
  @override
  late final GeneratedColumn<String> id = GeneratedColumn<String>(
      'id', aliasedName, false,
      type: DriftSqlType.string, requiredDuringInsert: true);
  static const VerificationMeta _workspaceIdMeta =
      const VerificationMeta('workspaceId');
  @override
  late final GeneratedColumn<String> workspaceId = GeneratedColumn<String>(
      'workspace_id', aliasedName, false,
      type: DriftSqlType.string, requiredDuringInsert: true);
  static const VerificationMeta _countryMeta =
      const VerificationMeta('country');
  @override
  late final GeneratedColumn<String> country = GeneratedColumn<String>(
      'country', aliasedName, true,
      type: DriftSqlType.string, requiredDuringInsert: false);
  static const VerificationMeta _serialNoMeta =
      const VerificationMeta('serialNo');
  @override
  late final GeneratedColumn<String> serialNo = GeneratedColumn<String>(
      'serial_no', aliasedName, true,
      type: DriftSqlType.string, requiredDuringInsert: false);
  static const VerificationMeta _serialNoNormMeta =
      const VerificationMeta('serialNoNorm');
  @override
  late final GeneratedColumn<String> serialNoNorm = GeneratedColumn<String>(
      'serial_no_norm', aliasedName, true,
      type: DriftSqlType.string, requiredDuringInsert: false);
  static const VerificationMeta _assetNoMeta =
      const VerificationMeta('assetNo');
  @override
  late final GeneratedColumn<String> assetNo = GeneratedColumn<String>(
      'asset_no', aliasedName, true,
      type: DriftSqlType.string, requiredDuringInsert: false);
  static const VerificationMeta _positionMeta =
      const VerificationMeta('position');
  @override
  late final GeneratedColumn<String> position = GeneratedColumn<String>(
      'position', aliasedName, true,
      type: DriftSqlType.string, requiredDuringInsert: false);
  static const VerificationMeta _brandMeta = const VerificationMeta('brand');
  @override
  late final GeneratedColumn<String> brand = GeneratedColumn<String>(
      'brand', aliasedName, true,
      type: DriftSqlType.string, requiredDuringInsert: false);
  static const VerificationMeta _sizeMeta = const VerificationMeta('size');
  @override
  late final GeneratedColumn<String> size = GeneratedColumn<String>(
      'size', aliasedName, true,
      type: DriftSqlType.string, requiredDuringInsert: false);
  static const VerificationMeta _statusMeta = const VerificationMeta('status');
  @override
  late final GeneratedColumn<String> status = GeneratedColumn<String>(
      'status', aliasedName, true,
      type: DriftSqlType.string, requiredDuringInsert: false);
  static const VerificationMeta _issueDateMeta =
      const VerificationMeta('issueDate');
  @override
  late final GeneratedColumn<DateTime> issueDate = GeneratedColumn<DateTime>(
      'issue_date', aliasedName, true,
      type: DriftSqlType.dateTime, requiredDuringInsert: false);
  static const VerificationMeta _removalDateMeta =
      const VerificationMeta('removalDate');
  @override
  late final GeneratedColumn<DateTime> removalDate = GeneratedColumn<DateTime>(
      'removal_date', aliasedName, true,
      type: DriftSqlType.dateTime, requiredDuringInsert: false);
  static const VerificationMeta _kmAtFitmentMeta =
      const VerificationMeta('kmAtFitment');
  @override
  late final GeneratedColumn<int> kmAtFitment = GeneratedColumn<int>(
      'km_at_fitment', aliasedName, true,
      type: DriftSqlType.int, requiredDuringInsert: false);
  static const VerificationMeta _kmAtRemovalMeta =
      const VerificationMeta('kmAtRemoval');
  @override
  late final GeneratedColumn<int> kmAtRemoval = GeneratedColumn<int>(
      'km_at_removal', aliasedName, true,
      type: DriftSqlType.int, requiredDuringInsert: false);
  static const VerificationMeta _totalKmMeta =
      const VerificationMeta('totalKm');
  @override
  late final GeneratedColumn<int> totalKm = GeneratedColumn<int>(
      'total_km', aliasedName, true,
      type: DriftSqlType.int, requiredDuringInsert: false);
  static const VerificationMeta _removalReasonMeta =
      const VerificationMeta('removalReason');
  @override
  late final GeneratedColumn<String> removalReason = GeneratedColumn<String>(
      'removal_reason', aliasedName, true,
      type: DriftSqlType.string, requiredDuringInsert: false);
  static const VerificationMeta _lastSeenAtMeta =
      const VerificationMeta('lastSeenAt');
  @override
  late final GeneratedColumn<DateTime> lastSeenAt = GeneratedColumn<DateTime>(
      'last_seen_at', aliasedName, false,
      type: DriftSqlType.dateTime, requiredDuringInsert: true);
  static const VerificationMeta _cachedAtMeta =
      const VerificationMeta('cachedAt');
  @override
  late final GeneratedColumn<DateTime> cachedAt = GeneratedColumn<DateTime>(
      'cached_at', aliasedName, false,
      type: DriftSqlType.dateTime, requiredDuringInsert: true);
  @override
  List<GeneratedColumn> get $columns => [
        id,
        workspaceId,
        country,
        serialNo,
        serialNoNorm,
        assetNo,
        position,
        brand,
        size,
        status,
        issueDate,
        removalDate,
        kmAtFitment,
        kmAtRemoval,
        totalKm,
        removalReason,
        lastSeenAt,
        cachedAt
      ];
  @override
  String get aliasedName => _alias ?? actualTableName;
  @override
  String get actualTableName => $name;
  static const String $name = 'cached_tyres';
  @override
  VerificationContext validateIntegrity(Insertable<CachedTyre> instance,
      {bool isInserting = false}) {
    final context = VerificationContext();
    final data = instance.toColumns(true);
    if (data.containsKey('id')) {
      context.handle(_idMeta, id.isAcceptableOrUnknown(data['id']!, _idMeta));
    } else if (isInserting) {
      context.missing(_idMeta);
    }
    if (data.containsKey('workspace_id')) {
      context.handle(
          _workspaceIdMeta,
          workspaceId.isAcceptableOrUnknown(
              data['workspace_id']!, _workspaceIdMeta));
    } else if (isInserting) {
      context.missing(_workspaceIdMeta);
    }
    if (data.containsKey('country')) {
      context.handle(_countryMeta,
          country.isAcceptableOrUnknown(data['country']!, _countryMeta));
    }
    if (data.containsKey('serial_no')) {
      context.handle(_serialNoMeta,
          serialNo.isAcceptableOrUnknown(data['serial_no']!, _serialNoMeta));
    }
    if (data.containsKey('serial_no_norm')) {
      context.handle(
          _serialNoNormMeta,
          serialNoNorm.isAcceptableOrUnknown(
              data['serial_no_norm']!, _serialNoNormMeta));
    }
    if (data.containsKey('asset_no')) {
      context.handle(_assetNoMeta,
          assetNo.isAcceptableOrUnknown(data['asset_no']!, _assetNoMeta));
    }
    if (data.containsKey('position')) {
      context.handle(_positionMeta,
          position.isAcceptableOrUnknown(data['position']!, _positionMeta));
    }
    if (data.containsKey('brand')) {
      context.handle(
          _brandMeta, brand.isAcceptableOrUnknown(data['brand']!, _brandMeta));
    }
    if (data.containsKey('size')) {
      context.handle(
          _sizeMeta, size.isAcceptableOrUnknown(data['size']!, _sizeMeta));
    }
    if (data.containsKey('status')) {
      context.handle(_statusMeta,
          status.isAcceptableOrUnknown(data['status']!, _statusMeta));
    }
    if (data.containsKey('issue_date')) {
      context.handle(_issueDateMeta,
          issueDate.isAcceptableOrUnknown(data['issue_date']!, _issueDateMeta));
    }
    if (data.containsKey('removal_date')) {
      context.handle(
          _removalDateMeta,
          removalDate.isAcceptableOrUnknown(
              data['removal_date']!, _removalDateMeta));
    }
    if (data.containsKey('km_at_fitment')) {
      context.handle(
          _kmAtFitmentMeta,
          kmAtFitment.isAcceptableOrUnknown(
              data['km_at_fitment']!, _kmAtFitmentMeta));
    }
    if (data.containsKey('km_at_removal')) {
      context.handle(
          _kmAtRemovalMeta,
          kmAtRemoval.isAcceptableOrUnknown(
              data['km_at_removal']!, _kmAtRemovalMeta));
    }
    if (data.containsKey('total_km')) {
      context.handle(_totalKmMeta,
          totalKm.isAcceptableOrUnknown(data['total_km']!, _totalKmMeta));
    }
    if (data.containsKey('removal_reason')) {
      context.handle(
          _removalReasonMeta,
          removalReason.isAcceptableOrUnknown(
              data['removal_reason']!, _removalReasonMeta));
    }
    if (data.containsKey('last_seen_at')) {
      context.handle(
          _lastSeenAtMeta,
          lastSeenAt.isAcceptableOrUnknown(
              data['last_seen_at']!, _lastSeenAtMeta));
    } else if (isInserting) {
      context.missing(_lastSeenAtMeta);
    }
    if (data.containsKey('cached_at')) {
      context.handle(_cachedAtMeta,
          cachedAt.isAcceptableOrUnknown(data['cached_at']!, _cachedAtMeta));
    } else if (isInserting) {
      context.missing(_cachedAtMeta);
    }
    return context;
  }

  @override
  Set<GeneratedColumn> get $primaryKey => {id};
  @override
  CachedTyre map(Map<String, dynamic> data, {String? tablePrefix}) {
    final effectivePrefix = tablePrefix != null ? '$tablePrefix.' : '';
    return CachedTyre(
      id: attachedDatabase.typeMapping
          .read(DriftSqlType.string, data['${effectivePrefix}id'])!,
      workspaceId: attachedDatabase.typeMapping
          .read(DriftSqlType.string, data['${effectivePrefix}workspace_id'])!,
      country: attachedDatabase.typeMapping
          .read(DriftSqlType.string, data['${effectivePrefix}country']),
      serialNo: attachedDatabase.typeMapping
          .read(DriftSqlType.string, data['${effectivePrefix}serial_no']),
      serialNoNorm: attachedDatabase.typeMapping
          .read(DriftSqlType.string, data['${effectivePrefix}serial_no_norm']),
      assetNo: attachedDatabase.typeMapping
          .read(DriftSqlType.string, data['${effectivePrefix}asset_no']),
      position: attachedDatabase.typeMapping
          .read(DriftSqlType.string, data['${effectivePrefix}position']),
      brand: attachedDatabase.typeMapping
          .read(DriftSqlType.string, data['${effectivePrefix}brand']),
      size: attachedDatabase.typeMapping
          .read(DriftSqlType.string, data['${effectivePrefix}size']),
      status: attachedDatabase.typeMapping
          .read(DriftSqlType.string, data['${effectivePrefix}status']),
      issueDate: attachedDatabase.typeMapping
          .read(DriftSqlType.dateTime, data['${effectivePrefix}issue_date']),
      removalDate: attachedDatabase.typeMapping
          .read(DriftSqlType.dateTime, data['${effectivePrefix}removal_date']),
      kmAtFitment: attachedDatabase.typeMapping
          .read(DriftSqlType.int, data['${effectivePrefix}km_at_fitment']),
      kmAtRemoval: attachedDatabase.typeMapping
          .read(DriftSqlType.int, data['${effectivePrefix}km_at_removal']),
      totalKm: attachedDatabase.typeMapping
          .read(DriftSqlType.int, data['${effectivePrefix}total_km']),
      removalReason: attachedDatabase.typeMapping
          .read(DriftSqlType.string, data['${effectivePrefix}removal_reason']),
      lastSeenAt: attachedDatabase.typeMapping
          .read(DriftSqlType.dateTime, data['${effectivePrefix}last_seen_at'])!,
      cachedAt: attachedDatabase.typeMapping
          .read(DriftSqlType.dateTime, data['${effectivePrefix}cached_at'])!,
    );
  }

  @override
  $CachedTyresTable createAlias(String alias) {
    return $CachedTyresTable(attachedDatabase, alias);
  }
}

class CachedTyre extends DataClass implements Insertable<CachedTyre> {
  final String id;
  final String workspaceId;
  final String? country;

  /// Nullable: RECORDED, some rows carry no serial at all.
  final String? serialNo;

  /// Trimmed and uppercased. A LOOKUP aid that must never be written back.
  ///
  /// RECORDED: the server's `serial_no` is case-split - one real tyre's life is
  /// recorded half under `k507B403590` and half under `K507B403590` - and the
  /// recorded decision was explicitly NOT to normalise the column, because the
  /// barcode lookup is a case-sensitive `.eq()` and uppercasing it turns a
  /// split-history bug into a cannot-find-the-tyre bug in the field. So: search
  /// locally through this column to HELP the technician find the row, then send
  /// [serialNo] verbatim in any command.
  final String? serialNoNorm;
  final String? assetNo;

  /// Canonical GCC position label. Never re-derived on the client: AGENTS.md
  /// rule 10 forbids changing tyre position ids.
  final String? position;
  final String? brand;
  final String? size;

  /// Active / Removed / Scrapped.
  final String? status;

  /// Fitment.
  final DateTime? issueDate;
  final DateTime? removalDate;
  final int? kmAtFitment;
  final int? kmAtRemoval;
  final int? totalKm;
  final String? removalReason;

  /// Drives count-based pruning. Touched every time the row is looked at, not
  /// every time it is refetched.
  final DateTime lastSeenAt;
  final DateTime cachedAt;
  const CachedTyre(
      {required this.id,
      required this.workspaceId,
      this.country,
      this.serialNo,
      this.serialNoNorm,
      this.assetNo,
      this.position,
      this.brand,
      this.size,
      this.status,
      this.issueDate,
      this.removalDate,
      this.kmAtFitment,
      this.kmAtRemoval,
      this.totalKm,
      this.removalReason,
      required this.lastSeenAt,
      required this.cachedAt});
  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    map['id'] = Variable<String>(id);
    map['workspace_id'] = Variable<String>(workspaceId);
    if (!nullToAbsent || country != null) {
      map['country'] = Variable<String>(country);
    }
    if (!nullToAbsent || serialNo != null) {
      map['serial_no'] = Variable<String>(serialNo);
    }
    if (!nullToAbsent || serialNoNorm != null) {
      map['serial_no_norm'] = Variable<String>(serialNoNorm);
    }
    if (!nullToAbsent || assetNo != null) {
      map['asset_no'] = Variable<String>(assetNo);
    }
    if (!nullToAbsent || position != null) {
      map['position'] = Variable<String>(position);
    }
    if (!nullToAbsent || brand != null) {
      map['brand'] = Variable<String>(brand);
    }
    if (!nullToAbsent || size != null) {
      map['size'] = Variable<String>(size);
    }
    if (!nullToAbsent || status != null) {
      map['status'] = Variable<String>(status);
    }
    if (!nullToAbsent || issueDate != null) {
      map['issue_date'] = Variable<DateTime>(issueDate);
    }
    if (!nullToAbsent || removalDate != null) {
      map['removal_date'] = Variable<DateTime>(removalDate);
    }
    if (!nullToAbsent || kmAtFitment != null) {
      map['km_at_fitment'] = Variable<int>(kmAtFitment);
    }
    if (!nullToAbsent || kmAtRemoval != null) {
      map['km_at_removal'] = Variable<int>(kmAtRemoval);
    }
    if (!nullToAbsent || totalKm != null) {
      map['total_km'] = Variable<int>(totalKm);
    }
    if (!nullToAbsent || removalReason != null) {
      map['removal_reason'] = Variable<String>(removalReason);
    }
    map['last_seen_at'] = Variable<DateTime>(lastSeenAt);
    map['cached_at'] = Variable<DateTime>(cachedAt);
    return map;
  }

  CachedTyresCompanion toCompanion(bool nullToAbsent) {
    return CachedTyresCompanion(
      id: Value(id),
      workspaceId: Value(workspaceId),
      country: country == null && nullToAbsent
          ? const Value.absent()
          : Value(country),
      serialNo: serialNo == null && nullToAbsent
          ? const Value.absent()
          : Value(serialNo),
      serialNoNorm: serialNoNorm == null && nullToAbsent
          ? const Value.absent()
          : Value(serialNoNorm),
      assetNo: assetNo == null && nullToAbsent
          ? const Value.absent()
          : Value(assetNo),
      position: position == null && nullToAbsent
          ? const Value.absent()
          : Value(position),
      brand:
          brand == null && nullToAbsent ? const Value.absent() : Value(brand),
      size: size == null && nullToAbsent ? const Value.absent() : Value(size),
      status:
          status == null && nullToAbsent ? const Value.absent() : Value(status),
      issueDate: issueDate == null && nullToAbsent
          ? const Value.absent()
          : Value(issueDate),
      removalDate: removalDate == null && nullToAbsent
          ? const Value.absent()
          : Value(removalDate),
      kmAtFitment: kmAtFitment == null && nullToAbsent
          ? const Value.absent()
          : Value(kmAtFitment),
      kmAtRemoval: kmAtRemoval == null && nullToAbsent
          ? const Value.absent()
          : Value(kmAtRemoval),
      totalKm: totalKm == null && nullToAbsent
          ? const Value.absent()
          : Value(totalKm),
      removalReason: removalReason == null && nullToAbsent
          ? const Value.absent()
          : Value(removalReason),
      lastSeenAt: Value(lastSeenAt),
      cachedAt: Value(cachedAt),
    );
  }

  factory CachedTyre.fromJson(Map<String, dynamic> json,
      {ValueSerializer? serializer}) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return CachedTyre(
      id: serializer.fromJson<String>(json['id']),
      workspaceId: serializer.fromJson<String>(json['workspaceId']),
      country: serializer.fromJson<String?>(json['country']),
      serialNo: serializer.fromJson<String?>(json['serialNo']),
      serialNoNorm: serializer.fromJson<String?>(json['serialNoNorm']),
      assetNo: serializer.fromJson<String?>(json['assetNo']),
      position: serializer.fromJson<String?>(json['position']),
      brand: serializer.fromJson<String?>(json['brand']),
      size: serializer.fromJson<String?>(json['size']),
      status: serializer.fromJson<String?>(json['status']),
      issueDate: serializer.fromJson<DateTime?>(json['issueDate']),
      removalDate: serializer.fromJson<DateTime?>(json['removalDate']),
      kmAtFitment: serializer.fromJson<int?>(json['kmAtFitment']),
      kmAtRemoval: serializer.fromJson<int?>(json['kmAtRemoval']),
      totalKm: serializer.fromJson<int?>(json['totalKm']),
      removalReason: serializer.fromJson<String?>(json['removalReason']),
      lastSeenAt: serializer.fromJson<DateTime>(json['lastSeenAt']),
      cachedAt: serializer.fromJson<DateTime>(json['cachedAt']),
    );
  }
  @override
  Map<String, dynamic> toJson({ValueSerializer? serializer}) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return <String, dynamic>{
      'id': serializer.toJson<String>(id),
      'workspaceId': serializer.toJson<String>(workspaceId),
      'country': serializer.toJson<String?>(country),
      'serialNo': serializer.toJson<String?>(serialNo),
      'serialNoNorm': serializer.toJson<String?>(serialNoNorm),
      'assetNo': serializer.toJson<String?>(assetNo),
      'position': serializer.toJson<String?>(position),
      'brand': serializer.toJson<String?>(brand),
      'size': serializer.toJson<String?>(size),
      'status': serializer.toJson<String?>(status),
      'issueDate': serializer.toJson<DateTime?>(issueDate),
      'removalDate': serializer.toJson<DateTime?>(removalDate),
      'kmAtFitment': serializer.toJson<int?>(kmAtFitment),
      'kmAtRemoval': serializer.toJson<int?>(kmAtRemoval),
      'totalKm': serializer.toJson<int?>(totalKm),
      'removalReason': serializer.toJson<String?>(removalReason),
      'lastSeenAt': serializer.toJson<DateTime>(lastSeenAt),
      'cachedAt': serializer.toJson<DateTime>(cachedAt),
    };
  }

  CachedTyre copyWith(
          {String? id,
          String? workspaceId,
          Value<String?> country = const Value.absent(),
          Value<String?> serialNo = const Value.absent(),
          Value<String?> serialNoNorm = const Value.absent(),
          Value<String?> assetNo = const Value.absent(),
          Value<String?> position = const Value.absent(),
          Value<String?> brand = const Value.absent(),
          Value<String?> size = const Value.absent(),
          Value<String?> status = const Value.absent(),
          Value<DateTime?> issueDate = const Value.absent(),
          Value<DateTime?> removalDate = const Value.absent(),
          Value<int?> kmAtFitment = const Value.absent(),
          Value<int?> kmAtRemoval = const Value.absent(),
          Value<int?> totalKm = const Value.absent(),
          Value<String?> removalReason = const Value.absent(),
          DateTime? lastSeenAt,
          DateTime? cachedAt}) =>
      CachedTyre(
        id: id ?? this.id,
        workspaceId: workspaceId ?? this.workspaceId,
        country: country.present ? country.value : this.country,
        serialNo: serialNo.present ? serialNo.value : this.serialNo,
        serialNoNorm:
            serialNoNorm.present ? serialNoNorm.value : this.serialNoNorm,
        assetNo: assetNo.present ? assetNo.value : this.assetNo,
        position: position.present ? position.value : this.position,
        brand: brand.present ? brand.value : this.brand,
        size: size.present ? size.value : this.size,
        status: status.present ? status.value : this.status,
        issueDate: issueDate.present ? issueDate.value : this.issueDate,
        removalDate: removalDate.present ? removalDate.value : this.removalDate,
        kmAtFitment: kmAtFitment.present ? kmAtFitment.value : this.kmAtFitment,
        kmAtRemoval: kmAtRemoval.present ? kmAtRemoval.value : this.kmAtRemoval,
        totalKm: totalKm.present ? totalKm.value : this.totalKm,
        removalReason:
            removalReason.present ? removalReason.value : this.removalReason,
        lastSeenAt: lastSeenAt ?? this.lastSeenAt,
        cachedAt: cachedAt ?? this.cachedAt,
      );
  CachedTyre copyWithCompanion(CachedTyresCompanion data) {
    return CachedTyre(
      id: data.id.present ? data.id.value : this.id,
      workspaceId:
          data.workspaceId.present ? data.workspaceId.value : this.workspaceId,
      country: data.country.present ? data.country.value : this.country,
      serialNo: data.serialNo.present ? data.serialNo.value : this.serialNo,
      serialNoNorm: data.serialNoNorm.present
          ? data.serialNoNorm.value
          : this.serialNoNorm,
      assetNo: data.assetNo.present ? data.assetNo.value : this.assetNo,
      position: data.position.present ? data.position.value : this.position,
      brand: data.brand.present ? data.brand.value : this.brand,
      size: data.size.present ? data.size.value : this.size,
      status: data.status.present ? data.status.value : this.status,
      issueDate: data.issueDate.present ? data.issueDate.value : this.issueDate,
      removalDate:
          data.removalDate.present ? data.removalDate.value : this.removalDate,
      kmAtFitment:
          data.kmAtFitment.present ? data.kmAtFitment.value : this.kmAtFitment,
      kmAtRemoval:
          data.kmAtRemoval.present ? data.kmAtRemoval.value : this.kmAtRemoval,
      totalKm: data.totalKm.present ? data.totalKm.value : this.totalKm,
      removalReason: data.removalReason.present
          ? data.removalReason.value
          : this.removalReason,
      lastSeenAt:
          data.lastSeenAt.present ? data.lastSeenAt.value : this.lastSeenAt,
      cachedAt: data.cachedAt.present ? data.cachedAt.value : this.cachedAt,
    );
  }

  @override
  String toString() {
    return (StringBuffer('CachedTyre(')
          ..write('id: $id, ')
          ..write('workspaceId: $workspaceId, ')
          ..write('country: $country, ')
          ..write('serialNo: $serialNo, ')
          ..write('serialNoNorm: $serialNoNorm, ')
          ..write('assetNo: $assetNo, ')
          ..write('position: $position, ')
          ..write('brand: $brand, ')
          ..write('size: $size, ')
          ..write('status: $status, ')
          ..write('issueDate: $issueDate, ')
          ..write('removalDate: $removalDate, ')
          ..write('kmAtFitment: $kmAtFitment, ')
          ..write('kmAtRemoval: $kmAtRemoval, ')
          ..write('totalKm: $totalKm, ')
          ..write('removalReason: $removalReason, ')
          ..write('lastSeenAt: $lastSeenAt, ')
          ..write('cachedAt: $cachedAt')
          ..write(')'))
        .toString();
  }

  @override
  int get hashCode => Object.hash(
      id,
      workspaceId,
      country,
      serialNo,
      serialNoNorm,
      assetNo,
      position,
      brand,
      size,
      status,
      issueDate,
      removalDate,
      kmAtFitment,
      kmAtRemoval,
      totalKm,
      removalReason,
      lastSeenAt,
      cachedAt);
  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      (other is CachedTyre &&
          other.id == this.id &&
          other.workspaceId == this.workspaceId &&
          other.country == this.country &&
          other.serialNo == this.serialNo &&
          other.serialNoNorm == this.serialNoNorm &&
          other.assetNo == this.assetNo &&
          other.position == this.position &&
          other.brand == this.brand &&
          other.size == this.size &&
          other.status == this.status &&
          other.issueDate == this.issueDate &&
          other.removalDate == this.removalDate &&
          other.kmAtFitment == this.kmAtFitment &&
          other.kmAtRemoval == this.kmAtRemoval &&
          other.totalKm == this.totalKm &&
          other.removalReason == this.removalReason &&
          other.lastSeenAt == this.lastSeenAt &&
          other.cachedAt == this.cachedAt);
}

class CachedTyresCompanion extends UpdateCompanion<CachedTyre> {
  final Value<String> id;
  final Value<String> workspaceId;
  final Value<String?> country;
  final Value<String?> serialNo;
  final Value<String?> serialNoNorm;
  final Value<String?> assetNo;
  final Value<String?> position;
  final Value<String?> brand;
  final Value<String?> size;
  final Value<String?> status;
  final Value<DateTime?> issueDate;
  final Value<DateTime?> removalDate;
  final Value<int?> kmAtFitment;
  final Value<int?> kmAtRemoval;
  final Value<int?> totalKm;
  final Value<String?> removalReason;
  final Value<DateTime> lastSeenAt;
  final Value<DateTime> cachedAt;
  final Value<int> rowid;
  const CachedTyresCompanion({
    this.id = const Value.absent(),
    this.workspaceId = const Value.absent(),
    this.country = const Value.absent(),
    this.serialNo = const Value.absent(),
    this.serialNoNorm = const Value.absent(),
    this.assetNo = const Value.absent(),
    this.position = const Value.absent(),
    this.brand = const Value.absent(),
    this.size = const Value.absent(),
    this.status = const Value.absent(),
    this.issueDate = const Value.absent(),
    this.removalDate = const Value.absent(),
    this.kmAtFitment = const Value.absent(),
    this.kmAtRemoval = const Value.absent(),
    this.totalKm = const Value.absent(),
    this.removalReason = const Value.absent(),
    this.lastSeenAt = const Value.absent(),
    this.cachedAt = const Value.absent(),
    this.rowid = const Value.absent(),
  });
  CachedTyresCompanion.insert({
    required String id,
    required String workspaceId,
    this.country = const Value.absent(),
    this.serialNo = const Value.absent(),
    this.serialNoNorm = const Value.absent(),
    this.assetNo = const Value.absent(),
    this.position = const Value.absent(),
    this.brand = const Value.absent(),
    this.size = const Value.absent(),
    this.status = const Value.absent(),
    this.issueDate = const Value.absent(),
    this.removalDate = const Value.absent(),
    this.kmAtFitment = const Value.absent(),
    this.kmAtRemoval = const Value.absent(),
    this.totalKm = const Value.absent(),
    this.removalReason = const Value.absent(),
    required DateTime lastSeenAt,
    required DateTime cachedAt,
    this.rowid = const Value.absent(),
  })  : id = Value(id),
        workspaceId = Value(workspaceId),
        lastSeenAt = Value(lastSeenAt),
        cachedAt = Value(cachedAt);
  static Insertable<CachedTyre> custom({
    Expression<String>? id,
    Expression<String>? workspaceId,
    Expression<String>? country,
    Expression<String>? serialNo,
    Expression<String>? serialNoNorm,
    Expression<String>? assetNo,
    Expression<String>? position,
    Expression<String>? brand,
    Expression<String>? size,
    Expression<String>? status,
    Expression<DateTime>? issueDate,
    Expression<DateTime>? removalDate,
    Expression<int>? kmAtFitment,
    Expression<int>? kmAtRemoval,
    Expression<int>? totalKm,
    Expression<String>? removalReason,
    Expression<DateTime>? lastSeenAt,
    Expression<DateTime>? cachedAt,
    Expression<int>? rowid,
  }) {
    return RawValuesInsertable({
      if (id != null) 'id': id,
      if (workspaceId != null) 'workspace_id': workspaceId,
      if (country != null) 'country': country,
      if (serialNo != null) 'serial_no': serialNo,
      if (serialNoNorm != null) 'serial_no_norm': serialNoNorm,
      if (assetNo != null) 'asset_no': assetNo,
      if (position != null) 'position': position,
      if (brand != null) 'brand': brand,
      if (size != null) 'size': size,
      if (status != null) 'status': status,
      if (issueDate != null) 'issue_date': issueDate,
      if (removalDate != null) 'removal_date': removalDate,
      if (kmAtFitment != null) 'km_at_fitment': kmAtFitment,
      if (kmAtRemoval != null) 'km_at_removal': kmAtRemoval,
      if (totalKm != null) 'total_km': totalKm,
      if (removalReason != null) 'removal_reason': removalReason,
      if (lastSeenAt != null) 'last_seen_at': lastSeenAt,
      if (cachedAt != null) 'cached_at': cachedAt,
      if (rowid != null) 'rowid': rowid,
    });
  }

  CachedTyresCompanion copyWith(
      {Value<String>? id,
      Value<String>? workspaceId,
      Value<String?>? country,
      Value<String?>? serialNo,
      Value<String?>? serialNoNorm,
      Value<String?>? assetNo,
      Value<String?>? position,
      Value<String?>? brand,
      Value<String?>? size,
      Value<String?>? status,
      Value<DateTime?>? issueDate,
      Value<DateTime?>? removalDate,
      Value<int?>? kmAtFitment,
      Value<int?>? kmAtRemoval,
      Value<int?>? totalKm,
      Value<String?>? removalReason,
      Value<DateTime>? lastSeenAt,
      Value<DateTime>? cachedAt,
      Value<int>? rowid}) {
    return CachedTyresCompanion(
      id: id ?? this.id,
      workspaceId: workspaceId ?? this.workspaceId,
      country: country ?? this.country,
      serialNo: serialNo ?? this.serialNo,
      serialNoNorm: serialNoNorm ?? this.serialNoNorm,
      assetNo: assetNo ?? this.assetNo,
      position: position ?? this.position,
      brand: brand ?? this.brand,
      size: size ?? this.size,
      status: status ?? this.status,
      issueDate: issueDate ?? this.issueDate,
      removalDate: removalDate ?? this.removalDate,
      kmAtFitment: kmAtFitment ?? this.kmAtFitment,
      kmAtRemoval: kmAtRemoval ?? this.kmAtRemoval,
      totalKm: totalKm ?? this.totalKm,
      removalReason: removalReason ?? this.removalReason,
      lastSeenAt: lastSeenAt ?? this.lastSeenAt,
      cachedAt: cachedAt ?? this.cachedAt,
      rowid: rowid ?? this.rowid,
    );
  }

  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    if (id.present) {
      map['id'] = Variable<String>(id.value);
    }
    if (workspaceId.present) {
      map['workspace_id'] = Variable<String>(workspaceId.value);
    }
    if (country.present) {
      map['country'] = Variable<String>(country.value);
    }
    if (serialNo.present) {
      map['serial_no'] = Variable<String>(serialNo.value);
    }
    if (serialNoNorm.present) {
      map['serial_no_norm'] = Variable<String>(serialNoNorm.value);
    }
    if (assetNo.present) {
      map['asset_no'] = Variable<String>(assetNo.value);
    }
    if (position.present) {
      map['position'] = Variable<String>(position.value);
    }
    if (brand.present) {
      map['brand'] = Variable<String>(brand.value);
    }
    if (size.present) {
      map['size'] = Variable<String>(size.value);
    }
    if (status.present) {
      map['status'] = Variable<String>(status.value);
    }
    if (issueDate.present) {
      map['issue_date'] = Variable<DateTime>(issueDate.value);
    }
    if (removalDate.present) {
      map['removal_date'] = Variable<DateTime>(removalDate.value);
    }
    if (kmAtFitment.present) {
      map['km_at_fitment'] = Variable<int>(kmAtFitment.value);
    }
    if (kmAtRemoval.present) {
      map['km_at_removal'] = Variable<int>(kmAtRemoval.value);
    }
    if (totalKm.present) {
      map['total_km'] = Variable<int>(totalKm.value);
    }
    if (removalReason.present) {
      map['removal_reason'] = Variable<String>(removalReason.value);
    }
    if (lastSeenAt.present) {
      map['last_seen_at'] = Variable<DateTime>(lastSeenAt.value);
    }
    if (cachedAt.present) {
      map['cached_at'] = Variable<DateTime>(cachedAt.value);
    }
    if (rowid.present) {
      map['rowid'] = Variable<int>(rowid.value);
    }
    return map;
  }

  @override
  String toString() {
    return (StringBuffer('CachedTyresCompanion(')
          ..write('id: $id, ')
          ..write('workspaceId: $workspaceId, ')
          ..write('country: $country, ')
          ..write('serialNo: $serialNo, ')
          ..write('serialNoNorm: $serialNoNorm, ')
          ..write('assetNo: $assetNo, ')
          ..write('position: $position, ')
          ..write('brand: $brand, ')
          ..write('size: $size, ')
          ..write('status: $status, ')
          ..write('issueDate: $issueDate, ')
          ..write('removalDate: $removalDate, ')
          ..write('kmAtFitment: $kmAtFitment, ')
          ..write('kmAtRemoval: $kmAtRemoval, ')
          ..write('totalKm: $totalKm, ')
          ..write('removalReason: $removalReason, ')
          ..write('lastSeenAt: $lastSeenAt, ')
          ..write('cachedAt: $cachedAt, ')
          ..write('rowid: $rowid')
          ..write(')'))
        .toString();
  }
}

class $CachedChecklistTemplatesTable extends CachedChecklistTemplates
    with TableInfo<$CachedChecklistTemplatesTable, CachedChecklistTemplate> {
  @override
  final GeneratedDatabase attachedDatabase;
  final String? _alias;
  $CachedChecklistTemplatesTable(this.attachedDatabase, [this._alias]);
  static const VerificationMeta _idMeta = const VerificationMeta('id');
  @override
  late final GeneratedColumn<String> id = GeneratedColumn<String>(
      'id', aliasedName, false,
      type: DriftSqlType.string, requiredDuringInsert: true);
  static const VerificationMeta _workspaceIdMeta =
      const VerificationMeta('workspaceId');
  @override
  late final GeneratedColumn<String> workspaceId = GeneratedColumn<String>(
      'workspace_id', aliasedName, false,
      type: DriftSqlType.string, requiredDuringInsert: true);
  static const VerificationMeta _countryMeta =
      const VerificationMeta('country');
  @override
  late final GeneratedColumn<String> country = GeneratedColumn<String>(
      'country', aliasedName, true,
      type: DriftSqlType.string, requiredDuringInsert: false);
  static const VerificationMeta _nameMeta = const VerificationMeta('name');
  @override
  late final GeneratedColumn<String> name = GeneratedColumn<String>(
      'name', aliasedName, false,
      type: DriftSqlType.string, requiredDuringInsert: true);
  static const VerificationMeta _versionMeta =
      const VerificationMeta('version');
  @override
  late final GeneratedColumn<int> version = GeneratedColumn<int>(
      'version', aliasedName, false,
      type: DriftSqlType.int, requiredDuringInsert: true);
  static const VerificationMeta _statusMeta = const VerificationMeta('status');
  @override
  late final GeneratedColumn<String> status = GeneratedColumn<String>(
      'status', aliasedName, false,
      type: DriftSqlType.string, requiredDuringInsert: true);
  static const VerificationMeta _iconMeta = const VerificationMeta('icon');
  @override
  late final GeneratedColumn<String> icon = GeneratedColumn<String>(
      'icon', aliasedName, true,
      type: DriftSqlType.string, requiredDuringInsert: false);
  static const VerificationMeta _categoryMeta =
      const VerificationMeta('category');
  @override
  late final GeneratedColumn<String> category = GeneratedColumn<String>(
      'category', aliasedName, true,
      type: DriftSqlType.string, requiredDuringInsert: false);
  static const VerificationMeta _fieldsJsonMeta =
      const VerificationMeta('fieldsJson');
  @override
  late final GeneratedColumn<String> fieldsJson = GeneratedColumn<String>(
      'fields_json', aliasedName, false,
      type: DriftSqlType.string, requiredDuringInsert: true);
  static const VerificationMeta _assigneeRolesJsonMeta =
      const VerificationMeta('assigneeRolesJson');
  @override
  late final GeneratedColumn<String> assigneeRolesJson =
      GeneratedColumn<String>('assignee_roles_json', aliasedName, true,
          type: DriftSqlType.string, requiredDuringInsert: false);
  static const VerificationMeta _requireSignatureMeta =
      const VerificationMeta('requireSignature');
  @override
  late final GeneratedColumn<bool> requireSignature = GeneratedColumn<bool>(
      'require_signature', aliasedName, false,
      type: DriftSqlType.bool,
      requiredDuringInsert: true,
      defaultConstraints: GeneratedColumn.constraintIsAlways(
          'CHECK ("require_signature" IN (0, 1))'));
  static const VerificationMeta _requireApprovalMeta =
      const VerificationMeta('requireApproval');
  @override
  late final GeneratedColumn<bool> requireApproval = GeneratedColumn<bool>(
      'require_approval', aliasedName, false,
      type: DriftSqlType.bool,
      requiredDuringInsert: true,
      defaultConstraints: GeneratedColumn.constraintIsAlways(
          'CHECK ("require_approval" IN (0, 1))'));
  static const VerificationMeta _minIntervalDaysMeta =
      const VerificationMeta('minIntervalDays');
  @override
  late final GeneratedColumn<int> minIntervalDays = GeneratedColumn<int>(
      'min_interval_days', aliasedName, true,
      type: DriftSqlType.int, requiredDuringInsert: false);
  static const VerificationMeta _cachedAtMeta =
      const VerificationMeta('cachedAt');
  @override
  late final GeneratedColumn<DateTime> cachedAt = GeneratedColumn<DateTime>(
      'cached_at', aliasedName, false,
      type: DriftSqlType.dateTime, requiredDuringInsert: true);
  @override
  List<GeneratedColumn> get $columns => [
        id,
        workspaceId,
        country,
        name,
        version,
        status,
        icon,
        category,
        fieldsJson,
        assigneeRolesJson,
        requireSignature,
        requireApproval,
        minIntervalDays,
        cachedAt
      ];
  @override
  String get aliasedName => _alias ?? actualTableName;
  @override
  String get actualTableName => $name;
  static const String $name = 'cached_checklist_templates';
  @override
  VerificationContext validateIntegrity(
      Insertable<CachedChecklistTemplate> instance,
      {bool isInserting = false}) {
    final context = VerificationContext();
    final data = instance.toColumns(true);
    if (data.containsKey('id')) {
      context.handle(_idMeta, id.isAcceptableOrUnknown(data['id']!, _idMeta));
    } else if (isInserting) {
      context.missing(_idMeta);
    }
    if (data.containsKey('workspace_id')) {
      context.handle(
          _workspaceIdMeta,
          workspaceId.isAcceptableOrUnknown(
              data['workspace_id']!, _workspaceIdMeta));
    } else if (isInserting) {
      context.missing(_workspaceIdMeta);
    }
    if (data.containsKey('country')) {
      context.handle(_countryMeta,
          country.isAcceptableOrUnknown(data['country']!, _countryMeta));
    }
    if (data.containsKey('name')) {
      context.handle(
          _nameMeta, name.isAcceptableOrUnknown(data['name']!, _nameMeta));
    } else if (isInserting) {
      context.missing(_nameMeta);
    }
    if (data.containsKey('version')) {
      context.handle(_versionMeta,
          version.isAcceptableOrUnknown(data['version']!, _versionMeta));
    } else if (isInserting) {
      context.missing(_versionMeta);
    }
    if (data.containsKey('status')) {
      context.handle(_statusMeta,
          status.isAcceptableOrUnknown(data['status']!, _statusMeta));
    } else if (isInserting) {
      context.missing(_statusMeta);
    }
    if (data.containsKey('icon')) {
      context.handle(
          _iconMeta, icon.isAcceptableOrUnknown(data['icon']!, _iconMeta));
    }
    if (data.containsKey('category')) {
      context.handle(_categoryMeta,
          category.isAcceptableOrUnknown(data['category']!, _categoryMeta));
    }
    if (data.containsKey('fields_json')) {
      context.handle(
          _fieldsJsonMeta,
          fieldsJson.isAcceptableOrUnknown(
              data['fields_json']!, _fieldsJsonMeta));
    } else if (isInserting) {
      context.missing(_fieldsJsonMeta);
    }
    if (data.containsKey('assignee_roles_json')) {
      context.handle(
          _assigneeRolesJsonMeta,
          assigneeRolesJson.isAcceptableOrUnknown(
              data['assignee_roles_json']!, _assigneeRolesJsonMeta));
    }
    if (data.containsKey('require_signature')) {
      context.handle(
          _requireSignatureMeta,
          requireSignature.isAcceptableOrUnknown(
              data['require_signature']!, _requireSignatureMeta));
    } else if (isInserting) {
      context.missing(_requireSignatureMeta);
    }
    if (data.containsKey('require_approval')) {
      context.handle(
          _requireApprovalMeta,
          requireApproval.isAcceptableOrUnknown(
              data['require_approval']!, _requireApprovalMeta));
    } else if (isInserting) {
      context.missing(_requireApprovalMeta);
    }
    if (data.containsKey('min_interval_days')) {
      context.handle(
          _minIntervalDaysMeta,
          minIntervalDays.isAcceptableOrUnknown(
              data['min_interval_days']!, _minIntervalDaysMeta));
    }
    if (data.containsKey('cached_at')) {
      context.handle(_cachedAtMeta,
          cachedAt.isAcceptableOrUnknown(data['cached_at']!, _cachedAtMeta));
    } else if (isInserting) {
      context.missing(_cachedAtMeta);
    }
    return context;
  }

  @override
  Set<GeneratedColumn> get $primaryKey => {id};
  @override
  CachedChecklistTemplate map(Map<String, dynamic> data,
      {String? tablePrefix}) {
    final effectivePrefix = tablePrefix != null ? '$tablePrefix.' : '';
    return CachedChecklistTemplate(
      id: attachedDatabase.typeMapping
          .read(DriftSqlType.string, data['${effectivePrefix}id'])!,
      workspaceId: attachedDatabase.typeMapping
          .read(DriftSqlType.string, data['${effectivePrefix}workspace_id'])!,
      country: attachedDatabase.typeMapping
          .read(DriftSqlType.string, data['${effectivePrefix}country']),
      name: attachedDatabase.typeMapping
          .read(DriftSqlType.string, data['${effectivePrefix}name'])!,
      version: attachedDatabase.typeMapping
          .read(DriftSqlType.int, data['${effectivePrefix}version'])!,
      status: attachedDatabase.typeMapping
          .read(DriftSqlType.string, data['${effectivePrefix}status'])!,
      icon: attachedDatabase.typeMapping
          .read(DriftSqlType.string, data['${effectivePrefix}icon']),
      category: attachedDatabase.typeMapping
          .read(DriftSqlType.string, data['${effectivePrefix}category']),
      fieldsJson: attachedDatabase.typeMapping
          .read(DriftSqlType.string, data['${effectivePrefix}fields_json'])!,
      assigneeRolesJson: attachedDatabase.typeMapping.read(
          DriftSqlType.string, data['${effectivePrefix}assignee_roles_json']),
      requireSignature: attachedDatabase.typeMapping.read(
          DriftSqlType.bool, data['${effectivePrefix}require_signature'])!,
      requireApproval: attachedDatabase.typeMapping
          .read(DriftSqlType.bool, data['${effectivePrefix}require_approval'])!,
      minIntervalDays: attachedDatabase.typeMapping
          .read(DriftSqlType.int, data['${effectivePrefix}min_interval_days']),
      cachedAt: attachedDatabase.typeMapping
          .read(DriftSqlType.dateTime, data['${effectivePrefix}cached_at'])!,
    );
  }

  @override
  $CachedChecklistTemplatesTable createAlias(String alias) {
    return $CachedChecklistTemplatesTable(attachedDatabase, alias);
  }
}

class CachedChecklistTemplate extends DataClass
    implements Insertable<CachedChecklistTemplate> {
  final String id;
  final String workspaceId;
  final String? country;
  final String name;

  /// A draft is pinned to the version it was started on. If a supervisor
  /// publishes version 3 while a sheet filled against version 2 is still open,
  /// the answers were given against different questions, and a resume must warn
  /// rather than silently re-map them.
  final int version;

  /// Only `published` is fillable.
  final String status;

  /// A token, resolved per platform. NOT a library-specific glyph name: a name
  /// valid in one icon library is meaningless to the other, which is the
  /// recorded cause of four templates rendering a blank square.
  final String? icon;
  final String? category;

  /// The field definitions, stored verbatim rather than parsed into child
  /// tables.
  ///
  /// They carry conditional logic, shared option references and per-language
  /// labels. Splitting them relationally would mean re-implementing the
  /// server's own document shape and drifting from it on the next template
  /// edit. The one thing that must be relational is a filled ANSWER.
  final String fieldsJson;

  /// JSON array, stored exactly as received.
  ///
  /// **Null and empty are different and must stay different.** Null means the
  /// template is for everyone; an empty array reads as "targeted at nobody". A
  /// mapper that coalesces null to `[]` hides every checklist from the whole
  /// fleet.
  final String? assigneeRolesJson;
  final bool requireSignature;
  final bool requireApproval;
  final int? minIntervalDays;
  final DateTime cachedAt;
  const CachedChecklistTemplate(
      {required this.id,
      required this.workspaceId,
      this.country,
      required this.name,
      required this.version,
      required this.status,
      this.icon,
      this.category,
      required this.fieldsJson,
      this.assigneeRolesJson,
      required this.requireSignature,
      required this.requireApproval,
      this.minIntervalDays,
      required this.cachedAt});
  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    map['id'] = Variable<String>(id);
    map['workspace_id'] = Variable<String>(workspaceId);
    if (!nullToAbsent || country != null) {
      map['country'] = Variable<String>(country);
    }
    map['name'] = Variable<String>(name);
    map['version'] = Variable<int>(version);
    map['status'] = Variable<String>(status);
    if (!nullToAbsent || icon != null) {
      map['icon'] = Variable<String>(icon);
    }
    if (!nullToAbsent || category != null) {
      map['category'] = Variable<String>(category);
    }
    map['fields_json'] = Variable<String>(fieldsJson);
    if (!nullToAbsent || assigneeRolesJson != null) {
      map['assignee_roles_json'] = Variable<String>(assigneeRolesJson);
    }
    map['require_signature'] = Variable<bool>(requireSignature);
    map['require_approval'] = Variable<bool>(requireApproval);
    if (!nullToAbsent || minIntervalDays != null) {
      map['min_interval_days'] = Variable<int>(minIntervalDays);
    }
    map['cached_at'] = Variable<DateTime>(cachedAt);
    return map;
  }

  CachedChecklistTemplatesCompanion toCompanion(bool nullToAbsent) {
    return CachedChecklistTemplatesCompanion(
      id: Value(id),
      workspaceId: Value(workspaceId),
      country: country == null && nullToAbsent
          ? const Value.absent()
          : Value(country),
      name: Value(name),
      version: Value(version),
      status: Value(status),
      icon: icon == null && nullToAbsent ? const Value.absent() : Value(icon),
      category: category == null && nullToAbsent
          ? const Value.absent()
          : Value(category),
      fieldsJson: Value(fieldsJson),
      assigneeRolesJson: assigneeRolesJson == null && nullToAbsent
          ? const Value.absent()
          : Value(assigneeRolesJson),
      requireSignature: Value(requireSignature),
      requireApproval: Value(requireApproval),
      minIntervalDays: minIntervalDays == null && nullToAbsent
          ? const Value.absent()
          : Value(minIntervalDays),
      cachedAt: Value(cachedAt),
    );
  }

  factory CachedChecklistTemplate.fromJson(Map<String, dynamic> json,
      {ValueSerializer? serializer}) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return CachedChecklistTemplate(
      id: serializer.fromJson<String>(json['id']),
      workspaceId: serializer.fromJson<String>(json['workspaceId']),
      country: serializer.fromJson<String?>(json['country']),
      name: serializer.fromJson<String>(json['name']),
      version: serializer.fromJson<int>(json['version']),
      status: serializer.fromJson<String>(json['status']),
      icon: serializer.fromJson<String?>(json['icon']),
      category: serializer.fromJson<String?>(json['category']),
      fieldsJson: serializer.fromJson<String>(json['fieldsJson']),
      assigneeRolesJson:
          serializer.fromJson<String?>(json['assigneeRolesJson']),
      requireSignature: serializer.fromJson<bool>(json['requireSignature']),
      requireApproval: serializer.fromJson<bool>(json['requireApproval']),
      minIntervalDays: serializer.fromJson<int?>(json['minIntervalDays']),
      cachedAt: serializer.fromJson<DateTime>(json['cachedAt']),
    );
  }
  @override
  Map<String, dynamic> toJson({ValueSerializer? serializer}) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return <String, dynamic>{
      'id': serializer.toJson<String>(id),
      'workspaceId': serializer.toJson<String>(workspaceId),
      'country': serializer.toJson<String?>(country),
      'name': serializer.toJson<String>(name),
      'version': serializer.toJson<int>(version),
      'status': serializer.toJson<String>(status),
      'icon': serializer.toJson<String?>(icon),
      'category': serializer.toJson<String?>(category),
      'fieldsJson': serializer.toJson<String>(fieldsJson),
      'assigneeRolesJson': serializer.toJson<String?>(assigneeRolesJson),
      'requireSignature': serializer.toJson<bool>(requireSignature),
      'requireApproval': serializer.toJson<bool>(requireApproval),
      'minIntervalDays': serializer.toJson<int?>(minIntervalDays),
      'cachedAt': serializer.toJson<DateTime>(cachedAt),
    };
  }

  CachedChecklistTemplate copyWith(
          {String? id,
          String? workspaceId,
          Value<String?> country = const Value.absent(),
          String? name,
          int? version,
          String? status,
          Value<String?> icon = const Value.absent(),
          Value<String?> category = const Value.absent(),
          String? fieldsJson,
          Value<String?> assigneeRolesJson = const Value.absent(),
          bool? requireSignature,
          bool? requireApproval,
          Value<int?> minIntervalDays = const Value.absent(),
          DateTime? cachedAt}) =>
      CachedChecklistTemplate(
        id: id ?? this.id,
        workspaceId: workspaceId ?? this.workspaceId,
        country: country.present ? country.value : this.country,
        name: name ?? this.name,
        version: version ?? this.version,
        status: status ?? this.status,
        icon: icon.present ? icon.value : this.icon,
        category: category.present ? category.value : this.category,
        fieldsJson: fieldsJson ?? this.fieldsJson,
        assigneeRolesJson: assigneeRolesJson.present
            ? assigneeRolesJson.value
            : this.assigneeRolesJson,
        requireSignature: requireSignature ?? this.requireSignature,
        requireApproval: requireApproval ?? this.requireApproval,
        minIntervalDays: minIntervalDays.present
            ? minIntervalDays.value
            : this.minIntervalDays,
        cachedAt: cachedAt ?? this.cachedAt,
      );
  CachedChecklistTemplate copyWithCompanion(
      CachedChecklistTemplatesCompanion data) {
    return CachedChecklistTemplate(
      id: data.id.present ? data.id.value : this.id,
      workspaceId:
          data.workspaceId.present ? data.workspaceId.value : this.workspaceId,
      country: data.country.present ? data.country.value : this.country,
      name: data.name.present ? data.name.value : this.name,
      version: data.version.present ? data.version.value : this.version,
      status: data.status.present ? data.status.value : this.status,
      icon: data.icon.present ? data.icon.value : this.icon,
      category: data.category.present ? data.category.value : this.category,
      fieldsJson:
          data.fieldsJson.present ? data.fieldsJson.value : this.fieldsJson,
      assigneeRolesJson: data.assigneeRolesJson.present
          ? data.assigneeRolesJson.value
          : this.assigneeRolesJson,
      requireSignature: data.requireSignature.present
          ? data.requireSignature.value
          : this.requireSignature,
      requireApproval: data.requireApproval.present
          ? data.requireApproval.value
          : this.requireApproval,
      minIntervalDays: data.minIntervalDays.present
          ? data.minIntervalDays.value
          : this.minIntervalDays,
      cachedAt: data.cachedAt.present ? data.cachedAt.value : this.cachedAt,
    );
  }

  @override
  String toString() {
    return (StringBuffer('CachedChecklistTemplate(')
          ..write('id: $id, ')
          ..write('workspaceId: $workspaceId, ')
          ..write('country: $country, ')
          ..write('name: $name, ')
          ..write('version: $version, ')
          ..write('status: $status, ')
          ..write('icon: $icon, ')
          ..write('category: $category, ')
          ..write('fieldsJson: $fieldsJson, ')
          ..write('assigneeRolesJson: $assigneeRolesJson, ')
          ..write('requireSignature: $requireSignature, ')
          ..write('requireApproval: $requireApproval, ')
          ..write('minIntervalDays: $minIntervalDays, ')
          ..write('cachedAt: $cachedAt')
          ..write(')'))
        .toString();
  }

  @override
  int get hashCode => Object.hash(
      id,
      workspaceId,
      country,
      name,
      version,
      status,
      icon,
      category,
      fieldsJson,
      assigneeRolesJson,
      requireSignature,
      requireApproval,
      minIntervalDays,
      cachedAt);
  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      (other is CachedChecklistTemplate &&
          other.id == this.id &&
          other.workspaceId == this.workspaceId &&
          other.country == this.country &&
          other.name == this.name &&
          other.version == this.version &&
          other.status == this.status &&
          other.icon == this.icon &&
          other.category == this.category &&
          other.fieldsJson == this.fieldsJson &&
          other.assigneeRolesJson == this.assigneeRolesJson &&
          other.requireSignature == this.requireSignature &&
          other.requireApproval == this.requireApproval &&
          other.minIntervalDays == this.minIntervalDays &&
          other.cachedAt == this.cachedAt);
}

class CachedChecklistTemplatesCompanion
    extends UpdateCompanion<CachedChecklistTemplate> {
  final Value<String> id;
  final Value<String> workspaceId;
  final Value<String?> country;
  final Value<String> name;
  final Value<int> version;
  final Value<String> status;
  final Value<String?> icon;
  final Value<String?> category;
  final Value<String> fieldsJson;
  final Value<String?> assigneeRolesJson;
  final Value<bool> requireSignature;
  final Value<bool> requireApproval;
  final Value<int?> minIntervalDays;
  final Value<DateTime> cachedAt;
  final Value<int> rowid;
  const CachedChecklistTemplatesCompanion({
    this.id = const Value.absent(),
    this.workspaceId = const Value.absent(),
    this.country = const Value.absent(),
    this.name = const Value.absent(),
    this.version = const Value.absent(),
    this.status = const Value.absent(),
    this.icon = const Value.absent(),
    this.category = const Value.absent(),
    this.fieldsJson = const Value.absent(),
    this.assigneeRolesJson = const Value.absent(),
    this.requireSignature = const Value.absent(),
    this.requireApproval = const Value.absent(),
    this.minIntervalDays = const Value.absent(),
    this.cachedAt = const Value.absent(),
    this.rowid = const Value.absent(),
  });
  CachedChecklistTemplatesCompanion.insert({
    required String id,
    required String workspaceId,
    this.country = const Value.absent(),
    required String name,
    required int version,
    required String status,
    this.icon = const Value.absent(),
    this.category = const Value.absent(),
    required String fieldsJson,
    this.assigneeRolesJson = const Value.absent(),
    required bool requireSignature,
    required bool requireApproval,
    this.minIntervalDays = const Value.absent(),
    required DateTime cachedAt,
    this.rowid = const Value.absent(),
  })  : id = Value(id),
        workspaceId = Value(workspaceId),
        name = Value(name),
        version = Value(version),
        status = Value(status),
        fieldsJson = Value(fieldsJson),
        requireSignature = Value(requireSignature),
        requireApproval = Value(requireApproval),
        cachedAt = Value(cachedAt);
  static Insertable<CachedChecklistTemplate> custom({
    Expression<String>? id,
    Expression<String>? workspaceId,
    Expression<String>? country,
    Expression<String>? name,
    Expression<int>? version,
    Expression<String>? status,
    Expression<String>? icon,
    Expression<String>? category,
    Expression<String>? fieldsJson,
    Expression<String>? assigneeRolesJson,
    Expression<bool>? requireSignature,
    Expression<bool>? requireApproval,
    Expression<int>? minIntervalDays,
    Expression<DateTime>? cachedAt,
    Expression<int>? rowid,
  }) {
    return RawValuesInsertable({
      if (id != null) 'id': id,
      if (workspaceId != null) 'workspace_id': workspaceId,
      if (country != null) 'country': country,
      if (name != null) 'name': name,
      if (version != null) 'version': version,
      if (status != null) 'status': status,
      if (icon != null) 'icon': icon,
      if (category != null) 'category': category,
      if (fieldsJson != null) 'fields_json': fieldsJson,
      if (assigneeRolesJson != null) 'assignee_roles_json': assigneeRolesJson,
      if (requireSignature != null) 'require_signature': requireSignature,
      if (requireApproval != null) 'require_approval': requireApproval,
      if (minIntervalDays != null) 'min_interval_days': minIntervalDays,
      if (cachedAt != null) 'cached_at': cachedAt,
      if (rowid != null) 'rowid': rowid,
    });
  }

  CachedChecklistTemplatesCompanion copyWith(
      {Value<String>? id,
      Value<String>? workspaceId,
      Value<String?>? country,
      Value<String>? name,
      Value<int>? version,
      Value<String>? status,
      Value<String?>? icon,
      Value<String?>? category,
      Value<String>? fieldsJson,
      Value<String?>? assigneeRolesJson,
      Value<bool>? requireSignature,
      Value<bool>? requireApproval,
      Value<int?>? minIntervalDays,
      Value<DateTime>? cachedAt,
      Value<int>? rowid}) {
    return CachedChecklistTemplatesCompanion(
      id: id ?? this.id,
      workspaceId: workspaceId ?? this.workspaceId,
      country: country ?? this.country,
      name: name ?? this.name,
      version: version ?? this.version,
      status: status ?? this.status,
      icon: icon ?? this.icon,
      category: category ?? this.category,
      fieldsJson: fieldsJson ?? this.fieldsJson,
      assigneeRolesJson: assigneeRolesJson ?? this.assigneeRolesJson,
      requireSignature: requireSignature ?? this.requireSignature,
      requireApproval: requireApproval ?? this.requireApproval,
      minIntervalDays: minIntervalDays ?? this.minIntervalDays,
      cachedAt: cachedAt ?? this.cachedAt,
      rowid: rowid ?? this.rowid,
    );
  }

  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    if (id.present) {
      map['id'] = Variable<String>(id.value);
    }
    if (workspaceId.present) {
      map['workspace_id'] = Variable<String>(workspaceId.value);
    }
    if (country.present) {
      map['country'] = Variable<String>(country.value);
    }
    if (name.present) {
      map['name'] = Variable<String>(name.value);
    }
    if (version.present) {
      map['version'] = Variable<int>(version.value);
    }
    if (status.present) {
      map['status'] = Variable<String>(status.value);
    }
    if (icon.present) {
      map['icon'] = Variable<String>(icon.value);
    }
    if (category.present) {
      map['category'] = Variable<String>(category.value);
    }
    if (fieldsJson.present) {
      map['fields_json'] = Variable<String>(fieldsJson.value);
    }
    if (assigneeRolesJson.present) {
      map['assignee_roles_json'] = Variable<String>(assigneeRolesJson.value);
    }
    if (requireSignature.present) {
      map['require_signature'] = Variable<bool>(requireSignature.value);
    }
    if (requireApproval.present) {
      map['require_approval'] = Variable<bool>(requireApproval.value);
    }
    if (minIntervalDays.present) {
      map['min_interval_days'] = Variable<int>(minIntervalDays.value);
    }
    if (cachedAt.present) {
      map['cached_at'] = Variable<DateTime>(cachedAt.value);
    }
    if (rowid.present) {
      map['rowid'] = Variable<int>(rowid.value);
    }
    return map;
  }

  @override
  String toString() {
    return (StringBuffer('CachedChecklistTemplatesCompanion(')
          ..write('id: $id, ')
          ..write('workspaceId: $workspaceId, ')
          ..write('country: $country, ')
          ..write('name: $name, ')
          ..write('version: $version, ')
          ..write('status: $status, ')
          ..write('icon: $icon, ')
          ..write('category: $category, ')
          ..write('fieldsJson: $fieldsJson, ')
          ..write('assigneeRolesJson: $assigneeRolesJson, ')
          ..write('requireSignature: $requireSignature, ')
          ..write('requireApproval: $requireApproval, ')
          ..write('minIntervalDays: $minIntervalDays, ')
          ..write('cachedAt: $cachedAt, ')
          ..write('rowid: $rowid')
          ..write(')'))
        .toString();
  }
}

class $CachedPermissionsTable extends CachedPermissions
    with TableInfo<$CachedPermissionsTable, CachedPermission> {
  @override
  final GeneratedDatabase attachedDatabase;
  final String? _alias;
  $CachedPermissionsTable(this.attachedDatabase, [this._alias]);
  static const VerificationMeta _userIdMeta = const VerificationMeta('userId');
  @override
  late final GeneratedColumn<String> userId = GeneratedColumn<String>(
      'user_id', aliasedName, false,
      type: DriftSqlType.string, requiredDuringInsert: true);
  static const VerificationMeta _moduleKeyMeta =
      const VerificationMeta('moduleKey');
  @override
  late final GeneratedColumn<String> moduleKey = GeneratedColumn<String>(
      'module_key', aliasedName, false,
      type: DriftSqlType.string, requiredDuringInsert: true);
  static const VerificationMeta _workspaceIdMeta =
      const VerificationMeta('workspaceId');
  @override
  late final GeneratedColumn<String> workspaceId = GeneratedColumn<String>(
      'workspace_id', aliasedName, false,
      type: DriftSqlType.string, requiredDuringInsert: true);
  static const VerificationMeta _effectMeta = const VerificationMeta('effect');
  @override
  late final GeneratedColumn<String> effect = GeneratedColumn<String>(
      'effect', aliasedName, false,
      type: DriftSqlType.string, requiredDuringInsert: true);
  static const VerificationMeta _capabilityMeta =
      const VerificationMeta('capability');
  @override
  late final GeneratedColumn<String> capability = GeneratedColumn<String>(
      'capability', aliasedName, false,
      type: DriftSqlType.string, requiredDuringInsert: true);
  static const VerificationMeta _expiresAtMeta =
      const VerificationMeta('expiresAt');
  @override
  late final GeneratedColumn<DateTime> expiresAt = GeneratedColumn<DateTime>(
      'expires_at', aliasedName, true,
      type: DriftSqlType.dateTime, requiredDuringInsert: false);
  static const VerificationMeta _cachedAtMeta =
      const VerificationMeta('cachedAt');
  @override
  late final GeneratedColumn<DateTime> cachedAt = GeneratedColumn<DateTime>(
      'cached_at', aliasedName, false,
      type: DriftSqlType.dateTime, requiredDuringInsert: true);
  @override
  List<GeneratedColumn> get $columns =>
      [userId, moduleKey, workspaceId, effect, capability, expiresAt, cachedAt];
  @override
  String get aliasedName => _alias ?? actualTableName;
  @override
  String get actualTableName => $name;
  static const String $name = 'cached_permissions';
  @override
  VerificationContext validateIntegrity(Insertable<CachedPermission> instance,
      {bool isInserting = false}) {
    final context = VerificationContext();
    final data = instance.toColumns(true);
    if (data.containsKey('user_id')) {
      context.handle(_userIdMeta,
          userId.isAcceptableOrUnknown(data['user_id']!, _userIdMeta));
    } else if (isInserting) {
      context.missing(_userIdMeta);
    }
    if (data.containsKey('module_key')) {
      context.handle(_moduleKeyMeta,
          moduleKey.isAcceptableOrUnknown(data['module_key']!, _moduleKeyMeta));
    } else if (isInserting) {
      context.missing(_moduleKeyMeta);
    }
    if (data.containsKey('workspace_id')) {
      context.handle(
          _workspaceIdMeta,
          workspaceId.isAcceptableOrUnknown(
              data['workspace_id']!, _workspaceIdMeta));
    } else if (isInserting) {
      context.missing(_workspaceIdMeta);
    }
    if (data.containsKey('effect')) {
      context.handle(_effectMeta,
          effect.isAcceptableOrUnknown(data['effect']!, _effectMeta));
    } else if (isInserting) {
      context.missing(_effectMeta);
    }
    if (data.containsKey('capability')) {
      context.handle(
          _capabilityMeta,
          capability.isAcceptableOrUnknown(
              data['capability']!, _capabilityMeta));
    } else if (isInserting) {
      context.missing(_capabilityMeta);
    }
    if (data.containsKey('expires_at')) {
      context.handle(_expiresAtMeta,
          expiresAt.isAcceptableOrUnknown(data['expires_at']!, _expiresAtMeta));
    }
    if (data.containsKey('cached_at')) {
      context.handle(_cachedAtMeta,
          cachedAt.isAcceptableOrUnknown(data['cached_at']!, _cachedAtMeta));
    } else if (isInserting) {
      context.missing(_cachedAtMeta);
    }
    return context;
  }

  @override
  Set<GeneratedColumn> get $primaryKey => {userId, moduleKey};
  @override
  CachedPermission map(Map<String, dynamic> data, {String? tablePrefix}) {
    final effectivePrefix = tablePrefix != null ? '$tablePrefix.' : '';
    return CachedPermission(
      userId: attachedDatabase.typeMapping
          .read(DriftSqlType.string, data['${effectivePrefix}user_id'])!,
      moduleKey: attachedDatabase.typeMapping
          .read(DriftSqlType.string, data['${effectivePrefix}module_key'])!,
      workspaceId: attachedDatabase.typeMapping
          .read(DriftSqlType.string, data['${effectivePrefix}workspace_id'])!,
      effect: attachedDatabase.typeMapping
          .read(DriftSqlType.string, data['${effectivePrefix}effect'])!,
      capability: attachedDatabase.typeMapping
          .read(DriftSqlType.string, data['${effectivePrefix}capability'])!,
      expiresAt: attachedDatabase.typeMapping
          .read(DriftSqlType.dateTime, data['${effectivePrefix}expires_at']),
      cachedAt: attachedDatabase.typeMapping
          .read(DriftSqlType.dateTime, data['${effectivePrefix}cached_at'])!,
    );
  }

  @override
  $CachedPermissionsTable createAlias(String alias) {
    return $CachedPermissionsTable(attachedDatabase, alias);
  }
}

class CachedPermission extends DataClass
    implements Insertable<CachedPermission> {
  final String userId;

  /// The MOBILE module key, e.g. `records`, `inspect`.
  final String moduleKey;
  final String workspaceId;

  /// `grant` or `revoke`, per PermissionEffect. A revoke always beats a
  /// grant.
  final String effect;

  /// Default `view` at the repository boundary, not in SQL: a capability that
  /// arrives absent from the server is a data problem worth seeing, not
  /// something to paper over with a column default.
  final String capability;

  /// An expired grant is not applied.
  final DateTime? expiresAt;
  final DateTime cachedAt;
  const CachedPermission(
      {required this.userId,
      required this.moduleKey,
      required this.workspaceId,
      required this.effect,
      required this.capability,
      this.expiresAt,
      required this.cachedAt});
  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    map['user_id'] = Variable<String>(userId);
    map['module_key'] = Variable<String>(moduleKey);
    map['workspace_id'] = Variable<String>(workspaceId);
    map['effect'] = Variable<String>(effect);
    map['capability'] = Variable<String>(capability);
    if (!nullToAbsent || expiresAt != null) {
      map['expires_at'] = Variable<DateTime>(expiresAt);
    }
    map['cached_at'] = Variable<DateTime>(cachedAt);
    return map;
  }

  CachedPermissionsCompanion toCompanion(bool nullToAbsent) {
    return CachedPermissionsCompanion(
      userId: Value(userId),
      moduleKey: Value(moduleKey),
      workspaceId: Value(workspaceId),
      effect: Value(effect),
      capability: Value(capability),
      expiresAt: expiresAt == null && nullToAbsent
          ? const Value.absent()
          : Value(expiresAt),
      cachedAt: Value(cachedAt),
    );
  }

  factory CachedPermission.fromJson(Map<String, dynamic> json,
      {ValueSerializer? serializer}) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return CachedPermission(
      userId: serializer.fromJson<String>(json['userId']),
      moduleKey: serializer.fromJson<String>(json['moduleKey']),
      workspaceId: serializer.fromJson<String>(json['workspaceId']),
      effect: serializer.fromJson<String>(json['effect']),
      capability: serializer.fromJson<String>(json['capability']),
      expiresAt: serializer.fromJson<DateTime?>(json['expiresAt']),
      cachedAt: serializer.fromJson<DateTime>(json['cachedAt']),
    );
  }
  @override
  Map<String, dynamic> toJson({ValueSerializer? serializer}) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return <String, dynamic>{
      'userId': serializer.toJson<String>(userId),
      'moduleKey': serializer.toJson<String>(moduleKey),
      'workspaceId': serializer.toJson<String>(workspaceId),
      'effect': serializer.toJson<String>(effect),
      'capability': serializer.toJson<String>(capability),
      'expiresAt': serializer.toJson<DateTime?>(expiresAt),
      'cachedAt': serializer.toJson<DateTime>(cachedAt),
    };
  }

  CachedPermission copyWith(
          {String? userId,
          String? moduleKey,
          String? workspaceId,
          String? effect,
          String? capability,
          Value<DateTime?> expiresAt = const Value.absent(),
          DateTime? cachedAt}) =>
      CachedPermission(
        userId: userId ?? this.userId,
        moduleKey: moduleKey ?? this.moduleKey,
        workspaceId: workspaceId ?? this.workspaceId,
        effect: effect ?? this.effect,
        capability: capability ?? this.capability,
        expiresAt: expiresAt.present ? expiresAt.value : this.expiresAt,
        cachedAt: cachedAt ?? this.cachedAt,
      );
  CachedPermission copyWithCompanion(CachedPermissionsCompanion data) {
    return CachedPermission(
      userId: data.userId.present ? data.userId.value : this.userId,
      moduleKey: data.moduleKey.present ? data.moduleKey.value : this.moduleKey,
      workspaceId:
          data.workspaceId.present ? data.workspaceId.value : this.workspaceId,
      effect: data.effect.present ? data.effect.value : this.effect,
      capability:
          data.capability.present ? data.capability.value : this.capability,
      expiresAt: data.expiresAt.present ? data.expiresAt.value : this.expiresAt,
      cachedAt: data.cachedAt.present ? data.cachedAt.value : this.cachedAt,
    );
  }

  @override
  String toString() {
    return (StringBuffer('CachedPermission(')
          ..write('userId: $userId, ')
          ..write('moduleKey: $moduleKey, ')
          ..write('workspaceId: $workspaceId, ')
          ..write('effect: $effect, ')
          ..write('capability: $capability, ')
          ..write('expiresAt: $expiresAt, ')
          ..write('cachedAt: $cachedAt')
          ..write(')'))
        .toString();
  }

  @override
  int get hashCode => Object.hash(
      userId, moduleKey, workspaceId, effect, capability, expiresAt, cachedAt);
  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      (other is CachedPermission &&
          other.userId == this.userId &&
          other.moduleKey == this.moduleKey &&
          other.workspaceId == this.workspaceId &&
          other.effect == this.effect &&
          other.capability == this.capability &&
          other.expiresAt == this.expiresAt &&
          other.cachedAt == this.cachedAt);
}

class CachedPermissionsCompanion extends UpdateCompanion<CachedPermission> {
  final Value<String> userId;
  final Value<String> moduleKey;
  final Value<String> workspaceId;
  final Value<String> effect;
  final Value<String> capability;
  final Value<DateTime?> expiresAt;
  final Value<DateTime> cachedAt;
  final Value<int> rowid;
  const CachedPermissionsCompanion({
    this.userId = const Value.absent(),
    this.moduleKey = const Value.absent(),
    this.workspaceId = const Value.absent(),
    this.effect = const Value.absent(),
    this.capability = const Value.absent(),
    this.expiresAt = const Value.absent(),
    this.cachedAt = const Value.absent(),
    this.rowid = const Value.absent(),
  });
  CachedPermissionsCompanion.insert({
    required String userId,
    required String moduleKey,
    required String workspaceId,
    required String effect,
    required String capability,
    this.expiresAt = const Value.absent(),
    required DateTime cachedAt,
    this.rowid = const Value.absent(),
  })  : userId = Value(userId),
        moduleKey = Value(moduleKey),
        workspaceId = Value(workspaceId),
        effect = Value(effect),
        capability = Value(capability),
        cachedAt = Value(cachedAt);
  static Insertable<CachedPermission> custom({
    Expression<String>? userId,
    Expression<String>? moduleKey,
    Expression<String>? workspaceId,
    Expression<String>? effect,
    Expression<String>? capability,
    Expression<DateTime>? expiresAt,
    Expression<DateTime>? cachedAt,
    Expression<int>? rowid,
  }) {
    return RawValuesInsertable({
      if (userId != null) 'user_id': userId,
      if (moduleKey != null) 'module_key': moduleKey,
      if (workspaceId != null) 'workspace_id': workspaceId,
      if (effect != null) 'effect': effect,
      if (capability != null) 'capability': capability,
      if (expiresAt != null) 'expires_at': expiresAt,
      if (cachedAt != null) 'cached_at': cachedAt,
      if (rowid != null) 'rowid': rowid,
    });
  }

  CachedPermissionsCompanion copyWith(
      {Value<String>? userId,
      Value<String>? moduleKey,
      Value<String>? workspaceId,
      Value<String>? effect,
      Value<String>? capability,
      Value<DateTime?>? expiresAt,
      Value<DateTime>? cachedAt,
      Value<int>? rowid}) {
    return CachedPermissionsCompanion(
      userId: userId ?? this.userId,
      moduleKey: moduleKey ?? this.moduleKey,
      workspaceId: workspaceId ?? this.workspaceId,
      effect: effect ?? this.effect,
      capability: capability ?? this.capability,
      expiresAt: expiresAt ?? this.expiresAt,
      cachedAt: cachedAt ?? this.cachedAt,
      rowid: rowid ?? this.rowid,
    );
  }

  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    if (userId.present) {
      map['user_id'] = Variable<String>(userId.value);
    }
    if (moduleKey.present) {
      map['module_key'] = Variable<String>(moduleKey.value);
    }
    if (workspaceId.present) {
      map['workspace_id'] = Variable<String>(workspaceId.value);
    }
    if (effect.present) {
      map['effect'] = Variable<String>(effect.value);
    }
    if (capability.present) {
      map['capability'] = Variable<String>(capability.value);
    }
    if (expiresAt.present) {
      map['expires_at'] = Variable<DateTime>(expiresAt.value);
    }
    if (cachedAt.present) {
      map['cached_at'] = Variable<DateTime>(cachedAt.value);
    }
    if (rowid.present) {
      map['rowid'] = Variable<int>(rowid.value);
    }
    return map;
  }

  @override
  String toString() {
    return (StringBuffer('CachedPermissionsCompanion(')
          ..write('userId: $userId, ')
          ..write('moduleKey: $moduleKey, ')
          ..write('workspaceId: $workspaceId, ')
          ..write('effect: $effect, ')
          ..write('capability: $capability, ')
          ..write('expiresAt: $expiresAt, ')
          ..write('cachedAt: $cachedAt, ')
          ..write('rowid: $rowid')
          ..write(')'))
        .toString();
  }
}

class $InspectionDraftsTable extends InspectionDrafts
    with TableInfo<$InspectionDraftsTable, InspectionDraft> {
  @override
  final GeneratedDatabase attachedDatabase;
  final String? _alias;
  $InspectionDraftsTable(this.attachedDatabase, [this._alias]);
  static const VerificationMeta _draftKeyMeta =
      const VerificationMeta('draftKey');
  @override
  late final GeneratedColumn<String> draftKey = GeneratedColumn<String>(
      'draft_key', aliasedName, false,
      type: DriftSqlType.string, requiredDuringInsert: true);
  static const VerificationMeta _userIdMeta = const VerificationMeta('userId');
  @override
  late final GeneratedColumn<String> userId = GeneratedColumn<String>(
      'user_id', aliasedName, false,
      type: DriftSqlType.string, requiredDuringInsert: true);
  static const VerificationMeta _workspaceIdMeta =
      const VerificationMeta('workspaceId');
  @override
  late final GeneratedColumn<String> workspaceId = GeneratedColumn<String>(
      'workspace_id', aliasedName, false,
      type: DriftSqlType.string, requiredDuringInsert: true);
  static const VerificationMeta _countryMeta =
      const VerificationMeta('country');
  @override
  late final GeneratedColumn<String> country = GeneratedColumn<String>(
      'country', aliasedName, true,
      type: DriftSqlType.string, requiredDuringInsert: false);
  static const VerificationMeta _assetNoMeta =
      const VerificationMeta('assetNo');
  @override
  late final GeneratedColumn<String> assetNo = GeneratedColumn<String>(
      'asset_no', aliasedName, false,
      type: DriftSqlType.string, requiredDuringInsert: true);
  static const VerificationMeta _vehicleTypeMeta =
      const VerificationMeta('vehicleType');
  @override
  late final GeneratedColumn<String> vehicleType = GeneratedColumn<String>(
      'vehicle_type', aliasedName, true,
      type: DriftSqlType.string, requiredDuringInsert: false);
  static const VerificationMeta _siteMeta = const VerificationMeta('site');
  @override
  late final GeneratedColumn<String> site = GeneratedColumn<String>(
      'site', aliasedName, true,
      type: DriftSqlType.string, requiredDuringInsert: false);
  static const VerificationMeta _inspectorNameMeta =
      const VerificationMeta('inspectorName');
  @override
  late final GeneratedColumn<String> inspectorName = GeneratedColumn<String>(
      'inspector_name', aliasedName, true,
      type: DriftSqlType.string, requiredDuringInsert: false);
  static const VerificationMeta _odometerKmMeta =
      const VerificationMeta('odometerKm');
  @override
  late final GeneratedColumn<int> odometerKm = GeneratedColumn<int>(
      'odometer_km', aliasedName, true,
      type: DriftSqlType.int, requiredDuringInsert: false);
  static const VerificationMeta _engineHoursMeta =
      const VerificationMeta('engineHours');
  @override
  late final GeneratedColumn<double> engineHours = GeneratedColumn<double>(
      'engine_hours', aliasedName, true,
      type: DriftSqlType.double, requiredDuringInsert: false);
  static const VerificationMeta _findingsMeta =
      const VerificationMeta('findings');
  @override
  late final GeneratedColumn<String> findings = GeneratedColumn<String>(
      'findings', aliasedName, true,
      type: DriftSqlType.string, requiredDuringInsert: false);
  static const VerificationMeta _filledMeta = const VerificationMeta('filled');
  @override
  late final GeneratedColumn<int> filled = GeneratedColumn<int>(
      'filled', aliasedName, false,
      type: DriftSqlType.int, requiredDuringInsert: true);
  static const VerificationMeta _totalMeta = const VerificationMeta('total');
  @override
  late final GeneratedColumn<int> total = GeneratedColumn<int>(
      'total', aliasedName, false,
      type: DriftSqlType.int, requiredDuringInsert: true);
  static const VerificationMeta _createdAtMeta =
      const VerificationMeta('createdAt');
  @override
  late final GeneratedColumn<DateTime> createdAt = GeneratedColumn<DateTime>(
      'created_at', aliasedName, false,
      type: DriftSqlType.dateTime, requiredDuringInsert: true);
  static const VerificationMeta _updatedAtMeta =
      const VerificationMeta('updatedAt');
  @override
  late final GeneratedColumn<DateTime> updatedAt = GeneratedColumn<DateTime>(
      'updated_at', aliasedName, false,
      type: DriftSqlType.dateTime, requiredDuringInsert: true);
  @override
  List<GeneratedColumn> get $columns => [
        draftKey,
        userId,
        workspaceId,
        country,
        assetNo,
        vehicleType,
        site,
        inspectorName,
        odometerKm,
        engineHours,
        findings,
        filled,
        total,
        createdAt,
        updatedAt
      ];
  @override
  String get aliasedName => _alias ?? actualTableName;
  @override
  String get actualTableName => $name;
  static const String $name = 'inspection_drafts';
  @override
  VerificationContext validateIntegrity(Insertable<InspectionDraft> instance,
      {bool isInserting = false}) {
    final context = VerificationContext();
    final data = instance.toColumns(true);
    if (data.containsKey('draft_key')) {
      context.handle(_draftKeyMeta,
          draftKey.isAcceptableOrUnknown(data['draft_key']!, _draftKeyMeta));
    } else if (isInserting) {
      context.missing(_draftKeyMeta);
    }
    if (data.containsKey('user_id')) {
      context.handle(_userIdMeta,
          userId.isAcceptableOrUnknown(data['user_id']!, _userIdMeta));
    } else if (isInserting) {
      context.missing(_userIdMeta);
    }
    if (data.containsKey('workspace_id')) {
      context.handle(
          _workspaceIdMeta,
          workspaceId.isAcceptableOrUnknown(
              data['workspace_id']!, _workspaceIdMeta));
    } else if (isInserting) {
      context.missing(_workspaceIdMeta);
    }
    if (data.containsKey('country')) {
      context.handle(_countryMeta,
          country.isAcceptableOrUnknown(data['country']!, _countryMeta));
    }
    if (data.containsKey('asset_no')) {
      context.handle(_assetNoMeta,
          assetNo.isAcceptableOrUnknown(data['asset_no']!, _assetNoMeta));
    } else if (isInserting) {
      context.missing(_assetNoMeta);
    }
    if (data.containsKey('vehicle_type')) {
      context.handle(
          _vehicleTypeMeta,
          vehicleType.isAcceptableOrUnknown(
              data['vehicle_type']!, _vehicleTypeMeta));
    }
    if (data.containsKey('site')) {
      context.handle(
          _siteMeta, site.isAcceptableOrUnknown(data['site']!, _siteMeta));
    }
    if (data.containsKey('inspector_name')) {
      context.handle(
          _inspectorNameMeta,
          inspectorName.isAcceptableOrUnknown(
              data['inspector_name']!, _inspectorNameMeta));
    }
    if (data.containsKey('odometer_km')) {
      context.handle(
          _odometerKmMeta,
          odometerKm.isAcceptableOrUnknown(
              data['odometer_km']!, _odometerKmMeta));
    }
    if (data.containsKey('engine_hours')) {
      context.handle(
          _engineHoursMeta,
          engineHours.isAcceptableOrUnknown(
              data['engine_hours']!, _engineHoursMeta));
    }
    if (data.containsKey('findings')) {
      context.handle(_findingsMeta,
          findings.isAcceptableOrUnknown(data['findings']!, _findingsMeta));
    }
    if (data.containsKey('filled')) {
      context.handle(_filledMeta,
          filled.isAcceptableOrUnknown(data['filled']!, _filledMeta));
    } else if (isInserting) {
      context.missing(_filledMeta);
    }
    if (data.containsKey('total')) {
      context.handle(
          _totalMeta, total.isAcceptableOrUnknown(data['total']!, _totalMeta));
    } else if (isInserting) {
      context.missing(_totalMeta);
    }
    if (data.containsKey('created_at')) {
      context.handle(_createdAtMeta,
          createdAt.isAcceptableOrUnknown(data['created_at']!, _createdAtMeta));
    } else if (isInserting) {
      context.missing(_createdAtMeta);
    }
    if (data.containsKey('updated_at')) {
      context.handle(_updatedAtMeta,
          updatedAt.isAcceptableOrUnknown(data['updated_at']!, _updatedAtMeta));
    } else if (isInserting) {
      context.missing(_updatedAtMeta);
    }
    return context;
  }

  @override
  Set<GeneratedColumn> get $primaryKey => {draftKey};
  @override
  InspectionDraft map(Map<String, dynamic> data, {String? tablePrefix}) {
    final effectivePrefix = tablePrefix != null ? '$tablePrefix.' : '';
    return InspectionDraft(
      draftKey: attachedDatabase.typeMapping
          .read(DriftSqlType.string, data['${effectivePrefix}draft_key'])!,
      userId: attachedDatabase.typeMapping
          .read(DriftSqlType.string, data['${effectivePrefix}user_id'])!,
      workspaceId: attachedDatabase.typeMapping
          .read(DriftSqlType.string, data['${effectivePrefix}workspace_id'])!,
      country: attachedDatabase.typeMapping
          .read(DriftSqlType.string, data['${effectivePrefix}country']),
      assetNo: attachedDatabase.typeMapping
          .read(DriftSqlType.string, data['${effectivePrefix}asset_no'])!,
      vehicleType: attachedDatabase.typeMapping
          .read(DriftSqlType.string, data['${effectivePrefix}vehicle_type']),
      site: attachedDatabase.typeMapping
          .read(DriftSqlType.string, data['${effectivePrefix}site']),
      inspectorName: attachedDatabase.typeMapping
          .read(DriftSqlType.string, data['${effectivePrefix}inspector_name']),
      odometerKm: attachedDatabase.typeMapping
          .read(DriftSqlType.int, data['${effectivePrefix}odometer_km']),
      engineHours: attachedDatabase.typeMapping
          .read(DriftSqlType.double, data['${effectivePrefix}engine_hours']),
      findings: attachedDatabase.typeMapping
          .read(DriftSqlType.string, data['${effectivePrefix}findings']),
      filled: attachedDatabase.typeMapping
          .read(DriftSqlType.int, data['${effectivePrefix}filled'])!,
      total: attachedDatabase.typeMapping
          .read(DriftSqlType.int, data['${effectivePrefix}total'])!,
      createdAt: attachedDatabase.typeMapping
          .read(DriftSqlType.dateTime, data['${effectivePrefix}created_at'])!,
      updatedAt: attachedDatabase.typeMapping
          .read(DriftSqlType.dateTime, data['${effectivePrefix}updated_at'])!,
    );
  }

  @override
  $InspectionDraftsTable createAlias(String alias) {
    return $InspectionDraftsTable(attachedDatabase, alias);
  }
}

class InspectionDraft extends DataClass implements Insertable<InspectionDraft> {
  /// `userId|ASSETNO`. Built by the repository, never by a screen.
  final String draftKey;
  final String userId;

  /// Which tenant this work was captured in, so a sync running under a
  /// switched workspace can refuse to push it rather than write it into the
  /// wrong tenant.
  final String workspaceId;
  final String? country;

  /// Normalised, uppercase.
  final String assetNo;

  /// Pins the diagram layout at fill time, so a later change to the asset
  /// record cannot silently re-shape a half-filled sheet.
  final String? vehicleType;
  final String? site;
  final String? inspectorName;

  /// Nullable. Zero IS a reading and must not be conflated with absent: an
  /// asset genuinely at 0 km and an asset nobody read are different facts.
  final int? odometerKm;

  /// Same reasoning as [odometerKm].
  final double? engineHours;
  final String? findings;

  /// Progress as the SCREEN counted it, over fields a person can actually
  /// record. Never re-derived here: the screen knows which fields are visible
  /// under the current conditional logic and this table does not.
  final int filled;
  final int total;
  final DateTime createdAt;

  /// Sort key for the unfinished-work list and the source of its "last saved"
  /// line.
  final DateTime updatedAt;
  const InspectionDraft(
      {required this.draftKey,
      required this.userId,
      required this.workspaceId,
      this.country,
      required this.assetNo,
      this.vehicleType,
      this.site,
      this.inspectorName,
      this.odometerKm,
      this.engineHours,
      this.findings,
      required this.filled,
      required this.total,
      required this.createdAt,
      required this.updatedAt});
  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    map['draft_key'] = Variable<String>(draftKey);
    map['user_id'] = Variable<String>(userId);
    map['workspace_id'] = Variable<String>(workspaceId);
    if (!nullToAbsent || country != null) {
      map['country'] = Variable<String>(country);
    }
    map['asset_no'] = Variable<String>(assetNo);
    if (!nullToAbsent || vehicleType != null) {
      map['vehicle_type'] = Variable<String>(vehicleType);
    }
    if (!nullToAbsent || site != null) {
      map['site'] = Variable<String>(site);
    }
    if (!nullToAbsent || inspectorName != null) {
      map['inspector_name'] = Variable<String>(inspectorName);
    }
    if (!nullToAbsent || odometerKm != null) {
      map['odometer_km'] = Variable<int>(odometerKm);
    }
    if (!nullToAbsent || engineHours != null) {
      map['engine_hours'] = Variable<double>(engineHours);
    }
    if (!nullToAbsent || findings != null) {
      map['findings'] = Variable<String>(findings);
    }
    map['filled'] = Variable<int>(filled);
    map['total'] = Variable<int>(total);
    map['created_at'] = Variable<DateTime>(createdAt);
    map['updated_at'] = Variable<DateTime>(updatedAt);
    return map;
  }

  InspectionDraftsCompanion toCompanion(bool nullToAbsent) {
    return InspectionDraftsCompanion(
      draftKey: Value(draftKey),
      userId: Value(userId),
      workspaceId: Value(workspaceId),
      country: country == null && nullToAbsent
          ? const Value.absent()
          : Value(country),
      assetNo: Value(assetNo),
      vehicleType: vehicleType == null && nullToAbsent
          ? const Value.absent()
          : Value(vehicleType),
      site: site == null && nullToAbsent ? const Value.absent() : Value(site),
      inspectorName: inspectorName == null && nullToAbsent
          ? const Value.absent()
          : Value(inspectorName),
      odometerKm: odometerKm == null && nullToAbsent
          ? const Value.absent()
          : Value(odometerKm),
      engineHours: engineHours == null && nullToAbsent
          ? const Value.absent()
          : Value(engineHours),
      findings: findings == null && nullToAbsent
          ? const Value.absent()
          : Value(findings),
      filled: Value(filled),
      total: Value(total),
      createdAt: Value(createdAt),
      updatedAt: Value(updatedAt),
    );
  }

  factory InspectionDraft.fromJson(Map<String, dynamic> json,
      {ValueSerializer? serializer}) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return InspectionDraft(
      draftKey: serializer.fromJson<String>(json['draftKey']),
      userId: serializer.fromJson<String>(json['userId']),
      workspaceId: serializer.fromJson<String>(json['workspaceId']),
      country: serializer.fromJson<String?>(json['country']),
      assetNo: serializer.fromJson<String>(json['assetNo']),
      vehicleType: serializer.fromJson<String?>(json['vehicleType']),
      site: serializer.fromJson<String?>(json['site']),
      inspectorName: serializer.fromJson<String?>(json['inspectorName']),
      odometerKm: serializer.fromJson<int?>(json['odometerKm']),
      engineHours: serializer.fromJson<double?>(json['engineHours']),
      findings: serializer.fromJson<String?>(json['findings']),
      filled: serializer.fromJson<int>(json['filled']),
      total: serializer.fromJson<int>(json['total']),
      createdAt: serializer.fromJson<DateTime>(json['createdAt']),
      updatedAt: serializer.fromJson<DateTime>(json['updatedAt']),
    );
  }
  @override
  Map<String, dynamic> toJson({ValueSerializer? serializer}) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return <String, dynamic>{
      'draftKey': serializer.toJson<String>(draftKey),
      'userId': serializer.toJson<String>(userId),
      'workspaceId': serializer.toJson<String>(workspaceId),
      'country': serializer.toJson<String?>(country),
      'assetNo': serializer.toJson<String>(assetNo),
      'vehicleType': serializer.toJson<String?>(vehicleType),
      'site': serializer.toJson<String?>(site),
      'inspectorName': serializer.toJson<String?>(inspectorName),
      'odometerKm': serializer.toJson<int?>(odometerKm),
      'engineHours': serializer.toJson<double?>(engineHours),
      'findings': serializer.toJson<String?>(findings),
      'filled': serializer.toJson<int>(filled),
      'total': serializer.toJson<int>(total),
      'createdAt': serializer.toJson<DateTime>(createdAt),
      'updatedAt': serializer.toJson<DateTime>(updatedAt),
    };
  }

  InspectionDraft copyWith(
          {String? draftKey,
          String? userId,
          String? workspaceId,
          Value<String?> country = const Value.absent(),
          String? assetNo,
          Value<String?> vehicleType = const Value.absent(),
          Value<String?> site = const Value.absent(),
          Value<String?> inspectorName = const Value.absent(),
          Value<int?> odometerKm = const Value.absent(),
          Value<double?> engineHours = const Value.absent(),
          Value<String?> findings = const Value.absent(),
          int? filled,
          int? total,
          DateTime? createdAt,
          DateTime? updatedAt}) =>
      InspectionDraft(
        draftKey: draftKey ?? this.draftKey,
        userId: userId ?? this.userId,
        workspaceId: workspaceId ?? this.workspaceId,
        country: country.present ? country.value : this.country,
        assetNo: assetNo ?? this.assetNo,
        vehicleType: vehicleType.present ? vehicleType.value : this.vehicleType,
        site: site.present ? site.value : this.site,
        inspectorName:
            inspectorName.present ? inspectorName.value : this.inspectorName,
        odometerKm: odometerKm.present ? odometerKm.value : this.odometerKm,
        engineHours: engineHours.present ? engineHours.value : this.engineHours,
        findings: findings.present ? findings.value : this.findings,
        filled: filled ?? this.filled,
        total: total ?? this.total,
        createdAt: createdAt ?? this.createdAt,
        updatedAt: updatedAt ?? this.updatedAt,
      );
  InspectionDraft copyWithCompanion(InspectionDraftsCompanion data) {
    return InspectionDraft(
      draftKey: data.draftKey.present ? data.draftKey.value : this.draftKey,
      userId: data.userId.present ? data.userId.value : this.userId,
      workspaceId:
          data.workspaceId.present ? data.workspaceId.value : this.workspaceId,
      country: data.country.present ? data.country.value : this.country,
      assetNo: data.assetNo.present ? data.assetNo.value : this.assetNo,
      vehicleType:
          data.vehicleType.present ? data.vehicleType.value : this.vehicleType,
      site: data.site.present ? data.site.value : this.site,
      inspectorName: data.inspectorName.present
          ? data.inspectorName.value
          : this.inspectorName,
      odometerKm:
          data.odometerKm.present ? data.odometerKm.value : this.odometerKm,
      engineHours:
          data.engineHours.present ? data.engineHours.value : this.engineHours,
      findings: data.findings.present ? data.findings.value : this.findings,
      filled: data.filled.present ? data.filled.value : this.filled,
      total: data.total.present ? data.total.value : this.total,
      createdAt: data.createdAt.present ? data.createdAt.value : this.createdAt,
      updatedAt: data.updatedAt.present ? data.updatedAt.value : this.updatedAt,
    );
  }

  @override
  String toString() {
    return (StringBuffer('InspectionDraft(')
          ..write('draftKey: $draftKey, ')
          ..write('userId: $userId, ')
          ..write('workspaceId: $workspaceId, ')
          ..write('country: $country, ')
          ..write('assetNo: $assetNo, ')
          ..write('vehicleType: $vehicleType, ')
          ..write('site: $site, ')
          ..write('inspectorName: $inspectorName, ')
          ..write('odometerKm: $odometerKm, ')
          ..write('engineHours: $engineHours, ')
          ..write('findings: $findings, ')
          ..write('filled: $filled, ')
          ..write('total: $total, ')
          ..write('createdAt: $createdAt, ')
          ..write('updatedAt: $updatedAt')
          ..write(')'))
        .toString();
  }

  @override
  int get hashCode => Object.hash(
      draftKey,
      userId,
      workspaceId,
      country,
      assetNo,
      vehicleType,
      site,
      inspectorName,
      odometerKm,
      engineHours,
      findings,
      filled,
      total,
      createdAt,
      updatedAt);
  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      (other is InspectionDraft &&
          other.draftKey == this.draftKey &&
          other.userId == this.userId &&
          other.workspaceId == this.workspaceId &&
          other.country == this.country &&
          other.assetNo == this.assetNo &&
          other.vehicleType == this.vehicleType &&
          other.site == this.site &&
          other.inspectorName == this.inspectorName &&
          other.odometerKm == this.odometerKm &&
          other.engineHours == this.engineHours &&
          other.findings == this.findings &&
          other.filled == this.filled &&
          other.total == this.total &&
          other.createdAt == this.createdAt &&
          other.updatedAt == this.updatedAt);
}

class InspectionDraftsCompanion extends UpdateCompanion<InspectionDraft> {
  final Value<String> draftKey;
  final Value<String> userId;
  final Value<String> workspaceId;
  final Value<String?> country;
  final Value<String> assetNo;
  final Value<String?> vehicleType;
  final Value<String?> site;
  final Value<String?> inspectorName;
  final Value<int?> odometerKm;
  final Value<double?> engineHours;
  final Value<String?> findings;
  final Value<int> filled;
  final Value<int> total;
  final Value<DateTime> createdAt;
  final Value<DateTime> updatedAt;
  final Value<int> rowid;
  const InspectionDraftsCompanion({
    this.draftKey = const Value.absent(),
    this.userId = const Value.absent(),
    this.workspaceId = const Value.absent(),
    this.country = const Value.absent(),
    this.assetNo = const Value.absent(),
    this.vehicleType = const Value.absent(),
    this.site = const Value.absent(),
    this.inspectorName = const Value.absent(),
    this.odometerKm = const Value.absent(),
    this.engineHours = const Value.absent(),
    this.findings = const Value.absent(),
    this.filled = const Value.absent(),
    this.total = const Value.absent(),
    this.createdAt = const Value.absent(),
    this.updatedAt = const Value.absent(),
    this.rowid = const Value.absent(),
  });
  InspectionDraftsCompanion.insert({
    required String draftKey,
    required String userId,
    required String workspaceId,
    this.country = const Value.absent(),
    required String assetNo,
    this.vehicleType = const Value.absent(),
    this.site = const Value.absent(),
    this.inspectorName = const Value.absent(),
    this.odometerKm = const Value.absent(),
    this.engineHours = const Value.absent(),
    this.findings = const Value.absent(),
    required int filled,
    required int total,
    required DateTime createdAt,
    required DateTime updatedAt,
    this.rowid = const Value.absent(),
  })  : draftKey = Value(draftKey),
        userId = Value(userId),
        workspaceId = Value(workspaceId),
        assetNo = Value(assetNo),
        filled = Value(filled),
        total = Value(total),
        createdAt = Value(createdAt),
        updatedAt = Value(updatedAt);
  static Insertable<InspectionDraft> custom({
    Expression<String>? draftKey,
    Expression<String>? userId,
    Expression<String>? workspaceId,
    Expression<String>? country,
    Expression<String>? assetNo,
    Expression<String>? vehicleType,
    Expression<String>? site,
    Expression<String>? inspectorName,
    Expression<int>? odometerKm,
    Expression<double>? engineHours,
    Expression<String>? findings,
    Expression<int>? filled,
    Expression<int>? total,
    Expression<DateTime>? createdAt,
    Expression<DateTime>? updatedAt,
    Expression<int>? rowid,
  }) {
    return RawValuesInsertable({
      if (draftKey != null) 'draft_key': draftKey,
      if (userId != null) 'user_id': userId,
      if (workspaceId != null) 'workspace_id': workspaceId,
      if (country != null) 'country': country,
      if (assetNo != null) 'asset_no': assetNo,
      if (vehicleType != null) 'vehicle_type': vehicleType,
      if (site != null) 'site': site,
      if (inspectorName != null) 'inspector_name': inspectorName,
      if (odometerKm != null) 'odometer_km': odometerKm,
      if (engineHours != null) 'engine_hours': engineHours,
      if (findings != null) 'findings': findings,
      if (filled != null) 'filled': filled,
      if (total != null) 'total': total,
      if (createdAt != null) 'created_at': createdAt,
      if (updatedAt != null) 'updated_at': updatedAt,
      if (rowid != null) 'rowid': rowid,
    });
  }

  InspectionDraftsCompanion copyWith(
      {Value<String>? draftKey,
      Value<String>? userId,
      Value<String>? workspaceId,
      Value<String?>? country,
      Value<String>? assetNo,
      Value<String?>? vehicleType,
      Value<String?>? site,
      Value<String?>? inspectorName,
      Value<int?>? odometerKm,
      Value<double?>? engineHours,
      Value<String?>? findings,
      Value<int>? filled,
      Value<int>? total,
      Value<DateTime>? createdAt,
      Value<DateTime>? updatedAt,
      Value<int>? rowid}) {
    return InspectionDraftsCompanion(
      draftKey: draftKey ?? this.draftKey,
      userId: userId ?? this.userId,
      workspaceId: workspaceId ?? this.workspaceId,
      country: country ?? this.country,
      assetNo: assetNo ?? this.assetNo,
      vehicleType: vehicleType ?? this.vehicleType,
      site: site ?? this.site,
      inspectorName: inspectorName ?? this.inspectorName,
      odometerKm: odometerKm ?? this.odometerKm,
      engineHours: engineHours ?? this.engineHours,
      findings: findings ?? this.findings,
      filled: filled ?? this.filled,
      total: total ?? this.total,
      createdAt: createdAt ?? this.createdAt,
      updatedAt: updatedAt ?? this.updatedAt,
      rowid: rowid ?? this.rowid,
    );
  }

  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    if (draftKey.present) {
      map['draft_key'] = Variable<String>(draftKey.value);
    }
    if (userId.present) {
      map['user_id'] = Variable<String>(userId.value);
    }
    if (workspaceId.present) {
      map['workspace_id'] = Variable<String>(workspaceId.value);
    }
    if (country.present) {
      map['country'] = Variable<String>(country.value);
    }
    if (assetNo.present) {
      map['asset_no'] = Variable<String>(assetNo.value);
    }
    if (vehicleType.present) {
      map['vehicle_type'] = Variable<String>(vehicleType.value);
    }
    if (site.present) {
      map['site'] = Variable<String>(site.value);
    }
    if (inspectorName.present) {
      map['inspector_name'] = Variable<String>(inspectorName.value);
    }
    if (odometerKm.present) {
      map['odometer_km'] = Variable<int>(odometerKm.value);
    }
    if (engineHours.present) {
      map['engine_hours'] = Variable<double>(engineHours.value);
    }
    if (findings.present) {
      map['findings'] = Variable<String>(findings.value);
    }
    if (filled.present) {
      map['filled'] = Variable<int>(filled.value);
    }
    if (total.present) {
      map['total'] = Variable<int>(total.value);
    }
    if (createdAt.present) {
      map['created_at'] = Variable<DateTime>(createdAt.value);
    }
    if (updatedAt.present) {
      map['updated_at'] = Variable<DateTime>(updatedAt.value);
    }
    if (rowid.present) {
      map['rowid'] = Variable<int>(rowid.value);
    }
    return map;
  }

  @override
  String toString() {
    return (StringBuffer('InspectionDraftsCompanion(')
          ..write('draftKey: $draftKey, ')
          ..write('userId: $userId, ')
          ..write('workspaceId: $workspaceId, ')
          ..write('country: $country, ')
          ..write('assetNo: $assetNo, ')
          ..write('vehicleType: $vehicleType, ')
          ..write('site: $site, ')
          ..write('inspectorName: $inspectorName, ')
          ..write('odometerKm: $odometerKm, ')
          ..write('engineHours: $engineHours, ')
          ..write('findings: $findings, ')
          ..write('filled: $filled, ')
          ..write('total: $total, ')
          ..write('createdAt: $createdAt, ')
          ..write('updatedAt: $updatedAt, ')
          ..write('rowid: $rowid')
          ..write(')'))
        .toString();
  }
}

class $InspectionDraftPositionsTable extends InspectionDraftPositions
    with TableInfo<$InspectionDraftPositionsTable, InspectionDraftPosition> {
  @override
  final GeneratedDatabase attachedDatabase;
  final String? _alias;
  $InspectionDraftPositionsTable(this.attachedDatabase, [this._alias]);
  static const VerificationMeta _idMeta = const VerificationMeta('id');
  @override
  late final GeneratedColumn<String> id = GeneratedColumn<String>(
      'id', aliasedName, false,
      type: DriftSqlType.string, requiredDuringInsert: true);
  static const VerificationMeta _draftKeyMeta =
      const VerificationMeta('draftKey');
  @override
  late final GeneratedColumn<String> draftKey = GeneratedColumn<String>(
      'draft_key', aliasedName, false,
      type: DriftSqlType.string,
      requiredDuringInsert: true,
      defaultConstraints: GeneratedColumn.constraintIsAlways(
          'REFERENCES inspection_drafts (draft_key) ON DELETE CASCADE'));
  static const VerificationMeta _positionMeta =
      const VerificationMeta('position');
  @override
  late final GeneratedColumn<String> position = GeneratedColumn<String>(
      'position', aliasedName, false,
      type: DriftSqlType.string, requiredDuringInsert: true);
  static const VerificationMeta _conditionMeta =
      const VerificationMeta('condition');
  @override
  late final GeneratedColumn<String> condition = GeneratedColumn<String>(
      'condition', aliasedName, true,
      type: DriftSqlType.string, requiredDuringInsert: false);
  static const VerificationMeta _pressurePsiMeta =
      const VerificationMeta('pressurePsi');
  @override
  late final GeneratedColumn<double> pressurePsi = GeneratedColumn<double>(
      'pressure_psi', aliasedName, true,
      type: DriftSqlType.double, requiredDuringInsert: false);
  static const VerificationMeta _treadDepthMmMeta =
      const VerificationMeta('treadDepthMm');
  @override
  late final GeneratedColumn<double> treadDepthMm = GeneratedColumn<double>(
      'tread_depth_mm', aliasedName, true,
      type: DriftSqlType.double, requiredDuringInsert: false);
  static const VerificationMeta _serialNoMeta =
      const VerificationMeta('serialNo');
  @override
  late final GeneratedColumn<String> serialNo = GeneratedColumn<String>(
      'serial_no', aliasedName, true,
      type: DriftSqlType.string, requiredDuringInsert: false);
  static const VerificationMeta _checkedMeta =
      const VerificationMeta('checked');
  @override
  late final GeneratedColumn<bool> checked = GeneratedColumn<bool>(
      'checked', aliasedName, false,
      type: DriftSqlType.bool,
      requiredDuringInsert: false,
      defaultConstraints:
          GeneratedColumn.constraintIsAlways('CHECK ("checked" IN (0, 1))'),
      defaultValue: const Constant(false));
  static const VerificationMeta _updatedAtMeta =
      const VerificationMeta('updatedAt');
  @override
  late final GeneratedColumn<DateTime> updatedAt = GeneratedColumn<DateTime>(
      'updated_at', aliasedName, false,
      type: DriftSqlType.dateTime, requiredDuringInsert: true);
  @override
  List<GeneratedColumn> get $columns => [
        id,
        draftKey,
        position,
        condition,
        pressurePsi,
        treadDepthMm,
        serialNo,
        checked,
        updatedAt
      ];
  @override
  String get aliasedName => _alias ?? actualTableName;
  @override
  String get actualTableName => $name;
  static const String $name = 'inspection_draft_positions';
  @override
  VerificationContext validateIntegrity(
      Insertable<InspectionDraftPosition> instance,
      {bool isInserting = false}) {
    final context = VerificationContext();
    final data = instance.toColumns(true);
    if (data.containsKey('id')) {
      context.handle(_idMeta, id.isAcceptableOrUnknown(data['id']!, _idMeta));
    } else if (isInserting) {
      context.missing(_idMeta);
    }
    if (data.containsKey('draft_key')) {
      context.handle(_draftKeyMeta,
          draftKey.isAcceptableOrUnknown(data['draft_key']!, _draftKeyMeta));
    } else if (isInserting) {
      context.missing(_draftKeyMeta);
    }
    if (data.containsKey('position')) {
      context.handle(_positionMeta,
          position.isAcceptableOrUnknown(data['position']!, _positionMeta));
    } else if (isInserting) {
      context.missing(_positionMeta);
    }
    if (data.containsKey('condition')) {
      context.handle(_conditionMeta,
          condition.isAcceptableOrUnknown(data['condition']!, _conditionMeta));
    }
    if (data.containsKey('pressure_psi')) {
      context.handle(
          _pressurePsiMeta,
          pressurePsi.isAcceptableOrUnknown(
              data['pressure_psi']!, _pressurePsiMeta));
    }
    if (data.containsKey('tread_depth_mm')) {
      context.handle(
          _treadDepthMmMeta,
          treadDepthMm.isAcceptableOrUnknown(
              data['tread_depth_mm']!, _treadDepthMmMeta));
    }
    if (data.containsKey('serial_no')) {
      context.handle(_serialNoMeta,
          serialNo.isAcceptableOrUnknown(data['serial_no']!, _serialNoMeta));
    }
    if (data.containsKey('checked')) {
      context.handle(_checkedMeta,
          checked.isAcceptableOrUnknown(data['checked']!, _checkedMeta));
    }
    if (data.containsKey('updated_at')) {
      context.handle(_updatedAtMeta,
          updatedAt.isAcceptableOrUnknown(data['updated_at']!, _updatedAtMeta));
    } else if (isInserting) {
      context.missing(_updatedAtMeta);
    }
    return context;
  }

  @override
  Set<GeneratedColumn> get $primaryKey => {id};
  @override
  InspectionDraftPosition map(Map<String, dynamic> data,
      {String? tablePrefix}) {
    final effectivePrefix = tablePrefix != null ? '$tablePrefix.' : '';
    return InspectionDraftPosition(
      id: attachedDatabase.typeMapping
          .read(DriftSqlType.string, data['${effectivePrefix}id'])!,
      draftKey: attachedDatabase.typeMapping
          .read(DriftSqlType.string, data['${effectivePrefix}draft_key'])!,
      position: attachedDatabase.typeMapping
          .read(DriftSqlType.string, data['${effectivePrefix}position'])!,
      condition: attachedDatabase.typeMapping
          .read(DriftSqlType.string, data['${effectivePrefix}condition']),
      pressurePsi: attachedDatabase.typeMapping
          .read(DriftSqlType.double, data['${effectivePrefix}pressure_psi']),
      treadDepthMm: attachedDatabase.typeMapping
          .read(DriftSqlType.double, data['${effectivePrefix}tread_depth_mm']),
      serialNo: attachedDatabase.typeMapping
          .read(DriftSqlType.string, data['${effectivePrefix}serial_no']),
      checked: attachedDatabase.typeMapping
          .read(DriftSqlType.bool, data['${effectivePrefix}checked'])!,
      updatedAt: attachedDatabase.typeMapping
          .read(DriftSqlType.dateTime, data['${effectivePrefix}updated_at'])!,
    );
  }

  @override
  $InspectionDraftPositionsTable createAlias(String alias) {
    return $InspectionDraftPositionsTable(attachedDatabase, alias);
  }
}

class InspectionDraftPosition extends DataClass
    implements Insertable<InspectionDraftPosition> {
  final String id;
  final String draftKey;

  /// Canonical label, e.g. `LHF1`. AGENTS.md rule 10: never change a tyre
  /// position id.
  final String position;

  /// Good / Worn / Flat / Damaged / Puncture / Wear.
  final String? condition;

  /// Nullable, and zero is a FLAT TYRE rather than "no reading". A truthiness
  /// check here throws away the most important reading on the screen.
  final double? pressurePsi;
  final double? treadDepthMm;
  final String? serialNo;

  /// Was this wheel deliberately attended to, as opposed to pre-seeded.
  ///
  /// It defaults to FALSE and that default is the whole point. RECORDED: both
  /// capture forms pre-seed every wheel with `condition: 'Good'`, so a seeded
  /// Good and a deliberate Good are byte-identical and no completeness rule can
  /// tell them apart. The single write path for a tyre edit stamps this true.
  /// Only an explicit true counts. Getting it wrong makes the completeness gate
  /// either vacuous or a refusal of one inspection in four.
  final bool checked;
  final DateTime updatedAt;
  const InspectionDraftPosition(
      {required this.id,
      required this.draftKey,
      required this.position,
      this.condition,
      this.pressurePsi,
      this.treadDepthMm,
      this.serialNo,
      required this.checked,
      required this.updatedAt});
  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    map['id'] = Variable<String>(id);
    map['draft_key'] = Variable<String>(draftKey);
    map['position'] = Variable<String>(position);
    if (!nullToAbsent || condition != null) {
      map['condition'] = Variable<String>(condition);
    }
    if (!nullToAbsent || pressurePsi != null) {
      map['pressure_psi'] = Variable<double>(pressurePsi);
    }
    if (!nullToAbsent || treadDepthMm != null) {
      map['tread_depth_mm'] = Variable<double>(treadDepthMm);
    }
    if (!nullToAbsent || serialNo != null) {
      map['serial_no'] = Variable<String>(serialNo);
    }
    map['checked'] = Variable<bool>(checked);
    map['updated_at'] = Variable<DateTime>(updatedAt);
    return map;
  }

  InspectionDraftPositionsCompanion toCompanion(bool nullToAbsent) {
    return InspectionDraftPositionsCompanion(
      id: Value(id),
      draftKey: Value(draftKey),
      position: Value(position),
      condition: condition == null && nullToAbsent
          ? const Value.absent()
          : Value(condition),
      pressurePsi: pressurePsi == null && nullToAbsent
          ? const Value.absent()
          : Value(pressurePsi),
      treadDepthMm: treadDepthMm == null && nullToAbsent
          ? const Value.absent()
          : Value(treadDepthMm),
      serialNo: serialNo == null && nullToAbsent
          ? const Value.absent()
          : Value(serialNo),
      checked: Value(checked),
      updatedAt: Value(updatedAt),
    );
  }

  factory InspectionDraftPosition.fromJson(Map<String, dynamic> json,
      {ValueSerializer? serializer}) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return InspectionDraftPosition(
      id: serializer.fromJson<String>(json['id']),
      draftKey: serializer.fromJson<String>(json['draftKey']),
      position: serializer.fromJson<String>(json['position']),
      condition: serializer.fromJson<String?>(json['condition']),
      pressurePsi: serializer.fromJson<double?>(json['pressurePsi']),
      treadDepthMm: serializer.fromJson<double?>(json['treadDepthMm']),
      serialNo: serializer.fromJson<String?>(json['serialNo']),
      checked: serializer.fromJson<bool>(json['checked']),
      updatedAt: serializer.fromJson<DateTime>(json['updatedAt']),
    );
  }
  @override
  Map<String, dynamic> toJson({ValueSerializer? serializer}) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return <String, dynamic>{
      'id': serializer.toJson<String>(id),
      'draftKey': serializer.toJson<String>(draftKey),
      'position': serializer.toJson<String>(position),
      'condition': serializer.toJson<String?>(condition),
      'pressurePsi': serializer.toJson<double?>(pressurePsi),
      'treadDepthMm': serializer.toJson<double?>(treadDepthMm),
      'serialNo': serializer.toJson<String?>(serialNo),
      'checked': serializer.toJson<bool>(checked),
      'updatedAt': serializer.toJson<DateTime>(updatedAt),
    };
  }

  InspectionDraftPosition copyWith(
          {String? id,
          String? draftKey,
          String? position,
          Value<String?> condition = const Value.absent(),
          Value<double?> pressurePsi = const Value.absent(),
          Value<double?> treadDepthMm = const Value.absent(),
          Value<String?> serialNo = const Value.absent(),
          bool? checked,
          DateTime? updatedAt}) =>
      InspectionDraftPosition(
        id: id ?? this.id,
        draftKey: draftKey ?? this.draftKey,
        position: position ?? this.position,
        condition: condition.present ? condition.value : this.condition,
        pressurePsi: pressurePsi.present ? pressurePsi.value : this.pressurePsi,
        treadDepthMm:
            treadDepthMm.present ? treadDepthMm.value : this.treadDepthMm,
        serialNo: serialNo.present ? serialNo.value : this.serialNo,
        checked: checked ?? this.checked,
        updatedAt: updatedAt ?? this.updatedAt,
      );
  InspectionDraftPosition copyWithCompanion(
      InspectionDraftPositionsCompanion data) {
    return InspectionDraftPosition(
      id: data.id.present ? data.id.value : this.id,
      draftKey: data.draftKey.present ? data.draftKey.value : this.draftKey,
      position: data.position.present ? data.position.value : this.position,
      condition: data.condition.present ? data.condition.value : this.condition,
      pressurePsi:
          data.pressurePsi.present ? data.pressurePsi.value : this.pressurePsi,
      treadDepthMm: data.treadDepthMm.present
          ? data.treadDepthMm.value
          : this.treadDepthMm,
      serialNo: data.serialNo.present ? data.serialNo.value : this.serialNo,
      checked: data.checked.present ? data.checked.value : this.checked,
      updatedAt: data.updatedAt.present ? data.updatedAt.value : this.updatedAt,
    );
  }

  @override
  String toString() {
    return (StringBuffer('InspectionDraftPosition(')
          ..write('id: $id, ')
          ..write('draftKey: $draftKey, ')
          ..write('position: $position, ')
          ..write('condition: $condition, ')
          ..write('pressurePsi: $pressurePsi, ')
          ..write('treadDepthMm: $treadDepthMm, ')
          ..write('serialNo: $serialNo, ')
          ..write('checked: $checked, ')
          ..write('updatedAt: $updatedAt')
          ..write(')'))
        .toString();
  }

  @override
  int get hashCode => Object.hash(id, draftKey, position, condition,
      pressurePsi, treadDepthMm, serialNo, checked, updatedAt);
  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      (other is InspectionDraftPosition &&
          other.id == this.id &&
          other.draftKey == this.draftKey &&
          other.position == this.position &&
          other.condition == this.condition &&
          other.pressurePsi == this.pressurePsi &&
          other.treadDepthMm == this.treadDepthMm &&
          other.serialNo == this.serialNo &&
          other.checked == this.checked &&
          other.updatedAt == this.updatedAt);
}

class InspectionDraftPositionsCompanion
    extends UpdateCompanion<InspectionDraftPosition> {
  final Value<String> id;
  final Value<String> draftKey;
  final Value<String> position;
  final Value<String?> condition;
  final Value<double?> pressurePsi;
  final Value<double?> treadDepthMm;
  final Value<String?> serialNo;
  final Value<bool> checked;
  final Value<DateTime> updatedAt;
  final Value<int> rowid;
  const InspectionDraftPositionsCompanion({
    this.id = const Value.absent(),
    this.draftKey = const Value.absent(),
    this.position = const Value.absent(),
    this.condition = const Value.absent(),
    this.pressurePsi = const Value.absent(),
    this.treadDepthMm = const Value.absent(),
    this.serialNo = const Value.absent(),
    this.checked = const Value.absent(),
    this.updatedAt = const Value.absent(),
    this.rowid = const Value.absent(),
  });
  InspectionDraftPositionsCompanion.insert({
    required String id,
    required String draftKey,
    required String position,
    this.condition = const Value.absent(),
    this.pressurePsi = const Value.absent(),
    this.treadDepthMm = const Value.absent(),
    this.serialNo = const Value.absent(),
    this.checked = const Value.absent(),
    required DateTime updatedAt,
    this.rowid = const Value.absent(),
  })  : id = Value(id),
        draftKey = Value(draftKey),
        position = Value(position),
        updatedAt = Value(updatedAt);
  static Insertable<InspectionDraftPosition> custom({
    Expression<String>? id,
    Expression<String>? draftKey,
    Expression<String>? position,
    Expression<String>? condition,
    Expression<double>? pressurePsi,
    Expression<double>? treadDepthMm,
    Expression<String>? serialNo,
    Expression<bool>? checked,
    Expression<DateTime>? updatedAt,
    Expression<int>? rowid,
  }) {
    return RawValuesInsertable({
      if (id != null) 'id': id,
      if (draftKey != null) 'draft_key': draftKey,
      if (position != null) 'position': position,
      if (condition != null) 'condition': condition,
      if (pressurePsi != null) 'pressure_psi': pressurePsi,
      if (treadDepthMm != null) 'tread_depth_mm': treadDepthMm,
      if (serialNo != null) 'serial_no': serialNo,
      if (checked != null) 'checked': checked,
      if (updatedAt != null) 'updated_at': updatedAt,
      if (rowid != null) 'rowid': rowid,
    });
  }

  InspectionDraftPositionsCompanion copyWith(
      {Value<String>? id,
      Value<String>? draftKey,
      Value<String>? position,
      Value<String?>? condition,
      Value<double?>? pressurePsi,
      Value<double?>? treadDepthMm,
      Value<String?>? serialNo,
      Value<bool>? checked,
      Value<DateTime>? updatedAt,
      Value<int>? rowid}) {
    return InspectionDraftPositionsCompanion(
      id: id ?? this.id,
      draftKey: draftKey ?? this.draftKey,
      position: position ?? this.position,
      condition: condition ?? this.condition,
      pressurePsi: pressurePsi ?? this.pressurePsi,
      treadDepthMm: treadDepthMm ?? this.treadDepthMm,
      serialNo: serialNo ?? this.serialNo,
      checked: checked ?? this.checked,
      updatedAt: updatedAt ?? this.updatedAt,
      rowid: rowid ?? this.rowid,
    );
  }

  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    if (id.present) {
      map['id'] = Variable<String>(id.value);
    }
    if (draftKey.present) {
      map['draft_key'] = Variable<String>(draftKey.value);
    }
    if (position.present) {
      map['position'] = Variable<String>(position.value);
    }
    if (condition.present) {
      map['condition'] = Variable<String>(condition.value);
    }
    if (pressurePsi.present) {
      map['pressure_psi'] = Variable<double>(pressurePsi.value);
    }
    if (treadDepthMm.present) {
      map['tread_depth_mm'] = Variable<double>(treadDepthMm.value);
    }
    if (serialNo.present) {
      map['serial_no'] = Variable<String>(serialNo.value);
    }
    if (checked.present) {
      map['checked'] = Variable<bool>(checked.value);
    }
    if (updatedAt.present) {
      map['updated_at'] = Variable<DateTime>(updatedAt.value);
    }
    if (rowid.present) {
      map['rowid'] = Variable<int>(rowid.value);
    }
    return map;
  }

  @override
  String toString() {
    return (StringBuffer('InspectionDraftPositionsCompanion(')
          ..write('id: $id, ')
          ..write('draftKey: $draftKey, ')
          ..write('position: $position, ')
          ..write('condition: $condition, ')
          ..write('pressurePsi: $pressurePsi, ')
          ..write('treadDepthMm: $treadDepthMm, ')
          ..write('serialNo: $serialNo, ')
          ..write('checked: $checked, ')
          ..write('updatedAt: $updatedAt, ')
          ..write('rowid: $rowid')
          ..write(')'))
        .toString();
  }
}

class $ChecklistDraftsTable extends ChecklistDrafts
    with TableInfo<$ChecklistDraftsTable, ChecklistDraft> {
  @override
  final GeneratedDatabase attachedDatabase;
  final String? _alias;
  $ChecklistDraftsTable(this.attachedDatabase, [this._alias]);
  static const VerificationMeta _draftKeyMeta =
      const VerificationMeta('draftKey');
  @override
  late final GeneratedColumn<String> draftKey = GeneratedColumn<String>(
      'draft_key', aliasedName, false,
      type: DriftSqlType.string, requiredDuringInsert: true);
  static const VerificationMeta _userIdMeta = const VerificationMeta('userId');
  @override
  late final GeneratedColumn<String> userId = GeneratedColumn<String>(
      'user_id', aliasedName, false,
      type: DriftSqlType.string, requiredDuringInsert: true);
  static const VerificationMeta _workspaceIdMeta =
      const VerificationMeta('workspaceId');
  @override
  late final GeneratedColumn<String> workspaceId = GeneratedColumn<String>(
      'workspace_id', aliasedName, false,
      type: DriftSqlType.string, requiredDuringInsert: true);
  static const VerificationMeta _templateIdMeta =
      const VerificationMeta('templateId');
  @override
  late final GeneratedColumn<String> templateId = GeneratedColumn<String>(
      'template_id', aliasedName, false,
      type: DriftSqlType.string, requiredDuringInsert: true);
  static const VerificationMeta _templateNameMeta =
      const VerificationMeta('templateName');
  @override
  late final GeneratedColumn<String> templateName = GeneratedColumn<String>(
      'template_name', aliasedName, false,
      type: DriftSqlType.string, requiredDuringInsert: true);
  static const VerificationMeta _templateVersionMeta =
      const VerificationMeta('templateVersion');
  @override
  late final GeneratedColumn<int> templateVersion = GeneratedColumn<int>(
      'template_version', aliasedName, false,
      type: DriftSqlType.int, requiredDuringInsert: true);
  static const VerificationMeta _assetNoMeta =
      const VerificationMeta('assetNo');
  @override
  late final GeneratedColumn<String> assetNo = GeneratedColumn<String>(
      'asset_no', aliasedName, false,
      type: DriftSqlType.string, requiredDuringInsert: true);
  static const VerificationMeta _assignmentIdMeta =
      const VerificationMeta('assignmentId');
  @override
  late final GeneratedColumn<String> assignmentId = GeneratedColumn<String>(
      'assignment_id', aliasedName, true,
      type: DriftSqlType.string, requiredDuringInsert: false);
  static const VerificationMeta _siteMeta = const VerificationMeta('site');
  @override
  late final GeneratedColumn<String> site = GeneratedColumn<String>(
      'site', aliasedName, true,
      type: DriftSqlType.string, requiredDuringInsert: false);
  static const VerificationMeta _titleMeta = const VerificationMeta('title');
  @override
  late final GeneratedColumn<String> title = GeneratedColumn<String>(
      'title', aliasedName, true,
      type: DriftSqlType.string, requiredDuringInsert: false);
  static const VerificationMeta _readLangMeta =
      const VerificationMeta('readLang');
  @override
  late final GeneratedColumn<String> readLang = GeneratedColumn<String>(
      'read_lang', aliasedName, true,
      type: DriftSqlType.string, requiredDuringInsert: false);
  static const VerificationMeta _answersJsonMeta =
      const VerificationMeta('answersJson');
  @override
  late final GeneratedColumn<String> answersJson = GeneratedColumn<String>(
      'answers_json', aliasedName, false,
      type: DriftSqlType.string, requiredDuringInsert: true);
  static const VerificationMeta _notesJsonMeta =
      const VerificationMeta('notesJson');
  @override
  late final GeneratedColumn<String> notesJson = GeneratedColumn<String>(
      'notes_json', aliasedName, false,
      type: DriftSqlType.string, requiredDuringInsert: true);
  static const VerificationMeta _printedNameMeta =
      const VerificationMeta('printedName');
  @override
  late final GeneratedColumn<String> printedName = GeneratedColumn<String>(
      'printed_name', aliasedName, true,
      type: DriftSqlType.string, requiredDuringInsert: false);
  static const VerificationMeta _filledMeta = const VerificationMeta('filled');
  @override
  late final GeneratedColumn<int> filled = GeneratedColumn<int>(
      'filled', aliasedName, false,
      type: DriftSqlType.int, requiredDuringInsert: true);
  static const VerificationMeta _totalMeta = const VerificationMeta('total');
  @override
  late final GeneratedColumn<int> total = GeneratedColumn<int>(
      'total', aliasedName, false,
      type: DriftSqlType.int, requiredDuringInsert: true);
  static const VerificationMeta _createdAtMeta =
      const VerificationMeta('createdAt');
  @override
  late final GeneratedColumn<DateTime> createdAt = GeneratedColumn<DateTime>(
      'created_at', aliasedName, false,
      type: DriftSqlType.dateTime, requiredDuringInsert: true);
  static const VerificationMeta _updatedAtMeta =
      const VerificationMeta('updatedAt');
  @override
  late final GeneratedColumn<DateTime> updatedAt = GeneratedColumn<DateTime>(
      'updated_at', aliasedName, false,
      type: DriftSqlType.dateTime, requiredDuringInsert: true);
  @override
  List<GeneratedColumn> get $columns => [
        draftKey,
        userId,
        workspaceId,
        templateId,
        templateName,
        templateVersion,
        assetNo,
        assignmentId,
        site,
        title,
        readLang,
        answersJson,
        notesJson,
        printedName,
        filled,
        total,
        createdAt,
        updatedAt
      ];
  @override
  String get aliasedName => _alias ?? actualTableName;
  @override
  String get actualTableName => $name;
  static const String $name = 'checklist_drafts';
  @override
  VerificationContext validateIntegrity(Insertable<ChecklistDraft> instance,
      {bool isInserting = false}) {
    final context = VerificationContext();
    final data = instance.toColumns(true);
    if (data.containsKey('draft_key')) {
      context.handle(_draftKeyMeta,
          draftKey.isAcceptableOrUnknown(data['draft_key']!, _draftKeyMeta));
    } else if (isInserting) {
      context.missing(_draftKeyMeta);
    }
    if (data.containsKey('user_id')) {
      context.handle(_userIdMeta,
          userId.isAcceptableOrUnknown(data['user_id']!, _userIdMeta));
    } else if (isInserting) {
      context.missing(_userIdMeta);
    }
    if (data.containsKey('workspace_id')) {
      context.handle(
          _workspaceIdMeta,
          workspaceId.isAcceptableOrUnknown(
              data['workspace_id']!, _workspaceIdMeta));
    } else if (isInserting) {
      context.missing(_workspaceIdMeta);
    }
    if (data.containsKey('template_id')) {
      context.handle(
          _templateIdMeta,
          templateId.isAcceptableOrUnknown(
              data['template_id']!, _templateIdMeta));
    } else if (isInserting) {
      context.missing(_templateIdMeta);
    }
    if (data.containsKey('template_name')) {
      context.handle(
          _templateNameMeta,
          templateName.isAcceptableOrUnknown(
              data['template_name']!, _templateNameMeta));
    } else if (isInserting) {
      context.missing(_templateNameMeta);
    }
    if (data.containsKey('template_version')) {
      context.handle(
          _templateVersionMeta,
          templateVersion.isAcceptableOrUnknown(
              data['template_version']!, _templateVersionMeta));
    } else if (isInserting) {
      context.missing(_templateVersionMeta);
    }
    if (data.containsKey('asset_no')) {
      context.handle(_assetNoMeta,
          assetNo.isAcceptableOrUnknown(data['asset_no']!, _assetNoMeta));
    } else if (isInserting) {
      context.missing(_assetNoMeta);
    }
    if (data.containsKey('assignment_id')) {
      context.handle(
          _assignmentIdMeta,
          assignmentId.isAcceptableOrUnknown(
              data['assignment_id']!, _assignmentIdMeta));
    }
    if (data.containsKey('site')) {
      context.handle(
          _siteMeta, site.isAcceptableOrUnknown(data['site']!, _siteMeta));
    }
    if (data.containsKey('title')) {
      context.handle(
          _titleMeta, title.isAcceptableOrUnknown(data['title']!, _titleMeta));
    }
    if (data.containsKey('read_lang')) {
      context.handle(_readLangMeta,
          readLang.isAcceptableOrUnknown(data['read_lang']!, _readLangMeta));
    }
    if (data.containsKey('answers_json')) {
      context.handle(
          _answersJsonMeta,
          answersJson.isAcceptableOrUnknown(
              data['answers_json']!, _answersJsonMeta));
    } else if (isInserting) {
      context.missing(_answersJsonMeta);
    }
    if (data.containsKey('notes_json')) {
      context.handle(_notesJsonMeta,
          notesJson.isAcceptableOrUnknown(data['notes_json']!, _notesJsonMeta));
    } else if (isInserting) {
      context.missing(_notesJsonMeta);
    }
    if (data.containsKey('printed_name')) {
      context.handle(
          _printedNameMeta,
          printedName.isAcceptableOrUnknown(
              data['printed_name']!, _printedNameMeta));
    }
    if (data.containsKey('filled')) {
      context.handle(_filledMeta,
          filled.isAcceptableOrUnknown(data['filled']!, _filledMeta));
    } else if (isInserting) {
      context.missing(_filledMeta);
    }
    if (data.containsKey('total')) {
      context.handle(
          _totalMeta, total.isAcceptableOrUnknown(data['total']!, _totalMeta));
    } else if (isInserting) {
      context.missing(_totalMeta);
    }
    if (data.containsKey('created_at')) {
      context.handle(_createdAtMeta,
          createdAt.isAcceptableOrUnknown(data['created_at']!, _createdAtMeta));
    } else if (isInserting) {
      context.missing(_createdAtMeta);
    }
    if (data.containsKey('updated_at')) {
      context.handle(_updatedAtMeta,
          updatedAt.isAcceptableOrUnknown(data['updated_at']!, _updatedAtMeta));
    } else if (isInserting) {
      context.missing(_updatedAtMeta);
    }
    return context;
  }

  @override
  Set<GeneratedColumn> get $primaryKey => {draftKey};
  @override
  ChecklistDraft map(Map<String, dynamic> data, {String? tablePrefix}) {
    final effectivePrefix = tablePrefix != null ? '$tablePrefix.' : '';
    return ChecklistDraft(
      draftKey: attachedDatabase.typeMapping
          .read(DriftSqlType.string, data['${effectivePrefix}draft_key'])!,
      userId: attachedDatabase.typeMapping
          .read(DriftSqlType.string, data['${effectivePrefix}user_id'])!,
      workspaceId: attachedDatabase.typeMapping
          .read(DriftSqlType.string, data['${effectivePrefix}workspace_id'])!,
      templateId: attachedDatabase.typeMapping
          .read(DriftSqlType.string, data['${effectivePrefix}template_id'])!,
      templateName: attachedDatabase.typeMapping
          .read(DriftSqlType.string, data['${effectivePrefix}template_name'])!,
      templateVersion: attachedDatabase.typeMapping
          .read(DriftSqlType.int, data['${effectivePrefix}template_version'])!,
      assetNo: attachedDatabase.typeMapping
          .read(DriftSqlType.string, data['${effectivePrefix}asset_no'])!,
      assignmentId: attachedDatabase.typeMapping
          .read(DriftSqlType.string, data['${effectivePrefix}assignment_id']),
      site: attachedDatabase.typeMapping
          .read(DriftSqlType.string, data['${effectivePrefix}site']),
      title: attachedDatabase.typeMapping
          .read(DriftSqlType.string, data['${effectivePrefix}title']),
      readLang: attachedDatabase.typeMapping
          .read(DriftSqlType.string, data['${effectivePrefix}read_lang']),
      answersJson: attachedDatabase.typeMapping
          .read(DriftSqlType.string, data['${effectivePrefix}answers_json'])!,
      notesJson: attachedDatabase.typeMapping
          .read(DriftSqlType.string, data['${effectivePrefix}notes_json'])!,
      printedName: attachedDatabase.typeMapping
          .read(DriftSqlType.string, data['${effectivePrefix}printed_name']),
      filled: attachedDatabase.typeMapping
          .read(DriftSqlType.int, data['${effectivePrefix}filled'])!,
      total: attachedDatabase.typeMapping
          .read(DriftSqlType.int, data['${effectivePrefix}total'])!,
      createdAt: attachedDatabase.typeMapping
          .read(DriftSqlType.dateTime, data['${effectivePrefix}created_at'])!,
      updatedAt: attachedDatabase.typeMapping
          .read(DriftSqlType.dateTime, data['${effectivePrefix}updated_at'])!,
    );
  }

  @override
  $ChecklistDraftsTable createAlias(String alias) {
    return $ChecklistDraftsTable(attachedDatabase, alias);
  }
}

class ChecklistDraft extends DataClass implements Insertable<ChecklistDraft> {
  /// `userId|templateId|ASSETNO`.
  ///
  /// An empty asset is a legitimate key component: a sheet started before a
  /// machine is picked gets its own slot, and when the operator picks one the
  /// row is rekeyed and the old key discarded.
  final String draftKey;
  final String userId;
  final String workspaceId;
  final String templateId;

  /// Denormalised so the unfinished-work list renders with no signal.
  final String templateName;

  /// The version pin. A resume against a changed version must warn rather than
  /// silently re-map answers given to different questions.
  final int templateVersion;

  /// Normalised. Empty string until a machine is picked.
  final String assetNo;
  final String? assignmentId;
  final String? site;
  final String? title;

  /// So a resumed sheet reads in the same language it was started in.
  final String? readLang;

  /// Answers keyed by field id.
  final String answersJson;

  /// Per-line remarks keyed by field id. A failed check recorded with no reason
  /// renders as an empty Remarks column, indistinguishable from "nothing to
  /// report".
  final String notesJson;
  final String? printedName;

  /// Counted by the screen, never re-derived here. See
  /// [InspectionDrafts.filled].
  final int filled;
  final int total;

  /// Preserved across later saves. An upsert must not reset it.
  final DateTime createdAt;
  final DateTime updatedAt;
  const ChecklistDraft(
      {required this.draftKey,
      required this.userId,
      required this.workspaceId,
      required this.templateId,
      required this.templateName,
      required this.templateVersion,
      required this.assetNo,
      this.assignmentId,
      this.site,
      this.title,
      this.readLang,
      required this.answersJson,
      required this.notesJson,
      this.printedName,
      required this.filled,
      required this.total,
      required this.createdAt,
      required this.updatedAt});
  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    map['draft_key'] = Variable<String>(draftKey);
    map['user_id'] = Variable<String>(userId);
    map['workspace_id'] = Variable<String>(workspaceId);
    map['template_id'] = Variable<String>(templateId);
    map['template_name'] = Variable<String>(templateName);
    map['template_version'] = Variable<int>(templateVersion);
    map['asset_no'] = Variable<String>(assetNo);
    if (!nullToAbsent || assignmentId != null) {
      map['assignment_id'] = Variable<String>(assignmentId);
    }
    if (!nullToAbsent || site != null) {
      map['site'] = Variable<String>(site);
    }
    if (!nullToAbsent || title != null) {
      map['title'] = Variable<String>(title);
    }
    if (!nullToAbsent || readLang != null) {
      map['read_lang'] = Variable<String>(readLang);
    }
    map['answers_json'] = Variable<String>(answersJson);
    map['notes_json'] = Variable<String>(notesJson);
    if (!nullToAbsent || printedName != null) {
      map['printed_name'] = Variable<String>(printedName);
    }
    map['filled'] = Variable<int>(filled);
    map['total'] = Variable<int>(total);
    map['created_at'] = Variable<DateTime>(createdAt);
    map['updated_at'] = Variable<DateTime>(updatedAt);
    return map;
  }

  ChecklistDraftsCompanion toCompanion(bool nullToAbsent) {
    return ChecklistDraftsCompanion(
      draftKey: Value(draftKey),
      userId: Value(userId),
      workspaceId: Value(workspaceId),
      templateId: Value(templateId),
      templateName: Value(templateName),
      templateVersion: Value(templateVersion),
      assetNo: Value(assetNo),
      assignmentId: assignmentId == null && nullToAbsent
          ? const Value.absent()
          : Value(assignmentId),
      site: site == null && nullToAbsent ? const Value.absent() : Value(site),
      title:
          title == null && nullToAbsent ? const Value.absent() : Value(title),
      readLang: readLang == null && nullToAbsent
          ? const Value.absent()
          : Value(readLang),
      answersJson: Value(answersJson),
      notesJson: Value(notesJson),
      printedName: printedName == null && nullToAbsent
          ? const Value.absent()
          : Value(printedName),
      filled: Value(filled),
      total: Value(total),
      createdAt: Value(createdAt),
      updatedAt: Value(updatedAt),
    );
  }

  factory ChecklistDraft.fromJson(Map<String, dynamic> json,
      {ValueSerializer? serializer}) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return ChecklistDraft(
      draftKey: serializer.fromJson<String>(json['draftKey']),
      userId: serializer.fromJson<String>(json['userId']),
      workspaceId: serializer.fromJson<String>(json['workspaceId']),
      templateId: serializer.fromJson<String>(json['templateId']),
      templateName: serializer.fromJson<String>(json['templateName']),
      templateVersion: serializer.fromJson<int>(json['templateVersion']),
      assetNo: serializer.fromJson<String>(json['assetNo']),
      assignmentId: serializer.fromJson<String?>(json['assignmentId']),
      site: serializer.fromJson<String?>(json['site']),
      title: serializer.fromJson<String?>(json['title']),
      readLang: serializer.fromJson<String?>(json['readLang']),
      answersJson: serializer.fromJson<String>(json['answersJson']),
      notesJson: serializer.fromJson<String>(json['notesJson']),
      printedName: serializer.fromJson<String?>(json['printedName']),
      filled: serializer.fromJson<int>(json['filled']),
      total: serializer.fromJson<int>(json['total']),
      createdAt: serializer.fromJson<DateTime>(json['createdAt']),
      updatedAt: serializer.fromJson<DateTime>(json['updatedAt']),
    );
  }
  @override
  Map<String, dynamic> toJson({ValueSerializer? serializer}) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return <String, dynamic>{
      'draftKey': serializer.toJson<String>(draftKey),
      'userId': serializer.toJson<String>(userId),
      'workspaceId': serializer.toJson<String>(workspaceId),
      'templateId': serializer.toJson<String>(templateId),
      'templateName': serializer.toJson<String>(templateName),
      'templateVersion': serializer.toJson<int>(templateVersion),
      'assetNo': serializer.toJson<String>(assetNo),
      'assignmentId': serializer.toJson<String?>(assignmentId),
      'site': serializer.toJson<String?>(site),
      'title': serializer.toJson<String?>(title),
      'readLang': serializer.toJson<String?>(readLang),
      'answersJson': serializer.toJson<String>(answersJson),
      'notesJson': serializer.toJson<String>(notesJson),
      'printedName': serializer.toJson<String?>(printedName),
      'filled': serializer.toJson<int>(filled),
      'total': serializer.toJson<int>(total),
      'createdAt': serializer.toJson<DateTime>(createdAt),
      'updatedAt': serializer.toJson<DateTime>(updatedAt),
    };
  }

  ChecklistDraft copyWith(
          {String? draftKey,
          String? userId,
          String? workspaceId,
          String? templateId,
          String? templateName,
          int? templateVersion,
          String? assetNo,
          Value<String?> assignmentId = const Value.absent(),
          Value<String?> site = const Value.absent(),
          Value<String?> title = const Value.absent(),
          Value<String?> readLang = const Value.absent(),
          String? answersJson,
          String? notesJson,
          Value<String?> printedName = const Value.absent(),
          int? filled,
          int? total,
          DateTime? createdAt,
          DateTime? updatedAt}) =>
      ChecklistDraft(
        draftKey: draftKey ?? this.draftKey,
        userId: userId ?? this.userId,
        workspaceId: workspaceId ?? this.workspaceId,
        templateId: templateId ?? this.templateId,
        templateName: templateName ?? this.templateName,
        templateVersion: templateVersion ?? this.templateVersion,
        assetNo: assetNo ?? this.assetNo,
        assignmentId:
            assignmentId.present ? assignmentId.value : this.assignmentId,
        site: site.present ? site.value : this.site,
        title: title.present ? title.value : this.title,
        readLang: readLang.present ? readLang.value : this.readLang,
        answersJson: answersJson ?? this.answersJson,
        notesJson: notesJson ?? this.notesJson,
        printedName: printedName.present ? printedName.value : this.printedName,
        filled: filled ?? this.filled,
        total: total ?? this.total,
        createdAt: createdAt ?? this.createdAt,
        updatedAt: updatedAt ?? this.updatedAt,
      );
  ChecklistDraft copyWithCompanion(ChecklistDraftsCompanion data) {
    return ChecklistDraft(
      draftKey: data.draftKey.present ? data.draftKey.value : this.draftKey,
      userId: data.userId.present ? data.userId.value : this.userId,
      workspaceId:
          data.workspaceId.present ? data.workspaceId.value : this.workspaceId,
      templateId:
          data.templateId.present ? data.templateId.value : this.templateId,
      templateName: data.templateName.present
          ? data.templateName.value
          : this.templateName,
      templateVersion: data.templateVersion.present
          ? data.templateVersion.value
          : this.templateVersion,
      assetNo: data.assetNo.present ? data.assetNo.value : this.assetNo,
      assignmentId: data.assignmentId.present
          ? data.assignmentId.value
          : this.assignmentId,
      site: data.site.present ? data.site.value : this.site,
      title: data.title.present ? data.title.value : this.title,
      readLang: data.readLang.present ? data.readLang.value : this.readLang,
      answersJson:
          data.answersJson.present ? data.answersJson.value : this.answersJson,
      notesJson: data.notesJson.present ? data.notesJson.value : this.notesJson,
      printedName:
          data.printedName.present ? data.printedName.value : this.printedName,
      filled: data.filled.present ? data.filled.value : this.filled,
      total: data.total.present ? data.total.value : this.total,
      createdAt: data.createdAt.present ? data.createdAt.value : this.createdAt,
      updatedAt: data.updatedAt.present ? data.updatedAt.value : this.updatedAt,
    );
  }

  @override
  String toString() {
    return (StringBuffer('ChecklistDraft(')
          ..write('draftKey: $draftKey, ')
          ..write('userId: $userId, ')
          ..write('workspaceId: $workspaceId, ')
          ..write('templateId: $templateId, ')
          ..write('templateName: $templateName, ')
          ..write('templateVersion: $templateVersion, ')
          ..write('assetNo: $assetNo, ')
          ..write('assignmentId: $assignmentId, ')
          ..write('site: $site, ')
          ..write('title: $title, ')
          ..write('readLang: $readLang, ')
          ..write('answersJson: $answersJson, ')
          ..write('notesJson: $notesJson, ')
          ..write('printedName: $printedName, ')
          ..write('filled: $filled, ')
          ..write('total: $total, ')
          ..write('createdAt: $createdAt, ')
          ..write('updatedAt: $updatedAt')
          ..write(')'))
        .toString();
  }

  @override
  int get hashCode => Object.hash(
      draftKey,
      userId,
      workspaceId,
      templateId,
      templateName,
      templateVersion,
      assetNo,
      assignmentId,
      site,
      title,
      readLang,
      answersJson,
      notesJson,
      printedName,
      filled,
      total,
      createdAt,
      updatedAt);
  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      (other is ChecklistDraft &&
          other.draftKey == this.draftKey &&
          other.userId == this.userId &&
          other.workspaceId == this.workspaceId &&
          other.templateId == this.templateId &&
          other.templateName == this.templateName &&
          other.templateVersion == this.templateVersion &&
          other.assetNo == this.assetNo &&
          other.assignmentId == this.assignmentId &&
          other.site == this.site &&
          other.title == this.title &&
          other.readLang == this.readLang &&
          other.answersJson == this.answersJson &&
          other.notesJson == this.notesJson &&
          other.printedName == this.printedName &&
          other.filled == this.filled &&
          other.total == this.total &&
          other.createdAt == this.createdAt &&
          other.updatedAt == this.updatedAt);
}

class ChecklistDraftsCompanion extends UpdateCompanion<ChecklistDraft> {
  final Value<String> draftKey;
  final Value<String> userId;
  final Value<String> workspaceId;
  final Value<String> templateId;
  final Value<String> templateName;
  final Value<int> templateVersion;
  final Value<String> assetNo;
  final Value<String?> assignmentId;
  final Value<String?> site;
  final Value<String?> title;
  final Value<String?> readLang;
  final Value<String> answersJson;
  final Value<String> notesJson;
  final Value<String?> printedName;
  final Value<int> filled;
  final Value<int> total;
  final Value<DateTime> createdAt;
  final Value<DateTime> updatedAt;
  final Value<int> rowid;
  const ChecklistDraftsCompanion({
    this.draftKey = const Value.absent(),
    this.userId = const Value.absent(),
    this.workspaceId = const Value.absent(),
    this.templateId = const Value.absent(),
    this.templateName = const Value.absent(),
    this.templateVersion = const Value.absent(),
    this.assetNo = const Value.absent(),
    this.assignmentId = const Value.absent(),
    this.site = const Value.absent(),
    this.title = const Value.absent(),
    this.readLang = const Value.absent(),
    this.answersJson = const Value.absent(),
    this.notesJson = const Value.absent(),
    this.printedName = const Value.absent(),
    this.filled = const Value.absent(),
    this.total = const Value.absent(),
    this.createdAt = const Value.absent(),
    this.updatedAt = const Value.absent(),
    this.rowid = const Value.absent(),
  });
  ChecklistDraftsCompanion.insert({
    required String draftKey,
    required String userId,
    required String workspaceId,
    required String templateId,
    required String templateName,
    required int templateVersion,
    required String assetNo,
    this.assignmentId = const Value.absent(),
    this.site = const Value.absent(),
    this.title = const Value.absent(),
    this.readLang = const Value.absent(),
    required String answersJson,
    required String notesJson,
    this.printedName = const Value.absent(),
    required int filled,
    required int total,
    required DateTime createdAt,
    required DateTime updatedAt,
    this.rowid = const Value.absent(),
  })  : draftKey = Value(draftKey),
        userId = Value(userId),
        workspaceId = Value(workspaceId),
        templateId = Value(templateId),
        templateName = Value(templateName),
        templateVersion = Value(templateVersion),
        assetNo = Value(assetNo),
        answersJson = Value(answersJson),
        notesJson = Value(notesJson),
        filled = Value(filled),
        total = Value(total),
        createdAt = Value(createdAt),
        updatedAt = Value(updatedAt);
  static Insertable<ChecklistDraft> custom({
    Expression<String>? draftKey,
    Expression<String>? userId,
    Expression<String>? workspaceId,
    Expression<String>? templateId,
    Expression<String>? templateName,
    Expression<int>? templateVersion,
    Expression<String>? assetNo,
    Expression<String>? assignmentId,
    Expression<String>? site,
    Expression<String>? title,
    Expression<String>? readLang,
    Expression<String>? answersJson,
    Expression<String>? notesJson,
    Expression<String>? printedName,
    Expression<int>? filled,
    Expression<int>? total,
    Expression<DateTime>? createdAt,
    Expression<DateTime>? updatedAt,
    Expression<int>? rowid,
  }) {
    return RawValuesInsertable({
      if (draftKey != null) 'draft_key': draftKey,
      if (userId != null) 'user_id': userId,
      if (workspaceId != null) 'workspace_id': workspaceId,
      if (templateId != null) 'template_id': templateId,
      if (templateName != null) 'template_name': templateName,
      if (templateVersion != null) 'template_version': templateVersion,
      if (assetNo != null) 'asset_no': assetNo,
      if (assignmentId != null) 'assignment_id': assignmentId,
      if (site != null) 'site': site,
      if (title != null) 'title': title,
      if (readLang != null) 'read_lang': readLang,
      if (answersJson != null) 'answers_json': answersJson,
      if (notesJson != null) 'notes_json': notesJson,
      if (printedName != null) 'printed_name': printedName,
      if (filled != null) 'filled': filled,
      if (total != null) 'total': total,
      if (createdAt != null) 'created_at': createdAt,
      if (updatedAt != null) 'updated_at': updatedAt,
      if (rowid != null) 'rowid': rowid,
    });
  }

  ChecklistDraftsCompanion copyWith(
      {Value<String>? draftKey,
      Value<String>? userId,
      Value<String>? workspaceId,
      Value<String>? templateId,
      Value<String>? templateName,
      Value<int>? templateVersion,
      Value<String>? assetNo,
      Value<String?>? assignmentId,
      Value<String?>? site,
      Value<String?>? title,
      Value<String?>? readLang,
      Value<String>? answersJson,
      Value<String>? notesJson,
      Value<String?>? printedName,
      Value<int>? filled,
      Value<int>? total,
      Value<DateTime>? createdAt,
      Value<DateTime>? updatedAt,
      Value<int>? rowid}) {
    return ChecklistDraftsCompanion(
      draftKey: draftKey ?? this.draftKey,
      userId: userId ?? this.userId,
      workspaceId: workspaceId ?? this.workspaceId,
      templateId: templateId ?? this.templateId,
      templateName: templateName ?? this.templateName,
      templateVersion: templateVersion ?? this.templateVersion,
      assetNo: assetNo ?? this.assetNo,
      assignmentId: assignmentId ?? this.assignmentId,
      site: site ?? this.site,
      title: title ?? this.title,
      readLang: readLang ?? this.readLang,
      answersJson: answersJson ?? this.answersJson,
      notesJson: notesJson ?? this.notesJson,
      printedName: printedName ?? this.printedName,
      filled: filled ?? this.filled,
      total: total ?? this.total,
      createdAt: createdAt ?? this.createdAt,
      updatedAt: updatedAt ?? this.updatedAt,
      rowid: rowid ?? this.rowid,
    );
  }

  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    if (draftKey.present) {
      map['draft_key'] = Variable<String>(draftKey.value);
    }
    if (userId.present) {
      map['user_id'] = Variable<String>(userId.value);
    }
    if (workspaceId.present) {
      map['workspace_id'] = Variable<String>(workspaceId.value);
    }
    if (templateId.present) {
      map['template_id'] = Variable<String>(templateId.value);
    }
    if (templateName.present) {
      map['template_name'] = Variable<String>(templateName.value);
    }
    if (templateVersion.present) {
      map['template_version'] = Variable<int>(templateVersion.value);
    }
    if (assetNo.present) {
      map['asset_no'] = Variable<String>(assetNo.value);
    }
    if (assignmentId.present) {
      map['assignment_id'] = Variable<String>(assignmentId.value);
    }
    if (site.present) {
      map['site'] = Variable<String>(site.value);
    }
    if (title.present) {
      map['title'] = Variable<String>(title.value);
    }
    if (readLang.present) {
      map['read_lang'] = Variable<String>(readLang.value);
    }
    if (answersJson.present) {
      map['answers_json'] = Variable<String>(answersJson.value);
    }
    if (notesJson.present) {
      map['notes_json'] = Variable<String>(notesJson.value);
    }
    if (printedName.present) {
      map['printed_name'] = Variable<String>(printedName.value);
    }
    if (filled.present) {
      map['filled'] = Variable<int>(filled.value);
    }
    if (total.present) {
      map['total'] = Variable<int>(total.value);
    }
    if (createdAt.present) {
      map['created_at'] = Variable<DateTime>(createdAt.value);
    }
    if (updatedAt.present) {
      map['updated_at'] = Variable<DateTime>(updatedAt.value);
    }
    if (rowid.present) {
      map['rowid'] = Variable<int>(rowid.value);
    }
    return map;
  }

  @override
  String toString() {
    return (StringBuffer('ChecklistDraftsCompanion(')
          ..write('draftKey: $draftKey, ')
          ..write('userId: $userId, ')
          ..write('workspaceId: $workspaceId, ')
          ..write('templateId: $templateId, ')
          ..write('templateName: $templateName, ')
          ..write('templateVersion: $templateVersion, ')
          ..write('assetNo: $assetNo, ')
          ..write('assignmentId: $assignmentId, ')
          ..write('site: $site, ')
          ..write('title: $title, ')
          ..write('readLang: $readLang, ')
          ..write('answersJson: $answersJson, ')
          ..write('notesJson: $notesJson, ')
          ..write('printedName: $printedName, ')
          ..write('filled: $filled, ')
          ..write('total: $total, ')
          ..write('createdAt: $createdAt, ')
          ..write('updatedAt: $updatedAt, ')
          ..write('rowid: $rowid')
          ..write(')'))
        .toString();
  }
}

class $DraftPhotosTable extends DraftPhotos
    with TableInfo<$DraftPhotosTable, DraftPhoto> {
  @override
  final GeneratedDatabase attachedDatabase;
  final String? _alias;
  $DraftPhotosTable(this.attachedDatabase, [this._alias]);
  static const VerificationMeta _idMeta = const VerificationMeta('id');
  @override
  late final GeneratedColumn<String> id = GeneratedColumn<String>(
      'id', aliasedName, false,
      type: DriftSqlType.string, requiredDuringInsert: true);
  static const VerificationMeta _ownerKindMeta =
      const VerificationMeta('ownerKind');
  @override
  late final GeneratedColumn<String> ownerKind = GeneratedColumn<String>(
      'owner_kind', aliasedName, false,
      type: DriftSqlType.string, requiredDuringInsert: true);
  static const VerificationMeta _ownerKeyMeta =
      const VerificationMeta('ownerKey');
  @override
  late final GeneratedColumn<String> ownerKey = GeneratedColumn<String>(
      'owner_key', aliasedName, false,
      type: DriftSqlType.string, requiredDuringInsert: true);
  static const VerificationMeta _fieldKeyMeta =
      const VerificationMeta('fieldKey');
  @override
  late final GeneratedColumn<String> fieldKey = GeneratedColumn<String>(
      'field_key', aliasedName, true,
      type: DriftSqlType.string, requiredDuringInsert: false);
  static const VerificationMeta _localPathMeta =
      const VerificationMeta('localPath');
  @override
  late final GeneratedColumn<String> localPath = GeneratedColumn<String>(
      'local_path', aliasedName, false,
      type: DriftSqlType.string, requiredDuringInsert: true);
  static const VerificationMeta _fileNameMeta =
      const VerificationMeta('fileName');
  @override
  late final GeneratedColumn<String> fileName = GeneratedColumn<String>(
      'file_name', aliasedName, false,
      type: DriftSqlType.string, requiredDuringInsert: true);
  static const VerificationMeta _sizeBytesMeta =
      const VerificationMeta('sizeBytes');
  @override
  late final GeneratedColumn<int> sizeBytes = GeneratedColumn<int>(
      'size_bytes', aliasedName, true,
      type: DriftSqlType.int, requiredDuringInsert: false);
  static const VerificationMeta _mimeTypeMeta =
      const VerificationMeta('mimeType');
  @override
  late final GeneratedColumn<String> mimeType = GeneratedColumn<String>(
      'mime_type', aliasedName, true,
      type: DriftSqlType.string, requiredDuringInsert: false);
  static const VerificationMeta _checksumMeta =
      const VerificationMeta('checksum');
  @override
  late final GeneratedColumn<String> checksum = GeneratedColumn<String>(
      'checksum', aliasedName, true,
      type: DriftSqlType.string, requiredDuringInsert: false);
  static const VerificationMeta _capturedAtMeta =
      const VerificationMeta('capturedAt');
  @override
  late final GeneratedColumn<DateTime> capturedAt = GeneratedColumn<DateTime>(
      'captured_at', aliasedName, false,
      type: DriftSqlType.dateTime, requiredDuringInsert: true);
  @override
  List<GeneratedColumn> get $columns => [
        id,
        ownerKind,
        ownerKey,
        fieldKey,
        localPath,
        fileName,
        sizeBytes,
        mimeType,
        checksum,
        capturedAt
      ];
  @override
  String get aliasedName => _alias ?? actualTableName;
  @override
  String get actualTableName => $name;
  static const String $name = 'draft_photos';
  @override
  VerificationContext validateIntegrity(Insertable<DraftPhoto> instance,
      {bool isInserting = false}) {
    final context = VerificationContext();
    final data = instance.toColumns(true);
    if (data.containsKey('id')) {
      context.handle(_idMeta, id.isAcceptableOrUnknown(data['id']!, _idMeta));
    } else if (isInserting) {
      context.missing(_idMeta);
    }
    if (data.containsKey('owner_kind')) {
      context.handle(_ownerKindMeta,
          ownerKind.isAcceptableOrUnknown(data['owner_kind']!, _ownerKindMeta));
    } else if (isInserting) {
      context.missing(_ownerKindMeta);
    }
    if (data.containsKey('owner_key')) {
      context.handle(_ownerKeyMeta,
          ownerKey.isAcceptableOrUnknown(data['owner_key']!, _ownerKeyMeta));
    } else if (isInserting) {
      context.missing(_ownerKeyMeta);
    }
    if (data.containsKey('field_key')) {
      context.handle(_fieldKeyMeta,
          fieldKey.isAcceptableOrUnknown(data['field_key']!, _fieldKeyMeta));
    }
    if (data.containsKey('local_path')) {
      context.handle(_localPathMeta,
          localPath.isAcceptableOrUnknown(data['local_path']!, _localPathMeta));
    } else if (isInserting) {
      context.missing(_localPathMeta);
    }
    if (data.containsKey('file_name')) {
      context.handle(_fileNameMeta,
          fileName.isAcceptableOrUnknown(data['file_name']!, _fileNameMeta));
    } else if (isInserting) {
      context.missing(_fileNameMeta);
    }
    if (data.containsKey('size_bytes')) {
      context.handle(_sizeBytesMeta,
          sizeBytes.isAcceptableOrUnknown(data['size_bytes']!, _sizeBytesMeta));
    }
    if (data.containsKey('mime_type')) {
      context.handle(_mimeTypeMeta,
          mimeType.isAcceptableOrUnknown(data['mime_type']!, _mimeTypeMeta));
    }
    if (data.containsKey('checksum')) {
      context.handle(_checksumMeta,
          checksum.isAcceptableOrUnknown(data['checksum']!, _checksumMeta));
    }
    if (data.containsKey('captured_at')) {
      context.handle(
          _capturedAtMeta,
          capturedAt.isAcceptableOrUnknown(
              data['captured_at']!, _capturedAtMeta));
    } else if (isInserting) {
      context.missing(_capturedAtMeta);
    }
    return context;
  }

  @override
  Set<GeneratedColumn> get $primaryKey => {id};
  @override
  DraftPhoto map(Map<String, dynamic> data, {String? tablePrefix}) {
    final effectivePrefix = tablePrefix != null ? '$tablePrefix.' : '';
    return DraftPhoto(
      id: attachedDatabase.typeMapping
          .read(DriftSqlType.string, data['${effectivePrefix}id'])!,
      ownerKind: attachedDatabase.typeMapping
          .read(DriftSqlType.string, data['${effectivePrefix}owner_kind'])!,
      ownerKey: attachedDatabase.typeMapping
          .read(DriftSqlType.string, data['${effectivePrefix}owner_key'])!,
      fieldKey: attachedDatabase.typeMapping
          .read(DriftSqlType.string, data['${effectivePrefix}field_key']),
      localPath: attachedDatabase.typeMapping
          .read(DriftSqlType.string, data['${effectivePrefix}local_path'])!,
      fileName: attachedDatabase.typeMapping
          .read(DriftSqlType.string, data['${effectivePrefix}file_name'])!,
      sizeBytes: attachedDatabase.typeMapping
          .read(DriftSqlType.int, data['${effectivePrefix}size_bytes']),
      mimeType: attachedDatabase.typeMapping
          .read(DriftSqlType.string, data['${effectivePrefix}mime_type']),
      checksum: attachedDatabase.typeMapping
          .read(DriftSqlType.string, data['${effectivePrefix}checksum']),
      capturedAt: attachedDatabase.typeMapping
          .read(DriftSqlType.dateTime, data['${effectivePrefix}captured_at'])!,
    );
  }

  @override
  $DraftPhotosTable createAlias(String alias) {
    return $DraftPhotosTable(attachedDatabase, alias);
  }
}

class DraftPhoto extends DataClass implements Insertable<DraftPhoto> {
  final String id;

  /// `checklist_draft` or `inspection_draft`. See OwnerKind.draftOwners.
  final String ownerKind;

  /// The owning `draftKey`.
  final String ownerKey;

  /// Checklist field id, or the tyre position.
  final String? fieldKey;

  /// Absolute `file://` path inside the draft media folder.
  final String localPath;

  /// Basename, stored separately from [localPath] on purpose.
  ///
  /// iOS rewrites the document container path between launches, so an absolute
  /// path stored yesterday can be stale while the file is perfectly intact. The
  /// heal is to look for the same basename in the CURRENT folder, and a column
  /// makes that a lookup instead of a string operation on every restore. It is
  /// also the sweep key, which is why it is unique.
  final String fileName;
  final int? sizeBytes;
  final String? mimeType;

  /// MD5 where readable, else `size:mtime`.
  final String? checksum;
  final DateTime capturedAt;
  const DraftPhoto(
      {required this.id,
      required this.ownerKind,
      required this.ownerKey,
      this.fieldKey,
      required this.localPath,
      required this.fileName,
      this.sizeBytes,
      this.mimeType,
      this.checksum,
      required this.capturedAt});
  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    map['id'] = Variable<String>(id);
    map['owner_kind'] = Variable<String>(ownerKind);
    map['owner_key'] = Variable<String>(ownerKey);
    if (!nullToAbsent || fieldKey != null) {
      map['field_key'] = Variable<String>(fieldKey);
    }
    map['local_path'] = Variable<String>(localPath);
    map['file_name'] = Variable<String>(fileName);
    if (!nullToAbsent || sizeBytes != null) {
      map['size_bytes'] = Variable<int>(sizeBytes);
    }
    if (!nullToAbsent || mimeType != null) {
      map['mime_type'] = Variable<String>(mimeType);
    }
    if (!nullToAbsent || checksum != null) {
      map['checksum'] = Variable<String>(checksum);
    }
    map['captured_at'] = Variable<DateTime>(capturedAt);
    return map;
  }

  DraftPhotosCompanion toCompanion(bool nullToAbsent) {
    return DraftPhotosCompanion(
      id: Value(id),
      ownerKind: Value(ownerKind),
      ownerKey: Value(ownerKey),
      fieldKey: fieldKey == null && nullToAbsent
          ? const Value.absent()
          : Value(fieldKey),
      localPath: Value(localPath),
      fileName: Value(fileName),
      sizeBytes: sizeBytes == null && nullToAbsent
          ? const Value.absent()
          : Value(sizeBytes),
      mimeType: mimeType == null && nullToAbsent
          ? const Value.absent()
          : Value(mimeType),
      checksum: checksum == null && nullToAbsent
          ? const Value.absent()
          : Value(checksum),
      capturedAt: Value(capturedAt),
    );
  }

  factory DraftPhoto.fromJson(Map<String, dynamic> json,
      {ValueSerializer? serializer}) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return DraftPhoto(
      id: serializer.fromJson<String>(json['id']),
      ownerKind: serializer.fromJson<String>(json['ownerKind']),
      ownerKey: serializer.fromJson<String>(json['ownerKey']),
      fieldKey: serializer.fromJson<String?>(json['fieldKey']),
      localPath: serializer.fromJson<String>(json['localPath']),
      fileName: serializer.fromJson<String>(json['fileName']),
      sizeBytes: serializer.fromJson<int?>(json['sizeBytes']),
      mimeType: serializer.fromJson<String?>(json['mimeType']),
      checksum: serializer.fromJson<String?>(json['checksum']),
      capturedAt: serializer.fromJson<DateTime>(json['capturedAt']),
    );
  }
  @override
  Map<String, dynamic> toJson({ValueSerializer? serializer}) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return <String, dynamic>{
      'id': serializer.toJson<String>(id),
      'ownerKind': serializer.toJson<String>(ownerKind),
      'ownerKey': serializer.toJson<String>(ownerKey),
      'fieldKey': serializer.toJson<String?>(fieldKey),
      'localPath': serializer.toJson<String>(localPath),
      'fileName': serializer.toJson<String>(fileName),
      'sizeBytes': serializer.toJson<int?>(sizeBytes),
      'mimeType': serializer.toJson<String?>(mimeType),
      'checksum': serializer.toJson<String?>(checksum),
      'capturedAt': serializer.toJson<DateTime>(capturedAt),
    };
  }

  DraftPhoto copyWith(
          {String? id,
          String? ownerKind,
          String? ownerKey,
          Value<String?> fieldKey = const Value.absent(),
          String? localPath,
          String? fileName,
          Value<int?> sizeBytes = const Value.absent(),
          Value<String?> mimeType = const Value.absent(),
          Value<String?> checksum = const Value.absent(),
          DateTime? capturedAt}) =>
      DraftPhoto(
        id: id ?? this.id,
        ownerKind: ownerKind ?? this.ownerKind,
        ownerKey: ownerKey ?? this.ownerKey,
        fieldKey: fieldKey.present ? fieldKey.value : this.fieldKey,
        localPath: localPath ?? this.localPath,
        fileName: fileName ?? this.fileName,
        sizeBytes: sizeBytes.present ? sizeBytes.value : this.sizeBytes,
        mimeType: mimeType.present ? mimeType.value : this.mimeType,
        checksum: checksum.present ? checksum.value : this.checksum,
        capturedAt: capturedAt ?? this.capturedAt,
      );
  DraftPhoto copyWithCompanion(DraftPhotosCompanion data) {
    return DraftPhoto(
      id: data.id.present ? data.id.value : this.id,
      ownerKind: data.ownerKind.present ? data.ownerKind.value : this.ownerKind,
      ownerKey: data.ownerKey.present ? data.ownerKey.value : this.ownerKey,
      fieldKey: data.fieldKey.present ? data.fieldKey.value : this.fieldKey,
      localPath: data.localPath.present ? data.localPath.value : this.localPath,
      fileName: data.fileName.present ? data.fileName.value : this.fileName,
      sizeBytes: data.sizeBytes.present ? data.sizeBytes.value : this.sizeBytes,
      mimeType: data.mimeType.present ? data.mimeType.value : this.mimeType,
      checksum: data.checksum.present ? data.checksum.value : this.checksum,
      capturedAt:
          data.capturedAt.present ? data.capturedAt.value : this.capturedAt,
    );
  }

  @override
  String toString() {
    return (StringBuffer('DraftPhoto(')
          ..write('id: $id, ')
          ..write('ownerKind: $ownerKind, ')
          ..write('ownerKey: $ownerKey, ')
          ..write('fieldKey: $fieldKey, ')
          ..write('localPath: $localPath, ')
          ..write('fileName: $fileName, ')
          ..write('sizeBytes: $sizeBytes, ')
          ..write('mimeType: $mimeType, ')
          ..write('checksum: $checksum, ')
          ..write('capturedAt: $capturedAt')
          ..write(')'))
        .toString();
  }

  @override
  int get hashCode => Object.hash(id, ownerKind, ownerKey, fieldKey, localPath,
      fileName, sizeBytes, mimeType, checksum, capturedAt);
  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      (other is DraftPhoto &&
          other.id == this.id &&
          other.ownerKind == this.ownerKind &&
          other.ownerKey == this.ownerKey &&
          other.fieldKey == this.fieldKey &&
          other.localPath == this.localPath &&
          other.fileName == this.fileName &&
          other.sizeBytes == this.sizeBytes &&
          other.mimeType == this.mimeType &&
          other.checksum == this.checksum &&
          other.capturedAt == this.capturedAt);
}

class DraftPhotosCompanion extends UpdateCompanion<DraftPhoto> {
  final Value<String> id;
  final Value<String> ownerKind;
  final Value<String> ownerKey;
  final Value<String?> fieldKey;
  final Value<String> localPath;
  final Value<String> fileName;
  final Value<int?> sizeBytes;
  final Value<String?> mimeType;
  final Value<String?> checksum;
  final Value<DateTime> capturedAt;
  final Value<int> rowid;
  const DraftPhotosCompanion({
    this.id = const Value.absent(),
    this.ownerKind = const Value.absent(),
    this.ownerKey = const Value.absent(),
    this.fieldKey = const Value.absent(),
    this.localPath = const Value.absent(),
    this.fileName = const Value.absent(),
    this.sizeBytes = const Value.absent(),
    this.mimeType = const Value.absent(),
    this.checksum = const Value.absent(),
    this.capturedAt = const Value.absent(),
    this.rowid = const Value.absent(),
  });
  DraftPhotosCompanion.insert({
    required String id,
    required String ownerKind,
    required String ownerKey,
    this.fieldKey = const Value.absent(),
    required String localPath,
    required String fileName,
    this.sizeBytes = const Value.absent(),
    this.mimeType = const Value.absent(),
    this.checksum = const Value.absent(),
    required DateTime capturedAt,
    this.rowid = const Value.absent(),
  })  : id = Value(id),
        ownerKind = Value(ownerKind),
        ownerKey = Value(ownerKey),
        localPath = Value(localPath),
        fileName = Value(fileName),
        capturedAt = Value(capturedAt);
  static Insertable<DraftPhoto> custom({
    Expression<String>? id,
    Expression<String>? ownerKind,
    Expression<String>? ownerKey,
    Expression<String>? fieldKey,
    Expression<String>? localPath,
    Expression<String>? fileName,
    Expression<int>? sizeBytes,
    Expression<String>? mimeType,
    Expression<String>? checksum,
    Expression<DateTime>? capturedAt,
    Expression<int>? rowid,
  }) {
    return RawValuesInsertable({
      if (id != null) 'id': id,
      if (ownerKind != null) 'owner_kind': ownerKind,
      if (ownerKey != null) 'owner_key': ownerKey,
      if (fieldKey != null) 'field_key': fieldKey,
      if (localPath != null) 'local_path': localPath,
      if (fileName != null) 'file_name': fileName,
      if (sizeBytes != null) 'size_bytes': sizeBytes,
      if (mimeType != null) 'mime_type': mimeType,
      if (checksum != null) 'checksum': checksum,
      if (capturedAt != null) 'captured_at': capturedAt,
      if (rowid != null) 'rowid': rowid,
    });
  }

  DraftPhotosCompanion copyWith(
      {Value<String>? id,
      Value<String>? ownerKind,
      Value<String>? ownerKey,
      Value<String?>? fieldKey,
      Value<String>? localPath,
      Value<String>? fileName,
      Value<int?>? sizeBytes,
      Value<String?>? mimeType,
      Value<String?>? checksum,
      Value<DateTime>? capturedAt,
      Value<int>? rowid}) {
    return DraftPhotosCompanion(
      id: id ?? this.id,
      ownerKind: ownerKind ?? this.ownerKind,
      ownerKey: ownerKey ?? this.ownerKey,
      fieldKey: fieldKey ?? this.fieldKey,
      localPath: localPath ?? this.localPath,
      fileName: fileName ?? this.fileName,
      sizeBytes: sizeBytes ?? this.sizeBytes,
      mimeType: mimeType ?? this.mimeType,
      checksum: checksum ?? this.checksum,
      capturedAt: capturedAt ?? this.capturedAt,
      rowid: rowid ?? this.rowid,
    );
  }

  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    if (id.present) {
      map['id'] = Variable<String>(id.value);
    }
    if (ownerKind.present) {
      map['owner_kind'] = Variable<String>(ownerKind.value);
    }
    if (ownerKey.present) {
      map['owner_key'] = Variable<String>(ownerKey.value);
    }
    if (fieldKey.present) {
      map['field_key'] = Variable<String>(fieldKey.value);
    }
    if (localPath.present) {
      map['local_path'] = Variable<String>(localPath.value);
    }
    if (fileName.present) {
      map['file_name'] = Variable<String>(fileName.value);
    }
    if (sizeBytes.present) {
      map['size_bytes'] = Variable<int>(sizeBytes.value);
    }
    if (mimeType.present) {
      map['mime_type'] = Variable<String>(mimeType.value);
    }
    if (checksum.present) {
      map['checksum'] = Variable<String>(checksum.value);
    }
    if (capturedAt.present) {
      map['captured_at'] = Variable<DateTime>(capturedAt.value);
    }
    if (rowid.present) {
      map['rowid'] = Variable<int>(rowid.value);
    }
    return map;
  }

  @override
  String toString() {
    return (StringBuffer('DraftPhotosCompanion(')
          ..write('id: $id, ')
          ..write('ownerKind: $ownerKind, ')
          ..write('ownerKey: $ownerKey, ')
          ..write('fieldKey: $fieldKey, ')
          ..write('localPath: $localPath, ')
          ..write('fileName: $fileName, ')
          ..write('sizeBytes: $sizeBytes, ')
          ..write('mimeType: $mimeType, ')
          ..write('checksum: $checksum, ')
          ..write('capturedAt: $capturedAt, ')
          ..write('rowid: $rowid')
          ..write(')'))
        .toString();
  }
}

class $CapturedSignaturesTable extends CapturedSignatures
    with TableInfo<$CapturedSignaturesTable, CapturedSignature> {
  @override
  final GeneratedDatabase attachedDatabase;
  final String? _alias;
  $CapturedSignaturesTable(this.attachedDatabase, [this._alias]);
  static const VerificationMeta _idMeta = const VerificationMeta('id');
  @override
  late final GeneratedColumn<String> id = GeneratedColumn<String>(
      'id', aliasedName, false,
      type: DriftSqlType.string, requiredDuringInsert: true);
  static const VerificationMeta _ownerKindMeta =
      const VerificationMeta('ownerKind');
  @override
  late final GeneratedColumn<String> ownerKind = GeneratedColumn<String>(
      'owner_kind', aliasedName, false,
      type: DriftSqlType.string, requiredDuringInsert: true);
  static const VerificationMeta _ownerKeyMeta =
      const VerificationMeta('ownerKey');
  @override
  late final GeneratedColumn<String> ownerKey = GeneratedColumn<String>(
      'owner_key', aliasedName, false,
      type: DriftSqlType.string, requiredDuringInsert: true);
  static const VerificationMeta _fieldKeyMeta =
      const VerificationMeta('fieldKey');
  @override
  late final GeneratedColumn<String> fieldKey = GeneratedColumn<String>(
      'field_key', aliasedName, false,
      type: DriftSqlType.string, requiredDuringInsert: true);
  static const VerificationMeta _formatMeta = const VerificationMeta('format');
  @override
  late final GeneratedColumn<String> format = GeneratedColumn<String>(
      'format', aliasedName, false,
      type: DriftSqlType.string, requiredDuringInsert: true);
  static const VerificationMeta _payloadMeta =
      const VerificationMeta('payload');
  @override
  late final GeneratedColumn<String> payload = GeneratedColumn<String>(
      'payload', aliasedName, false,
      additionalChecks: GeneratedColumn.checkTextLength(),
      type: DriftSqlType.string,
      requiredDuringInsert: true);
  static const VerificationMeta _strokesJsonMeta =
      const VerificationMeta('strokesJson');
  @override
  late final GeneratedColumn<String> strokesJson = GeneratedColumn<String>(
      'strokes_json', aliasedName, true,
      type: DriftSqlType.string, requiredDuringInsert: false);
  static const VerificationMeta _signerUserIdMeta =
      const VerificationMeta('signerUserId');
  @override
  late final GeneratedColumn<String> signerUserId = GeneratedColumn<String>(
      'signer_user_id', aliasedName, true,
      type: DriftSqlType.string, requiredDuringInsert: false);
  static const VerificationMeta _signerNameMeta =
      const VerificationMeta('signerName');
  @override
  late final GeneratedColumn<String> signerName = GeneratedColumn<String>(
      'signer_name', aliasedName, true,
      type: DriftSqlType.string, requiredDuringInsert: false);
  static const VerificationMeta _signerRoleMeta =
      const VerificationMeta('signerRole');
  @override
  late final GeneratedColumn<String> signerRole = GeneratedColumn<String>(
      'signer_role', aliasedName, true,
      type: DriftSqlType.string, requiredDuringInsert: false);
  static const VerificationMeta _sourceMeta = const VerificationMeta('source');
  @override
  late final GeneratedColumn<String> source = GeneratedColumn<String>(
      'source', aliasedName, false,
      type: DriftSqlType.string, requiredDuringInsert: true);
  static const VerificationMeta _signedAtMeta =
      const VerificationMeta('signedAt');
  @override
  late final GeneratedColumn<DateTime> signedAt = GeneratedColumn<DateTime>(
      'signed_at', aliasedName, false,
      type: DriftSqlType.dateTime, requiredDuringInsert: true);
  @override
  List<GeneratedColumn> get $columns => [
        id,
        ownerKind,
        ownerKey,
        fieldKey,
        format,
        payload,
        strokesJson,
        signerUserId,
        signerName,
        signerRole,
        source,
        signedAt
      ];
  @override
  String get aliasedName => _alias ?? actualTableName;
  @override
  String get actualTableName => $name;
  static const String $name = 'captured_signatures';
  @override
  VerificationContext validateIntegrity(Insertable<CapturedSignature> instance,
      {bool isInserting = false}) {
    final context = VerificationContext();
    final data = instance.toColumns(true);
    if (data.containsKey('id')) {
      context.handle(_idMeta, id.isAcceptableOrUnknown(data['id']!, _idMeta));
    } else if (isInserting) {
      context.missing(_idMeta);
    }
    if (data.containsKey('owner_kind')) {
      context.handle(_ownerKindMeta,
          ownerKind.isAcceptableOrUnknown(data['owner_kind']!, _ownerKindMeta));
    } else if (isInserting) {
      context.missing(_ownerKindMeta);
    }
    if (data.containsKey('owner_key')) {
      context.handle(_ownerKeyMeta,
          ownerKey.isAcceptableOrUnknown(data['owner_key']!, _ownerKeyMeta));
    } else if (isInserting) {
      context.missing(_ownerKeyMeta);
    }
    if (data.containsKey('field_key')) {
      context.handle(_fieldKeyMeta,
          fieldKey.isAcceptableOrUnknown(data['field_key']!, _fieldKeyMeta));
    } else if (isInserting) {
      context.missing(_fieldKeyMeta);
    }
    if (data.containsKey('format')) {
      context.handle(_formatMeta,
          format.isAcceptableOrUnknown(data['format']!, _formatMeta));
    } else if (isInserting) {
      context.missing(_formatMeta);
    }
    if (data.containsKey('payload')) {
      context.handle(_payloadMeta,
          payload.isAcceptableOrUnknown(data['payload']!, _payloadMeta));
    } else if (isInserting) {
      context.missing(_payloadMeta);
    }
    if (data.containsKey('strokes_json')) {
      context.handle(
          _strokesJsonMeta,
          strokesJson.isAcceptableOrUnknown(
              data['strokes_json']!, _strokesJsonMeta));
    }
    if (data.containsKey('signer_user_id')) {
      context.handle(
          _signerUserIdMeta,
          signerUserId.isAcceptableOrUnknown(
              data['signer_user_id']!, _signerUserIdMeta));
    }
    if (data.containsKey('signer_name')) {
      context.handle(
          _signerNameMeta,
          signerName.isAcceptableOrUnknown(
              data['signer_name']!, _signerNameMeta));
    }
    if (data.containsKey('signer_role')) {
      context.handle(
          _signerRoleMeta,
          signerRole.isAcceptableOrUnknown(
              data['signer_role']!, _signerRoleMeta));
    }
    if (data.containsKey('source')) {
      context.handle(_sourceMeta,
          source.isAcceptableOrUnknown(data['source']!, _sourceMeta));
    } else if (isInserting) {
      context.missing(_sourceMeta);
    }
    if (data.containsKey('signed_at')) {
      context.handle(_signedAtMeta,
          signedAt.isAcceptableOrUnknown(data['signed_at']!, _signedAtMeta));
    } else if (isInserting) {
      context.missing(_signedAtMeta);
    }
    return context;
  }

  @override
  Set<GeneratedColumn> get $primaryKey => {id};
  @override
  CapturedSignature map(Map<String, dynamic> data, {String? tablePrefix}) {
    final effectivePrefix = tablePrefix != null ? '$tablePrefix.' : '';
    return CapturedSignature(
      id: attachedDatabase.typeMapping
          .read(DriftSqlType.string, data['${effectivePrefix}id'])!,
      ownerKind: attachedDatabase.typeMapping
          .read(DriftSqlType.string, data['${effectivePrefix}owner_kind'])!,
      ownerKey: attachedDatabase.typeMapping
          .read(DriftSqlType.string, data['${effectivePrefix}owner_key'])!,
      fieldKey: attachedDatabase.typeMapping
          .read(DriftSqlType.string, data['${effectivePrefix}field_key'])!,
      format: attachedDatabase.typeMapping
          .read(DriftSqlType.string, data['${effectivePrefix}format'])!,
      payload: attachedDatabase.typeMapping
          .read(DriftSqlType.string, data['${effectivePrefix}payload'])!,
      strokesJson: attachedDatabase.typeMapping
          .read(DriftSqlType.string, data['${effectivePrefix}strokes_json']),
      signerUserId: attachedDatabase.typeMapping
          .read(DriftSqlType.string, data['${effectivePrefix}signer_user_id']),
      signerName: attachedDatabase.typeMapping
          .read(DriftSqlType.string, data['${effectivePrefix}signer_name']),
      signerRole: attachedDatabase.typeMapping
          .read(DriftSqlType.string, data['${effectivePrefix}signer_role']),
      source: attachedDatabase.typeMapping
          .read(DriftSqlType.string, data['${effectivePrefix}source'])!,
      signedAt: attachedDatabase.typeMapping
          .read(DriftSqlType.dateTime, data['${effectivePrefix}signed_at'])!,
    );
  }

  @override
  $CapturedSignaturesTable createAlias(String alias) {
    return $CapturedSignaturesTable(attachedDatabase, alias);
  }
}

class CapturedSignature extends DataClass
    implements Insertable<CapturedSignature> {
  final String id;

  /// `checklist_draft`, `inspection_draft` or `pending_command`. There is no
  /// `approval` kind: an approver's mark goes straight to the RPC while online
  /// and is never persisted, because a signature waiting in a local table to
  /// approve something is a decision queued offline.
  final String ownerKind;
  final String ownerKey;

  /// The form field id, or the reserved `__primary__` for the template-level
  /// pad. Deliberately NOT nullable: SQLite treats NULLs as distinct in a
  /// unique index, so a nullable key would quietly restore the shared slot.
  final String fieldKey;

  /// `svg` or `dataurl`. Anything else is not a mark this app draws.
  final String format;

  /// The mark itself, length-capped to mirror `user_signatures_len_chk`. A
  /// value the server column would refuse is refused here at capture time with
  /// a message, rather than at sync time with a failure.
  final String payload;

  /// Vector points, when the pad captured them. SVG markup reconstructs the
  /// picture; the raw strokes reconstruct the ACT, which is what makes a mark
  /// defensible if it is ever disputed. Nullable, because a mark restored from
  /// a saved signature has no strokes: it was drawn on another day, possibly on
  /// another device.
  final String? strokesJson;
  final String? signerUserId;
  final String? signerName;
  final String? signerRole;

  /// `drawn`, `saved` or `none`. Carried into the record so an audit can answer
  /// later where the mark came from.
  final String source;
  final DateTime signedAt;
  const CapturedSignature(
      {required this.id,
      required this.ownerKind,
      required this.ownerKey,
      required this.fieldKey,
      required this.format,
      required this.payload,
      this.strokesJson,
      this.signerUserId,
      this.signerName,
      this.signerRole,
      required this.source,
      required this.signedAt});
  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    map['id'] = Variable<String>(id);
    map['owner_kind'] = Variable<String>(ownerKind);
    map['owner_key'] = Variable<String>(ownerKey);
    map['field_key'] = Variable<String>(fieldKey);
    map['format'] = Variable<String>(format);
    map['payload'] = Variable<String>(payload);
    if (!nullToAbsent || strokesJson != null) {
      map['strokes_json'] = Variable<String>(strokesJson);
    }
    if (!nullToAbsent || signerUserId != null) {
      map['signer_user_id'] = Variable<String>(signerUserId);
    }
    if (!nullToAbsent || signerName != null) {
      map['signer_name'] = Variable<String>(signerName);
    }
    if (!nullToAbsent || signerRole != null) {
      map['signer_role'] = Variable<String>(signerRole);
    }
    map['source'] = Variable<String>(source);
    map['signed_at'] = Variable<DateTime>(signedAt);
    return map;
  }

  CapturedSignaturesCompanion toCompanion(bool nullToAbsent) {
    return CapturedSignaturesCompanion(
      id: Value(id),
      ownerKind: Value(ownerKind),
      ownerKey: Value(ownerKey),
      fieldKey: Value(fieldKey),
      format: Value(format),
      payload: Value(payload),
      strokesJson: strokesJson == null && nullToAbsent
          ? const Value.absent()
          : Value(strokesJson),
      signerUserId: signerUserId == null && nullToAbsent
          ? const Value.absent()
          : Value(signerUserId),
      signerName: signerName == null && nullToAbsent
          ? const Value.absent()
          : Value(signerName),
      signerRole: signerRole == null && nullToAbsent
          ? const Value.absent()
          : Value(signerRole),
      source: Value(source),
      signedAt: Value(signedAt),
    );
  }

  factory CapturedSignature.fromJson(Map<String, dynamic> json,
      {ValueSerializer? serializer}) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return CapturedSignature(
      id: serializer.fromJson<String>(json['id']),
      ownerKind: serializer.fromJson<String>(json['ownerKind']),
      ownerKey: serializer.fromJson<String>(json['ownerKey']),
      fieldKey: serializer.fromJson<String>(json['fieldKey']),
      format: serializer.fromJson<String>(json['format']),
      payload: serializer.fromJson<String>(json['payload']),
      strokesJson: serializer.fromJson<String?>(json['strokesJson']),
      signerUserId: serializer.fromJson<String?>(json['signerUserId']),
      signerName: serializer.fromJson<String?>(json['signerName']),
      signerRole: serializer.fromJson<String?>(json['signerRole']),
      source: serializer.fromJson<String>(json['source']),
      signedAt: serializer.fromJson<DateTime>(json['signedAt']),
    );
  }
  @override
  Map<String, dynamic> toJson({ValueSerializer? serializer}) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return <String, dynamic>{
      'id': serializer.toJson<String>(id),
      'ownerKind': serializer.toJson<String>(ownerKind),
      'ownerKey': serializer.toJson<String>(ownerKey),
      'fieldKey': serializer.toJson<String>(fieldKey),
      'format': serializer.toJson<String>(format),
      'payload': serializer.toJson<String>(payload),
      'strokesJson': serializer.toJson<String?>(strokesJson),
      'signerUserId': serializer.toJson<String?>(signerUserId),
      'signerName': serializer.toJson<String?>(signerName),
      'signerRole': serializer.toJson<String?>(signerRole),
      'source': serializer.toJson<String>(source),
      'signedAt': serializer.toJson<DateTime>(signedAt),
    };
  }

  CapturedSignature copyWith(
          {String? id,
          String? ownerKind,
          String? ownerKey,
          String? fieldKey,
          String? format,
          String? payload,
          Value<String?> strokesJson = const Value.absent(),
          Value<String?> signerUserId = const Value.absent(),
          Value<String?> signerName = const Value.absent(),
          Value<String?> signerRole = const Value.absent(),
          String? source,
          DateTime? signedAt}) =>
      CapturedSignature(
        id: id ?? this.id,
        ownerKind: ownerKind ?? this.ownerKind,
        ownerKey: ownerKey ?? this.ownerKey,
        fieldKey: fieldKey ?? this.fieldKey,
        format: format ?? this.format,
        payload: payload ?? this.payload,
        strokesJson: strokesJson.present ? strokesJson.value : this.strokesJson,
        signerUserId:
            signerUserId.present ? signerUserId.value : this.signerUserId,
        signerName: signerName.present ? signerName.value : this.signerName,
        signerRole: signerRole.present ? signerRole.value : this.signerRole,
        source: source ?? this.source,
        signedAt: signedAt ?? this.signedAt,
      );
  CapturedSignature copyWithCompanion(CapturedSignaturesCompanion data) {
    return CapturedSignature(
      id: data.id.present ? data.id.value : this.id,
      ownerKind: data.ownerKind.present ? data.ownerKind.value : this.ownerKind,
      ownerKey: data.ownerKey.present ? data.ownerKey.value : this.ownerKey,
      fieldKey: data.fieldKey.present ? data.fieldKey.value : this.fieldKey,
      format: data.format.present ? data.format.value : this.format,
      payload: data.payload.present ? data.payload.value : this.payload,
      strokesJson:
          data.strokesJson.present ? data.strokesJson.value : this.strokesJson,
      signerUserId: data.signerUserId.present
          ? data.signerUserId.value
          : this.signerUserId,
      signerName:
          data.signerName.present ? data.signerName.value : this.signerName,
      signerRole:
          data.signerRole.present ? data.signerRole.value : this.signerRole,
      source: data.source.present ? data.source.value : this.source,
      signedAt: data.signedAt.present ? data.signedAt.value : this.signedAt,
    );
  }

  @override
  String toString() {
    return (StringBuffer('CapturedSignature(')
          ..write('id: $id, ')
          ..write('ownerKind: $ownerKind, ')
          ..write('ownerKey: $ownerKey, ')
          ..write('fieldKey: $fieldKey, ')
          ..write('format: $format, ')
          ..write('payload: $payload, ')
          ..write('strokesJson: $strokesJson, ')
          ..write('signerUserId: $signerUserId, ')
          ..write('signerName: $signerName, ')
          ..write('signerRole: $signerRole, ')
          ..write('source: $source, ')
          ..write('signedAt: $signedAt')
          ..write(')'))
        .toString();
  }

  @override
  int get hashCode => Object.hash(
      id,
      ownerKind,
      ownerKey,
      fieldKey,
      format,
      payload,
      strokesJson,
      signerUserId,
      signerName,
      signerRole,
      source,
      signedAt);
  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      (other is CapturedSignature &&
          other.id == this.id &&
          other.ownerKind == this.ownerKind &&
          other.ownerKey == this.ownerKey &&
          other.fieldKey == this.fieldKey &&
          other.format == this.format &&
          other.payload == this.payload &&
          other.strokesJson == this.strokesJson &&
          other.signerUserId == this.signerUserId &&
          other.signerName == this.signerName &&
          other.signerRole == this.signerRole &&
          other.source == this.source &&
          other.signedAt == this.signedAt);
}

class CapturedSignaturesCompanion extends UpdateCompanion<CapturedSignature> {
  final Value<String> id;
  final Value<String> ownerKind;
  final Value<String> ownerKey;
  final Value<String> fieldKey;
  final Value<String> format;
  final Value<String> payload;
  final Value<String?> strokesJson;
  final Value<String?> signerUserId;
  final Value<String?> signerName;
  final Value<String?> signerRole;
  final Value<String> source;
  final Value<DateTime> signedAt;
  final Value<int> rowid;
  const CapturedSignaturesCompanion({
    this.id = const Value.absent(),
    this.ownerKind = const Value.absent(),
    this.ownerKey = const Value.absent(),
    this.fieldKey = const Value.absent(),
    this.format = const Value.absent(),
    this.payload = const Value.absent(),
    this.strokesJson = const Value.absent(),
    this.signerUserId = const Value.absent(),
    this.signerName = const Value.absent(),
    this.signerRole = const Value.absent(),
    this.source = const Value.absent(),
    this.signedAt = const Value.absent(),
    this.rowid = const Value.absent(),
  });
  CapturedSignaturesCompanion.insert({
    required String id,
    required String ownerKind,
    required String ownerKey,
    required String fieldKey,
    required String format,
    required String payload,
    this.strokesJson = const Value.absent(),
    this.signerUserId = const Value.absent(),
    this.signerName = const Value.absent(),
    this.signerRole = const Value.absent(),
    required String source,
    required DateTime signedAt,
    this.rowid = const Value.absent(),
  })  : id = Value(id),
        ownerKind = Value(ownerKind),
        ownerKey = Value(ownerKey),
        fieldKey = Value(fieldKey),
        format = Value(format),
        payload = Value(payload),
        source = Value(source),
        signedAt = Value(signedAt);
  static Insertable<CapturedSignature> custom({
    Expression<String>? id,
    Expression<String>? ownerKind,
    Expression<String>? ownerKey,
    Expression<String>? fieldKey,
    Expression<String>? format,
    Expression<String>? payload,
    Expression<String>? strokesJson,
    Expression<String>? signerUserId,
    Expression<String>? signerName,
    Expression<String>? signerRole,
    Expression<String>? source,
    Expression<DateTime>? signedAt,
    Expression<int>? rowid,
  }) {
    return RawValuesInsertable({
      if (id != null) 'id': id,
      if (ownerKind != null) 'owner_kind': ownerKind,
      if (ownerKey != null) 'owner_key': ownerKey,
      if (fieldKey != null) 'field_key': fieldKey,
      if (format != null) 'format': format,
      if (payload != null) 'payload': payload,
      if (strokesJson != null) 'strokes_json': strokesJson,
      if (signerUserId != null) 'signer_user_id': signerUserId,
      if (signerName != null) 'signer_name': signerName,
      if (signerRole != null) 'signer_role': signerRole,
      if (source != null) 'source': source,
      if (signedAt != null) 'signed_at': signedAt,
      if (rowid != null) 'rowid': rowid,
    });
  }

  CapturedSignaturesCompanion copyWith(
      {Value<String>? id,
      Value<String>? ownerKind,
      Value<String>? ownerKey,
      Value<String>? fieldKey,
      Value<String>? format,
      Value<String>? payload,
      Value<String?>? strokesJson,
      Value<String?>? signerUserId,
      Value<String?>? signerName,
      Value<String?>? signerRole,
      Value<String>? source,
      Value<DateTime>? signedAt,
      Value<int>? rowid}) {
    return CapturedSignaturesCompanion(
      id: id ?? this.id,
      ownerKind: ownerKind ?? this.ownerKind,
      ownerKey: ownerKey ?? this.ownerKey,
      fieldKey: fieldKey ?? this.fieldKey,
      format: format ?? this.format,
      payload: payload ?? this.payload,
      strokesJson: strokesJson ?? this.strokesJson,
      signerUserId: signerUserId ?? this.signerUserId,
      signerName: signerName ?? this.signerName,
      signerRole: signerRole ?? this.signerRole,
      source: source ?? this.source,
      signedAt: signedAt ?? this.signedAt,
      rowid: rowid ?? this.rowid,
    );
  }

  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    if (id.present) {
      map['id'] = Variable<String>(id.value);
    }
    if (ownerKind.present) {
      map['owner_kind'] = Variable<String>(ownerKind.value);
    }
    if (ownerKey.present) {
      map['owner_key'] = Variable<String>(ownerKey.value);
    }
    if (fieldKey.present) {
      map['field_key'] = Variable<String>(fieldKey.value);
    }
    if (format.present) {
      map['format'] = Variable<String>(format.value);
    }
    if (payload.present) {
      map['payload'] = Variable<String>(payload.value);
    }
    if (strokesJson.present) {
      map['strokes_json'] = Variable<String>(strokesJson.value);
    }
    if (signerUserId.present) {
      map['signer_user_id'] = Variable<String>(signerUserId.value);
    }
    if (signerName.present) {
      map['signer_name'] = Variable<String>(signerName.value);
    }
    if (signerRole.present) {
      map['signer_role'] = Variable<String>(signerRole.value);
    }
    if (source.present) {
      map['source'] = Variable<String>(source.value);
    }
    if (signedAt.present) {
      map['signed_at'] = Variable<DateTime>(signedAt.value);
    }
    if (rowid.present) {
      map['rowid'] = Variable<int>(rowid.value);
    }
    return map;
  }

  @override
  String toString() {
    return (StringBuffer('CapturedSignaturesCompanion(')
          ..write('id: $id, ')
          ..write('ownerKind: $ownerKind, ')
          ..write('ownerKey: $ownerKey, ')
          ..write('fieldKey: $fieldKey, ')
          ..write('format: $format, ')
          ..write('payload: $payload, ')
          ..write('strokesJson: $strokesJson, ')
          ..write('signerUserId: $signerUserId, ')
          ..write('signerName: $signerName, ')
          ..write('signerRole: $signerRole, ')
          ..write('source: $source, ')
          ..write('signedAt: $signedAt, ')
          ..write('rowid: $rowid')
          ..write(')'))
        .toString();
  }
}

class $PendingCommandsTable extends PendingCommands
    with TableInfo<$PendingCommandsTable, PendingCommand> {
  @override
  final GeneratedDatabase attachedDatabase;
  final String? _alias;
  $PendingCommandsTable(this.attachedDatabase, [this._alias]);
  static const VerificationMeta _idMeta = const VerificationMeta('id');
  @override
  late final GeneratedColumn<String> id = GeneratedColumn<String>(
      'id', aliasedName, false,
      type: DriftSqlType.string, requiredDuringInsert: true);
  static const VerificationMeta _commandTypeMeta =
      const VerificationMeta('commandType');
  @override
  late final GeneratedColumn<String> commandType = GeneratedColumn<String>(
      'command_type', aliasedName, false,
      type: DriftSqlType.string, requiredDuringInsert: true);
  static const VerificationMeta _entityTypeMeta =
      const VerificationMeta('entityType');
  @override
  late final GeneratedColumn<String> entityType = GeneratedColumn<String>(
      'entity_type', aliasedName, false,
      type: DriftSqlType.string, requiredDuringInsert: true);
  static const VerificationMeta _entityIdMeta =
      const VerificationMeta('entityId');
  @override
  late final GeneratedColumn<String> entityId = GeneratedColumn<String>(
      'entity_id', aliasedName, true,
      type: DriftSqlType.string, requiredDuringInsert: false);
  static const VerificationMeta _payloadJsonMeta =
      const VerificationMeta('payloadJson');
  @override
  late final GeneratedColumn<String> payloadJson = GeneratedColumn<String>(
      'payload_json', aliasedName, false,
      type: DriftSqlType.string, requiredDuringInsert: true);
  static const VerificationMeta _createdAtMeta =
      const VerificationMeta('createdAt');
  @override
  late final GeneratedColumn<DateTime> createdAt = GeneratedColumn<DateTime>(
      'created_at', aliasedName, false,
      type: DriftSqlType.dateTime, requiredDuringInsert: true);
  static const VerificationMeta _createdByMeta =
      const VerificationMeta('createdBy');
  @override
  late final GeneratedColumn<String> createdBy = GeneratedColumn<String>(
      'created_by', aliasedName, false,
      type: DriftSqlType.string, requiredDuringInsert: true);
  static const VerificationMeta _workspaceIdMeta =
      const VerificationMeta('workspaceId');
  @override
  late final GeneratedColumn<String> workspaceId = GeneratedColumn<String>(
      'workspace_id', aliasedName, false,
      type: DriftSqlType.string, requiredDuringInsert: true);
  static const VerificationMeta _countryMeta =
      const VerificationMeta('country');
  @override
  late final GeneratedColumn<String> country = GeneratedColumn<String>(
      'country', aliasedName, true,
      type: DriftSqlType.string, requiredDuringInsert: false);
  static const VerificationMeta _retryCountMeta =
      const VerificationMeta('retryCount');
  @override
  late final GeneratedColumn<int> retryCount = GeneratedColumn<int>(
      'retry_count', aliasedName, false,
      type: DriftSqlType.int,
      requiredDuringInsert: false,
      defaultValue: const Constant(0));
  static const VerificationMeta _nextRetryAtMeta =
      const VerificationMeta('nextRetryAt');
  @override
  late final GeneratedColumn<DateTime> nextRetryAt = GeneratedColumn<DateTime>(
      'next_retry_at', aliasedName, false,
      type: DriftSqlType.dateTime, requiredDuringInsert: true);
  static const VerificationMeta _statusMeta = const VerificationMeta('status');
  @override
  late final GeneratedColumn<String> status = GeneratedColumn<String>(
      'status', aliasedName, false,
      type: DriftSqlType.string, requiredDuringInsert: true);
  static const VerificationMeta _lastErrorMeta =
      const VerificationMeta('lastError');
  @override
  late final GeneratedColumn<String> lastError = GeneratedColumn<String>(
      'last_error', aliasedName, true,
      type: DriftSqlType.string, requiredDuringInsert: false);
  static const VerificationMeta _idempotencyKeyMeta =
      const VerificationMeta('idempotencyKey');
  @override
  late final GeneratedColumn<String> idempotencyKey = GeneratedColumn<String>(
      'idempotency_key', aliasedName, false,
      type: DriftSqlType.string, requiredDuringInsert: true);
  static const VerificationMeta _syncedAtMeta =
      const VerificationMeta('syncedAt');
  @override
  late final GeneratedColumn<DateTime> syncedAt = GeneratedColumn<DateTime>(
      'synced_at', aliasedName, true,
      type: DriftSqlType.dateTime, requiredDuringInsert: false);
  static const VerificationMeta _dependsOnMeta =
      const VerificationMeta('dependsOn');
  @override
  late final GeneratedColumn<String> dependsOn = GeneratedColumn<String>(
      'depends_on', aliasedName, true,
      type: DriftSqlType.string, requiredDuringInsert: false);
  @override
  List<GeneratedColumn> get $columns => [
        id,
        commandType,
        entityType,
        entityId,
        payloadJson,
        createdAt,
        createdBy,
        workspaceId,
        country,
        retryCount,
        nextRetryAt,
        status,
        lastError,
        idempotencyKey,
        syncedAt,
        dependsOn
      ];
  @override
  String get aliasedName => _alias ?? actualTableName;
  @override
  String get actualTableName => $name;
  static const String $name = 'pending_commands';
  @override
  VerificationContext validateIntegrity(Insertable<PendingCommand> instance,
      {bool isInserting = false}) {
    final context = VerificationContext();
    final data = instance.toColumns(true);
    if (data.containsKey('id')) {
      context.handle(_idMeta, id.isAcceptableOrUnknown(data['id']!, _idMeta));
    } else if (isInserting) {
      context.missing(_idMeta);
    }
    if (data.containsKey('command_type')) {
      context.handle(
          _commandTypeMeta,
          commandType.isAcceptableOrUnknown(
              data['command_type']!, _commandTypeMeta));
    } else if (isInserting) {
      context.missing(_commandTypeMeta);
    }
    if (data.containsKey('entity_type')) {
      context.handle(
          _entityTypeMeta,
          entityType.isAcceptableOrUnknown(
              data['entity_type']!, _entityTypeMeta));
    } else if (isInserting) {
      context.missing(_entityTypeMeta);
    }
    if (data.containsKey('entity_id')) {
      context.handle(_entityIdMeta,
          entityId.isAcceptableOrUnknown(data['entity_id']!, _entityIdMeta));
    }
    if (data.containsKey('payload_json')) {
      context.handle(
          _payloadJsonMeta,
          payloadJson.isAcceptableOrUnknown(
              data['payload_json']!, _payloadJsonMeta));
    } else if (isInserting) {
      context.missing(_payloadJsonMeta);
    }
    if (data.containsKey('created_at')) {
      context.handle(_createdAtMeta,
          createdAt.isAcceptableOrUnknown(data['created_at']!, _createdAtMeta));
    } else if (isInserting) {
      context.missing(_createdAtMeta);
    }
    if (data.containsKey('created_by')) {
      context.handle(_createdByMeta,
          createdBy.isAcceptableOrUnknown(data['created_by']!, _createdByMeta));
    } else if (isInserting) {
      context.missing(_createdByMeta);
    }
    if (data.containsKey('workspace_id')) {
      context.handle(
          _workspaceIdMeta,
          workspaceId.isAcceptableOrUnknown(
              data['workspace_id']!, _workspaceIdMeta));
    } else if (isInserting) {
      context.missing(_workspaceIdMeta);
    }
    if (data.containsKey('country')) {
      context.handle(_countryMeta,
          country.isAcceptableOrUnknown(data['country']!, _countryMeta));
    }
    if (data.containsKey('retry_count')) {
      context.handle(
          _retryCountMeta,
          retryCount.isAcceptableOrUnknown(
              data['retry_count']!, _retryCountMeta));
    }
    if (data.containsKey('next_retry_at')) {
      context.handle(
          _nextRetryAtMeta,
          nextRetryAt.isAcceptableOrUnknown(
              data['next_retry_at']!, _nextRetryAtMeta));
    } else if (isInserting) {
      context.missing(_nextRetryAtMeta);
    }
    if (data.containsKey('status')) {
      context.handle(_statusMeta,
          status.isAcceptableOrUnknown(data['status']!, _statusMeta));
    } else if (isInserting) {
      context.missing(_statusMeta);
    }
    if (data.containsKey('last_error')) {
      context.handle(_lastErrorMeta,
          lastError.isAcceptableOrUnknown(data['last_error']!, _lastErrorMeta));
    }
    if (data.containsKey('idempotency_key')) {
      context.handle(
          _idempotencyKeyMeta,
          idempotencyKey.isAcceptableOrUnknown(
              data['idempotency_key']!, _idempotencyKeyMeta));
    } else if (isInserting) {
      context.missing(_idempotencyKeyMeta);
    }
    if (data.containsKey('synced_at')) {
      context.handle(_syncedAtMeta,
          syncedAt.isAcceptableOrUnknown(data['synced_at']!, _syncedAtMeta));
    }
    if (data.containsKey('depends_on')) {
      context.handle(_dependsOnMeta,
          dependsOn.isAcceptableOrUnknown(data['depends_on']!, _dependsOnMeta));
    }
    return context;
  }

  @override
  Set<GeneratedColumn> get $primaryKey => {id};
  @override
  PendingCommand map(Map<String, dynamic> data, {String? tablePrefix}) {
    final effectivePrefix = tablePrefix != null ? '$tablePrefix.' : '';
    return PendingCommand(
      id: attachedDatabase.typeMapping
          .read(DriftSqlType.string, data['${effectivePrefix}id'])!,
      commandType: attachedDatabase.typeMapping
          .read(DriftSqlType.string, data['${effectivePrefix}command_type'])!,
      entityType: attachedDatabase.typeMapping
          .read(DriftSqlType.string, data['${effectivePrefix}entity_type'])!,
      entityId: attachedDatabase.typeMapping
          .read(DriftSqlType.string, data['${effectivePrefix}entity_id']),
      payloadJson: attachedDatabase.typeMapping
          .read(DriftSqlType.string, data['${effectivePrefix}payload_json'])!,
      createdAt: attachedDatabase.typeMapping
          .read(DriftSqlType.dateTime, data['${effectivePrefix}created_at'])!,
      createdBy: attachedDatabase.typeMapping
          .read(DriftSqlType.string, data['${effectivePrefix}created_by'])!,
      workspaceId: attachedDatabase.typeMapping
          .read(DriftSqlType.string, data['${effectivePrefix}workspace_id'])!,
      country: attachedDatabase.typeMapping
          .read(DriftSqlType.string, data['${effectivePrefix}country']),
      retryCount: attachedDatabase.typeMapping
          .read(DriftSqlType.int, data['${effectivePrefix}retry_count'])!,
      nextRetryAt: attachedDatabase.typeMapping.read(
          DriftSqlType.dateTime, data['${effectivePrefix}next_retry_at'])!,
      status: attachedDatabase.typeMapping
          .read(DriftSqlType.string, data['${effectivePrefix}status'])!,
      lastError: attachedDatabase.typeMapping
          .read(DriftSqlType.string, data['${effectivePrefix}last_error']),
      idempotencyKey: attachedDatabase.typeMapping.read(
          DriftSqlType.string, data['${effectivePrefix}idempotency_key'])!,
      syncedAt: attachedDatabase.typeMapping
          .read(DriftSqlType.dateTime, data['${effectivePrefix}synced_at']),
      dependsOn: attachedDatabase.typeMapping
          .read(DriftSqlType.string, data['${effectivePrefix}depends_on']),
    );
  }

  @override
  $PendingCommandsTable createAlias(String alias) {
    return $PendingCommandsTable(attachedDatabase, alias);
  }
}

class PendingCommand extends DataClass implements Insertable<PendingCommand> {
  /// Local UUID, minted when the user commits the form.
  final String id;

  /// One of the command types in the registry. The registry is the ONLY place
  /// a table name may appear on the client.
  final String commandType;

  /// The target table, derived from the registry and never client-chosen.
  final String entityType;

  /// The match value for an update command; null for an insert. An update
  /// command excludes the match column from its SET clause, so the primary key
  /// is never rewritten.
  final String? entityId;

  /// The payload, ALREADY stripped to the command's field allow-list. A column
  /// PostgREST cannot find fails the WHOLE request, so one stray key would kill
  /// a field worker's entire sync.
  final String payloadJson;
  final DateTime createdAt;

  /// Who captured this. The React Native queue does not record it, which makes
  /// a shared-handset queue unattributable.
  final String createdBy;

  /// Which workspace this was captured in. This column is a REFUSAL, not a
  /// filter.
  ///
  /// The React Native queue does not record it, so a sync running after a
  /// workspace switch would push the command under whatever context is now
  /// active. That is a cross-tenant write. The rule here: if this does not
  /// match the active workspace the row is set `blocked` and reported as
  /// "captured in another workspace" - never pushed, and never discarded.
  final String workspaceId;
  final String? country;
  final int retryCount;

  /// When this row becomes due. Backoff is `30s * 2^retry` capped at 30
  /// minutes.
  final DateTime nextRetryAt;

  /// One of CommandStatus: pending, processing, retry, blocked, failed, synced.
  final String status;

  /// Sanitised before storage, not before display. A raw database message must
  /// never land on disk at all, so it cannot leak later through a log export or
  /// a support screenshot.
  final String? lastError;

  /// The stable client id shared by the immediate attempt AND every queued
  /// retry, so a lost response or a crash can never create a duplicate.
  ///
  /// Minted ONCE, before the first network attempt, and written in the SAME
  /// transaction as the payload. A key minted only on the fallback path means
  /// the online attempt and the queued retry carry different keys, which is the
  /// exact double-insert the mechanism exists to prevent.
  final String idempotencyKey;
  final DateTime? syncedAt;

  /// Another `pending_commands.id` that must reach `synced` first. Spec section
  /// 15 requires processing by dependency order.
  ///
  /// Deliberately NOT a declared foreign key: a synced predecessor is pruned
  /// while its dependent may still be queued, and a FK would either block that
  /// prune or cascade-delete unsynced work. The dependency is resolved by the
  /// queue DAO, which treats a missing predecessor as already satisfied.
  final String? dependsOn;
  const PendingCommand(
      {required this.id,
      required this.commandType,
      required this.entityType,
      this.entityId,
      required this.payloadJson,
      required this.createdAt,
      required this.createdBy,
      required this.workspaceId,
      this.country,
      required this.retryCount,
      required this.nextRetryAt,
      required this.status,
      this.lastError,
      required this.idempotencyKey,
      this.syncedAt,
      this.dependsOn});
  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    map['id'] = Variable<String>(id);
    map['command_type'] = Variable<String>(commandType);
    map['entity_type'] = Variable<String>(entityType);
    if (!nullToAbsent || entityId != null) {
      map['entity_id'] = Variable<String>(entityId);
    }
    map['payload_json'] = Variable<String>(payloadJson);
    map['created_at'] = Variable<DateTime>(createdAt);
    map['created_by'] = Variable<String>(createdBy);
    map['workspace_id'] = Variable<String>(workspaceId);
    if (!nullToAbsent || country != null) {
      map['country'] = Variable<String>(country);
    }
    map['retry_count'] = Variable<int>(retryCount);
    map['next_retry_at'] = Variable<DateTime>(nextRetryAt);
    map['status'] = Variable<String>(status);
    if (!nullToAbsent || lastError != null) {
      map['last_error'] = Variable<String>(lastError);
    }
    map['idempotency_key'] = Variable<String>(idempotencyKey);
    if (!nullToAbsent || syncedAt != null) {
      map['synced_at'] = Variable<DateTime>(syncedAt);
    }
    if (!nullToAbsent || dependsOn != null) {
      map['depends_on'] = Variable<String>(dependsOn);
    }
    return map;
  }

  PendingCommandsCompanion toCompanion(bool nullToAbsent) {
    return PendingCommandsCompanion(
      id: Value(id),
      commandType: Value(commandType),
      entityType: Value(entityType),
      entityId: entityId == null && nullToAbsent
          ? const Value.absent()
          : Value(entityId),
      payloadJson: Value(payloadJson),
      createdAt: Value(createdAt),
      createdBy: Value(createdBy),
      workspaceId: Value(workspaceId),
      country: country == null && nullToAbsent
          ? const Value.absent()
          : Value(country),
      retryCount: Value(retryCount),
      nextRetryAt: Value(nextRetryAt),
      status: Value(status),
      lastError: lastError == null && nullToAbsent
          ? const Value.absent()
          : Value(lastError),
      idempotencyKey: Value(idempotencyKey),
      syncedAt: syncedAt == null && nullToAbsent
          ? const Value.absent()
          : Value(syncedAt),
      dependsOn: dependsOn == null && nullToAbsent
          ? const Value.absent()
          : Value(dependsOn),
    );
  }

  factory PendingCommand.fromJson(Map<String, dynamic> json,
      {ValueSerializer? serializer}) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return PendingCommand(
      id: serializer.fromJson<String>(json['id']),
      commandType: serializer.fromJson<String>(json['commandType']),
      entityType: serializer.fromJson<String>(json['entityType']),
      entityId: serializer.fromJson<String?>(json['entityId']),
      payloadJson: serializer.fromJson<String>(json['payloadJson']),
      createdAt: serializer.fromJson<DateTime>(json['createdAt']),
      createdBy: serializer.fromJson<String>(json['createdBy']),
      workspaceId: serializer.fromJson<String>(json['workspaceId']),
      country: serializer.fromJson<String?>(json['country']),
      retryCount: serializer.fromJson<int>(json['retryCount']),
      nextRetryAt: serializer.fromJson<DateTime>(json['nextRetryAt']),
      status: serializer.fromJson<String>(json['status']),
      lastError: serializer.fromJson<String?>(json['lastError']),
      idempotencyKey: serializer.fromJson<String>(json['idempotencyKey']),
      syncedAt: serializer.fromJson<DateTime?>(json['syncedAt']),
      dependsOn: serializer.fromJson<String?>(json['dependsOn']),
    );
  }
  @override
  Map<String, dynamic> toJson({ValueSerializer? serializer}) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return <String, dynamic>{
      'id': serializer.toJson<String>(id),
      'commandType': serializer.toJson<String>(commandType),
      'entityType': serializer.toJson<String>(entityType),
      'entityId': serializer.toJson<String?>(entityId),
      'payloadJson': serializer.toJson<String>(payloadJson),
      'createdAt': serializer.toJson<DateTime>(createdAt),
      'createdBy': serializer.toJson<String>(createdBy),
      'workspaceId': serializer.toJson<String>(workspaceId),
      'country': serializer.toJson<String?>(country),
      'retryCount': serializer.toJson<int>(retryCount),
      'nextRetryAt': serializer.toJson<DateTime>(nextRetryAt),
      'status': serializer.toJson<String>(status),
      'lastError': serializer.toJson<String?>(lastError),
      'idempotencyKey': serializer.toJson<String>(idempotencyKey),
      'syncedAt': serializer.toJson<DateTime?>(syncedAt),
      'dependsOn': serializer.toJson<String?>(dependsOn),
    };
  }

  PendingCommand copyWith(
          {String? id,
          String? commandType,
          String? entityType,
          Value<String?> entityId = const Value.absent(),
          String? payloadJson,
          DateTime? createdAt,
          String? createdBy,
          String? workspaceId,
          Value<String?> country = const Value.absent(),
          int? retryCount,
          DateTime? nextRetryAt,
          String? status,
          Value<String?> lastError = const Value.absent(),
          String? idempotencyKey,
          Value<DateTime?> syncedAt = const Value.absent(),
          Value<String?> dependsOn = const Value.absent()}) =>
      PendingCommand(
        id: id ?? this.id,
        commandType: commandType ?? this.commandType,
        entityType: entityType ?? this.entityType,
        entityId: entityId.present ? entityId.value : this.entityId,
        payloadJson: payloadJson ?? this.payloadJson,
        createdAt: createdAt ?? this.createdAt,
        createdBy: createdBy ?? this.createdBy,
        workspaceId: workspaceId ?? this.workspaceId,
        country: country.present ? country.value : this.country,
        retryCount: retryCount ?? this.retryCount,
        nextRetryAt: nextRetryAt ?? this.nextRetryAt,
        status: status ?? this.status,
        lastError: lastError.present ? lastError.value : this.lastError,
        idempotencyKey: idempotencyKey ?? this.idempotencyKey,
        syncedAt: syncedAt.present ? syncedAt.value : this.syncedAt,
        dependsOn: dependsOn.present ? dependsOn.value : this.dependsOn,
      );
  PendingCommand copyWithCompanion(PendingCommandsCompanion data) {
    return PendingCommand(
      id: data.id.present ? data.id.value : this.id,
      commandType:
          data.commandType.present ? data.commandType.value : this.commandType,
      entityType:
          data.entityType.present ? data.entityType.value : this.entityType,
      entityId: data.entityId.present ? data.entityId.value : this.entityId,
      payloadJson:
          data.payloadJson.present ? data.payloadJson.value : this.payloadJson,
      createdAt: data.createdAt.present ? data.createdAt.value : this.createdAt,
      createdBy: data.createdBy.present ? data.createdBy.value : this.createdBy,
      workspaceId:
          data.workspaceId.present ? data.workspaceId.value : this.workspaceId,
      country: data.country.present ? data.country.value : this.country,
      retryCount:
          data.retryCount.present ? data.retryCount.value : this.retryCount,
      nextRetryAt:
          data.nextRetryAt.present ? data.nextRetryAt.value : this.nextRetryAt,
      status: data.status.present ? data.status.value : this.status,
      lastError: data.lastError.present ? data.lastError.value : this.lastError,
      idempotencyKey: data.idempotencyKey.present
          ? data.idempotencyKey.value
          : this.idempotencyKey,
      syncedAt: data.syncedAt.present ? data.syncedAt.value : this.syncedAt,
      dependsOn: data.dependsOn.present ? data.dependsOn.value : this.dependsOn,
    );
  }

  @override
  String toString() {
    return (StringBuffer('PendingCommand(')
          ..write('id: $id, ')
          ..write('commandType: $commandType, ')
          ..write('entityType: $entityType, ')
          ..write('entityId: $entityId, ')
          ..write('payloadJson: $payloadJson, ')
          ..write('createdAt: $createdAt, ')
          ..write('createdBy: $createdBy, ')
          ..write('workspaceId: $workspaceId, ')
          ..write('country: $country, ')
          ..write('retryCount: $retryCount, ')
          ..write('nextRetryAt: $nextRetryAt, ')
          ..write('status: $status, ')
          ..write('lastError: $lastError, ')
          ..write('idempotencyKey: $idempotencyKey, ')
          ..write('syncedAt: $syncedAt, ')
          ..write('dependsOn: $dependsOn')
          ..write(')'))
        .toString();
  }

  @override
  int get hashCode => Object.hash(
      id,
      commandType,
      entityType,
      entityId,
      payloadJson,
      createdAt,
      createdBy,
      workspaceId,
      country,
      retryCount,
      nextRetryAt,
      status,
      lastError,
      idempotencyKey,
      syncedAt,
      dependsOn);
  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      (other is PendingCommand &&
          other.id == this.id &&
          other.commandType == this.commandType &&
          other.entityType == this.entityType &&
          other.entityId == this.entityId &&
          other.payloadJson == this.payloadJson &&
          other.createdAt == this.createdAt &&
          other.createdBy == this.createdBy &&
          other.workspaceId == this.workspaceId &&
          other.country == this.country &&
          other.retryCount == this.retryCount &&
          other.nextRetryAt == this.nextRetryAt &&
          other.status == this.status &&
          other.lastError == this.lastError &&
          other.idempotencyKey == this.idempotencyKey &&
          other.syncedAt == this.syncedAt &&
          other.dependsOn == this.dependsOn);
}

class PendingCommandsCompanion extends UpdateCompanion<PendingCommand> {
  final Value<String> id;
  final Value<String> commandType;
  final Value<String> entityType;
  final Value<String?> entityId;
  final Value<String> payloadJson;
  final Value<DateTime> createdAt;
  final Value<String> createdBy;
  final Value<String> workspaceId;
  final Value<String?> country;
  final Value<int> retryCount;
  final Value<DateTime> nextRetryAt;
  final Value<String> status;
  final Value<String?> lastError;
  final Value<String> idempotencyKey;
  final Value<DateTime?> syncedAt;
  final Value<String?> dependsOn;
  final Value<int> rowid;
  const PendingCommandsCompanion({
    this.id = const Value.absent(),
    this.commandType = const Value.absent(),
    this.entityType = const Value.absent(),
    this.entityId = const Value.absent(),
    this.payloadJson = const Value.absent(),
    this.createdAt = const Value.absent(),
    this.createdBy = const Value.absent(),
    this.workspaceId = const Value.absent(),
    this.country = const Value.absent(),
    this.retryCount = const Value.absent(),
    this.nextRetryAt = const Value.absent(),
    this.status = const Value.absent(),
    this.lastError = const Value.absent(),
    this.idempotencyKey = const Value.absent(),
    this.syncedAt = const Value.absent(),
    this.dependsOn = const Value.absent(),
    this.rowid = const Value.absent(),
  });
  PendingCommandsCompanion.insert({
    required String id,
    required String commandType,
    required String entityType,
    this.entityId = const Value.absent(),
    required String payloadJson,
    required DateTime createdAt,
    required String createdBy,
    required String workspaceId,
    this.country = const Value.absent(),
    this.retryCount = const Value.absent(),
    required DateTime nextRetryAt,
    required String status,
    this.lastError = const Value.absent(),
    required String idempotencyKey,
    this.syncedAt = const Value.absent(),
    this.dependsOn = const Value.absent(),
    this.rowid = const Value.absent(),
  })  : id = Value(id),
        commandType = Value(commandType),
        entityType = Value(entityType),
        payloadJson = Value(payloadJson),
        createdAt = Value(createdAt),
        createdBy = Value(createdBy),
        workspaceId = Value(workspaceId),
        nextRetryAt = Value(nextRetryAt),
        status = Value(status),
        idempotencyKey = Value(idempotencyKey);
  static Insertable<PendingCommand> custom({
    Expression<String>? id,
    Expression<String>? commandType,
    Expression<String>? entityType,
    Expression<String>? entityId,
    Expression<String>? payloadJson,
    Expression<DateTime>? createdAt,
    Expression<String>? createdBy,
    Expression<String>? workspaceId,
    Expression<String>? country,
    Expression<int>? retryCount,
    Expression<DateTime>? nextRetryAt,
    Expression<String>? status,
    Expression<String>? lastError,
    Expression<String>? idempotencyKey,
    Expression<DateTime>? syncedAt,
    Expression<String>? dependsOn,
    Expression<int>? rowid,
  }) {
    return RawValuesInsertable({
      if (id != null) 'id': id,
      if (commandType != null) 'command_type': commandType,
      if (entityType != null) 'entity_type': entityType,
      if (entityId != null) 'entity_id': entityId,
      if (payloadJson != null) 'payload_json': payloadJson,
      if (createdAt != null) 'created_at': createdAt,
      if (createdBy != null) 'created_by': createdBy,
      if (workspaceId != null) 'workspace_id': workspaceId,
      if (country != null) 'country': country,
      if (retryCount != null) 'retry_count': retryCount,
      if (nextRetryAt != null) 'next_retry_at': nextRetryAt,
      if (status != null) 'status': status,
      if (lastError != null) 'last_error': lastError,
      if (idempotencyKey != null) 'idempotency_key': idempotencyKey,
      if (syncedAt != null) 'synced_at': syncedAt,
      if (dependsOn != null) 'depends_on': dependsOn,
      if (rowid != null) 'rowid': rowid,
    });
  }

  PendingCommandsCompanion copyWith(
      {Value<String>? id,
      Value<String>? commandType,
      Value<String>? entityType,
      Value<String?>? entityId,
      Value<String>? payloadJson,
      Value<DateTime>? createdAt,
      Value<String>? createdBy,
      Value<String>? workspaceId,
      Value<String?>? country,
      Value<int>? retryCount,
      Value<DateTime>? nextRetryAt,
      Value<String>? status,
      Value<String?>? lastError,
      Value<String>? idempotencyKey,
      Value<DateTime?>? syncedAt,
      Value<String?>? dependsOn,
      Value<int>? rowid}) {
    return PendingCommandsCompanion(
      id: id ?? this.id,
      commandType: commandType ?? this.commandType,
      entityType: entityType ?? this.entityType,
      entityId: entityId ?? this.entityId,
      payloadJson: payloadJson ?? this.payloadJson,
      createdAt: createdAt ?? this.createdAt,
      createdBy: createdBy ?? this.createdBy,
      workspaceId: workspaceId ?? this.workspaceId,
      country: country ?? this.country,
      retryCount: retryCount ?? this.retryCount,
      nextRetryAt: nextRetryAt ?? this.nextRetryAt,
      status: status ?? this.status,
      lastError: lastError ?? this.lastError,
      idempotencyKey: idempotencyKey ?? this.idempotencyKey,
      syncedAt: syncedAt ?? this.syncedAt,
      dependsOn: dependsOn ?? this.dependsOn,
      rowid: rowid ?? this.rowid,
    );
  }

  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    if (id.present) {
      map['id'] = Variable<String>(id.value);
    }
    if (commandType.present) {
      map['command_type'] = Variable<String>(commandType.value);
    }
    if (entityType.present) {
      map['entity_type'] = Variable<String>(entityType.value);
    }
    if (entityId.present) {
      map['entity_id'] = Variable<String>(entityId.value);
    }
    if (payloadJson.present) {
      map['payload_json'] = Variable<String>(payloadJson.value);
    }
    if (createdAt.present) {
      map['created_at'] = Variable<DateTime>(createdAt.value);
    }
    if (createdBy.present) {
      map['created_by'] = Variable<String>(createdBy.value);
    }
    if (workspaceId.present) {
      map['workspace_id'] = Variable<String>(workspaceId.value);
    }
    if (country.present) {
      map['country'] = Variable<String>(country.value);
    }
    if (retryCount.present) {
      map['retry_count'] = Variable<int>(retryCount.value);
    }
    if (nextRetryAt.present) {
      map['next_retry_at'] = Variable<DateTime>(nextRetryAt.value);
    }
    if (status.present) {
      map['status'] = Variable<String>(status.value);
    }
    if (lastError.present) {
      map['last_error'] = Variable<String>(lastError.value);
    }
    if (idempotencyKey.present) {
      map['idempotency_key'] = Variable<String>(idempotencyKey.value);
    }
    if (syncedAt.present) {
      map['synced_at'] = Variable<DateTime>(syncedAt.value);
    }
    if (dependsOn.present) {
      map['depends_on'] = Variable<String>(dependsOn.value);
    }
    if (rowid.present) {
      map['rowid'] = Variable<int>(rowid.value);
    }
    return map;
  }

  @override
  String toString() {
    return (StringBuffer('PendingCommandsCompanion(')
          ..write('id: $id, ')
          ..write('commandType: $commandType, ')
          ..write('entityType: $entityType, ')
          ..write('entityId: $entityId, ')
          ..write('payloadJson: $payloadJson, ')
          ..write('createdAt: $createdAt, ')
          ..write('createdBy: $createdBy, ')
          ..write('workspaceId: $workspaceId, ')
          ..write('country: $country, ')
          ..write('retryCount: $retryCount, ')
          ..write('nextRetryAt: $nextRetryAt, ')
          ..write('status: $status, ')
          ..write('lastError: $lastError, ')
          ..write('idempotencyKey: $idempotencyKey, ')
          ..write('syncedAt: $syncedAt, ')
          ..write('dependsOn: $dependsOn, ')
          ..write('rowid: $rowid')
          ..write(')'))
        .toString();
  }
}

class $PendingMediaUploadsTable extends PendingMediaUploads
    with TableInfo<$PendingMediaUploadsTable, PendingMediaUpload> {
  @override
  final GeneratedDatabase attachedDatabase;
  final String? _alias;
  $PendingMediaUploadsTable(this.attachedDatabase, [this._alias]);
  static const VerificationMeta _idMeta = const VerificationMeta('id');
  @override
  late final GeneratedColumn<String> id = GeneratedColumn<String>(
      'id', aliasedName, false,
      type: DriftSqlType.string, requiredDuringInsert: true);
  static const VerificationMeta _commandIdMeta =
      const VerificationMeta('commandId');
  @override
  late final GeneratedColumn<String> commandId = GeneratedColumn<String>(
      'command_id', aliasedName, false,
      type: DriftSqlType.string,
      requiredDuringInsert: true,
      defaultConstraints: GeneratedColumn.constraintIsAlways(
          'REFERENCES pending_commands (id) ON DELETE RESTRICT'));
  static const VerificationMeta _fieldKeyMeta =
      const VerificationMeta('fieldKey');
  @override
  late final GeneratedColumn<String> fieldKey = GeneratedColumn<String>(
      'field_key', aliasedName, true,
      type: DriftSqlType.string, requiredDuringInsert: false);
  static const VerificationMeta _orderIndexMeta =
      const VerificationMeta('orderIndex');
  @override
  late final GeneratedColumn<int> orderIndex = GeneratedColumn<int>(
      'order_index', aliasedName, false,
      type: DriftSqlType.int, requiredDuringInsert: true);
  static const VerificationMeta _localPathMeta =
      const VerificationMeta('localPath');
  @override
  late final GeneratedColumn<String> localPath = GeneratedColumn<String>(
      'local_path', aliasedName, false,
      type: DriftSqlType.string, requiredDuringInsert: true);
  static const VerificationMeta _fileNameMeta =
      const VerificationMeta('fileName');
  @override
  late final GeneratedColumn<String> fileName = GeneratedColumn<String>(
      'file_name', aliasedName, false,
      type: DriftSqlType.string, requiredDuringInsert: true);
  static const VerificationMeta _sizeBytesMeta =
      const VerificationMeta('sizeBytes');
  @override
  late final GeneratedColumn<int> sizeBytes = GeneratedColumn<int>(
      'size_bytes', aliasedName, true,
      type: DriftSqlType.int, requiredDuringInsert: false);
  static const VerificationMeta _mimeTypeMeta =
      const VerificationMeta('mimeType');
  @override
  late final GeneratedColumn<String> mimeType = GeneratedColumn<String>(
      'mime_type', aliasedName, true,
      type: DriftSqlType.string, requiredDuringInsert: false);
  static const VerificationMeta _checksumMeta =
      const VerificationMeta('checksum');
  @override
  late final GeneratedColumn<String> checksum = GeneratedColumn<String>(
      'checksum', aliasedName, true,
      type: DriftSqlType.string, requiredDuringInsert: false);
  static const VerificationMeta _bucketMeta = const VerificationMeta('bucket');
  @override
  late final GeneratedColumn<String> bucket = GeneratedColumn<String>(
      'bucket', aliasedName, true,
      type: DriftSqlType.string, requiredDuringInsert: false);
  static const VerificationMeta _remotePathMeta =
      const VerificationMeta('remotePath');
  @override
  late final GeneratedColumn<String> remotePath = GeneratedColumn<String>(
      'remote_path', aliasedName, true,
      type: DriftSqlType.string, requiredDuringInsert: false);
  static const VerificationMeta _remoteRefMeta =
      const VerificationMeta('remoteRef');
  @override
  late final GeneratedColumn<String> remoteRef = GeneratedColumn<String>(
      'remote_ref', aliasedName, true,
      type: DriftSqlType.string, requiredDuringInsert: false);
  static const VerificationMeta _stateMeta = const VerificationMeta('state');
  @override
  late final GeneratedColumn<String> state = GeneratedColumn<String>(
      'state', aliasedName, false,
      type: DriftSqlType.string, requiredDuringInsert: true);
  static const VerificationMeta _attemptsMeta =
      const VerificationMeta('attempts');
  @override
  late final GeneratedColumn<int> attempts = GeneratedColumn<int>(
      'attempts', aliasedName, false,
      type: DriftSqlType.int,
      requiredDuringInsert: false,
      defaultValue: const Constant(0));
  static const VerificationMeta _lastErrorMeta =
      const VerificationMeta('lastError');
  @override
  late final GeneratedColumn<String> lastError = GeneratedColumn<String>(
      'last_error', aliasedName, true,
      type: DriftSqlType.string, requiredDuringInsert: false);
  static const VerificationMeta _capturedAtMeta =
      const VerificationMeta('capturedAt');
  @override
  late final GeneratedColumn<DateTime> capturedAt = GeneratedColumn<DateTime>(
      'captured_at', aliasedName, false,
      type: DriftSqlType.dateTime, requiredDuringInsert: true);
  static const VerificationMeta _uploadedAtMeta =
      const VerificationMeta('uploadedAt');
  @override
  late final GeneratedColumn<DateTime> uploadedAt = GeneratedColumn<DateTime>(
      'uploaded_at', aliasedName, true,
      type: DriftSqlType.dateTime, requiredDuringInsert: false);
  @override
  List<GeneratedColumn> get $columns => [
        id,
        commandId,
        fieldKey,
        orderIndex,
        localPath,
        fileName,
        sizeBytes,
        mimeType,
        checksum,
        bucket,
        remotePath,
        remoteRef,
        state,
        attempts,
        lastError,
        capturedAt,
        uploadedAt
      ];
  @override
  String get aliasedName => _alias ?? actualTableName;
  @override
  String get actualTableName => $name;
  static const String $name = 'pending_media_uploads';
  @override
  VerificationContext validateIntegrity(Insertable<PendingMediaUpload> instance,
      {bool isInserting = false}) {
    final context = VerificationContext();
    final data = instance.toColumns(true);
    if (data.containsKey('id')) {
      context.handle(_idMeta, id.isAcceptableOrUnknown(data['id']!, _idMeta));
    } else if (isInserting) {
      context.missing(_idMeta);
    }
    if (data.containsKey('command_id')) {
      context.handle(_commandIdMeta,
          commandId.isAcceptableOrUnknown(data['command_id']!, _commandIdMeta));
    } else if (isInserting) {
      context.missing(_commandIdMeta);
    }
    if (data.containsKey('field_key')) {
      context.handle(_fieldKeyMeta,
          fieldKey.isAcceptableOrUnknown(data['field_key']!, _fieldKeyMeta));
    }
    if (data.containsKey('order_index')) {
      context.handle(
          _orderIndexMeta,
          orderIndex.isAcceptableOrUnknown(
              data['order_index']!, _orderIndexMeta));
    } else if (isInserting) {
      context.missing(_orderIndexMeta);
    }
    if (data.containsKey('local_path')) {
      context.handle(_localPathMeta,
          localPath.isAcceptableOrUnknown(data['local_path']!, _localPathMeta));
    } else if (isInserting) {
      context.missing(_localPathMeta);
    }
    if (data.containsKey('file_name')) {
      context.handle(_fileNameMeta,
          fileName.isAcceptableOrUnknown(data['file_name']!, _fileNameMeta));
    } else if (isInserting) {
      context.missing(_fileNameMeta);
    }
    if (data.containsKey('size_bytes')) {
      context.handle(_sizeBytesMeta,
          sizeBytes.isAcceptableOrUnknown(data['size_bytes']!, _sizeBytesMeta));
    }
    if (data.containsKey('mime_type')) {
      context.handle(_mimeTypeMeta,
          mimeType.isAcceptableOrUnknown(data['mime_type']!, _mimeTypeMeta));
    }
    if (data.containsKey('checksum')) {
      context.handle(_checksumMeta,
          checksum.isAcceptableOrUnknown(data['checksum']!, _checksumMeta));
    }
    if (data.containsKey('bucket')) {
      context.handle(_bucketMeta,
          bucket.isAcceptableOrUnknown(data['bucket']!, _bucketMeta));
    }
    if (data.containsKey('remote_path')) {
      context.handle(
          _remotePathMeta,
          remotePath.isAcceptableOrUnknown(
              data['remote_path']!, _remotePathMeta));
    }
    if (data.containsKey('remote_ref')) {
      context.handle(_remoteRefMeta,
          remoteRef.isAcceptableOrUnknown(data['remote_ref']!, _remoteRefMeta));
    }
    if (data.containsKey('state')) {
      context.handle(
          _stateMeta, state.isAcceptableOrUnknown(data['state']!, _stateMeta));
    } else if (isInserting) {
      context.missing(_stateMeta);
    }
    if (data.containsKey('attempts')) {
      context.handle(_attemptsMeta,
          attempts.isAcceptableOrUnknown(data['attempts']!, _attemptsMeta));
    }
    if (data.containsKey('last_error')) {
      context.handle(_lastErrorMeta,
          lastError.isAcceptableOrUnknown(data['last_error']!, _lastErrorMeta));
    }
    if (data.containsKey('captured_at')) {
      context.handle(
          _capturedAtMeta,
          capturedAt.isAcceptableOrUnknown(
              data['captured_at']!, _capturedAtMeta));
    } else if (isInserting) {
      context.missing(_capturedAtMeta);
    }
    if (data.containsKey('uploaded_at')) {
      context.handle(
          _uploadedAtMeta,
          uploadedAt.isAcceptableOrUnknown(
              data['uploaded_at']!, _uploadedAtMeta));
    }
    return context;
  }

  @override
  Set<GeneratedColumn> get $primaryKey => {id};
  @override
  PendingMediaUpload map(Map<String, dynamic> data, {String? tablePrefix}) {
    final effectivePrefix = tablePrefix != null ? '$tablePrefix.' : '';
    return PendingMediaUpload(
      id: attachedDatabase.typeMapping
          .read(DriftSqlType.string, data['${effectivePrefix}id'])!,
      commandId: attachedDatabase.typeMapping
          .read(DriftSqlType.string, data['${effectivePrefix}command_id'])!,
      fieldKey: attachedDatabase.typeMapping
          .read(DriftSqlType.string, data['${effectivePrefix}field_key']),
      orderIndex: attachedDatabase.typeMapping
          .read(DriftSqlType.int, data['${effectivePrefix}order_index'])!,
      localPath: attachedDatabase.typeMapping
          .read(DriftSqlType.string, data['${effectivePrefix}local_path'])!,
      fileName: attachedDatabase.typeMapping
          .read(DriftSqlType.string, data['${effectivePrefix}file_name'])!,
      sizeBytes: attachedDatabase.typeMapping
          .read(DriftSqlType.int, data['${effectivePrefix}size_bytes']),
      mimeType: attachedDatabase.typeMapping
          .read(DriftSqlType.string, data['${effectivePrefix}mime_type']),
      checksum: attachedDatabase.typeMapping
          .read(DriftSqlType.string, data['${effectivePrefix}checksum']),
      bucket: attachedDatabase.typeMapping
          .read(DriftSqlType.string, data['${effectivePrefix}bucket']),
      remotePath: attachedDatabase.typeMapping
          .read(DriftSqlType.string, data['${effectivePrefix}remote_path']),
      remoteRef: attachedDatabase.typeMapping
          .read(DriftSqlType.string, data['${effectivePrefix}remote_ref']),
      state: attachedDatabase.typeMapping
          .read(DriftSqlType.string, data['${effectivePrefix}state'])!,
      attempts: attachedDatabase.typeMapping
          .read(DriftSqlType.int, data['${effectivePrefix}attempts'])!,
      lastError: attachedDatabase.typeMapping
          .read(DriftSqlType.string, data['${effectivePrefix}last_error']),
      capturedAt: attachedDatabase.typeMapping
          .read(DriftSqlType.dateTime, data['${effectivePrefix}captured_at'])!,
      uploadedAt: attachedDatabase.typeMapping
          .read(DriftSqlType.dateTime, data['${effectivePrefix}uploaded_at']),
    );
  }

  @override
  $PendingMediaUploadsTable createAlias(String alias) {
    return $PendingMediaUploadsTable(attachedDatabase, alias);
  }
}

class PendingMediaUpload extends DataClass
    implements Insertable<PendingMediaUpload> {
  final String id;

  /// ON DELETE RESTRICT rather than CASCADE, and that is the whole point.
  ///
  /// A command row cannot be deleted while media rows still reference it, so
  /// the pruner physically cannot remove the queue entry that is the only thing
  /// keeping a photo's file alive. The deletion order is forced: verify the
  /// media, delete the media rows and their files, then delete the command.
  ///
  /// This is inert without `PRAGMA foreign_keys = ON`, which the database's
  /// `beforeOpen` sets on every connection.
  final String commandId;

  /// Checklist field id, or tyre position, or null for a flat list. Photos are
  /// a keyed MAP for checklists and a flat ARRAY elsewhere; code that assumes
  /// one shape silently skips the other.
  final String? fieldKey;

  /// Position within its field. Rebuilding the keyed map in the right order
  /// depends on this.
  final int orderIndex;

  /// Absolute `file://` path in the queue media folder. Never a path in the OS
  /// cache directory: Android and iOS may purge that at any moment, so a queue
  /// that merely remembered the camera's path would come back holding dead
  /// URIs. Copy first, enqueue second.
  final String localPath;

  /// Basename, for iOS container healing and for the sweep. Unique, which is
  /// what turns the orphan sweep into a join instead of a directory listing
  /// compared against an in-memory set.
  final String fileName;
  final int? sizeBytes;
  final String? mimeType;

  /// MD5 where readable, else `size:mtime`.
  final String? checksum;

  /// `tyre-photos` or `accident-photos`.
  final String? bucket;
  final String? remotePath;

  /// `tp-storage://<bucket>/<path>`.
  final String? remoteRef;

  /// One of MediaUploadState. The local file may only be deleted in
  /// `verified`.
  final String state;
  final int attempts;
  final String? lastError;
  final DateTime capturedAt;
  final DateTime? uploadedAt;
  const PendingMediaUpload(
      {required this.id,
      required this.commandId,
      this.fieldKey,
      required this.orderIndex,
      required this.localPath,
      required this.fileName,
      this.sizeBytes,
      this.mimeType,
      this.checksum,
      this.bucket,
      this.remotePath,
      this.remoteRef,
      required this.state,
      required this.attempts,
      this.lastError,
      required this.capturedAt,
      this.uploadedAt});
  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    map['id'] = Variable<String>(id);
    map['command_id'] = Variable<String>(commandId);
    if (!nullToAbsent || fieldKey != null) {
      map['field_key'] = Variable<String>(fieldKey);
    }
    map['order_index'] = Variable<int>(orderIndex);
    map['local_path'] = Variable<String>(localPath);
    map['file_name'] = Variable<String>(fileName);
    if (!nullToAbsent || sizeBytes != null) {
      map['size_bytes'] = Variable<int>(sizeBytes);
    }
    if (!nullToAbsent || mimeType != null) {
      map['mime_type'] = Variable<String>(mimeType);
    }
    if (!nullToAbsent || checksum != null) {
      map['checksum'] = Variable<String>(checksum);
    }
    if (!nullToAbsent || bucket != null) {
      map['bucket'] = Variable<String>(bucket);
    }
    if (!nullToAbsent || remotePath != null) {
      map['remote_path'] = Variable<String>(remotePath);
    }
    if (!nullToAbsent || remoteRef != null) {
      map['remote_ref'] = Variable<String>(remoteRef);
    }
    map['state'] = Variable<String>(state);
    map['attempts'] = Variable<int>(attempts);
    if (!nullToAbsent || lastError != null) {
      map['last_error'] = Variable<String>(lastError);
    }
    map['captured_at'] = Variable<DateTime>(capturedAt);
    if (!nullToAbsent || uploadedAt != null) {
      map['uploaded_at'] = Variable<DateTime>(uploadedAt);
    }
    return map;
  }

  PendingMediaUploadsCompanion toCompanion(bool nullToAbsent) {
    return PendingMediaUploadsCompanion(
      id: Value(id),
      commandId: Value(commandId),
      fieldKey: fieldKey == null && nullToAbsent
          ? const Value.absent()
          : Value(fieldKey),
      orderIndex: Value(orderIndex),
      localPath: Value(localPath),
      fileName: Value(fileName),
      sizeBytes: sizeBytes == null && nullToAbsent
          ? const Value.absent()
          : Value(sizeBytes),
      mimeType: mimeType == null && nullToAbsent
          ? const Value.absent()
          : Value(mimeType),
      checksum: checksum == null && nullToAbsent
          ? const Value.absent()
          : Value(checksum),
      bucket:
          bucket == null && nullToAbsent ? const Value.absent() : Value(bucket),
      remotePath: remotePath == null && nullToAbsent
          ? const Value.absent()
          : Value(remotePath),
      remoteRef: remoteRef == null && nullToAbsent
          ? const Value.absent()
          : Value(remoteRef),
      state: Value(state),
      attempts: Value(attempts),
      lastError: lastError == null && nullToAbsent
          ? const Value.absent()
          : Value(lastError),
      capturedAt: Value(capturedAt),
      uploadedAt: uploadedAt == null && nullToAbsent
          ? const Value.absent()
          : Value(uploadedAt),
    );
  }

  factory PendingMediaUpload.fromJson(Map<String, dynamic> json,
      {ValueSerializer? serializer}) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return PendingMediaUpload(
      id: serializer.fromJson<String>(json['id']),
      commandId: serializer.fromJson<String>(json['commandId']),
      fieldKey: serializer.fromJson<String?>(json['fieldKey']),
      orderIndex: serializer.fromJson<int>(json['orderIndex']),
      localPath: serializer.fromJson<String>(json['localPath']),
      fileName: serializer.fromJson<String>(json['fileName']),
      sizeBytes: serializer.fromJson<int?>(json['sizeBytes']),
      mimeType: serializer.fromJson<String?>(json['mimeType']),
      checksum: serializer.fromJson<String?>(json['checksum']),
      bucket: serializer.fromJson<String?>(json['bucket']),
      remotePath: serializer.fromJson<String?>(json['remotePath']),
      remoteRef: serializer.fromJson<String?>(json['remoteRef']),
      state: serializer.fromJson<String>(json['state']),
      attempts: serializer.fromJson<int>(json['attempts']),
      lastError: serializer.fromJson<String?>(json['lastError']),
      capturedAt: serializer.fromJson<DateTime>(json['capturedAt']),
      uploadedAt: serializer.fromJson<DateTime?>(json['uploadedAt']),
    );
  }
  @override
  Map<String, dynamic> toJson({ValueSerializer? serializer}) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return <String, dynamic>{
      'id': serializer.toJson<String>(id),
      'commandId': serializer.toJson<String>(commandId),
      'fieldKey': serializer.toJson<String?>(fieldKey),
      'orderIndex': serializer.toJson<int>(orderIndex),
      'localPath': serializer.toJson<String>(localPath),
      'fileName': serializer.toJson<String>(fileName),
      'sizeBytes': serializer.toJson<int?>(sizeBytes),
      'mimeType': serializer.toJson<String?>(mimeType),
      'checksum': serializer.toJson<String?>(checksum),
      'bucket': serializer.toJson<String?>(bucket),
      'remotePath': serializer.toJson<String?>(remotePath),
      'remoteRef': serializer.toJson<String?>(remoteRef),
      'state': serializer.toJson<String>(state),
      'attempts': serializer.toJson<int>(attempts),
      'lastError': serializer.toJson<String?>(lastError),
      'capturedAt': serializer.toJson<DateTime>(capturedAt),
      'uploadedAt': serializer.toJson<DateTime?>(uploadedAt),
    };
  }

  PendingMediaUpload copyWith(
          {String? id,
          String? commandId,
          Value<String?> fieldKey = const Value.absent(),
          int? orderIndex,
          String? localPath,
          String? fileName,
          Value<int?> sizeBytes = const Value.absent(),
          Value<String?> mimeType = const Value.absent(),
          Value<String?> checksum = const Value.absent(),
          Value<String?> bucket = const Value.absent(),
          Value<String?> remotePath = const Value.absent(),
          Value<String?> remoteRef = const Value.absent(),
          String? state,
          int? attempts,
          Value<String?> lastError = const Value.absent(),
          DateTime? capturedAt,
          Value<DateTime?> uploadedAt = const Value.absent()}) =>
      PendingMediaUpload(
        id: id ?? this.id,
        commandId: commandId ?? this.commandId,
        fieldKey: fieldKey.present ? fieldKey.value : this.fieldKey,
        orderIndex: orderIndex ?? this.orderIndex,
        localPath: localPath ?? this.localPath,
        fileName: fileName ?? this.fileName,
        sizeBytes: sizeBytes.present ? sizeBytes.value : this.sizeBytes,
        mimeType: mimeType.present ? mimeType.value : this.mimeType,
        checksum: checksum.present ? checksum.value : this.checksum,
        bucket: bucket.present ? bucket.value : this.bucket,
        remotePath: remotePath.present ? remotePath.value : this.remotePath,
        remoteRef: remoteRef.present ? remoteRef.value : this.remoteRef,
        state: state ?? this.state,
        attempts: attempts ?? this.attempts,
        lastError: lastError.present ? lastError.value : this.lastError,
        capturedAt: capturedAt ?? this.capturedAt,
        uploadedAt: uploadedAt.present ? uploadedAt.value : this.uploadedAt,
      );
  PendingMediaUpload copyWithCompanion(PendingMediaUploadsCompanion data) {
    return PendingMediaUpload(
      id: data.id.present ? data.id.value : this.id,
      commandId: data.commandId.present ? data.commandId.value : this.commandId,
      fieldKey: data.fieldKey.present ? data.fieldKey.value : this.fieldKey,
      orderIndex:
          data.orderIndex.present ? data.orderIndex.value : this.orderIndex,
      localPath: data.localPath.present ? data.localPath.value : this.localPath,
      fileName: data.fileName.present ? data.fileName.value : this.fileName,
      sizeBytes: data.sizeBytes.present ? data.sizeBytes.value : this.sizeBytes,
      mimeType: data.mimeType.present ? data.mimeType.value : this.mimeType,
      checksum: data.checksum.present ? data.checksum.value : this.checksum,
      bucket: data.bucket.present ? data.bucket.value : this.bucket,
      remotePath:
          data.remotePath.present ? data.remotePath.value : this.remotePath,
      remoteRef: data.remoteRef.present ? data.remoteRef.value : this.remoteRef,
      state: data.state.present ? data.state.value : this.state,
      attempts: data.attempts.present ? data.attempts.value : this.attempts,
      lastError: data.lastError.present ? data.lastError.value : this.lastError,
      capturedAt:
          data.capturedAt.present ? data.capturedAt.value : this.capturedAt,
      uploadedAt:
          data.uploadedAt.present ? data.uploadedAt.value : this.uploadedAt,
    );
  }

  @override
  String toString() {
    return (StringBuffer('PendingMediaUpload(')
          ..write('id: $id, ')
          ..write('commandId: $commandId, ')
          ..write('fieldKey: $fieldKey, ')
          ..write('orderIndex: $orderIndex, ')
          ..write('localPath: $localPath, ')
          ..write('fileName: $fileName, ')
          ..write('sizeBytes: $sizeBytes, ')
          ..write('mimeType: $mimeType, ')
          ..write('checksum: $checksum, ')
          ..write('bucket: $bucket, ')
          ..write('remotePath: $remotePath, ')
          ..write('remoteRef: $remoteRef, ')
          ..write('state: $state, ')
          ..write('attempts: $attempts, ')
          ..write('lastError: $lastError, ')
          ..write('capturedAt: $capturedAt, ')
          ..write('uploadedAt: $uploadedAt')
          ..write(')'))
        .toString();
  }

  @override
  int get hashCode => Object.hash(
      id,
      commandId,
      fieldKey,
      orderIndex,
      localPath,
      fileName,
      sizeBytes,
      mimeType,
      checksum,
      bucket,
      remotePath,
      remoteRef,
      state,
      attempts,
      lastError,
      capturedAt,
      uploadedAt);
  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      (other is PendingMediaUpload &&
          other.id == this.id &&
          other.commandId == this.commandId &&
          other.fieldKey == this.fieldKey &&
          other.orderIndex == this.orderIndex &&
          other.localPath == this.localPath &&
          other.fileName == this.fileName &&
          other.sizeBytes == this.sizeBytes &&
          other.mimeType == this.mimeType &&
          other.checksum == this.checksum &&
          other.bucket == this.bucket &&
          other.remotePath == this.remotePath &&
          other.remoteRef == this.remoteRef &&
          other.state == this.state &&
          other.attempts == this.attempts &&
          other.lastError == this.lastError &&
          other.capturedAt == this.capturedAt &&
          other.uploadedAt == this.uploadedAt);
}

class PendingMediaUploadsCompanion extends UpdateCompanion<PendingMediaUpload> {
  final Value<String> id;
  final Value<String> commandId;
  final Value<String?> fieldKey;
  final Value<int> orderIndex;
  final Value<String> localPath;
  final Value<String> fileName;
  final Value<int?> sizeBytes;
  final Value<String?> mimeType;
  final Value<String?> checksum;
  final Value<String?> bucket;
  final Value<String?> remotePath;
  final Value<String?> remoteRef;
  final Value<String> state;
  final Value<int> attempts;
  final Value<String?> lastError;
  final Value<DateTime> capturedAt;
  final Value<DateTime?> uploadedAt;
  final Value<int> rowid;
  const PendingMediaUploadsCompanion({
    this.id = const Value.absent(),
    this.commandId = const Value.absent(),
    this.fieldKey = const Value.absent(),
    this.orderIndex = const Value.absent(),
    this.localPath = const Value.absent(),
    this.fileName = const Value.absent(),
    this.sizeBytes = const Value.absent(),
    this.mimeType = const Value.absent(),
    this.checksum = const Value.absent(),
    this.bucket = const Value.absent(),
    this.remotePath = const Value.absent(),
    this.remoteRef = const Value.absent(),
    this.state = const Value.absent(),
    this.attempts = const Value.absent(),
    this.lastError = const Value.absent(),
    this.capturedAt = const Value.absent(),
    this.uploadedAt = const Value.absent(),
    this.rowid = const Value.absent(),
  });
  PendingMediaUploadsCompanion.insert({
    required String id,
    required String commandId,
    this.fieldKey = const Value.absent(),
    required int orderIndex,
    required String localPath,
    required String fileName,
    this.sizeBytes = const Value.absent(),
    this.mimeType = const Value.absent(),
    this.checksum = const Value.absent(),
    this.bucket = const Value.absent(),
    this.remotePath = const Value.absent(),
    this.remoteRef = const Value.absent(),
    required String state,
    this.attempts = const Value.absent(),
    this.lastError = const Value.absent(),
    required DateTime capturedAt,
    this.uploadedAt = const Value.absent(),
    this.rowid = const Value.absent(),
  })  : id = Value(id),
        commandId = Value(commandId),
        orderIndex = Value(orderIndex),
        localPath = Value(localPath),
        fileName = Value(fileName),
        state = Value(state),
        capturedAt = Value(capturedAt);
  static Insertable<PendingMediaUpload> custom({
    Expression<String>? id,
    Expression<String>? commandId,
    Expression<String>? fieldKey,
    Expression<int>? orderIndex,
    Expression<String>? localPath,
    Expression<String>? fileName,
    Expression<int>? sizeBytes,
    Expression<String>? mimeType,
    Expression<String>? checksum,
    Expression<String>? bucket,
    Expression<String>? remotePath,
    Expression<String>? remoteRef,
    Expression<String>? state,
    Expression<int>? attempts,
    Expression<String>? lastError,
    Expression<DateTime>? capturedAt,
    Expression<DateTime>? uploadedAt,
    Expression<int>? rowid,
  }) {
    return RawValuesInsertable({
      if (id != null) 'id': id,
      if (commandId != null) 'command_id': commandId,
      if (fieldKey != null) 'field_key': fieldKey,
      if (orderIndex != null) 'order_index': orderIndex,
      if (localPath != null) 'local_path': localPath,
      if (fileName != null) 'file_name': fileName,
      if (sizeBytes != null) 'size_bytes': sizeBytes,
      if (mimeType != null) 'mime_type': mimeType,
      if (checksum != null) 'checksum': checksum,
      if (bucket != null) 'bucket': bucket,
      if (remotePath != null) 'remote_path': remotePath,
      if (remoteRef != null) 'remote_ref': remoteRef,
      if (state != null) 'state': state,
      if (attempts != null) 'attempts': attempts,
      if (lastError != null) 'last_error': lastError,
      if (capturedAt != null) 'captured_at': capturedAt,
      if (uploadedAt != null) 'uploaded_at': uploadedAt,
      if (rowid != null) 'rowid': rowid,
    });
  }

  PendingMediaUploadsCompanion copyWith(
      {Value<String>? id,
      Value<String>? commandId,
      Value<String?>? fieldKey,
      Value<int>? orderIndex,
      Value<String>? localPath,
      Value<String>? fileName,
      Value<int?>? sizeBytes,
      Value<String?>? mimeType,
      Value<String?>? checksum,
      Value<String?>? bucket,
      Value<String?>? remotePath,
      Value<String?>? remoteRef,
      Value<String>? state,
      Value<int>? attempts,
      Value<String?>? lastError,
      Value<DateTime>? capturedAt,
      Value<DateTime?>? uploadedAt,
      Value<int>? rowid}) {
    return PendingMediaUploadsCompanion(
      id: id ?? this.id,
      commandId: commandId ?? this.commandId,
      fieldKey: fieldKey ?? this.fieldKey,
      orderIndex: orderIndex ?? this.orderIndex,
      localPath: localPath ?? this.localPath,
      fileName: fileName ?? this.fileName,
      sizeBytes: sizeBytes ?? this.sizeBytes,
      mimeType: mimeType ?? this.mimeType,
      checksum: checksum ?? this.checksum,
      bucket: bucket ?? this.bucket,
      remotePath: remotePath ?? this.remotePath,
      remoteRef: remoteRef ?? this.remoteRef,
      state: state ?? this.state,
      attempts: attempts ?? this.attempts,
      lastError: lastError ?? this.lastError,
      capturedAt: capturedAt ?? this.capturedAt,
      uploadedAt: uploadedAt ?? this.uploadedAt,
      rowid: rowid ?? this.rowid,
    );
  }

  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    if (id.present) {
      map['id'] = Variable<String>(id.value);
    }
    if (commandId.present) {
      map['command_id'] = Variable<String>(commandId.value);
    }
    if (fieldKey.present) {
      map['field_key'] = Variable<String>(fieldKey.value);
    }
    if (orderIndex.present) {
      map['order_index'] = Variable<int>(orderIndex.value);
    }
    if (localPath.present) {
      map['local_path'] = Variable<String>(localPath.value);
    }
    if (fileName.present) {
      map['file_name'] = Variable<String>(fileName.value);
    }
    if (sizeBytes.present) {
      map['size_bytes'] = Variable<int>(sizeBytes.value);
    }
    if (mimeType.present) {
      map['mime_type'] = Variable<String>(mimeType.value);
    }
    if (checksum.present) {
      map['checksum'] = Variable<String>(checksum.value);
    }
    if (bucket.present) {
      map['bucket'] = Variable<String>(bucket.value);
    }
    if (remotePath.present) {
      map['remote_path'] = Variable<String>(remotePath.value);
    }
    if (remoteRef.present) {
      map['remote_ref'] = Variable<String>(remoteRef.value);
    }
    if (state.present) {
      map['state'] = Variable<String>(state.value);
    }
    if (attempts.present) {
      map['attempts'] = Variable<int>(attempts.value);
    }
    if (lastError.present) {
      map['last_error'] = Variable<String>(lastError.value);
    }
    if (capturedAt.present) {
      map['captured_at'] = Variable<DateTime>(capturedAt.value);
    }
    if (uploadedAt.present) {
      map['uploaded_at'] = Variable<DateTime>(uploadedAt.value);
    }
    if (rowid.present) {
      map['rowid'] = Variable<int>(rowid.value);
    }
    return map;
  }

  @override
  String toString() {
    return (StringBuffer('PendingMediaUploadsCompanion(')
          ..write('id: $id, ')
          ..write('commandId: $commandId, ')
          ..write('fieldKey: $fieldKey, ')
          ..write('orderIndex: $orderIndex, ')
          ..write('localPath: $localPath, ')
          ..write('fileName: $fileName, ')
          ..write('sizeBytes: $sizeBytes, ')
          ..write('mimeType: $mimeType, ')
          ..write('checksum: $checksum, ')
          ..write('bucket: $bucket, ')
          ..write('remotePath: $remotePath, ')
          ..write('remoteRef: $remoteRef, ')
          ..write('state: $state, ')
          ..write('attempts: $attempts, ')
          ..write('lastError: $lastError, ')
          ..write('capturedAt: $capturedAt, ')
          ..write('uploadedAt: $uploadedAt, ')
          ..write('rowid: $rowid')
          ..write(')'))
        .toString();
  }
}

class $SyncFailuresTable extends SyncFailures
    with TableInfo<$SyncFailuresTable, SyncFailure> {
  @override
  final GeneratedDatabase attachedDatabase;
  final String? _alias;
  $SyncFailuresTable(this.attachedDatabase, [this._alias]);
  static const VerificationMeta _idMeta = const VerificationMeta('id');
  @override
  late final GeneratedColumn<String> id = GeneratedColumn<String>(
      'id', aliasedName, false,
      type: DriftSqlType.string, requiredDuringInsert: true);
  static const VerificationMeta _commandIdMeta =
      const VerificationMeta('commandId');
  @override
  late final GeneratedColumn<String> commandId = GeneratedColumn<String>(
      'command_id', aliasedName, true,
      type: DriftSqlType.string, requiredDuringInsert: false);
  static const VerificationMeta _commandTypeMeta =
      const VerificationMeta('commandType');
  @override
  late final GeneratedColumn<String> commandType = GeneratedColumn<String>(
      'command_type', aliasedName, true,
      type: DriftSqlType.string, requiredDuringInsert: false);
  static const VerificationMeta _entityTypeMeta =
      const VerificationMeta('entityType');
  @override
  late final GeneratedColumn<String> entityType = GeneratedColumn<String>(
      'entity_type', aliasedName, true,
      type: DriftSqlType.string, requiredDuringInsert: false);
  static const VerificationMeta _workspaceIdMeta =
      const VerificationMeta('workspaceId');
  @override
  late final GeneratedColumn<String> workspaceId = GeneratedColumn<String>(
      'workspace_id', aliasedName, true,
      type: DriftSqlType.string, requiredDuringInsert: false);
  static const VerificationMeta _occurredAtMeta =
      const VerificationMeta('occurredAt');
  @override
  late final GeneratedColumn<DateTime> occurredAt = GeneratedColumn<DateTime>(
      'occurred_at', aliasedName, false,
      type: DriftSqlType.dateTime, requiredDuringInsert: true);
  static const VerificationMeta _attemptMeta =
      const VerificationMeta('attempt');
  @override
  late final GeneratedColumn<int> attempt = GeneratedColumn<int>(
      'attempt', aliasedName, false,
      type: DriftSqlType.int, requiredDuringInsert: true);
  static const VerificationMeta _errorCodeMeta =
      const VerificationMeta('errorCode');
  @override
  late final GeneratedColumn<String> errorCode = GeneratedColumn<String>(
      'error_code', aliasedName, true,
      type: DriftSqlType.string, requiredDuringInsert: false);
  static const VerificationMeta _errorClassMeta =
      const VerificationMeta('errorClass');
  @override
  late final GeneratedColumn<String> errorClass = GeneratedColumn<String>(
      'error_class', aliasedName, false,
      type: DriftSqlType.string, requiredDuringInsert: true);
  static const VerificationMeta _messageSafeMeta =
      const VerificationMeta('messageSafe');
  @override
  late final GeneratedColumn<String> messageSafe = GeneratedColumn<String>(
      'message_safe', aliasedName, true,
      type: DriftSqlType.string, requiredDuringInsert: false);
  static const VerificationMeta _payloadSnapshotJsonMeta =
      const VerificationMeta('payloadSnapshotJson');
  @override
  late final GeneratedColumn<String> payloadSnapshotJson =
      GeneratedColumn<String>('payload_snapshot_json', aliasedName, true,
          type: DriftSqlType.string, requiredDuringInsert: false);
  @override
  List<GeneratedColumn> get $columns => [
        id,
        commandId,
        commandType,
        entityType,
        workspaceId,
        occurredAt,
        attempt,
        errorCode,
        errorClass,
        messageSafe,
        payloadSnapshotJson
      ];
  @override
  String get aliasedName => _alias ?? actualTableName;
  @override
  String get actualTableName => $name;
  static const String $name = 'sync_failures';
  @override
  VerificationContext validateIntegrity(Insertable<SyncFailure> instance,
      {bool isInserting = false}) {
    final context = VerificationContext();
    final data = instance.toColumns(true);
    if (data.containsKey('id')) {
      context.handle(_idMeta, id.isAcceptableOrUnknown(data['id']!, _idMeta));
    } else if (isInserting) {
      context.missing(_idMeta);
    }
    if (data.containsKey('command_id')) {
      context.handle(_commandIdMeta,
          commandId.isAcceptableOrUnknown(data['command_id']!, _commandIdMeta));
    }
    if (data.containsKey('command_type')) {
      context.handle(
          _commandTypeMeta,
          commandType.isAcceptableOrUnknown(
              data['command_type']!, _commandTypeMeta));
    }
    if (data.containsKey('entity_type')) {
      context.handle(
          _entityTypeMeta,
          entityType.isAcceptableOrUnknown(
              data['entity_type']!, _entityTypeMeta));
    }
    if (data.containsKey('workspace_id')) {
      context.handle(
          _workspaceIdMeta,
          workspaceId.isAcceptableOrUnknown(
              data['workspace_id']!, _workspaceIdMeta));
    }
    if (data.containsKey('occurred_at')) {
      context.handle(
          _occurredAtMeta,
          occurredAt.isAcceptableOrUnknown(
              data['occurred_at']!, _occurredAtMeta));
    } else if (isInserting) {
      context.missing(_occurredAtMeta);
    }
    if (data.containsKey('attempt')) {
      context.handle(_attemptMeta,
          attempt.isAcceptableOrUnknown(data['attempt']!, _attemptMeta));
    } else if (isInserting) {
      context.missing(_attemptMeta);
    }
    if (data.containsKey('error_code')) {
      context.handle(_errorCodeMeta,
          errorCode.isAcceptableOrUnknown(data['error_code']!, _errorCodeMeta));
    }
    if (data.containsKey('error_class')) {
      context.handle(
          _errorClassMeta,
          errorClass.isAcceptableOrUnknown(
              data['error_class']!, _errorClassMeta));
    } else if (isInserting) {
      context.missing(_errorClassMeta);
    }
    if (data.containsKey('message_safe')) {
      context.handle(
          _messageSafeMeta,
          messageSafe.isAcceptableOrUnknown(
              data['message_safe']!, _messageSafeMeta));
    }
    if (data.containsKey('payload_snapshot_json')) {
      context.handle(
          _payloadSnapshotJsonMeta,
          payloadSnapshotJson.isAcceptableOrUnknown(
              data['payload_snapshot_json']!, _payloadSnapshotJsonMeta));
    }
    return context;
  }

  @override
  Set<GeneratedColumn> get $primaryKey => {id};
  @override
  SyncFailure map(Map<String, dynamic> data, {String? tablePrefix}) {
    final effectivePrefix = tablePrefix != null ? '$tablePrefix.' : '';
    return SyncFailure(
      id: attachedDatabase.typeMapping
          .read(DriftSqlType.string, data['${effectivePrefix}id'])!,
      commandId: attachedDatabase.typeMapping
          .read(DriftSqlType.string, data['${effectivePrefix}command_id']),
      commandType: attachedDatabase.typeMapping
          .read(DriftSqlType.string, data['${effectivePrefix}command_type']),
      entityType: attachedDatabase.typeMapping
          .read(DriftSqlType.string, data['${effectivePrefix}entity_type']),
      workspaceId: attachedDatabase.typeMapping
          .read(DriftSqlType.string, data['${effectivePrefix}workspace_id']),
      occurredAt: attachedDatabase.typeMapping
          .read(DriftSqlType.dateTime, data['${effectivePrefix}occurred_at'])!,
      attempt: attachedDatabase.typeMapping
          .read(DriftSqlType.int, data['${effectivePrefix}attempt'])!,
      errorCode: attachedDatabase.typeMapping
          .read(DriftSqlType.string, data['${effectivePrefix}error_code']),
      errorClass: attachedDatabase.typeMapping
          .read(DriftSqlType.string, data['${effectivePrefix}error_class'])!,
      messageSafe: attachedDatabase.typeMapping
          .read(DriftSqlType.string, data['${effectivePrefix}message_safe']),
      payloadSnapshotJson: attachedDatabase.typeMapping.read(
          DriftSqlType.string, data['${effectivePrefix}payload_snapshot_json']),
    );
  }

  @override
  $SyncFailuresTable createAlias(String alias) {
    return $SyncFailuresTable(attachedDatabase, alias);
  }
}

class SyncFailure extends DataClass implements Insertable<SyncFailure> {
  final String id;

  /// Nullable: the command row may have been cleared. There is deliberately no
  /// foreign key, so the diagnosis outlives the thing it diagnoses.
  final String? commandId;
  final String? commandType;
  final String? entityType;
  final String? workspaceId;
  final DateTime occurredAt;
  final int attempt;

  /// PostgREST or Postgres code where available.
  final String? errorCode;

  /// One of SyncErrorClass. This, and never the message text, decides whether a
  /// retry happens.
  final String errorClass;

  /// Sanitised at WRITE time, not at display time, so a raw database message
  /// never lands on disk and cannot leak later through a log export or a
  /// support screenshot.
  final String? messageSafe;

  /// What was attempted.
  final String? payloadSnapshotJson;
  const SyncFailure(
      {required this.id,
      this.commandId,
      this.commandType,
      this.entityType,
      this.workspaceId,
      required this.occurredAt,
      required this.attempt,
      this.errorCode,
      required this.errorClass,
      this.messageSafe,
      this.payloadSnapshotJson});
  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    map['id'] = Variable<String>(id);
    if (!nullToAbsent || commandId != null) {
      map['command_id'] = Variable<String>(commandId);
    }
    if (!nullToAbsent || commandType != null) {
      map['command_type'] = Variable<String>(commandType);
    }
    if (!nullToAbsent || entityType != null) {
      map['entity_type'] = Variable<String>(entityType);
    }
    if (!nullToAbsent || workspaceId != null) {
      map['workspace_id'] = Variable<String>(workspaceId);
    }
    map['occurred_at'] = Variable<DateTime>(occurredAt);
    map['attempt'] = Variable<int>(attempt);
    if (!nullToAbsent || errorCode != null) {
      map['error_code'] = Variable<String>(errorCode);
    }
    map['error_class'] = Variable<String>(errorClass);
    if (!nullToAbsent || messageSafe != null) {
      map['message_safe'] = Variable<String>(messageSafe);
    }
    if (!nullToAbsent || payloadSnapshotJson != null) {
      map['payload_snapshot_json'] = Variable<String>(payloadSnapshotJson);
    }
    return map;
  }

  SyncFailuresCompanion toCompanion(bool nullToAbsent) {
    return SyncFailuresCompanion(
      id: Value(id),
      commandId: commandId == null && nullToAbsent
          ? const Value.absent()
          : Value(commandId),
      commandType: commandType == null && nullToAbsent
          ? const Value.absent()
          : Value(commandType),
      entityType: entityType == null && nullToAbsent
          ? const Value.absent()
          : Value(entityType),
      workspaceId: workspaceId == null && nullToAbsent
          ? const Value.absent()
          : Value(workspaceId),
      occurredAt: Value(occurredAt),
      attempt: Value(attempt),
      errorCode: errorCode == null && nullToAbsent
          ? const Value.absent()
          : Value(errorCode),
      errorClass: Value(errorClass),
      messageSafe: messageSafe == null && nullToAbsent
          ? const Value.absent()
          : Value(messageSafe),
      payloadSnapshotJson: payloadSnapshotJson == null && nullToAbsent
          ? const Value.absent()
          : Value(payloadSnapshotJson),
    );
  }

  factory SyncFailure.fromJson(Map<String, dynamic> json,
      {ValueSerializer? serializer}) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return SyncFailure(
      id: serializer.fromJson<String>(json['id']),
      commandId: serializer.fromJson<String?>(json['commandId']),
      commandType: serializer.fromJson<String?>(json['commandType']),
      entityType: serializer.fromJson<String?>(json['entityType']),
      workspaceId: serializer.fromJson<String?>(json['workspaceId']),
      occurredAt: serializer.fromJson<DateTime>(json['occurredAt']),
      attempt: serializer.fromJson<int>(json['attempt']),
      errorCode: serializer.fromJson<String?>(json['errorCode']),
      errorClass: serializer.fromJson<String>(json['errorClass']),
      messageSafe: serializer.fromJson<String?>(json['messageSafe']),
      payloadSnapshotJson:
          serializer.fromJson<String?>(json['payloadSnapshotJson']),
    );
  }
  @override
  Map<String, dynamic> toJson({ValueSerializer? serializer}) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return <String, dynamic>{
      'id': serializer.toJson<String>(id),
      'commandId': serializer.toJson<String?>(commandId),
      'commandType': serializer.toJson<String?>(commandType),
      'entityType': serializer.toJson<String?>(entityType),
      'workspaceId': serializer.toJson<String?>(workspaceId),
      'occurredAt': serializer.toJson<DateTime>(occurredAt),
      'attempt': serializer.toJson<int>(attempt),
      'errorCode': serializer.toJson<String?>(errorCode),
      'errorClass': serializer.toJson<String>(errorClass),
      'messageSafe': serializer.toJson<String?>(messageSafe),
      'payloadSnapshotJson': serializer.toJson<String?>(payloadSnapshotJson),
    };
  }

  SyncFailure copyWith(
          {String? id,
          Value<String?> commandId = const Value.absent(),
          Value<String?> commandType = const Value.absent(),
          Value<String?> entityType = const Value.absent(),
          Value<String?> workspaceId = const Value.absent(),
          DateTime? occurredAt,
          int? attempt,
          Value<String?> errorCode = const Value.absent(),
          String? errorClass,
          Value<String?> messageSafe = const Value.absent(),
          Value<String?> payloadSnapshotJson = const Value.absent()}) =>
      SyncFailure(
        id: id ?? this.id,
        commandId: commandId.present ? commandId.value : this.commandId,
        commandType: commandType.present ? commandType.value : this.commandType,
        entityType: entityType.present ? entityType.value : this.entityType,
        workspaceId: workspaceId.present ? workspaceId.value : this.workspaceId,
        occurredAt: occurredAt ?? this.occurredAt,
        attempt: attempt ?? this.attempt,
        errorCode: errorCode.present ? errorCode.value : this.errorCode,
        errorClass: errorClass ?? this.errorClass,
        messageSafe: messageSafe.present ? messageSafe.value : this.messageSafe,
        payloadSnapshotJson: payloadSnapshotJson.present
            ? payloadSnapshotJson.value
            : this.payloadSnapshotJson,
      );
  SyncFailure copyWithCompanion(SyncFailuresCompanion data) {
    return SyncFailure(
      id: data.id.present ? data.id.value : this.id,
      commandId: data.commandId.present ? data.commandId.value : this.commandId,
      commandType:
          data.commandType.present ? data.commandType.value : this.commandType,
      entityType:
          data.entityType.present ? data.entityType.value : this.entityType,
      workspaceId:
          data.workspaceId.present ? data.workspaceId.value : this.workspaceId,
      occurredAt:
          data.occurredAt.present ? data.occurredAt.value : this.occurredAt,
      attempt: data.attempt.present ? data.attempt.value : this.attempt,
      errorCode: data.errorCode.present ? data.errorCode.value : this.errorCode,
      errorClass:
          data.errorClass.present ? data.errorClass.value : this.errorClass,
      messageSafe:
          data.messageSafe.present ? data.messageSafe.value : this.messageSafe,
      payloadSnapshotJson: data.payloadSnapshotJson.present
          ? data.payloadSnapshotJson.value
          : this.payloadSnapshotJson,
    );
  }

  @override
  String toString() {
    return (StringBuffer('SyncFailure(')
          ..write('id: $id, ')
          ..write('commandId: $commandId, ')
          ..write('commandType: $commandType, ')
          ..write('entityType: $entityType, ')
          ..write('workspaceId: $workspaceId, ')
          ..write('occurredAt: $occurredAt, ')
          ..write('attempt: $attempt, ')
          ..write('errorCode: $errorCode, ')
          ..write('errorClass: $errorClass, ')
          ..write('messageSafe: $messageSafe, ')
          ..write('payloadSnapshotJson: $payloadSnapshotJson')
          ..write(')'))
        .toString();
  }

  @override
  int get hashCode => Object.hash(
      id,
      commandId,
      commandType,
      entityType,
      workspaceId,
      occurredAt,
      attempt,
      errorCode,
      errorClass,
      messageSafe,
      payloadSnapshotJson);
  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      (other is SyncFailure &&
          other.id == this.id &&
          other.commandId == this.commandId &&
          other.commandType == this.commandType &&
          other.entityType == this.entityType &&
          other.workspaceId == this.workspaceId &&
          other.occurredAt == this.occurredAt &&
          other.attempt == this.attempt &&
          other.errorCode == this.errorCode &&
          other.errorClass == this.errorClass &&
          other.messageSafe == this.messageSafe &&
          other.payloadSnapshotJson == this.payloadSnapshotJson);
}

class SyncFailuresCompanion extends UpdateCompanion<SyncFailure> {
  final Value<String> id;
  final Value<String?> commandId;
  final Value<String?> commandType;
  final Value<String?> entityType;
  final Value<String?> workspaceId;
  final Value<DateTime> occurredAt;
  final Value<int> attempt;
  final Value<String?> errorCode;
  final Value<String> errorClass;
  final Value<String?> messageSafe;
  final Value<String?> payloadSnapshotJson;
  final Value<int> rowid;
  const SyncFailuresCompanion({
    this.id = const Value.absent(),
    this.commandId = const Value.absent(),
    this.commandType = const Value.absent(),
    this.entityType = const Value.absent(),
    this.workspaceId = const Value.absent(),
    this.occurredAt = const Value.absent(),
    this.attempt = const Value.absent(),
    this.errorCode = const Value.absent(),
    this.errorClass = const Value.absent(),
    this.messageSafe = const Value.absent(),
    this.payloadSnapshotJson = const Value.absent(),
    this.rowid = const Value.absent(),
  });
  SyncFailuresCompanion.insert({
    required String id,
    this.commandId = const Value.absent(),
    this.commandType = const Value.absent(),
    this.entityType = const Value.absent(),
    this.workspaceId = const Value.absent(),
    required DateTime occurredAt,
    required int attempt,
    this.errorCode = const Value.absent(),
    required String errorClass,
    this.messageSafe = const Value.absent(),
    this.payloadSnapshotJson = const Value.absent(),
    this.rowid = const Value.absent(),
  })  : id = Value(id),
        occurredAt = Value(occurredAt),
        attempt = Value(attempt),
        errorClass = Value(errorClass);
  static Insertable<SyncFailure> custom({
    Expression<String>? id,
    Expression<String>? commandId,
    Expression<String>? commandType,
    Expression<String>? entityType,
    Expression<String>? workspaceId,
    Expression<DateTime>? occurredAt,
    Expression<int>? attempt,
    Expression<String>? errorCode,
    Expression<String>? errorClass,
    Expression<String>? messageSafe,
    Expression<String>? payloadSnapshotJson,
    Expression<int>? rowid,
  }) {
    return RawValuesInsertable({
      if (id != null) 'id': id,
      if (commandId != null) 'command_id': commandId,
      if (commandType != null) 'command_type': commandType,
      if (entityType != null) 'entity_type': entityType,
      if (workspaceId != null) 'workspace_id': workspaceId,
      if (occurredAt != null) 'occurred_at': occurredAt,
      if (attempt != null) 'attempt': attempt,
      if (errorCode != null) 'error_code': errorCode,
      if (errorClass != null) 'error_class': errorClass,
      if (messageSafe != null) 'message_safe': messageSafe,
      if (payloadSnapshotJson != null)
        'payload_snapshot_json': payloadSnapshotJson,
      if (rowid != null) 'rowid': rowid,
    });
  }

  SyncFailuresCompanion copyWith(
      {Value<String>? id,
      Value<String?>? commandId,
      Value<String?>? commandType,
      Value<String?>? entityType,
      Value<String?>? workspaceId,
      Value<DateTime>? occurredAt,
      Value<int>? attempt,
      Value<String?>? errorCode,
      Value<String>? errorClass,
      Value<String?>? messageSafe,
      Value<String?>? payloadSnapshotJson,
      Value<int>? rowid}) {
    return SyncFailuresCompanion(
      id: id ?? this.id,
      commandId: commandId ?? this.commandId,
      commandType: commandType ?? this.commandType,
      entityType: entityType ?? this.entityType,
      workspaceId: workspaceId ?? this.workspaceId,
      occurredAt: occurredAt ?? this.occurredAt,
      attempt: attempt ?? this.attempt,
      errorCode: errorCode ?? this.errorCode,
      errorClass: errorClass ?? this.errorClass,
      messageSafe: messageSafe ?? this.messageSafe,
      payloadSnapshotJson: payloadSnapshotJson ?? this.payloadSnapshotJson,
      rowid: rowid ?? this.rowid,
    );
  }

  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    if (id.present) {
      map['id'] = Variable<String>(id.value);
    }
    if (commandId.present) {
      map['command_id'] = Variable<String>(commandId.value);
    }
    if (commandType.present) {
      map['command_type'] = Variable<String>(commandType.value);
    }
    if (entityType.present) {
      map['entity_type'] = Variable<String>(entityType.value);
    }
    if (workspaceId.present) {
      map['workspace_id'] = Variable<String>(workspaceId.value);
    }
    if (occurredAt.present) {
      map['occurred_at'] = Variable<DateTime>(occurredAt.value);
    }
    if (attempt.present) {
      map['attempt'] = Variable<int>(attempt.value);
    }
    if (errorCode.present) {
      map['error_code'] = Variable<String>(errorCode.value);
    }
    if (errorClass.present) {
      map['error_class'] = Variable<String>(errorClass.value);
    }
    if (messageSafe.present) {
      map['message_safe'] = Variable<String>(messageSafe.value);
    }
    if (payloadSnapshotJson.present) {
      map['payload_snapshot_json'] =
          Variable<String>(payloadSnapshotJson.value);
    }
    if (rowid.present) {
      map['rowid'] = Variable<int>(rowid.value);
    }
    return map;
  }

  @override
  String toString() {
    return (StringBuffer('SyncFailuresCompanion(')
          ..write('id: $id, ')
          ..write('commandId: $commandId, ')
          ..write('commandType: $commandType, ')
          ..write('entityType: $entityType, ')
          ..write('workspaceId: $workspaceId, ')
          ..write('occurredAt: $occurredAt, ')
          ..write('attempt: $attempt, ')
          ..write('errorCode: $errorCode, ')
          ..write('errorClass: $errorClass, ')
          ..write('messageSafe: $messageSafe, ')
          ..write('payloadSnapshotJson: $payloadSnapshotJson, ')
          ..write('rowid: $rowid')
          ..write(')'))
        .toString();
  }
}

class $SyncMetadataTable extends SyncMetadata
    with TableInfo<$SyncMetadataTable, SyncMetadataEntry> {
  @override
  final GeneratedDatabase attachedDatabase;
  final String? _alias;
  $SyncMetadataTable(this.attachedDatabase, [this._alias]);
  static const VerificationMeta _keyMeta = const VerificationMeta('key');
  @override
  late final GeneratedColumn<String> key = GeneratedColumn<String>(
      'key', aliasedName, false,
      type: DriftSqlType.string, requiredDuringInsert: true);
  static const VerificationMeta _workspaceIdMeta =
      const VerificationMeta('workspaceId');
  @override
  late final GeneratedColumn<String> workspaceId = GeneratedColumn<String>(
      'workspace_id', aliasedName, true,
      type: DriftSqlType.string, requiredDuringInsert: false);
  static const VerificationMeta _valueJsonMeta =
      const VerificationMeta('valueJson');
  @override
  late final GeneratedColumn<String> valueJson = GeneratedColumn<String>(
      'value_json', aliasedName, false,
      type: DriftSqlType.string, requiredDuringInsert: true);
  static const VerificationMeta _updatedAtMeta =
      const VerificationMeta('updatedAt');
  @override
  late final GeneratedColumn<DateTime> updatedAt = GeneratedColumn<DateTime>(
      'updated_at', aliasedName, false,
      type: DriftSqlType.dateTime, requiredDuringInsert: true);
  @override
  List<GeneratedColumn> get $columns =>
      [key, workspaceId, valueJson, updatedAt];
  @override
  String get aliasedName => _alias ?? actualTableName;
  @override
  String get actualTableName => $name;
  static const String $name = 'sync_metadata';
  @override
  VerificationContext validateIntegrity(Insertable<SyncMetadataEntry> instance,
      {bool isInserting = false}) {
    final context = VerificationContext();
    final data = instance.toColumns(true);
    if (data.containsKey('key')) {
      context.handle(
          _keyMeta, key.isAcceptableOrUnknown(data['key']!, _keyMeta));
    } else if (isInserting) {
      context.missing(_keyMeta);
    }
    if (data.containsKey('workspace_id')) {
      context.handle(
          _workspaceIdMeta,
          workspaceId.isAcceptableOrUnknown(
              data['workspace_id']!, _workspaceIdMeta));
    }
    if (data.containsKey('value_json')) {
      context.handle(_valueJsonMeta,
          valueJson.isAcceptableOrUnknown(data['value_json']!, _valueJsonMeta));
    } else if (isInserting) {
      context.missing(_valueJsonMeta);
    }
    if (data.containsKey('updated_at')) {
      context.handle(_updatedAtMeta,
          updatedAt.isAcceptableOrUnknown(data['updated_at']!, _updatedAtMeta));
    } else if (isInserting) {
      context.missing(_updatedAtMeta);
    }
    return context;
  }

  @override
  Set<GeneratedColumn> get $primaryKey => {key};
  @override
  SyncMetadataEntry map(Map<String, dynamic> data, {String? tablePrefix}) {
    final effectivePrefix = tablePrefix != null ? '$tablePrefix.' : '';
    return SyncMetadataEntry(
      key: attachedDatabase.typeMapping
          .read(DriftSqlType.string, data['${effectivePrefix}key'])!,
      workspaceId: attachedDatabase.typeMapping
          .read(DriftSqlType.string, data['${effectivePrefix}workspace_id']),
      valueJson: attachedDatabase.typeMapping
          .read(DriftSqlType.string, data['${effectivePrefix}value_json'])!,
      updatedAt: attachedDatabase.typeMapping
          .read(DriftSqlType.dateTime, data['${effectivePrefix}updated_at'])!,
    );
  }

  @override
  $SyncMetadataTable createAlias(String alias) {
    return $SyncMetadataTable(attachedDatabase, alias);
  }
}

class SyncMetadataEntry extends DataClass
    implements Insertable<SyncMetadataEntry> {
  /// Built by SyncMetadataKeys, never typed at a call site: a near-miss
  /// spelling reads back as absent, which is indistinguishable from "never
  /// synced".
  final String key;

  /// Null for device-wide facts.
  final String? workspaceId;
  final String valueJson;
  final DateTime updatedAt;
  const SyncMetadataEntry(
      {required this.key,
      this.workspaceId,
      required this.valueJson,
      required this.updatedAt});
  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    map['key'] = Variable<String>(key);
    if (!nullToAbsent || workspaceId != null) {
      map['workspace_id'] = Variable<String>(workspaceId);
    }
    map['value_json'] = Variable<String>(valueJson);
    map['updated_at'] = Variable<DateTime>(updatedAt);
    return map;
  }

  SyncMetadataCompanion toCompanion(bool nullToAbsent) {
    return SyncMetadataCompanion(
      key: Value(key),
      workspaceId: workspaceId == null && nullToAbsent
          ? const Value.absent()
          : Value(workspaceId),
      valueJson: Value(valueJson),
      updatedAt: Value(updatedAt),
    );
  }

  factory SyncMetadataEntry.fromJson(Map<String, dynamic> json,
      {ValueSerializer? serializer}) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return SyncMetadataEntry(
      key: serializer.fromJson<String>(json['key']),
      workspaceId: serializer.fromJson<String?>(json['workspaceId']),
      valueJson: serializer.fromJson<String>(json['valueJson']),
      updatedAt: serializer.fromJson<DateTime>(json['updatedAt']),
    );
  }
  @override
  Map<String, dynamic> toJson({ValueSerializer? serializer}) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return <String, dynamic>{
      'key': serializer.toJson<String>(key),
      'workspaceId': serializer.toJson<String?>(workspaceId),
      'valueJson': serializer.toJson<String>(valueJson),
      'updatedAt': serializer.toJson<DateTime>(updatedAt),
    };
  }

  SyncMetadataEntry copyWith(
          {String? key,
          Value<String?> workspaceId = const Value.absent(),
          String? valueJson,
          DateTime? updatedAt}) =>
      SyncMetadataEntry(
        key: key ?? this.key,
        workspaceId: workspaceId.present ? workspaceId.value : this.workspaceId,
        valueJson: valueJson ?? this.valueJson,
        updatedAt: updatedAt ?? this.updatedAt,
      );
  SyncMetadataEntry copyWithCompanion(SyncMetadataCompanion data) {
    return SyncMetadataEntry(
      key: data.key.present ? data.key.value : this.key,
      workspaceId:
          data.workspaceId.present ? data.workspaceId.value : this.workspaceId,
      valueJson: data.valueJson.present ? data.valueJson.value : this.valueJson,
      updatedAt: data.updatedAt.present ? data.updatedAt.value : this.updatedAt,
    );
  }

  @override
  String toString() {
    return (StringBuffer('SyncMetadataEntry(')
          ..write('key: $key, ')
          ..write('workspaceId: $workspaceId, ')
          ..write('valueJson: $valueJson, ')
          ..write('updatedAt: $updatedAt')
          ..write(')'))
        .toString();
  }

  @override
  int get hashCode => Object.hash(key, workspaceId, valueJson, updatedAt);
  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      (other is SyncMetadataEntry &&
          other.key == this.key &&
          other.workspaceId == this.workspaceId &&
          other.valueJson == this.valueJson &&
          other.updatedAt == this.updatedAt);
}

class SyncMetadataCompanion extends UpdateCompanion<SyncMetadataEntry> {
  final Value<String> key;
  final Value<String?> workspaceId;
  final Value<String> valueJson;
  final Value<DateTime> updatedAt;
  final Value<int> rowid;
  const SyncMetadataCompanion({
    this.key = const Value.absent(),
    this.workspaceId = const Value.absent(),
    this.valueJson = const Value.absent(),
    this.updatedAt = const Value.absent(),
    this.rowid = const Value.absent(),
  });
  SyncMetadataCompanion.insert({
    required String key,
    this.workspaceId = const Value.absent(),
    required String valueJson,
    required DateTime updatedAt,
    this.rowid = const Value.absent(),
  })  : key = Value(key),
        valueJson = Value(valueJson),
        updatedAt = Value(updatedAt);
  static Insertable<SyncMetadataEntry> custom({
    Expression<String>? key,
    Expression<String>? workspaceId,
    Expression<String>? valueJson,
    Expression<DateTime>? updatedAt,
    Expression<int>? rowid,
  }) {
    return RawValuesInsertable({
      if (key != null) 'key': key,
      if (workspaceId != null) 'workspace_id': workspaceId,
      if (valueJson != null) 'value_json': valueJson,
      if (updatedAt != null) 'updated_at': updatedAt,
      if (rowid != null) 'rowid': rowid,
    });
  }

  SyncMetadataCompanion copyWith(
      {Value<String>? key,
      Value<String?>? workspaceId,
      Value<String>? valueJson,
      Value<DateTime>? updatedAt,
      Value<int>? rowid}) {
    return SyncMetadataCompanion(
      key: key ?? this.key,
      workspaceId: workspaceId ?? this.workspaceId,
      valueJson: valueJson ?? this.valueJson,
      updatedAt: updatedAt ?? this.updatedAt,
      rowid: rowid ?? this.rowid,
    );
  }

  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    if (key.present) {
      map['key'] = Variable<String>(key.value);
    }
    if (workspaceId.present) {
      map['workspace_id'] = Variable<String>(workspaceId.value);
    }
    if (valueJson.present) {
      map['value_json'] = Variable<String>(valueJson.value);
    }
    if (updatedAt.present) {
      map['updated_at'] = Variable<DateTime>(updatedAt.value);
    }
    if (rowid.present) {
      map['rowid'] = Variable<int>(rowid.value);
    }
    return map;
  }

  @override
  String toString() {
    return (StringBuffer('SyncMetadataCompanion(')
          ..write('key: $key, ')
          ..write('workspaceId: $workspaceId, ')
          ..write('valueJson: $valueJson, ')
          ..write('updatedAt: $updatedAt, ')
          ..write('rowid: $rowid')
          ..write(')'))
        .toString();
  }
}

class $RecentSearchesTable extends RecentSearches
    with TableInfo<$RecentSearchesTable, RecentSearch> {
  @override
  final GeneratedDatabase attachedDatabase;
  final String? _alias;
  $RecentSearchesTable(this.attachedDatabase, [this._alias]);
  static const VerificationMeta _idMeta = const VerificationMeta('id');
  @override
  late final GeneratedColumn<String> id = GeneratedColumn<String>(
      'id', aliasedName, false,
      type: DriftSqlType.string, requiredDuringInsert: true);
  static const VerificationMeta _userIdMeta = const VerificationMeta('userId');
  @override
  late final GeneratedColumn<String> userId = GeneratedColumn<String>(
      'user_id', aliasedName, false,
      type: DriftSqlType.string, requiredDuringInsert: true);
  static const VerificationMeta _workspaceIdMeta =
      const VerificationMeta('workspaceId');
  @override
  late final GeneratedColumn<String> workspaceId = GeneratedColumn<String>(
      'workspace_id', aliasedName, false,
      type: DriftSqlType.string, requiredDuringInsert: true);
  static const VerificationMeta _termMeta = const VerificationMeta('term');
  @override
  late final GeneratedColumn<String> term = GeneratedColumn<String>(
      'term', aliasedName, false,
      type: DriftSqlType.string, requiredDuringInsert: true);
  static const VerificationMeta _termNormMeta =
      const VerificationMeta('termNorm');
  @override
  late final GeneratedColumn<String> termNorm = GeneratedColumn<String>(
      'term_norm', aliasedName, false,
      type: DriftSqlType.string, requiredDuringInsert: true);
  static const VerificationMeta _resultKindMeta =
      const VerificationMeta('resultKind');
  @override
  late final GeneratedColumn<String> resultKind = GeneratedColumn<String>(
      'result_kind', aliasedName, true,
      type: DriftSqlType.string, requiredDuringInsert: false);
  static const VerificationMeta _resultIdMeta =
      const VerificationMeta('resultId');
  @override
  late final GeneratedColumn<String> resultId = GeneratedColumn<String>(
      'result_id', aliasedName, true,
      type: DriftSqlType.string, requiredDuringInsert: false);
  static const VerificationMeta _searchedAtMeta =
      const VerificationMeta('searchedAt');
  @override
  late final GeneratedColumn<DateTime> searchedAt = GeneratedColumn<DateTime>(
      'searched_at', aliasedName, false,
      type: DriftSqlType.dateTime, requiredDuringInsert: true);
  @override
  List<GeneratedColumn> get $columns => [
        id,
        userId,
        workspaceId,
        term,
        termNorm,
        resultKind,
        resultId,
        searchedAt
      ];
  @override
  String get aliasedName => _alias ?? actualTableName;
  @override
  String get actualTableName => $name;
  static const String $name = 'recent_searches';
  @override
  VerificationContext validateIntegrity(Insertable<RecentSearch> instance,
      {bool isInserting = false}) {
    final context = VerificationContext();
    final data = instance.toColumns(true);
    if (data.containsKey('id')) {
      context.handle(_idMeta, id.isAcceptableOrUnknown(data['id']!, _idMeta));
    } else if (isInserting) {
      context.missing(_idMeta);
    }
    if (data.containsKey('user_id')) {
      context.handle(_userIdMeta,
          userId.isAcceptableOrUnknown(data['user_id']!, _userIdMeta));
    } else if (isInserting) {
      context.missing(_userIdMeta);
    }
    if (data.containsKey('workspace_id')) {
      context.handle(
          _workspaceIdMeta,
          workspaceId.isAcceptableOrUnknown(
              data['workspace_id']!, _workspaceIdMeta));
    } else if (isInserting) {
      context.missing(_workspaceIdMeta);
    }
    if (data.containsKey('term')) {
      context.handle(
          _termMeta, term.isAcceptableOrUnknown(data['term']!, _termMeta));
    } else if (isInserting) {
      context.missing(_termMeta);
    }
    if (data.containsKey('term_norm')) {
      context.handle(_termNormMeta,
          termNorm.isAcceptableOrUnknown(data['term_norm']!, _termNormMeta));
    } else if (isInserting) {
      context.missing(_termNormMeta);
    }
    if (data.containsKey('result_kind')) {
      context.handle(
          _resultKindMeta,
          resultKind.isAcceptableOrUnknown(
              data['result_kind']!, _resultKindMeta));
    }
    if (data.containsKey('result_id')) {
      context.handle(_resultIdMeta,
          resultId.isAcceptableOrUnknown(data['result_id']!, _resultIdMeta));
    }
    if (data.containsKey('searched_at')) {
      context.handle(
          _searchedAtMeta,
          searchedAt.isAcceptableOrUnknown(
              data['searched_at']!, _searchedAtMeta));
    } else if (isInserting) {
      context.missing(_searchedAtMeta);
    }
    return context;
  }

  @override
  Set<GeneratedColumn> get $primaryKey => {id};
  @override
  RecentSearch map(Map<String, dynamic> data, {String? tablePrefix}) {
    final effectivePrefix = tablePrefix != null ? '$tablePrefix.' : '';
    return RecentSearch(
      id: attachedDatabase.typeMapping
          .read(DriftSqlType.string, data['${effectivePrefix}id'])!,
      userId: attachedDatabase.typeMapping
          .read(DriftSqlType.string, data['${effectivePrefix}user_id'])!,
      workspaceId: attachedDatabase.typeMapping
          .read(DriftSqlType.string, data['${effectivePrefix}workspace_id'])!,
      term: attachedDatabase.typeMapping
          .read(DriftSqlType.string, data['${effectivePrefix}term'])!,
      termNorm: attachedDatabase.typeMapping
          .read(DriftSqlType.string, data['${effectivePrefix}term_norm'])!,
      resultKind: attachedDatabase.typeMapping
          .read(DriftSqlType.string, data['${effectivePrefix}result_kind']),
      resultId: attachedDatabase.typeMapping
          .read(DriftSqlType.string, data['${effectivePrefix}result_id']),
      searchedAt: attachedDatabase.typeMapping
          .read(DriftSqlType.dateTime, data['${effectivePrefix}searched_at'])!,
    );
  }

  @override
  $RecentSearchesTable createAlias(String alias) {
    return $RecentSearchesTable(attachedDatabase, alias);
  }
}

class RecentSearch extends DataClass implements Insertable<RecentSearch> {
  final String id;
  final String userId;
  final String workspaceId;

  /// As typed.
  final String term;

  /// Trimmed and uppercased, for dedupe only. Searching the same thing twice
  /// updates the timestamp; it does not add a second row.
  final String termNorm;

  /// `asset`, `tyre`, `work_order`, `accident` or `inspection`.
  final String? resultKind;

  /// What was opened, so a repeat is one tap.
  final String? resultId;
  final DateTime searchedAt;
  const RecentSearch(
      {required this.id,
      required this.userId,
      required this.workspaceId,
      required this.term,
      required this.termNorm,
      this.resultKind,
      this.resultId,
      required this.searchedAt});
  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    map['id'] = Variable<String>(id);
    map['user_id'] = Variable<String>(userId);
    map['workspace_id'] = Variable<String>(workspaceId);
    map['term'] = Variable<String>(term);
    map['term_norm'] = Variable<String>(termNorm);
    if (!nullToAbsent || resultKind != null) {
      map['result_kind'] = Variable<String>(resultKind);
    }
    if (!nullToAbsent || resultId != null) {
      map['result_id'] = Variable<String>(resultId);
    }
    map['searched_at'] = Variable<DateTime>(searchedAt);
    return map;
  }

  RecentSearchesCompanion toCompanion(bool nullToAbsent) {
    return RecentSearchesCompanion(
      id: Value(id),
      userId: Value(userId),
      workspaceId: Value(workspaceId),
      term: Value(term),
      termNorm: Value(termNorm),
      resultKind: resultKind == null && nullToAbsent
          ? const Value.absent()
          : Value(resultKind),
      resultId: resultId == null && nullToAbsent
          ? const Value.absent()
          : Value(resultId),
      searchedAt: Value(searchedAt),
    );
  }

  factory RecentSearch.fromJson(Map<String, dynamic> json,
      {ValueSerializer? serializer}) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return RecentSearch(
      id: serializer.fromJson<String>(json['id']),
      userId: serializer.fromJson<String>(json['userId']),
      workspaceId: serializer.fromJson<String>(json['workspaceId']),
      term: serializer.fromJson<String>(json['term']),
      termNorm: serializer.fromJson<String>(json['termNorm']),
      resultKind: serializer.fromJson<String?>(json['resultKind']),
      resultId: serializer.fromJson<String?>(json['resultId']),
      searchedAt: serializer.fromJson<DateTime>(json['searchedAt']),
    );
  }
  @override
  Map<String, dynamic> toJson({ValueSerializer? serializer}) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return <String, dynamic>{
      'id': serializer.toJson<String>(id),
      'userId': serializer.toJson<String>(userId),
      'workspaceId': serializer.toJson<String>(workspaceId),
      'term': serializer.toJson<String>(term),
      'termNorm': serializer.toJson<String>(termNorm),
      'resultKind': serializer.toJson<String?>(resultKind),
      'resultId': serializer.toJson<String?>(resultId),
      'searchedAt': serializer.toJson<DateTime>(searchedAt),
    };
  }

  RecentSearch copyWith(
          {String? id,
          String? userId,
          String? workspaceId,
          String? term,
          String? termNorm,
          Value<String?> resultKind = const Value.absent(),
          Value<String?> resultId = const Value.absent(),
          DateTime? searchedAt}) =>
      RecentSearch(
        id: id ?? this.id,
        userId: userId ?? this.userId,
        workspaceId: workspaceId ?? this.workspaceId,
        term: term ?? this.term,
        termNorm: termNorm ?? this.termNorm,
        resultKind: resultKind.present ? resultKind.value : this.resultKind,
        resultId: resultId.present ? resultId.value : this.resultId,
        searchedAt: searchedAt ?? this.searchedAt,
      );
  RecentSearch copyWithCompanion(RecentSearchesCompanion data) {
    return RecentSearch(
      id: data.id.present ? data.id.value : this.id,
      userId: data.userId.present ? data.userId.value : this.userId,
      workspaceId:
          data.workspaceId.present ? data.workspaceId.value : this.workspaceId,
      term: data.term.present ? data.term.value : this.term,
      termNorm: data.termNorm.present ? data.termNorm.value : this.termNorm,
      resultKind:
          data.resultKind.present ? data.resultKind.value : this.resultKind,
      resultId: data.resultId.present ? data.resultId.value : this.resultId,
      searchedAt:
          data.searchedAt.present ? data.searchedAt.value : this.searchedAt,
    );
  }

  @override
  String toString() {
    return (StringBuffer('RecentSearch(')
          ..write('id: $id, ')
          ..write('userId: $userId, ')
          ..write('workspaceId: $workspaceId, ')
          ..write('term: $term, ')
          ..write('termNorm: $termNorm, ')
          ..write('resultKind: $resultKind, ')
          ..write('resultId: $resultId, ')
          ..write('searchedAt: $searchedAt')
          ..write(')'))
        .toString();
  }

  @override
  int get hashCode => Object.hash(id, userId, workspaceId, term, termNorm,
      resultKind, resultId, searchedAt);
  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      (other is RecentSearch &&
          other.id == this.id &&
          other.userId == this.userId &&
          other.workspaceId == this.workspaceId &&
          other.term == this.term &&
          other.termNorm == this.termNorm &&
          other.resultKind == this.resultKind &&
          other.resultId == this.resultId &&
          other.searchedAt == this.searchedAt);
}

class RecentSearchesCompanion extends UpdateCompanion<RecentSearch> {
  final Value<String> id;
  final Value<String> userId;
  final Value<String> workspaceId;
  final Value<String> term;
  final Value<String> termNorm;
  final Value<String?> resultKind;
  final Value<String?> resultId;
  final Value<DateTime> searchedAt;
  final Value<int> rowid;
  const RecentSearchesCompanion({
    this.id = const Value.absent(),
    this.userId = const Value.absent(),
    this.workspaceId = const Value.absent(),
    this.term = const Value.absent(),
    this.termNorm = const Value.absent(),
    this.resultKind = const Value.absent(),
    this.resultId = const Value.absent(),
    this.searchedAt = const Value.absent(),
    this.rowid = const Value.absent(),
  });
  RecentSearchesCompanion.insert({
    required String id,
    required String userId,
    required String workspaceId,
    required String term,
    required String termNorm,
    this.resultKind = const Value.absent(),
    this.resultId = const Value.absent(),
    required DateTime searchedAt,
    this.rowid = const Value.absent(),
  })  : id = Value(id),
        userId = Value(userId),
        workspaceId = Value(workspaceId),
        term = Value(term),
        termNorm = Value(termNorm),
        searchedAt = Value(searchedAt);
  static Insertable<RecentSearch> custom({
    Expression<String>? id,
    Expression<String>? userId,
    Expression<String>? workspaceId,
    Expression<String>? term,
    Expression<String>? termNorm,
    Expression<String>? resultKind,
    Expression<String>? resultId,
    Expression<DateTime>? searchedAt,
    Expression<int>? rowid,
  }) {
    return RawValuesInsertable({
      if (id != null) 'id': id,
      if (userId != null) 'user_id': userId,
      if (workspaceId != null) 'workspace_id': workspaceId,
      if (term != null) 'term': term,
      if (termNorm != null) 'term_norm': termNorm,
      if (resultKind != null) 'result_kind': resultKind,
      if (resultId != null) 'result_id': resultId,
      if (searchedAt != null) 'searched_at': searchedAt,
      if (rowid != null) 'rowid': rowid,
    });
  }

  RecentSearchesCompanion copyWith(
      {Value<String>? id,
      Value<String>? userId,
      Value<String>? workspaceId,
      Value<String>? term,
      Value<String>? termNorm,
      Value<String?>? resultKind,
      Value<String?>? resultId,
      Value<DateTime>? searchedAt,
      Value<int>? rowid}) {
    return RecentSearchesCompanion(
      id: id ?? this.id,
      userId: userId ?? this.userId,
      workspaceId: workspaceId ?? this.workspaceId,
      term: term ?? this.term,
      termNorm: termNorm ?? this.termNorm,
      resultKind: resultKind ?? this.resultKind,
      resultId: resultId ?? this.resultId,
      searchedAt: searchedAt ?? this.searchedAt,
      rowid: rowid ?? this.rowid,
    );
  }

  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    if (id.present) {
      map['id'] = Variable<String>(id.value);
    }
    if (userId.present) {
      map['user_id'] = Variable<String>(userId.value);
    }
    if (workspaceId.present) {
      map['workspace_id'] = Variable<String>(workspaceId.value);
    }
    if (term.present) {
      map['term'] = Variable<String>(term.value);
    }
    if (termNorm.present) {
      map['term_norm'] = Variable<String>(termNorm.value);
    }
    if (resultKind.present) {
      map['result_kind'] = Variable<String>(resultKind.value);
    }
    if (resultId.present) {
      map['result_id'] = Variable<String>(resultId.value);
    }
    if (searchedAt.present) {
      map['searched_at'] = Variable<DateTime>(searchedAt.value);
    }
    if (rowid.present) {
      map['rowid'] = Variable<int>(rowid.value);
    }
    return map;
  }

  @override
  String toString() {
    return (StringBuffer('RecentSearchesCompanion(')
          ..write('id: $id, ')
          ..write('userId: $userId, ')
          ..write('workspaceId: $workspaceId, ')
          ..write('term: $term, ')
          ..write('termNorm: $termNorm, ')
          ..write('resultKind: $resultKind, ')
          ..write('resultId: $resultId, ')
          ..write('searchedAt: $searchedAt, ')
          ..write('rowid: $rowid')
          ..write(')'))
        .toString();
  }
}

abstract class _$AppDatabase extends GeneratedDatabase {
  _$AppDatabase(QueryExecutor e) : super(e);
  $AppDatabaseManager get managers => $AppDatabaseManager(this);
  late final $WorkspaceScopesTable workspaceScopes =
      $WorkspaceScopesTable(this);
  late final $CachedUsersTable cachedUsers = $CachedUsersTable(this);
  late final $CachedSitesTable cachedSites = $CachedSitesTable(this);
  late final $CachedAssetsTable cachedAssets = $CachedAssetsTable(this);
  late final $CachedTyresTable cachedTyres = $CachedTyresTable(this);
  late final $CachedChecklistTemplatesTable cachedChecklistTemplates =
      $CachedChecklistTemplatesTable(this);
  late final $CachedPermissionsTable cachedPermissions =
      $CachedPermissionsTable(this);
  late final $InspectionDraftsTable inspectionDrafts =
      $InspectionDraftsTable(this);
  late final $InspectionDraftPositionsTable inspectionDraftPositions =
      $InspectionDraftPositionsTable(this);
  late final $ChecklistDraftsTable checklistDrafts =
      $ChecklistDraftsTable(this);
  late final $DraftPhotosTable draftPhotos = $DraftPhotosTable(this);
  late final $CapturedSignaturesTable capturedSignatures =
      $CapturedSignaturesTable(this);
  late final $PendingCommandsTable pendingCommands =
      $PendingCommandsTable(this);
  late final $PendingMediaUploadsTable pendingMediaUploads =
      $PendingMediaUploadsTable(this);
  late final $SyncFailuresTable syncFailures = $SyncFailuresTable(this);
  late final $SyncMetadataTable syncMetadata = $SyncMetadataTable(this);
  late final $RecentSearchesTable recentSearches = $RecentSearchesTable(this);
  late final Index idxWorkspaceActive = Index('idx_workspace_active',
      'CREATE INDEX idx_workspace_active ON workspace_scope (is_active)');
  late final Index idxCachedUsersScope = Index('idx_cached_users_scope',
      'CREATE INDEX idx_cached_users_scope ON cached_users (workspace_id, role)');
  late final Index idxCachedUsersName = Index('idx_cached_users_name',
      'CREATE INDEX idx_cached_users_name ON cached_users (workspace_id, full_name)');
  late final Index idxCachedSitesScope = Index('idx_cached_sites_scope',
      'CREATE INDEX idx_cached_sites_scope ON cached_sites (workspace_id, country, name)');
  late final Index idxCachedAssetsIdentity = Index('idx_cached_assets_identity',
      'CREATE UNIQUE INDEX idx_cached_assets_identity ON cached_assets (workspace_id, country, asset_no_norm)');
  late final Index idxCachedAssetsLookup = Index('idx_cached_assets_lookup',
      'CREATE INDEX idx_cached_assets_lookup ON cached_assets (workspace_id, asset_no_norm)');
  late final Index idxCachedAssetsPlate = Index('idx_cached_assets_plate',
      'CREATE INDEX idx_cached_assets_plate ON cached_assets (workspace_id, registration_no)');
  late final Index idxCachedAssetsChassis = Index('idx_cached_assets_chassis',
      'CREATE INDEX idx_cached_assets_chassis ON cached_assets (workspace_id, chassis_no)');
  late final Index idxCachedAssetsSite = Index('idx_cached_assets_site',
      'CREATE INDEX idx_cached_assets_site ON cached_assets (workspace_id, country, site)');
  late final Index idxCachedTyresAsset = Index('idx_cached_tyres_asset',
      'CREATE INDEX idx_cached_tyres_asset ON cached_tyres (workspace_id, asset_no, position)');
  late final Index idxCachedTyresSerial = Index('idx_cached_tyres_serial',
      'CREATE INDEX idx_cached_tyres_serial ON cached_tyres (workspace_id, serial_no_norm)');
  late final Index idxCachedTyresPrune = Index('idx_cached_tyres_prune',
      'CREATE INDEX idx_cached_tyres_prune ON cached_tyres (last_seen_at)');
  late final Index idxTemplatesScope = Index('idx_templates_scope',
      'CREATE INDEX idx_templates_scope ON cached_checklist_templates (workspace_id, country, status)');
  late final Index idxPermissionsUser = Index('idx_permissions_user',
      'CREATE INDEX idx_permissions_user ON cached_permissions (user_id, workspace_id)');
  late final Index idxInspectionDraftsUser = Index('idx_inspection_drafts_user',
      'CREATE INDEX idx_inspection_drafts_user ON inspection_drafts (user_id, updated_at)');
  late final Index idxDraftPosition = Index('idx_draft_position',
      'CREATE UNIQUE INDEX idx_draft_position ON inspection_draft_positions (draft_key, position)');
  late final Index idxChecklistDraftsUser = Index('idx_checklist_drafts_user',
      'CREATE INDEX idx_checklist_drafts_user ON checklist_drafts (user_id, updated_at)');
  late final Index idxChecklistDraftsResume = Index(
      'idx_checklist_drafts_resume',
      'CREATE INDEX idx_checklist_drafts_resume ON checklist_drafts (user_id, template_id, asset_no)');
  late final Index idxDraftPhotosOwner = Index('idx_draft_photos_owner',
      'CREATE INDEX idx_draft_photos_owner ON draft_photos (owner_kind, owner_key)');
  late final Index idxDraftPhotosFile = Index('idx_draft_photos_file',
      'CREATE UNIQUE INDEX idx_draft_photos_file ON draft_photos (file_name)');
  late final Index idxSignatureSlot = Index('idx_signature_slot',
      'CREATE UNIQUE INDEX idx_signature_slot ON captured_signatures (owner_kind, owner_key, field_key)');
  late final Index idxCommandsDue = Index('idx_commands_due',
      'CREATE INDEX idx_commands_due ON pending_commands (status, next_retry_at)');
  late final Index idxCommandsPendingCount = Index('idx_commands_pending_count',
      'CREATE INDEX idx_commands_pending_count ON pending_commands (status)');
  late final Index idxCommandsIdem = Index('idx_commands_idem',
      'CREATE UNIQUE INDEX idx_commands_idem ON pending_commands (idempotency_key)');
  late final Index idxCommandsWorkspace = Index('idx_commands_workspace',
      'CREATE INDEX idx_commands_workspace ON pending_commands (workspace_id, status)');
  late final Index idxMediaCommand = Index('idx_media_command',
      'CREATE INDEX idx_media_command ON pending_media_uploads (command_id, field_key, order_index)');
  late final Index idxMediaState = Index('idx_media_state',
      'CREATE INDEX idx_media_state ON pending_media_uploads (state, attempts)');
  late final Index idxMediaFile = Index('idx_media_file',
      'CREATE UNIQUE INDEX idx_media_file ON pending_media_uploads (file_name)');
  late final Index idxFailuresRecent = Index('idx_failures_recent',
      'CREATE INDEX idx_failures_recent ON sync_failures (occurred_at)');
  late final Index idxRecentDedupe = Index('idx_recent_dedupe',
      'CREATE UNIQUE INDEX idx_recent_dedupe ON recent_searches (user_id, workspace_id, term_norm)');
  late final Index idxRecentList = Index('idx_recent_list',
      'CREATE INDEX idx_recent_list ON recent_searches (user_id, workspace_id, searched_at)');
  late final QueueDao queueDao = QueueDao(this as AppDatabase);
  late final DraftsDao draftsDao = DraftsDao(this as AppDatabase);
  late final MediaDao mediaDao = MediaDao(this as AppDatabase);
  late final CacheDao cacheDao = CacheDao(this as AppDatabase);
  @override
  Iterable<TableInfo<Table, Object?>> get allTables =>
      allSchemaEntities.whereType<TableInfo<Table, Object?>>();
  @override
  List<DatabaseSchemaEntity> get allSchemaEntities => [
        workspaceScopes,
        cachedUsers,
        cachedSites,
        cachedAssets,
        cachedTyres,
        cachedChecklistTemplates,
        cachedPermissions,
        inspectionDrafts,
        inspectionDraftPositions,
        checklistDrafts,
        draftPhotos,
        capturedSignatures,
        pendingCommands,
        pendingMediaUploads,
        syncFailures,
        syncMetadata,
        recentSearches,
        idxWorkspaceActive,
        idxCachedUsersScope,
        idxCachedUsersName,
        idxCachedSitesScope,
        idxCachedAssetsIdentity,
        idxCachedAssetsLookup,
        idxCachedAssetsPlate,
        idxCachedAssetsChassis,
        idxCachedAssetsSite,
        idxCachedTyresAsset,
        idxCachedTyresSerial,
        idxCachedTyresPrune,
        idxTemplatesScope,
        idxPermissionsUser,
        idxInspectionDraftsUser,
        idxDraftPosition,
        idxChecklistDraftsUser,
        idxChecklistDraftsResume,
        idxDraftPhotosOwner,
        idxDraftPhotosFile,
        idxSignatureSlot,
        idxCommandsDue,
        idxCommandsPendingCount,
        idxCommandsIdem,
        idxCommandsWorkspace,
        idxMediaCommand,
        idxMediaState,
        idxMediaFile,
        idxFailuresRecent,
        idxRecentDedupe,
        idxRecentList
      ];
  @override
  StreamQueryUpdateRules get streamUpdateRules => const StreamQueryUpdateRules(
        [
          WritePropagation(
            on: TableUpdateQuery.onTableName('inspection_drafts',
                limitUpdateKind: UpdateKind.delete),
            result: [
              TableUpdate('inspection_draft_positions',
                  kind: UpdateKind.delete),
            ],
          ),
        ],
      );
}

typedef $$WorkspaceScopesTableCreateCompanionBuilder = WorkspaceScopesCompanion
    Function({
  required String workspaceId,
  Value<String?> tenantId,
  Value<String?> companyName,
  Value<String?> country,
  Value<String?> currency,
  required String siteIdsJson,
  required String userId,
  required String role,
  Value<bool> isSuperAdmin,
  Value<bool> isActive,
  required DateTime lastVerifiedAt,
  Value<int> rowid,
});
typedef $$WorkspaceScopesTableUpdateCompanionBuilder = WorkspaceScopesCompanion
    Function({
  Value<String> workspaceId,
  Value<String?> tenantId,
  Value<String?> companyName,
  Value<String?> country,
  Value<String?> currency,
  Value<String> siteIdsJson,
  Value<String> userId,
  Value<String> role,
  Value<bool> isSuperAdmin,
  Value<bool> isActive,
  Value<DateTime> lastVerifiedAt,
  Value<int> rowid,
});

class $$WorkspaceScopesTableFilterComposer
    extends Composer<_$AppDatabase, $WorkspaceScopesTable> {
  $$WorkspaceScopesTableFilterComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  ColumnFilters<String> get workspaceId => $composableBuilder(
      column: $table.workspaceId, builder: (column) => ColumnFilters(column));

  ColumnFilters<String> get tenantId => $composableBuilder(
      column: $table.tenantId, builder: (column) => ColumnFilters(column));

  ColumnFilters<String> get companyName => $composableBuilder(
      column: $table.companyName, builder: (column) => ColumnFilters(column));

  ColumnFilters<String> get country => $composableBuilder(
      column: $table.country, builder: (column) => ColumnFilters(column));

  ColumnFilters<String> get currency => $composableBuilder(
      column: $table.currency, builder: (column) => ColumnFilters(column));

  ColumnFilters<String> get siteIdsJson => $composableBuilder(
      column: $table.siteIdsJson, builder: (column) => ColumnFilters(column));

  ColumnFilters<String> get userId => $composableBuilder(
      column: $table.userId, builder: (column) => ColumnFilters(column));

  ColumnFilters<String> get role => $composableBuilder(
      column: $table.role, builder: (column) => ColumnFilters(column));

  ColumnFilters<bool> get isSuperAdmin => $composableBuilder(
      column: $table.isSuperAdmin, builder: (column) => ColumnFilters(column));

  ColumnFilters<bool> get isActive => $composableBuilder(
      column: $table.isActive, builder: (column) => ColumnFilters(column));

  ColumnFilters<DateTime> get lastVerifiedAt => $composableBuilder(
      column: $table.lastVerifiedAt,
      builder: (column) => ColumnFilters(column));
}

class $$WorkspaceScopesTableOrderingComposer
    extends Composer<_$AppDatabase, $WorkspaceScopesTable> {
  $$WorkspaceScopesTableOrderingComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  ColumnOrderings<String> get workspaceId => $composableBuilder(
      column: $table.workspaceId, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<String> get tenantId => $composableBuilder(
      column: $table.tenantId, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<String> get companyName => $composableBuilder(
      column: $table.companyName, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<String> get country => $composableBuilder(
      column: $table.country, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<String> get currency => $composableBuilder(
      column: $table.currency, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<String> get siteIdsJson => $composableBuilder(
      column: $table.siteIdsJson, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<String> get userId => $composableBuilder(
      column: $table.userId, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<String> get role => $composableBuilder(
      column: $table.role, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<bool> get isSuperAdmin => $composableBuilder(
      column: $table.isSuperAdmin,
      builder: (column) => ColumnOrderings(column));

  ColumnOrderings<bool> get isActive => $composableBuilder(
      column: $table.isActive, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<DateTime> get lastVerifiedAt => $composableBuilder(
      column: $table.lastVerifiedAt,
      builder: (column) => ColumnOrderings(column));
}

class $$WorkspaceScopesTableAnnotationComposer
    extends Composer<_$AppDatabase, $WorkspaceScopesTable> {
  $$WorkspaceScopesTableAnnotationComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  GeneratedColumn<String> get workspaceId => $composableBuilder(
      column: $table.workspaceId, builder: (column) => column);

  GeneratedColumn<String> get tenantId =>
      $composableBuilder(column: $table.tenantId, builder: (column) => column);

  GeneratedColumn<String> get companyName => $composableBuilder(
      column: $table.companyName, builder: (column) => column);

  GeneratedColumn<String> get country =>
      $composableBuilder(column: $table.country, builder: (column) => column);

  GeneratedColumn<String> get currency =>
      $composableBuilder(column: $table.currency, builder: (column) => column);

  GeneratedColumn<String> get siteIdsJson => $composableBuilder(
      column: $table.siteIdsJson, builder: (column) => column);

  GeneratedColumn<String> get userId =>
      $composableBuilder(column: $table.userId, builder: (column) => column);

  GeneratedColumn<String> get role =>
      $composableBuilder(column: $table.role, builder: (column) => column);

  GeneratedColumn<bool> get isSuperAdmin => $composableBuilder(
      column: $table.isSuperAdmin, builder: (column) => column);

  GeneratedColumn<bool> get isActive =>
      $composableBuilder(column: $table.isActive, builder: (column) => column);

  GeneratedColumn<DateTime> get lastVerifiedAt => $composableBuilder(
      column: $table.lastVerifiedAt, builder: (column) => column);
}

class $$WorkspaceScopesTableTableManager extends RootTableManager<
    _$AppDatabase,
    $WorkspaceScopesTable,
    WorkspaceScopeRow,
    $$WorkspaceScopesTableFilterComposer,
    $$WorkspaceScopesTableOrderingComposer,
    $$WorkspaceScopesTableAnnotationComposer,
    $$WorkspaceScopesTableCreateCompanionBuilder,
    $$WorkspaceScopesTableUpdateCompanionBuilder,
    (
      WorkspaceScopeRow,
      BaseReferences<_$AppDatabase, $WorkspaceScopesTable, WorkspaceScopeRow>
    ),
    WorkspaceScopeRow,
    PrefetchHooks Function()> {
  $$WorkspaceScopesTableTableManager(
      _$AppDatabase db, $WorkspaceScopesTable table)
      : super(TableManagerState(
          db: db,
          table: table,
          createFilteringComposer: () =>
              $$WorkspaceScopesTableFilterComposer($db: db, $table: table),
          createOrderingComposer: () =>
              $$WorkspaceScopesTableOrderingComposer($db: db, $table: table),
          createComputedFieldComposer: () =>
              $$WorkspaceScopesTableAnnotationComposer($db: db, $table: table),
          updateCompanionCallback: ({
            Value<String> workspaceId = const Value.absent(),
            Value<String?> tenantId = const Value.absent(),
            Value<String?> companyName = const Value.absent(),
            Value<String?> country = const Value.absent(),
            Value<String?> currency = const Value.absent(),
            Value<String> siteIdsJson = const Value.absent(),
            Value<String> userId = const Value.absent(),
            Value<String> role = const Value.absent(),
            Value<bool> isSuperAdmin = const Value.absent(),
            Value<bool> isActive = const Value.absent(),
            Value<DateTime> lastVerifiedAt = const Value.absent(),
            Value<int> rowid = const Value.absent(),
          }) =>
              WorkspaceScopesCompanion(
            workspaceId: workspaceId,
            tenantId: tenantId,
            companyName: companyName,
            country: country,
            currency: currency,
            siteIdsJson: siteIdsJson,
            userId: userId,
            role: role,
            isSuperAdmin: isSuperAdmin,
            isActive: isActive,
            lastVerifiedAt: lastVerifiedAt,
            rowid: rowid,
          ),
          createCompanionCallback: ({
            required String workspaceId,
            Value<String?> tenantId = const Value.absent(),
            Value<String?> companyName = const Value.absent(),
            Value<String?> country = const Value.absent(),
            Value<String?> currency = const Value.absent(),
            required String siteIdsJson,
            required String userId,
            required String role,
            Value<bool> isSuperAdmin = const Value.absent(),
            Value<bool> isActive = const Value.absent(),
            required DateTime lastVerifiedAt,
            Value<int> rowid = const Value.absent(),
          }) =>
              WorkspaceScopesCompanion.insert(
            workspaceId: workspaceId,
            tenantId: tenantId,
            companyName: companyName,
            country: country,
            currency: currency,
            siteIdsJson: siteIdsJson,
            userId: userId,
            role: role,
            isSuperAdmin: isSuperAdmin,
            isActive: isActive,
            lastVerifiedAt: lastVerifiedAt,
            rowid: rowid,
          ),
          withReferenceMapper: (p0) => p0
              .map((e) => (e.readTable(table), BaseReferences(db, table, e)))
              .toList(),
          prefetchHooksCallback: null,
        ));
}

typedef $$WorkspaceScopesTableProcessedTableManager = ProcessedTableManager<
    _$AppDatabase,
    $WorkspaceScopesTable,
    WorkspaceScopeRow,
    $$WorkspaceScopesTableFilterComposer,
    $$WorkspaceScopesTableOrderingComposer,
    $$WorkspaceScopesTableAnnotationComposer,
    $$WorkspaceScopesTableCreateCompanionBuilder,
    $$WorkspaceScopesTableUpdateCompanionBuilder,
    (
      WorkspaceScopeRow,
      BaseReferences<_$AppDatabase, $WorkspaceScopesTable, WorkspaceScopeRow>
    ),
    WorkspaceScopeRow,
    PrefetchHooks Function()>;
typedef $$CachedUsersTableCreateCompanionBuilder = CachedUsersCompanion
    Function({
  required String id,
  required String workspaceId,
  Value<String?> country,
  Value<String?> fullName,
  Value<String?> username,
  Value<String?> role,
  Value<bool?> approved,
  Value<bool?> locked,
  Value<String?> sitesJson,
  required DateTime cachedAt,
  Value<int> rowid,
});
typedef $$CachedUsersTableUpdateCompanionBuilder = CachedUsersCompanion
    Function({
  Value<String> id,
  Value<String> workspaceId,
  Value<String?> country,
  Value<String?> fullName,
  Value<String?> username,
  Value<String?> role,
  Value<bool?> approved,
  Value<bool?> locked,
  Value<String?> sitesJson,
  Value<DateTime> cachedAt,
  Value<int> rowid,
});

class $$CachedUsersTableFilterComposer
    extends Composer<_$AppDatabase, $CachedUsersTable> {
  $$CachedUsersTableFilterComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  ColumnFilters<String> get id => $composableBuilder(
      column: $table.id, builder: (column) => ColumnFilters(column));

  ColumnFilters<String> get workspaceId => $composableBuilder(
      column: $table.workspaceId, builder: (column) => ColumnFilters(column));

  ColumnFilters<String> get country => $composableBuilder(
      column: $table.country, builder: (column) => ColumnFilters(column));

  ColumnFilters<String> get fullName => $composableBuilder(
      column: $table.fullName, builder: (column) => ColumnFilters(column));

  ColumnFilters<String> get username => $composableBuilder(
      column: $table.username, builder: (column) => ColumnFilters(column));

  ColumnFilters<String> get role => $composableBuilder(
      column: $table.role, builder: (column) => ColumnFilters(column));

  ColumnFilters<bool> get approved => $composableBuilder(
      column: $table.approved, builder: (column) => ColumnFilters(column));

  ColumnFilters<bool> get locked => $composableBuilder(
      column: $table.locked, builder: (column) => ColumnFilters(column));

  ColumnFilters<String> get sitesJson => $composableBuilder(
      column: $table.sitesJson, builder: (column) => ColumnFilters(column));

  ColumnFilters<DateTime> get cachedAt => $composableBuilder(
      column: $table.cachedAt, builder: (column) => ColumnFilters(column));
}

class $$CachedUsersTableOrderingComposer
    extends Composer<_$AppDatabase, $CachedUsersTable> {
  $$CachedUsersTableOrderingComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  ColumnOrderings<String> get id => $composableBuilder(
      column: $table.id, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<String> get workspaceId => $composableBuilder(
      column: $table.workspaceId, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<String> get country => $composableBuilder(
      column: $table.country, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<String> get fullName => $composableBuilder(
      column: $table.fullName, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<String> get username => $composableBuilder(
      column: $table.username, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<String> get role => $composableBuilder(
      column: $table.role, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<bool> get approved => $composableBuilder(
      column: $table.approved, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<bool> get locked => $composableBuilder(
      column: $table.locked, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<String> get sitesJson => $composableBuilder(
      column: $table.sitesJson, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<DateTime> get cachedAt => $composableBuilder(
      column: $table.cachedAt, builder: (column) => ColumnOrderings(column));
}

class $$CachedUsersTableAnnotationComposer
    extends Composer<_$AppDatabase, $CachedUsersTable> {
  $$CachedUsersTableAnnotationComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  GeneratedColumn<String> get id =>
      $composableBuilder(column: $table.id, builder: (column) => column);

  GeneratedColumn<String> get workspaceId => $composableBuilder(
      column: $table.workspaceId, builder: (column) => column);

  GeneratedColumn<String> get country =>
      $composableBuilder(column: $table.country, builder: (column) => column);

  GeneratedColumn<String> get fullName =>
      $composableBuilder(column: $table.fullName, builder: (column) => column);

  GeneratedColumn<String> get username =>
      $composableBuilder(column: $table.username, builder: (column) => column);

  GeneratedColumn<String> get role =>
      $composableBuilder(column: $table.role, builder: (column) => column);

  GeneratedColumn<bool> get approved =>
      $composableBuilder(column: $table.approved, builder: (column) => column);

  GeneratedColumn<bool> get locked =>
      $composableBuilder(column: $table.locked, builder: (column) => column);

  GeneratedColumn<String> get sitesJson =>
      $composableBuilder(column: $table.sitesJson, builder: (column) => column);

  GeneratedColumn<DateTime> get cachedAt =>
      $composableBuilder(column: $table.cachedAt, builder: (column) => column);
}

class $$CachedUsersTableTableManager extends RootTableManager<
    _$AppDatabase,
    $CachedUsersTable,
    CachedUser,
    $$CachedUsersTableFilterComposer,
    $$CachedUsersTableOrderingComposer,
    $$CachedUsersTableAnnotationComposer,
    $$CachedUsersTableCreateCompanionBuilder,
    $$CachedUsersTableUpdateCompanionBuilder,
    (CachedUser, BaseReferences<_$AppDatabase, $CachedUsersTable, CachedUser>),
    CachedUser,
    PrefetchHooks Function()> {
  $$CachedUsersTableTableManager(_$AppDatabase db, $CachedUsersTable table)
      : super(TableManagerState(
          db: db,
          table: table,
          createFilteringComposer: () =>
              $$CachedUsersTableFilterComposer($db: db, $table: table),
          createOrderingComposer: () =>
              $$CachedUsersTableOrderingComposer($db: db, $table: table),
          createComputedFieldComposer: () =>
              $$CachedUsersTableAnnotationComposer($db: db, $table: table),
          updateCompanionCallback: ({
            Value<String> id = const Value.absent(),
            Value<String> workspaceId = const Value.absent(),
            Value<String?> country = const Value.absent(),
            Value<String?> fullName = const Value.absent(),
            Value<String?> username = const Value.absent(),
            Value<String?> role = const Value.absent(),
            Value<bool?> approved = const Value.absent(),
            Value<bool?> locked = const Value.absent(),
            Value<String?> sitesJson = const Value.absent(),
            Value<DateTime> cachedAt = const Value.absent(),
            Value<int> rowid = const Value.absent(),
          }) =>
              CachedUsersCompanion(
            id: id,
            workspaceId: workspaceId,
            country: country,
            fullName: fullName,
            username: username,
            role: role,
            approved: approved,
            locked: locked,
            sitesJson: sitesJson,
            cachedAt: cachedAt,
            rowid: rowid,
          ),
          createCompanionCallback: ({
            required String id,
            required String workspaceId,
            Value<String?> country = const Value.absent(),
            Value<String?> fullName = const Value.absent(),
            Value<String?> username = const Value.absent(),
            Value<String?> role = const Value.absent(),
            Value<bool?> approved = const Value.absent(),
            Value<bool?> locked = const Value.absent(),
            Value<String?> sitesJson = const Value.absent(),
            required DateTime cachedAt,
            Value<int> rowid = const Value.absent(),
          }) =>
              CachedUsersCompanion.insert(
            id: id,
            workspaceId: workspaceId,
            country: country,
            fullName: fullName,
            username: username,
            role: role,
            approved: approved,
            locked: locked,
            sitesJson: sitesJson,
            cachedAt: cachedAt,
            rowid: rowid,
          ),
          withReferenceMapper: (p0) => p0
              .map((e) => (e.readTable(table), BaseReferences(db, table, e)))
              .toList(),
          prefetchHooksCallback: null,
        ));
}

typedef $$CachedUsersTableProcessedTableManager = ProcessedTableManager<
    _$AppDatabase,
    $CachedUsersTable,
    CachedUser,
    $$CachedUsersTableFilterComposer,
    $$CachedUsersTableOrderingComposer,
    $$CachedUsersTableAnnotationComposer,
    $$CachedUsersTableCreateCompanionBuilder,
    $$CachedUsersTableUpdateCompanionBuilder,
    (CachedUser, BaseReferences<_$AppDatabase, $CachedUsersTable, CachedUser>),
    CachedUser,
    PrefetchHooks Function()>;
typedef $$CachedSitesTableCreateCompanionBuilder = CachedSitesCompanion
    Function({
  required String id,
  required String workspaceId,
  Value<String?> country,
  required String name,
  Value<String?> region,
  Value<bool?> active,
  required DateTime cachedAt,
  Value<int> rowid,
});
typedef $$CachedSitesTableUpdateCompanionBuilder = CachedSitesCompanion
    Function({
  Value<String> id,
  Value<String> workspaceId,
  Value<String?> country,
  Value<String> name,
  Value<String?> region,
  Value<bool?> active,
  Value<DateTime> cachedAt,
  Value<int> rowid,
});

class $$CachedSitesTableFilterComposer
    extends Composer<_$AppDatabase, $CachedSitesTable> {
  $$CachedSitesTableFilterComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  ColumnFilters<String> get id => $composableBuilder(
      column: $table.id, builder: (column) => ColumnFilters(column));

  ColumnFilters<String> get workspaceId => $composableBuilder(
      column: $table.workspaceId, builder: (column) => ColumnFilters(column));

  ColumnFilters<String> get country => $composableBuilder(
      column: $table.country, builder: (column) => ColumnFilters(column));

  ColumnFilters<String> get name => $composableBuilder(
      column: $table.name, builder: (column) => ColumnFilters(column));

  ColumnFilters<String> get region => $composableBuilder(
      column: $table.region, builder: (column) => ColumnFilters(column));

  ColumnFilters<bool> get active => $composableBuilder(
      column: $table.active, builder: (column) => ColumnFilters(column));

  ColumnFilters<DateTime> get cachedAt => $composableBuilder(
      column: $table.cachedAt, builder: (column) => ColumnFilters(column));
}

class $$CachedSitesTableOrderingComposer
    extends Composer<_$AppDatabase, $CachedSitesTable> {
  $$CachedSitesTableOrderingComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  ColumnOrderings<String> get id => $composableBuilder(
      column: $table.id, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<String> get workspaceId => $composableBuilder(
      column: $table.workspaceId, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<String> get country => $composableBuilder(
      column: $table.country, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<String> get name => $composableBuilder(
      column: $table.name, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<String> get region => $composableBuilder(
      column: $table.region, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<bool> get active => $composableBuilder(
      column: $table.active, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<DateTime> get cachedAt => $composableBuilder(
      column: $table.cachedAt, builder: (column) => ColumnOrderings(column));
}

class $$CachedSitesTableAnnotationComposer
    extends Composer<_$AppDatabase, $CachedSitesTable> {
  $$CachedSitesTableAnnotationComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  GeneratedColumn<String> get id =>
      $composableBuilder(column: $table.id, builder: (column) => column);

  GeneratedColumn<String> get workspaceId => $composableBuilder(
      column: $table.workspaceId, builder: (column) => column);

  GeneratedColumn<String> get country =>
      $composableBuilder(column: $table.country, builder: (column) => column);

  GeneratedColumn<String> get name =>
      $composableBuilder(column: $table.name, builder: (column) => column);

  GeneratedColumn<String> get region =>
      $composableBuilder(column: $table.region, builder: (column) => column);

  GeneratedColumn<bool> get active =>
      $composableBuilder(column: $table.active, builder: (column) => column);

  GeneratedColumn<DateTime> get cachedAt =>
      $composableBuilder(column: $table.cachedAt, builder: (column) => column);
}

class $$CachedSitesTableTableManager extends RootTableManager<
    _$AppDatabase,
    $CachedSitesTable,
    CachedSite,
    $$CachedSitesTableFilterComposer,
    $$CachedSitesTableOrderingComposer,
    $$CachedSitesTableAnnotationComposer,
    $$CachedSitesTableCreateCompanionBuilder,
    $$CachedSitesTableUpdateCompanionBuilder,
    (CachedSite, BaseReferences<_$AppDatabase, $CachedSitesTable, CachedSite>),
    CachedSite,
    PrefetchHooks Function()> {
  $$CachedSitesTableTableManager(_$AppDatabase db, $CachedSitesTable table)
      : super(TableManagerState(
          db: db,
          table: table,
          createFilteringComposer: () =>
              $$CachedSitesTableFilterComposer($db: db, $table: table),
          createOrderingComposer: () =>
              $$CachedSitesTableOrderingComposer($db: db, $table: table),
          createComputedFieldComposer: () =>
              $$CachedSitesTableAnnotationComposer($db: db, $table: table),
          updateCompanionCallback: ({
            Value<String> id = const Value.absent(),
            Value<String> workspaceId = const Value.absent(),
            Value<String?> country = const Value.absent(),
            Value<String> name = const Value.absent(),
            Value<String?> region = const Value.absent(),
            Value<bool?> active = const Value.absent(),
            Value<DateTime> cachedAt = const Value.absent(),
            Value<int> rowid = const Value.absent(),
          }) =>
              CachedSitesCompanion(
            id: id,
            workspaceId: workspaceId,
            country: country,
            name: name,
            region: region,
            active: active,
            cachedAt: cachedAt,
            rowid: rowid,
          ),
          createCompanionCallback: ({
            required String id,
            required String workspaceId,
            Value<String?> country = const Value.absent(),
            required String name,
            Value<String?> region = const Value.absent(),
            Value<bool?> active = const Value.absent(),
            required DateTime cachedAt,
            Value<int> rowid = const Value.absent(),
          }) =>
              CachedSitesCompanion.insert(
            id: id,
            workspaceId: workspaceId,
            country: country,
            name: name,
            region: region,
            active: active,
            cachedAt: cachedAt,
            rowid: rowid,
          ),
          withReferenceMapper: (p0) => p0
              .map((e) => (e.readTable(table), BaseReferences(db, table, e)))
              .toList(),
          prefetchHooksCallback: null,
        ));
}

typedef $$CachedSitesTableProcessedTableManager = ProcessedTableManager<
    _$AppDatabase,
    $CachedSitesTable,
    CachedSite,
    $$CachedSitesTableFilterComposer,
    $$CachedSitesTableOrderingComposer,
    $$CachedSitesTableAnnotationComposer,
    $$CachedSitesTableCreateCompanionBuilder,
    $$CachedSitesTableUpdateCompanionBuilder,
    (CachedSite, BaseReferences<_$AppDatabase, $CachedSitesTable, CachedSite>),
    CachedSite,
    PrefetchHooks Function()>;
typedef $$CachedAssetsTableCreateCompanionBuilder = CachedAssetsCompanion
    Function({
  required String id,
  required String workspaceId,
  Value<String?> country,
  required String assetNo,
  required String assetNoNorm,
  Value<String?> fleetNumber,
  Value<String?> registrationNo,
  Value<String?> chassisNo,
  Value<String?> serialNo,
  Value<String?> vehicleType,
  Value<String?> make,
  Value<String?> model,
  Value<String?> site,
  Value<int?> currentKm,
  Value<String?> status,
  Value<String?> opsStatus,
  required DateTime cachedAt,
  Value<int> rowid,
});
typedef $$CachedAssetsTableUpdateCompanionBuilder = CachedAssetsCompanion
    Function({
  Value<String> id,
  Value<String> workspaceId,
  Value<String?> country,
  Value<String> assetNo,
  Value<String> assetNoNorm,
  Value<String?> fleetNumber,
  Value<String?> registrationNo,
  Value<String?> chassisNo,
  Value<String?> serialNo,
  Value<String?> vehicleType,
  Value<String?> make,
  Value<String?> model,
  Value<String?> site,
  Value<int?> currentKm,
  Value<String?> status,
  Value<String?> opsStatus,
  Value<DateTime> cachedAt,
  Value<int> rowid,
});

class $$CachedAssetsTableFilterComposer
    extends Composer<_$AppDatabase, $CachedAssetsTable> {
  $$CachedAssetsTableFilterComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  ColumnFilters<String> get id => $composableBuilder(
      column: $table.id, builder: (column) => ColumnFilters(column));

  ColumnFilters<String> get workspaceId => $composableBuilder(
      column: $table.workspaceId, builder: (column) => ColumnFilters(column));

  ColumnFilters<String> get country => $composableBuilder(
      column: $table.country, builder: (column) => ColumnFilters(column));

  ColumnFilters<String> get assetNo => $composableBuilder(
      column: $table.assetNo, builder: (column) => ColumnFilters(column));

  ColumnFilters<String> get assetNoNorm => $composableBuilder(
      column: $table.assetNoNorm, builder: (column) => ColumnFilters(column));

  ColumnFilters<String> get fleetNumber => $composableBuilder(
      column: $table.fleetNumber, builder: (column) => ColumnFilters(column));

  ColumnFilters<String> get registrationNo => $composableBuilder(
      column: $table.registrationNo,
      builder: (column) => ColumnFilters(column));

  ColumnFilters<String> get chassisNo => $composableBuilder(
      column: $table.chassisNo, builder: (column) => ColumnFilters(column));

  ColumnFilters<String> get serialNo => $composableBuilder(
      column: $table.serialNo, builder: (column) => ColumnFilters(column));

  ColumnFilters<String> get vehicleType => $composableBuilder(
      column: $table.vehicleType, builder: (column) => ColumnFilters(column));

  ColumnFilters<String> get make => $composableBuilder(
      column: $table.make, builder: (column) => ColumnFilters(column));

  ColumnFilters<String> get model => $composableBuilder(
      column: $table.model, builder: (column) => ColumnFilters(column));

  ColumnFilters<String> get site => $composableBuilder(
      column: $table.site, builder: (column) => ColumnFilters(column));

  ColumnFilters<int> get currentKm => $composableBuilder(
      column: $table.currentKm, builder: (column) => ColumnFilters(column));

  ColumnFilters<String> get status => $composableBuilder(
      column: $table.status, builder: (column) => ColumnFilters(column));

  ColumnFilters<String> get opsStatus => $composableBuilder(
      column: $table.opsStatus, builder: (column) => ColumnFilters(column));

  ColumnFilters<DateTime> get cachedAt => $composableBuilder(
      column: $table.cachedAt, builder: (column) => ColumnFilters(column));
}

class $$CachedAssetsTableOrderingComposer
    extends Composer<_$AppDatabase, $CachedAssetsTable> {
  $$CachedAssetsTableOrderingComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  ColumnOrderings<String> get id => $composableBuilder(
      column: $table.id, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<String> get workspaceId => $composableBuilder(
      column: $table.workspaceId, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<String> get country => $composableBuilder(
      column: $table.country, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<String> get assetNo => $composableBuilder(
      column: $table.assetNo, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<String> get assetNoNorm => $composableBuilder(
      column: $table.assetNoNorm, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<String> get fleetNumber => $composableBuilder(
      column: $table.fleetNumber, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<String> get registrationNo => $composableBuilder(
      column: $table.registrationNo,
      builder: (column) => ColumnOrderings(column));

  ColumnOrderings<String> get chassisNo => $composableBuilder(
      column: $table.chassisNo, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<String> get serialNo => $composableBuilder(
      column: $table.serialNo, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<String> get vehicleType => $composableBuilder(
      column: $table.vehicleType, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<String> get make => $composableBuilder(
      column: $table.make, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<String> get model => $composableBuilder(
      column: $table.model, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<String> get site => $composableBuilder(
      column: $table.site, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<int> get currentKm => $composableBuilder(
      column: $table.currentKm, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<String> get status => $composableBuilder(
      column: $table.status, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<String> get opsStatus => $composableBuilder(
      column: $table.opsStatus, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<DateTime> get cachedAt => $composableBuilder(
      column: $table.cachedAt, builder: (column) => ColumnOrderings(column));
}

class $$CachedAssetsTableAnnotationComposer
    extends Composer<_$AppDatabase, $CachedAssetsTable> {
  $$CachedAssetsTableAnnotationComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  GeneratedColumn<String> get id =>
      $composableBuilder(column: $table.id, builder: (column) => column);

  GeneratedColumn<String> get workspaceId => $composableBuilder(
      column: $table.workspaceId, builder: (column) => column);

  GeneratedColumn<String> get country =>
      $composableBuilder(column: $table.country, builder: (column) => column);

  GeneratedColumn<String> get assetNo =>
      $composableBuilder(column: $table.assetNo, builder: (column) => column);

  GeneratedColumn<String> get assetNoNorm => $composableBuilder(
      column: $table.assetNoNorm, builder: (column) => column);

  GeneratedColumn<String> get fleetNumber => $composableBuilder(
      column: $table.fleetNumber, builder: (column) => column);

  GeneratedColumn<String> get registrationNo => $composableBuilder(
      column: $table.registrationNo, builder: (column) => column);

  GeneratedColumn<String> get chassisNo =>
      $composableBuilder(column: $table.chassisNo, builder: (column) => column);

  GeneratedColumn<String> get serialNo =>
      $composableBuilder(column: $table.serialNo, builder: (column) => column);

  GeneratedColumn<String> get vehicleType => $composableBuilder(
      column: $table.vehicleType, builder: (column) => column);

  GeneratedColumn<String> get make =>
      $composableBuilder(column: $table.make, builder: (column) => column);

  GeneratedColumn<String> get model =>
      $composableBuilder(column: $table.model, builder: (column) => column);

  GeneratedColumn<String> get site =>
      $composableBuilder(column: $table.site, builder: (column) => column);

  GeneratedColumn<int> get currentKm =>
      $composableBuilder(column: $table.currentKm, builder: (column) => column);

  GeneratedColumn<String> get status =>
      $composableBuilder(column: $table.status, builder: (column) => column);

  GeneratedColumn<String> get opsStatus =>
      $composableBuilder(column: $table.opsStatus, builder: (column) => column);

  GeneratedColumn<DateTime> get cachedAt =>
      $composableBuilder(column: $table.cachedAt, builder: (column) => column);
}

class $$CachedAssetsTableTableManager extends RootTableManager<
    _$AppDatabase,
    $CachedAssetsTable,
    CachedAsset,
    $$CachedAssetsTableFilterComposer,
    $$CachedAssetsTableOrderingComposer,
    $$CachedAssetsTableAnnotationComposer,
    $$CachedAssetsTableCreateCompanionBuilder,
    $$CachedAssetsTableUpdateCompanionBuilder,
    (
      CachedAsset,
      BaseReferences<_$AppDatabase, $CachedAssetsTable, CachedAsset>
    ),
    CachedAsset,
    PrefetchHooks Function()> {
  $$CachedAssetsTableTableManager(_$AppDatabase db, $CachedAssetsTable table)
      : super(TableManagerState(
          db: db,
          table: table,
          createFilteringComposer: () =>
              $$CachedAssetsTableFilterComposer($db: db, $table: table),
          createOrderingComposer: () =>
              $$CachedAssetsTableOrderingComposer($db: db, $table: table),
          createComputedFieldComposer: () =>
              $$CachedAssetsTableAnnotationComposer($db: db, $table: table),
          updateCompanionCallback: ({
            Value<String> id = const Value.absent(),
            Value<String> workspaceId = const Value.absent(),
            Value<String?> country = const Value.absent(),
            Value<String> assetNo = const Value.absent(),
            Value<String> assetNoNorm = const Value.absent(),
            Value<String?> fleetNumber = const Value.absent(),
            Value<String?> registrationNo = const Value.absent(),
            Value<String?> chassisNo = const Value.absent(),
            Value<String?> serialNo = const Value.absent(),
            Value<String?> vehicleType = const Value.absent(),
            Value<String?> make = const Value.absent(),
            Value<String?> model = const Value.absent(),
            Value<String?> site = const Value.absent(),
            Value<int?> currentKm = const Value.absent(),
            Value<String?> status = const Value.absent(),
            Value<String?> opsStatus = const Value.absent(),
            Value<DateTime> cachedAt = const Value.absent(),
            Value<int> rowid = const Value.absent(),
          }) =>
              CachedAssetsCompanion(
            id: id,
            workspaceId: workspaceId,
            country: country,
            assetNo: assetNo,
            assetNoNorm: assetNoNorm,
            fleetNumber: fleetNumber,
            registrationNo: registrationNo,
            chassisNo: chassisNo,
            serialNo: serialNo,
            vehicleType: vehicleType,
            make: make,
            model: model,
            site: site,
            currentKm: currentKm,
            status: status,
            opsStatus: opsStatus,
            cachedAt: cachedAt,
            rowid: rowid,
          ),
          createCompanionCallback: ({
            required String id,
            required String workspaceId,
            Value<String?> country = const Value.absent(),
            required String assetNo,
            required String assetNoNorm,
            Value<String?> fleetNumber = const Value.absent(),
            Value<String?> registrationNo = const Value.absent(),
            Value<String?> chassisNo = const Value.absent(),
            Value<String?> serialNo = const Value.absent(),
            Value<String?> vehicleType = const Value.absent(),
            Value<String?> make = const Value.absent(),
            Value<String?> model = const Value.absent(),
            Value<String?> site = const Value.absent(),
            Value<int?> currentKm = const Value.absent(),
            Value<String?> status = const Value.absent(),
            Value<String?> opsStatus = const Value.absent(),
            required DateTime cachedAt,
            Value<int> rowid = const Value.absent(),
          }) =>
              CachedAssetsCompanion.insert(
            id: id,
            workspaceId: workspaceId,
            country: country,
            assetNo: assetNo,
            assetNoNorm: assetNoNorm,
            fleetNumber: fleetNumber,
            registrationNo: registrationNo,
            chassisNo: chassisNo,
            serialNo: serialNo,
            vehicleType: vehicleType,
            make: make,
            model: model,
            site: site,
            currentKm: currentKm,
            status: status,
            opsStatus: opsStatus,
            cachedAt: cachedAt,
            rowid: rowid,
          ),
          withReferenceMapper: (p0) => p0
              .map((e) => (e.readTable(table), BaseReferences(db, table, e)))
              .toList(),
          prefetchHooksCallback: null,
        ));
}

typedef $$CachedAssetsTableProcessedTableManager = ProcessedTableManager<
    _$AppDatabase,
    $CachedAssetsTable,
    CachedAsset,
    $$CachedAssetsTableFilterComposer,
    $$CachedAssetsTableOrderingComposer,
    $$CachedAssetsTableAnnotationComposer,
    $$CachedAssetsTableCreateCompanionBuilder,
    $$CachedAssetsTableUpdateCompanionBuilder,
    (
      CachedAsset,
      BaseReferences<_$AppDatabase, $CachedAssetsTable, CachedAsset>
    ),
    CachedAsset,
    PrefetchHooks Function()>;
typedef $$CachedTyresTableCreateCompanionBuilder = CachedTyresCompanion
    Function({
  required String id,
  required String workspaceId,
  Value<String?> country,
  Value<String?> serialNo,
  Value<String?> serialNoNorm,
  Value<String?> assetNo,
  Value<String?> position,
  Value<String?> brand,
  Value<String?> size,
  Value<String?> status,
  Value<DateTime?> issueDate,
  Value<DateTime?> removalDate,
  Value<int?> kmAtFitment,
  Value<int?> kmAtRemoval,
  Value<int?> totalKm,
  Value<String?> removalReason,
  required DateTime lastSeenAt,
  required DateTime cachedAt,
  Value<int> rowid,
});
typedef $$CachedTyresTableUpdateCompanionBuilder = CachedTyresCompanion
    Function({
  Value<String> id,
  Value<String> workspaceId,
  Value<String?> country,
  Value<String?> serialNo,
  Value<String?> serialNoNorm,
  Value<String?> assetNo,
  Value<String?> position,
  Value<String?> brand,
  Value<String?> size,
  Value<String?> status,
  Value<DateTime?> issueDate,
  Value<DateTime?> removalDate,
  Value<int?> kmAtFitment,
  Value<int?> kmAtRemoval,
  Value<int?> totalKm,
  Value<String?> removalReason,
  Value<DateTime> lastSeenAt,
  Value<DateTime> cachedAt,
  Value<int> rowid,
});

class $$CachedTyresTableFilterComposer
    extends Composer<_$AppDatabase, $CachedTyresTable> {
  $$CachedTyresTableFilterComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  ColumnFilters<String> get id => $composableBuilder(
      column: $table.id, builder: (column) => ColumnFilters(column));

  ColumnFilters<String> get workspaceId => $composableBuilder(
      column: $table.workspaceId, builder: (column) => ColumnFilters(column));

  ColumnFilters<String> get country => $composableBuilder(
      column: $table.country, builder: (column) => ColumnFilters(column));

  ColumnFilters<String> get serialNo => $composableBuilder(
      column: $table.serialNo, builder: (column) => ColumnFilters(column));

  ColumnFilters<String> get serialNoNorm => $composableBuilder(
      column: $table.serialNoNorm, builder: (column) => ColumnFilters(column));

  ColumnFilters<String> get assetNo => $composableBuilder(
      column: $table.assetNo, builder: (column) => ColumnFilters(column));

  ColumnFilters<String> get position => $composableBuilder(
      column: $table.position, builder: (column) => ColumnFilters(column));

  ColumnFilters<String> get brand => $composableBuilder(
      column: $table.brand, builder: (column) => ColumnFilters(column));

  ColumnFilters<String> get size => $composableBuilder(
      column: $table.size, builder: (column) => ColumnFilters(column));

  ColumnFilters<String> get status => $composableBuilder(
      column: $table.status, builder: (column) => ColumnFilters(column));

  ColumnFilters<DateTime> get issueDate => $composableBuilder(
      column: $table.issueDate, builder: (column) => ColumnFilters(column));

  ColumnFilters<DateTime> get removalDate => $composableBuilder(
      column: $table.removalDate, builder: (column) => ColumnFilters(column));

  ColumnFilters<int> get kmAtFitment => $composableBuilder(
      column: $table.kmAtFitment, builder: (column) => ColumnFilters(column));

  ColumnFilters<int> get kmAtRemoval => $composableBuilder(
      column: $table.kmAtRemoval, builder: (column) => ColumnFilters(column));

  ColumnFilters<int> get totalKm => $composableBuilder(
      column: $table.totalKm, builder: (column) => ColumnFilters(column));

  ColumnFilters<String> get removalReason => $composableBuilder(
      column: $table.removalReason, builder: (column) => ColumnFilters(column));

  ColumnFilters<DateTime> get lastSeenAt => $composableBuilder(
      column: $table.lastSeenAt, builder: (column) => ColumnFilters(column));

  ColumnFilters<DateTime> get cachedAt => $composableBuilder(
      column: $table.cachedAt, builder: (column) => ColumnFilters(column));
}

class $$CachedTyresTableOrderingComposer
    extends Composer<_$AppDatabase, $CachedTyresTable> {
  $$CachedTyresTableOrderingComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  ColumnOrderings<String> get id => $composableBuilder(
      column: $table.id, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<String> get workspaceId => $composableBuilder(
      column: $table.workspaceId, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<String> get country => $composableBuilder(
      column: $table.country, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<String> get serialNo => $composableBuilder(
      column: $table.serialNo, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<String> get serialNoNorm => $composableBuilder(
      column: $table.serialNoNorm,
      builder: (column) => ColumnOrderings(column));

  ColumnOrderings<String> get assetNo => $composableBuilder(
      column: $table.assetNo, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<String> get position => $composableBuilder(
      column: $table.position, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<String> get brand => $composableBuilder(
      column: $table.brand, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<String> get size => $composableBuilder(
      column: $table.size, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<String> get status => $composableBuilder(
      column: $table.status, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<DateTime> get issueDate => $composableBuilder(
      column: $table.issueDate, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<DateTime> get removalDate => $composableBuilder(
      column: $table.removalDate, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<int> get kmAtFitment => $composableBuilder(
      column: $table.kmAtFitment, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<int> get kmAtRemoval => $composableBuilder(
      column: $table.kmAtRemoval, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<int> get totalKm => $composableBuilder(
      column: $table.totalKm, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<String> get removalReason => $composableBuilder(
      column: $table.removalReason,
      builder: (column) => ColumnOrderings(column));

  ColumnOrderings<DateTime> get lastSeenAt => $composableBuilder(
      column: $table.lastSeenAt, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<DateTime> get cachedAt => $composableBuilder(
      column: $table.cachedAt, builder: (column) => ColumnOrderings(column));
}

class $$CachedTyresTableAnnotationComposer
    extends Composer<_$AppDatabase, $CachedTyresTable> {
  $$CachedTyresTableAnnotationComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  GeneratedColumn<String> get id =>
      $composableBuilder(column: $table.id, builder: (column) => column);

  GeneratedColumn<String> get workspaceId => $composableBuilder(
      column: $table.workspaceId, builder: (column) => column);

  GeneratedColumn<String> get country =>
      $composableBuilder(column: $table.country, builder: (column) => column);

  GeneratedColumn<String> get serialNo =>
      $composableBuilder(column: $table.serialNo, builder: (column) => column);

  GeneratedColumn<String> get serialNoNorm => $composableBuilder(
      column: $table.serialNoNorm, builder: (column) => column);

  GeneratedColumn<String> get assetNo =>
      $composableBuilder(column: $table.assetNo, builder: (column) => column);

  GeneratedColumn<String> get position =>
      $composableBuilder(column: $table.position, builder: (column) => column);

  GeneratedColumn<String> get brand =>
      $composableBuilder(column: $table.brand, builder: (column) => column);

  GeneratedColumn<String> get size =>
      $composableBuilder(column: $table.size, builder: (column) => column);

  GeneratedColumn<String> get status =>
      $composableBuilder(column: $table.status, builder: (column) => column);

  GeneratedColumn<DateTime> get issueDate =>
      $composableBuilder(column: $table.issueDate, builder: (column) => column);

  GeneratedColumn<DateTime> get removalDate => $composableBuilder(
      column: $table.removalDate, builder: (column) => column);

  GeneratedColumn<int> get kmAtFitment => $composableBuilder(
      column: $table.kmAtFitment, builder: (column) => column);

  GeneratedColumn<int> get kmAtRemoval => $composableBuilder(
      column: $table.kmAtRemoval, builder: (column) => column);

  GeneratedColumn<int> get totalKm =>
      $composableBuilder(column: $table.totalKm, builder: (column) => column);

  GeneratedColumn<String> get removalReason => $composableBuilder(
      column: $table.removalReason, builder: (column) => column);

  GeneratedColumn<DateTime> get lastSeenAt => $composableBuilder(
      column: $table.lastSeenAt, builder: (column) => column);

  GeneratedColumn<DateTime> get cachedAt =>
      $composableBuilder(column: $table.cachedAt, builder: (column) => column);
}

class $$CachedTyresTableTableManager extends RootTableManager<
    _$AppDatabase,
    $CachedTyresTable,
    CachedTyre,
    $$CachedTyresTableFilterComposer,
    $$CachedTyresTableOrderingComposer,
    $$CachedTyresTableAnnotationComposer,
    $$CachedTyresTableCreateCompanionBuilder,
    $$CachedTyresTableUpdateCompanionBuilder,
    (CachedTyre, BaseReferences<_$AppDatabase, $CachedTyresTable, CachedTyre>),
    CachedTyre,
    PrefetchHooks Function()> {
  $$CachedTyresTableTableManager(_$AppDatabase db, $CachedTyresTable table)
      : super(TableManagerState(
          db: db,
          table: table,
          createFilteringComposer: () =>
              $$CachedTyresTableFilterComposer($db: db, $table: table),
          createOrderingComposer: () =>
              $$CachedTyresTableOrderingComposer($db: db, $table: table),
          createComputedFieldComposer: () =>
              $$CachedTyresTableAnnotationComposer($db: db, $table: table),
          updateCompanionCallback: ({
            Value<String> id = const Value.absent(),
            Value<String> workspaceId = const Value.absent(),
            Value<String?> country = const Value.absent(),
            Value<String?> serialNo = const Value.absent(),
            Value<String?> serialNoNorm = const Value.absent(),
            Value<String?> assetNo = const Value.absent(),
            Value<String?> position = const Value.absent(),
            Value<String?> brand = const Value.absent(),
            Value<String?> size = const Value.absent(),
            Value<String?> status = const Value.absent(),
            Value<DateTime?> issueDate = const Value.absent(),
            Value<DateTime?> removalDate = const Value.absent(),
            Value<int?> kmAtFitment = const Value.absent(),
            Value<int?> kmAtRemoval = const Value.absent(),
            Value<int?> totalKm = const Value.absent(),
            Value<String?> removalReason = const Value.absent(),
            Value<DateTime> lastSeenAt = const Value.absent(),
            Value<DateTime> cachedAt = const Value.absent(),
            Value<int> rowid = const Value.absent(),
          }) =>
              CachedTyresCompanion(
            id: id,
            workspaceId: workspaceId,
            country: country,
            serialNo: serialNo,
            serialNoNorm: serialNoNorm,
            assetNo: assetNo,
            position: position,
            brand: brand,
            size: size,
            status: status,
            issueDate: issueDate,
            removalDate: removalDate,
            kmAtFitment: kmAtFitment,
            kmAtRemoval: kmAtRemoval,
            totalKm: totalKm,
            removalReason: removalReason,
            lastSeenAt: lastSeenAt,
            cachedAt: cachedAt,
            rowid: rowid,
          ),
          createCompanionCallback: ({
            required String id,
            required String workspaceId,
            Value<String?> country = const Value.absent(),
            Value<String?> serialNo = const Value.absent(),
            Value<String?> serialNoNorm = const Value.absent(),
            Value<String?> assetNo = const Value.absent(),
            Value<String?> position = const Value.absent(),
            Value<String?> brand = const Value.absent(),
            Value<String?> size = const Value.absent(),
            Value<String?> status = const Value.absent(),
            Value<DateTime?> issueDate = const Value.absent(),
            Value<DateTime?> removalDate = const Value.absent(),
            Value<int?> kmAtFitment = const Value.absent(),
            Value<int?> kmAtRemoval = const Value.absent(),
            Value<int?> totalKm = const Value.absent(),
            Value<String?> removalReason = const Value.absent(),
            required DateTime lastSeenAt,
            required DateTime cachedAt,
            Value<int> rowid = const Value.absent(),
          }) =>
              CachedTyresCompanion.insert(
            id: id,
            workspaceId: workspaceId,
            country: country,
            serialNo: serialNo,
            serialNoNorm: serialNoNorm,
            assetNo: assetNo,
            position: position,
            brand: brand,
            size: size,
            status: status,
            issueDate: issueDate,
            removalDate: removalDate,
            kmAtFitment: kmAtFitment,
            kmAtRemoval: kmAtRemoval,
            totalKm: totalKm,
            removalReason: removalReason,
            lastSeenAt: lastSeenAt,
            cachedAt: cachedAt,
            rowid: rowid,
          ),
          withReferenceMapper: (p0) => p0
              .map((e) => (e.readTable(table), BaseReferences(db, table, e)))
              .toList(),
          prefetchHooksCallback: null,
        ));
}

typedef $$CachedTyresTableProcessedTableManager = ProcessedTableManager<
    _$AppDatabase,
    $CachedTyresTable,
    CachedTyre,
    $$CachedTyresTableFilterComposer,
    $$CachedTyresTableOrderingComposer,
    $$CachedTyresTableAnnotationComposer,
    $$CachedTyresTableCreateCompanionBuilder,
    $$CachedTyresTableUpdateCompanionBuilder,
    (CachedTyre, BaseReferences<_$AppDatabase, $CachedTyresTable, CachedTyre>),
    CachedTyre,
    PrefetchHooks Function()>;
typedef $$CachedChecklistTemplatesTableCreateCompanionBuilder
    = CachedChecklistTemplatesCompanion Function({
  required String id,
  required String workspaceId,
  Value<String?> country,
  required String name,
  required int version,
  required String status,
  Value<String?> icon,
  Value<String?> category,
  required String fieldsJson,
  Value<String?> assigneeRolesJson,
  required bool requireSignature,
  required bool requireApproval,
  Value<int?> minIntervalDays,
  required DateTime cachedAt,
  Value<int> rowid,
});
typedef $$CachedChecklistTemplatesTableUpdateCompanionBuilder
    = CachedChecklistTemplatesCompanion Function({
  Value<String> id,
  Value<String> workspaceId,
  Value<String?> country,
  Value<String> name,
  Value<int> version,
  Value<String> status,
  Value<String?> icon,
  Value<String?> category,
  Value<String> fieldsJson,
  Value<String?> assigneeRolesJson,
  Value<bool> requireSignature,
  Value<bool> requireApproval,
  Value<int?> minIntervalDays,
  Value<DateTime> cachedAt,
  Value<int> rowid,
});

class $$CachedChecklistTemplatesTableFilterComposer
    extends Composer<_$AppDatabase, $CachedChecklistTemplatesTable> {
  $$CachedChecklistTemplatesTableFilterComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  ColumnFilters<String> get id => $composableBuilder(
      column: $table.id, builder: (column) => ColumnFilters(column));

  ColumnFilters<String> get workspaceId => $composableBuilder(
      column: $table.workspaceId, builder: (column) => ColumnFilters(column));

  ColumnFilters<String> get country => $composableBuilder(
      column: $table.country, builder: (column) => ColumnFilters(column));

  ColumnFilters<String> get name => $composableBuilder(
      column: $table.name, builder: (column) => ColumnFilters(column));

  ColumnFilters<int> get version => $composableBuilder(
      column: $table.version, builder: (column) => ColumnFilters(column));

  ColumnFilters<String> get status => $composableBuilder(
      column: $table.status, builder: (column) => ColumnFilters(column));

  ColumnFilters<String> get icon => $composableBuilder(
      column: $table.icon, builder: (column) => ColumnFilters(column));

  ColumnFilters<String> get category => $composableBuilder(
      column: $table.category, builder: (column) => ColumnFilters(column));

  ColumnFilters<String> get fieldsJson => $composableBuilder(
      column: $table.fieldsJson, builder: (column) => ColumnFilters(column));

  ColumnFilters<String> get assigneeRolesJson => $composableBuilder(
      column: $table.assigneeRolesJson,
      builder: (column) => ColumnFilters(column));

  ColumnFilters<bool> get requireSignature => $composableBuilder(
      column: $table.requireSignature,
      builder: (column) => ColumnFilters(column));

  ColumnFilters<bool> get requireApproval => $composableBuilder(
      column: $table.requireApproval,
      builder: (column) => ColumnFilters(column));

  ColumnFilters<int> get minIntervalDays => $composableBuilder(
      column: $table.minIntervalDays,
      builder: (column) => ColumnFilters(column));

  ColumnFilters<DateTime> get cachedAt => $composableBuilder(
      column: $table.cachedAt, builder: (column) => ColumnFilters(column));
}

class $$CachedChecklistTemplatesTableOrderingComposer
    extends Composer<_$AppDatabase, $CachedChecklistTemplatesTable> {
  $$CachedChecklistTemplatesTableOrderingComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  ColumnOrderings<String> get id => $composableBuilder(
      column: $table.id, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<String> get workspaceId => $composableBuilder(
      column: $table.workspaceId, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<String> get country => $composableBuilder(
      column: $table.country, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<String> get name => $composableBuilder(
      column: $table.name, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<int> get version => $composableBuilder(
      column: $table.version, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<String> get status => $composableBuilder(
      column: $table.status, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<String> get icon => $composableBuilder(
      column: $table.icon, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<String> get category => $composableBuilder(
      column: $table.category, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<String> get fieldsJson => $composableBuilder(
      column: $table.fieldsJson, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<String> get assigneeRolesJson => $composableBuilder(
      column: $table.assigneeRolesJson,
      builder: (column) => ColumnOrderings(column));

  ColumnOrderings<bool> get requireSignature => $composableBuilder(
      column: $table.requireSignature,
      builder: (column) => ColumnOrderings(column));

  ColumnOrderings<bool> get requireApproval => $composableBuilder(
      column: $table.requireApproval,
      builder: (column) => ColumnOrderings(column));

  ColumnOrderings<int> get minIntervalDays => $composableBuilder(
      column: $table.minIntervalDays,
      builder: (column) => ColumnOrderings(column));

  ColumnOrderings<DateTime> get cachedAt => $composableBuilder(
      column: $table.cachedAt, builder: (column) => ColumnOrderings(column));
}

class $$CachedChecklistTemplatesTableAnnotationComposer
    extends Composer<_$AppDatabase, $CachedChecklistTemplatesTable> {
  $$CachedChecklistTemplatesTableAnnotationComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  GeneratedColumn<String> get id =>
      $composableBuilder(column: $table.id, builder: (column) => column);

  GeneratedColumn<String> get workspaceId => $composableBuilder(
      column: $table.workspaceId, builder: (column) => column);

  GeneratedColumn<String> get country =>
      $composableBuilder(column: $table.country, builder: (column) => column);

  GeneratedColumn<String> get name =>
      $composableBuilder(column: $table.name, builder: (column) => column);

  GeneratedColumn<int> get version =>
      $composableBuilder(column: $table.version, builder: (column) => column);

  GeneratedColumn<String> get status =>
      $composableBuilder(column: $table.status, builder: (column) => column);

  GeneratedColumn<String> get icon =>
      $composableBuilder(column: $table.icon, builder: (column) => column);

  GeneratedColumn<String> get category =>
      $composableBuilder(column: $table.category, builder: (column) => column);

  GeneratedColumn<String> get fieldsJson => $composableBuilder(
      column: $table.fieldsJson, builder: (column) => column);

  GeneratedColumn<String> get assigneeRolesJson => $composableBuilder(
      column: $table.assigneeRolesJson, builder: (column) => column);

  GeneratedColumn<bool> get requireSignature => $composableBuilder(
      column: $table.requireSignature, builder: (column) => column);

  GeneratedColumn<bool> get requireApproval => $composableBuilder(
      column: $table.requireApproval, builder: (column) => column);

  GeneratedColumn<int> get minIntervalDays => $composableBuilder(
      column: $table.minIntervalDays, builder: (column) => column);

  GeneratedColumn<DateTime> get cachedAt =>
      $composableBuilder(column: $table.cachedAt, builder: (column) => column);
}

class $$CachedChecklistTemplatesTableTableManager extends RootTableManager<
    _$AppDatabase,
    $CachedChecklistTemplatesTable,
    CachedChecklistTemplate,
    $$CachedChecklistTemplatesTableFilterComposer,
    $$CachedChecklistTemplatesTableOrderingComposer,
    $$CachedChecklistTemplatesTableAnnotationComposer,
    $$CachedChecklistTemplatesTableCreateCompanionBuilder,
    $$CachedChecklistTemplatesTableUpdateCompanionBuilder,
    (
      CachedChecklistTemplate,
      BaseReferences<_$AppDatabase, $CachedChecklistTemplatesTable,
          CachedChecklistTemplate>
    ),
    CachedChecklistTemplate,
    PrefetchHooks Function()> {
  $$CachedChecklistTemplatesTableTableManager(
      _$AppDatabase db, $CachedChecklistTemplatesTable table)
      : super(TableManagerState(
          db: db,
          table: table,
          createFilteringComposer: () =>
              $$CachedChecklistTemplatesTableFilterComposer(
                  $db: db, $table: table),
          createOrderingComposer: () =>
              $$CachedChecklistTemplatesTableOrderingComposer(
                  $db: db, $table: table),
          createComputedFieldComposer: () =>
              $$CachedChecklistTemplatesTableAnnotationComposer(
                  $db: db, $table: table),
          updateCompanionCallback: ({
            Value<String> id = const Value.absent(),
            Value<String> workspaceId = const Value.absent(),
            Value<String?> country = const Value.absent(),
            Value<String> name = const Value.absent(),
            Value<int> version = const Value.absent(),
            Value<String> status = const Value.absent(),
            Value<String?> icon = const Value.absent(),
            Value<String?> category = const Value.absent(),
            Value<String> fieldsJson = const Value.absent(),
            Value<String?> assigneeRolesJson = const Value.absent(),
            Value<bool> requireSignature = const Value.absent(),
            Value<bool> requireApproval = const Value.absent(),
            Value<int?> minIntervalDays = const Value.absent(),
            Value<DateTime> cachedAt = const Value.absent(),
            Value<int> rowid = const Value.absent(),
          }) =>
              CachedChecklistTemplatesCompanion(
            id: id,
            workspaceId: workspaceId,
            country: country,
            name: name,
            version: version,
            status: status,
            icon: icon,
            category: category,
            fieldsJson: fieldsJson,
            assigneeRolesJson: assigneeRolesJson,
            requireSignature: requireSignature,
            requireApproval: requireApproval,
            minIntervalDays: minIntervalDays,
            cachedAt: cachedAt,
            rowid: rowid,
          ),
          createCompanionCallback: ({
            required String id,
            required String workspaceId,
            Value<String?> country = const Value.absent(),
            required String name,
            required int version,
            required String status,
            Value<String?> icon = const Value.absent(),
            Value<String?> category = const Value.absent(),
            required String fieldsJson,
            Value<String?> assigneeRolesJson = const Value.absent(),
            required bool requireSignature,
            required bool requireApproval,
            Value<int?> minIntervalDays = const Value.absent(),
            required DateTime cachedAt,
            Value<int> rowid = const Value.absent(),
          }) =>
              CachedChecklistTemplatesCompanion.insert(
            id: id,
            workspaceId: workspaceId,
            country: country,
            name: name,
            version: version,
            status: status,
            icon: icon,
            category: category,
            fieldsJson: fieldsJson,
            assigneeRolesJson: assigneeRolesJson,
            requireSignature: requireSignature,
            requireApproval: requireApproval,
            minIntervalDays: minIntervalDays,
            cachedAt: cachedAt,
            rowid: rowid,
          ),
          withReferenceMapper: (p0) => p0
              .map((e) => (e.readTable(table), BaseReferences(db, table, e)))
              .toList(),
          prefetchHooksCallback: null,
        ));
}

typedef $$CachedChecklistTemplatesTableProcessedTableManager
    = ProcessedTableManager<
        _$AppDatabase,
        $CachedChecklistTemplatesTable,
        CachedChecklistTemplate,
        $$CachedChecklistTemplatesTableFilterComposer,
        $$CachedChecklistTemplatesTableOrderingComposer,
        $$CachedChecklistTemplatesTableAnnotationComposer,
        $$CachedChecklistTemplatesTableCreateCompanionBuilder,
        $$CachedChecklistTemplatesTableUpdateCompanionBuilder,
        (
          CachedChecklistTemplate,
          BaseReferences<_$AppDatabase, $CachedChecklistTemplatesTable,
              CachedChecklistTemplate>
        ),
        CachedChecklistTemplate,
        PrefetchHooks Function()>;
typedef $$CachedPermissionsTableCreateCompanionBuilder
    = CachedPermissionsCompanion Function({
  required String userId,
  required String moduleKey,
  required String workspaceId,
  required String effect,
  required String capability,
  Value<DateTime?> expiresAt,
  required DateTime cachedAt,
  Value<int> rowid,
});
typedef $$CachedPermissionsTableUpdateCompanionBuilder
    = CachedPermissionsCompanion Function({
  Value<String> userId,
  Value<String> moduleKey,
  Value<String> workspaceId,
  Value<String> effect,
  Value<String> capability,
  Value<DateTime?> expiresAt,
  Value<DateTime> cachedAt,
  Value<int> rowid,
});

class $$CachedPermissionsTableFilterComposer
    extends Composer<_$AppDatabase, $CachedPermissionsTable> {
  $$CachedPermissionsTableFilterComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  ColumnFilters<String> get userId => $composableBuilder(
      column: $table.userId, builder: (column) => ColumnFilters(column));

  ColumnFilters<String> get moduleKey => $composableBuilder(
      column: $table.moduleKey, builder: (column) => ColumnFilters(column));

  ColumnFilters<String> get workspaceId => $composableBuilder(
      column: $table.workspaceId, builder: (column) => ColumnFilters(column));

  ColumnFilters<String> get effect => $composableBuilder(
      column: $table.effect, builder: (column) => ColumnFilters(column));

  ColumnFilters<String> get capability => $composableBuilder(
      column: $table.capability, builder: (column) => ColumnFilters(column));

  ColumnFilters<DateTime> get expiresAt => $composableBuilder(
      column: $table.expiresAt, builder: (column) => ColumnFilters(column));

  ColumnFilters<DateTime> get cachedAt => $composableBuilder(
      column: $table.cachedAt, builder: (column) => ColumnFilters(column));
}

class $$CachedPermissionsTableOrderingComposer
    extends Composer<_$AppDatabase, $CachedPermissionsTable> {
  $$CachedPermissionsTableOrderingComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  ColumnOrderings<String> get userId => $composableBuilder(
      column: $table.userId, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<String> get moduleKey => $composableBuilder(
      column: $table.moduleKey, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<String> get workspaceId => $composableBuilder(
      column: $table.workspaceId, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<String> get effect => $composableBuilder(
      column: $table.effect, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<String> get capability => $composableBuilder(
      column: $table.capability, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<DateTime> get expiresAt => $composableBuilder(
      column: $table.expiresAt, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<DateTime> get cachedAt => $composableBuilder(
      column: $table.cachedAt, builder: (column) => ColumnOrderings(column));
}

class $$CachedPermissionsTableAnnotationComposer
    extends Composer<_$AppDatabase, $CachedPermissionsTable> {
  $$CachedPermissionsTableAnnotationComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  GeneratedColumn<String> get userId =>
      $composableBuilder(column: $table.userId, builder: (column) => column);

  GeneratedColumn<String> get moduleKey =>
      $composableBuilder(column: $table.moduleKey, builder: (column) => column);

  GeneratedColumn<String> get workspaceId => $composableBuilder(
      column: $table.workspaceId, builder: (column) => column);

  GeneratedColumn<String> get effect =>
      $composableBuilder(column: $table.effect, builder: (column) => column);

  GeneratedColumn<String> get capability => $composableBuilder(
      column: $table.capability, builder: (column) => column);

  GeneratedColumn<DateTime> get expiresAt =>
      $composableBuilder(column: $table.expiresAt, builder: (column) => column);

  GeneratedColumn<DateTime> get cachedAt =>
      $composableBuilder(column: $table.cachedAt, builder: (column) => column);
}

class $$CachedPermissionsTableTableManager extends RootTableManager<
    _$AppDatabase,
    $CachedPermissionsTable,
    CachedPermission,
    $$CachedPermissionsTableFilterComposer,
    $$CachedPermissionsTableOrderingComposer,
    $$CachedPermissionsTableAnnotationComposer,
    $$CachedPermissionsTableCreateCompanionBuilder,
    $$CachedPermissionsTableUpdateCompanionBuilder,
    (
      CachedPermission,
      BaseReferences<_$AppDatabase, $CachedPermissionsTable, CachedPermission>
    ),
    CachedPermission,
    PrefetchHooks Function()> {
  $$CachedPermissionsTableTableManager(
      _$AppDatabase db, $CachedPermissionsTable table)
      : super(TableManagerState(
          db: db,
          table: table,
          createFilteringComposer: () =>
              $$CachedPermissionsTableFilterComposer($db: db, $table: table),
          createOrderingComposer: () =>
              $$CachedPermissionsTableOrderingComposer($db: db, $table: table),
          createComputedFieldComposer: () =>
              $$CachedPermissionsTableAnnotationComposer(
                  $db: db, $table: table),
          updateCompanionCallback: ({
            Value<String> userId = const Value.absent(),
            Value<String> moduleKey = const Value.absent(),
            Value<String> workspaceId = const Value.absent(),
            Value<String> effect = const Value.absent(),
            Value<String> capability = const Value.absent(),
            Value<DateTime?> expiresAt = const Value.absent(),
            Value<DateTime> cachedAt = const Value.absent(),
            Value<int> rowid = const Value.absent(),
          }) =>
              CachedPermissionsCompanion(
            userId: userId,
            moduleKey: moduleKey,
            workspaceId: workspaceId,
            effect: effect,
            capability: capability,
            expiresAt: expiresAt,
            cachedAt: cachedAt,
            rowid: rowid,
          ),
          createCompanionCallback: ({
            required String userId,
            required String moduleKey,
            required String workspaceId,
            required String effect,
            required String capability,
            Value<DateTime?> expiresAt = const Value.absent(),
            required DateTime cachedAt,
            Value<int> rowid = const Value.absent(),
          }) =>
              CachedPermissionsCompanion.insert(
            userId: userId,
            moduleKey: moduleKey,
            workspaceId: workspaceId,
            effect: effect,
            capability: capability,
            expiresAt: expiresAt,
            cachedAt: cachedAt,
            rowid: rowid,
          ),
          withReferenceMapper: (p0) => p0
              .map((e) => (e.readTable(table), BaseReferences(db, table, e)))
              .toList(),
          prefetchHooksCallback: null,
        ));
}

typedef $$CachedPermissionsTableProcessedTableManager = ProcessedTableManager<
    _$AppDatabase,
    $CachedPermissionsTable,
    CachedPermission,
    $$CachedPermissionsTableFilterComposer,
    $$CachedPermissionsTableOrderingComposer,
    $$CachedPermissionsTableAnnotationComposer,
    $$CachedPermissionsTableCreateCompanionBuilder,
    $$CachedPermissionsTableUpdateCompanionBuilder,
    (
      CachedPermission,
      BaseReferences<_$AppDatabase, $CachedPermissionsTable, CachedPermission>
    ),
    CachedPermission,
    PrefetchHooks Function()>;
typedef $$InspectionDraftsTableCreateCompanionBuilder
    = InspectionDraftsCompanion Function({
  required String draftKey,
  required String userId,
  required String workspaceId,
  Value<String?> country,
  required String assetNo,
  Value<String?> vehicleType,
  Value<String?> site,
  Value<String?> inspectorName,
  Value<int?> odometerKm,
  Value<double?> engineHours,
  Value<String?> findings,
  required int filled,
  required int total,
  required DateTime createdAt,
  required DateTime updatedAt,
  Value<int> rowid,
});
typedef $$InspectionDraftsTableUpdateCompanionBuilder
    = InspectionDraftsCompanion Function({
  Value<String> draftKey,
  Value<String> userId,
  Value<String> workspaceId,
  Value<String?> country,
  Value<String> assetNo,
  Value<String?> vehicleType,
  Value<String?> site,
  Value<String?> inspectorName,
  Value<int?> odometerKm,
  Value<double?> engineHours,
  Value<String?> findings,
  Value<int> filled,
  Value<int> total,
  Value<DateTime> createdAt,
  Value<DateTime> updatedAt,
  Value<int> rowid,
});

final class $$InspectionDraftsTableReferences extends BaseReferences<
    _$AppDatabase, $InspectionDraftsTable, InspectionDraft> {
  $$InspectionDraftsTableReferences(
      super.$_db, super.$_table, super.$_typedResult);

  static MultiTypedResultKey<$InspectionDraftPositionsTable,
      List<InspectionDraftPosition>> _inspectionDraftPositionsRefsTable(
          _$AppDatabase db) =>
      MultiTypedResultKey.fromTable(db.inspectionDraftPositions,
          aliasName:
              'inspection_drafts__draft_key__inspection_draft_positions__draft_key');

  $$InspectionDraftPositionsTableProcessedTableManager
      get inspectionDraftPositionsRefs {
    final manager = $$InspectionDraftPositionsTableTableManager(
            $_db, $_db.inspectionDraftPositions)
        .filter((f) =>
            f.draftKey.draftKey.sqlEquals($_itemColumn<String>('draft_key')!));

    final cache =
        $_typedResult.readTableOrNull(_inspectionDraftPositionsRefsTable($_db));
    return ProcessedTableManager(
        manager.$state.copyWith(prefetchedData: cache));
  }
}

class $$InspectionDraftsTableFilterComposer
    extends Composer<_$AppDatabase, $InspectionDraftsTable> {
  $$InspectionDraftsTableFilterComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  ColumnFilters<String> get draftKey => $composableBuilder(
      column: $table.draftKey, builder: (column) => ColumnFilters(column));

  ColumnFilters<String> get userId => $composableBuilder(
      column: $table.userId, builder: (column) => ColumnFilters(column));

  ColumnFilters<String> get workspaceId => $composableBuilder(
      column: $table.workspaceId, builder: (column) => ColumnFilters(column));

  ColumnFilters<String> get country => $composableBuilder(
      column: $table.country, builder: (column) => ColumnFilters(column));

  ColumnFilters<String> get assetNo => $composableBuilder(
      column: $table.assetNo, builder: (column) => ColumnFilters(column));

  ColumnFilters<String> get vehicleType => $composableBuilder(
      column: $table.vehicleType, builder: (column) => ColumnFilters(column));

  ColumnFilters<String> get site => $composableBuilder(
      column: $table.site, builder: (column) => ColumnFilters(column));

  ColumnFilters<String> get inspectorName => $composableBuilder(
      column: $table.inspectorName, builder: (column) => ColumnFilters(column));

  ColumnFilters<int> get odometerKm => $composableBuilder(
      column: $table.odometerKm, builder: (column) => ColumnFilters(column));

  ColumnFilters<double> get engineHours => $composableBuilder(
      column: $table.engineHours, builder: (column) => ColumnFilters(column));

  ColumnFilters<String> get findings => $composableBuilder(
      column: $table.findings, builder: (column) => ColumnFilters(column));

  ColumnFilters<int> get filled => $composableBuilder(
      column: $table.filled, builder: (column) => ColumnFilters(column));

  ColumnFilters<int> get total => $composableBuilder(
      column: $table.total, builder: (column) => ColumnFilters(column));

  ColumnFilters<DateTime> get createdAt => $composableBuilder(
      column: $table.createdAt, builder: (column) => ColumnFilters(column));

  ColumnFilters<DateTime> get updatedAt => $composableBuilder(
      column: $table.updatedAt, builder: (column) => ColumnFilters(column));

  Expression<bool> inspectionDraftPositionsRefs(
      Expression<bool> Function($$InspectionDraftPositionsTableFilterComposer f)
          f) {
    final $$InspectionDraftPositionsTableFilterComposer composer =
        $composerBuilder(
            composer: this,
            getCurrentColumn: (t) => t.draftKey,
            referencedTable: $db.inspectionDraftPositions,
            getReferencedColumn: (t) => t.draftKey,
            builder: (joinBuilder,
                    {$addJoinBuilderToRootComposer,
                    $removeJoinBuilderFromRootComposer}) =>
                $$InspectionDraftPositionsTableFilterComposer(
                  $db: $db,
                  $table: $db.inspectionDraftPositions,
                  $addJoinBuilderToRootComposer: $addJoinBuilderToRootComposer,
                  joinBuilder: joinBuilder,
                  $removeJoinBuilderFromRootComposer:
                      $removeJoinBuilderFromRootComposer,
                ));
    return f(composer);
  }
}

class $$InspectionDraftsTableOrderingComposer
    extends Composer<_$AppDatabase, $InspectionDraftsTable> {
  $$InspectionDraftsTableOrderingComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  ColumnOrderings<String> get draftKey => $composableBuilder(
      column: $table.draftKey, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<String> get userId => $composableBuilder(
      column: $table.userId, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<String> get workspaceId => $composableBuilder(
      column: $table.workspaceId, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<String> get country => $composableBuilder(
      column: $table.country, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<String> get assetNo => $composableBuilder(
      column: $table.assetNo, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<String> get vehicleType => $composableBuilder(
      column: $table.vehicleType, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<String> get site => $composableBuilder(
      column: $table.site, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<String> get inspectorName => $composableBuilder(
      column: $table.inspectorName,
      builder: (column) => ColumnOrderings(column));

  ColumnOrderings<int> get odometerKm => $composableBuilder(
      column: $table.odometerKm, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<double> get engineHours => $composableBuilder(
      column: $table.engineHours, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<String> get findings => $composableBuilder(
      column: $table.findings, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<int> get filled => $composableBuilder(
      column: $table.filled, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<int> get total => $composableBuilder(
      column: $table.total, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<DateTime> get createdAt => $composableBuilder(
      column: $table.createdAt, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<DateTime> get updatedAt => $composableBuilder(
      column: $table.updatedAt, builder: (column) => ColumnOrderings(column));
}

class $$InspectionDraftsTableAnnotationComposer
    extends Composer<_$AppDatabase, $InspectionDraftsTable> {
  $$InspectionDraftsTableAnnotationComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  GeneratedColumn<String> get draftKey =>
      $composableBuilder(column: $table.draftKey, builder: (column) => column);

  GeneratedColumn<String> get userId =>
      $composableBuilder(column: $table.userId, builder: (column) => column);

  GeneratedColumn<String> get workspaceId => $composableBuilder(
      column: $table.workspaceId, builder: (column) => column);

  GeneratedColumn<String> get country =>
      $composableBuilder(column: $table.country, builder: (column) => column);

  GeneratedColumn<String> get assetNo =>
      $composableBuilder(column: $table.assetNo, builder: (column) => column);

  GeneratedColumn<String> get vehicleType => $composableBuilder(
      column: $table.vehicleType, builder: (column) => column);

  GeneratedColumn<String> get site =>
      $composableBuilder(column: $table.site, builder: (column) => column);

  GeneratedColumn<String> get inspectorName => $composableBuilder(
      column: $table.inspectorName, builder: (column) => column);

  GeneratedColumn<int> get odometerKm => $composableBuilder(
      column: $table.odometerKm, builder: (column) => column);

  GeneratedColumn<double> get engineHours => $composableBuilder(
      column: $table.engineHours, builder: (column) => column);

  GeneratedColumn<String> get findings =>
      $composableBuilder(column: $table.findings, builder: (column) => column);

  GeneratedColumn<int> get filled =>
      $composableBuilder(column: $table.filled, builder: (column) => column);

  GeneratedColumn<int> get total =>
      $composableBuilder(column: $table.total, builder: (column) => column);

  GeneratedColumn<DateTime> get createdAt =>
      $composableBuilder(column: $table.createdAt, builder: (column) => column);

  GeneratedColumn<DateTime> get updatedAt =>
      $composableBuilder(column: $table.updatedAt, builder: (column) => column);

  Expression<T> inspectionDraftPositionsRefs<T extends Object>(
      Expression<T> Function(
              $$InspectionDraftPositionsTableAnnotationComposer a)
          f) {
    final $$InspectionDraftPositionsTableAnnotationComposer composer =
        $composerBuilder(
            composer: this,
            getCurrentColumn: (t) => t.draftKey,
            referencedTable: $db.inspectionDraftPositions,
            getReferencedColumn: (t) => t.draftKey,
            builder: (joinBuilder,
                    {$addJoinBuilderToRootComposer,
                    $removeJoinBuilderFromRootComposer}) =>
                $$InspectionDraftPositionsTableAnnotationComposer(
                  $db: $db,
                  $table: $db.inspectionDraftPositions,
                  $addJoinBuilderToRootComposer: $addJoinBuilderToRootComposer,
                  joinBuilder: joinBuilder,
                  $removeJoinBuilderFromRootComposer:
                      $removeJoinBuilderFromRootComposer,
                ));
    return f(composer);
  }
}

class $$InspectionDraftsTableTableManager extends RootTableManager<
    _$AppDatabase,
    $InspectionDraftsTable,
    InspectionDraft,
    $$InspectionDraftsTableFilterComposer,
    $$InspectionDraftsTableOrderingComposer,
    $$InspectionDraftsTableAnnotationComposer,
    $$InspectionDraftsTableCreateCompanionBuilder,
    $$InspectionDraftsTableUpdateCompanionBuilder,
    (InspectionDraft, $$InspectionDraftsTableReferences),
    InspectionDraft,
    PrefetchHooks Function({bool inspectionDraftPositionsRefs})> {
  $$InspectionDraftsTableTableManager(
      _$AppDatabase db, $InspectionDraftsTable table)
      : super(TableManagerState(
          db: db,
          table: table,
          createFilteringComposer: () =>
              $$InspectionDraftsTableFilterComposer($db: db, $table: table),
          createOrderingComposer: () =>
              $$InspectionDraftsTableOrderingComposer($db: db, $table: table),
          createComputedFieldComposer: () =>
              $$InspectionDraftsTableAnnotationComposer($db: db, $table: table),
          updateCompanionCallback: ({
            Value<String> draftKey = const Value.absent(),
            Value<String> userId = const Value.absent(),
            Value<String> workspaceId = const Value.absent(),
            Value<String?> country = const Value.absent(),
            Value<String> assetNo = const Value.absent(),
            Value<String?> vehicleType = const Value.absent(),
            Value<String?> site = const Value.absent(),
            Value<String?> inspectorName = const Value.absent(),
            Value<int?> odometerKm = const Value.absent(),
            Value<double?> engineHours = const Value.absent(),
            Value<String?> findings = const Value.absent(),
            Value<int> filled = const Value.absent(),
            Value<int> total = const Value.absent(),
            Value<DateTime> createdAt = const Value.absent(),
            Value<DateTime> updatedAt = const Value.absent(),
            Value<int> rowid = const Value.absent(),
          }) =>
              InspectionDraftsCompanion(
            draftKey: draftKey,
            userId: userId,
            workspaceId: workspaceId,
            country: country,
            assetNo: assetNo,
            vehicleType: vehicleType,
            site: site,
            inspectorName: inspectorName,
            odometerKm: odometerKm,
            engineHours: engineHours,
            findings: findings,
            filled: filled,
            total: total,
            createdAt: createdAt,
            updatedAt: updatedAt,
            rowid: rowid,
          ),
          createCompanionCallback: ({
            required String draftKey,
            required String userId,
            required String workspaceId,
            Value<String?> country = const Value.absent(),
            required String assetNo,
            Value<String?> vehicleType = const Value.absent(),
            Value<String?> site = const Value.absent(),
            Value<String?> inspectorName = const Value.absent(),
            Value<int?> odometerKm = const Value.absent(),
            Value<double?> engineHours = const Value.absent(),
            Value<String?> findings = const Value.absent(),
            required int filled,
            required int total,
            required DateTime createdAt,
            required DateTime updatedAt,
            Value<int> rowid = const Value.absent(),
          }) =>
              InspectionDraftsCompanion.insert(
            draftKey: draftKey,
            userId: userId,
            workspaceId: workspaceId,
            country: country,
            assetNo: assetNo,
            vehicleType: vehicleType,
            site: site,
            inspectorName: inspectorName,
            odometerKm: odometerKm,
            engineHours: engineHours,
            findings: findings,
            filled: filled,
            total: total,
            createdAt: createdAt,
            updatedAt: updatedAt,
            rowid: rowid,
          ),
          withReferenceMapper: (p0) => p0
              .map((e) => (
                    e.readTable(table),
                    $$InspectionDraftsTableReferences(db, table, e)
                  ))
              .toList(),
          prefetchHooksCallback: ({inspectionDraftPositionsRefs = false}) {
            return PrefetchHooks(
              db: db,
              explicitlyWatchedTables: [
                if (inspectionDraftPositionsRefs) db.inspectionDraftPositions
              ],
              addJoins: null,
              getPrefetchedDataCallback: (items) async {
                return [
                  if (inspectionDraftPositionsRefs)
                    await $_getPrefetchedData<InspectionDraft,
                            $InspectionDraftsTable, InspectionDraftPosition>(
                        currentTable: table,
                        referencedTable: $$InspectionDraftsTableReferences
                            ._inspectionDraftPositionsRefsTable(db),
                        managerFromTypedResult: (p0) =>
                            $$InspectionDraftsTableReferences(db, table, p0)
                                .inspectionDraftPositionsRefs,
                        referencedItemsForCurrentItem:
                            (item, referencedItems) => referencedItems
                                .where((e) => e.draftKey == item.draftKey),
                        typedResults: items)
                ];
              },
            );
          },
        ));
}

typedef $$InspectionDraftsTableProcessedTableManager = ProcessedTableManager<
    _$AppDatabase,
    $InspectionDraftsTable,
    InspectionDraft,
    $$InspectionDraftsTableFilterComposer,
    $$InspectionDraftsTableOrderingComposer,
    $$InspectionDraftsTableAnnotationComposer,
    $$InspectionDraftsTableCreateCompanionBuilder,
    $$InspectionDraftsTableUpdateCompanionBuilder,
    (InspectionDraft, $$InspectionDraftsTableReferences),
    InspectionDraft,
    PrefetchHooks Function({bool inspectionDraftPositionsRefs})>;
typedef $$InspectionDraftPositionsTableCreateCompanionBuilder
    = InspectionDraftPositionsCompanion Function({
  required String id,
  required String draftKey,
  required String position,
  Value<String?> condition,
  Value<double?> pressurePsi,
  Value<double?> treadDepthMm,
  Value<String?> serialNo,
  Value<bool> checked,
  required DateTime updatedAt,
  Value<int> rowid,
});
typedef $$InspectionDraftPositionsTableUpdateCompanionBuilder
    = InspectionDraftPositionsCompanion Function({
  Value<String> id,
  Value<String> draftKey,
  Value<String> position,
  Value<String?> condition,
  Value<double?> pressurePsi,
  Value<double?> treadDepthMm,
  Value<String?> serialNo,
  Value<bool> checked,
  Value<DateTime> updatedAt,
  Value<int> rowid,
});

final class $$InspectionDraftPositionsTableReferences extends BaseReferences<
    _$AppDatabase, $InspectionDraftPositionsTable, InspectionDraftPosition> {
  $$InspectionDraftPositionsTableReferences(
      super.$_db, super.$_table, super.$_typedResult);

  static $InspectionDraftsTable _draftKeyTable(_$AppDatabase db) =>
      db.inspectionDrafts.createAlias(
          'inspection_draft_positions__draft_key__inspection_drafts__draft_key');

  $$InspectionDraftsTableProcessedTableManager get draftKey {
    final $_column = $_itemColumn<String>('draft_key')!;

    final manager =
        $$InspectionDraftsTableTableManager($_db, $_db.inspectionDrafts)
            .filter((f) => f.draftKey.sqlEquals($_column));
    final item = $_typedResult.readTableOrNull(_draftKeyTable($_db));
    if (item == null) return manager;
    return ProcessedTableManager(
        manager.$state.copyWith(prefetchedData: [item]));
  }
}

class $$InspectionDraftPositionsTableFilterComposer
    extends Composer<_$AppDatabase, $InspectionDraftPositionsTable> {
  $$InspectionDraftPositionsTableFilterComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  ColumnFilters<String> get id => $composableBuilder(
      column: $table.id, builder: (column) => ColumnFilters(column));

  ColumnFilters<String> get position => $composableBuilder(
      column: $table.position, builder: (column) => ColumnFilters(column));

  ColumnFilters<String> get condition => $composableBuilder(
      column: $table.condition, builder: (column) => ColumnFilters(column));

  ColumnFilters<double> get pressurePsi => $composableBuilder(
      column: $table.pressurePsi, builder: (column) => ColumnFilters(column));

  ColumnFilters<double> get treadDepthMm => $composableBuilder(
      column: $table.treadDepthMm, builder: (column) => ColumnFilters(column));

  ColumnFilters<String> get serialNo => $composableBuilder(
      column: $table.serialNo, builder: (column) => ColumnFilters(column));

  ColumnFilters<bool> get checked => $composableBuilder(
      column: $table.checked, builder: (column) => ColumnFilters(column));

  ColumnFilters<DateTime> get updatedAt => $composableBuilder(
      column: $table.updatedAt, builder: (column) => ColumnFilters(column));

  $$InspectionDraftsTableFilterComposer get draftKey {
    final $$InspectionDraftsTableFilterComposer composer = $composerBuilder(
        composer: this,
        getCurrentColumn: (t) => t.draftKey,
        referencedTable: $db.inspectionDrafts,
        getReferencedColumn: (t) => t.draftKey,
        builder: (joinBuilder,
                {$addJoinBuilderToRootComposer,
                $removeJoinBuilderFromRootComposer}) =>
            $$InspectionDraftsTableFilterComposer(
              $db: $db,
              $table: $db.inspectionDrafts,
              $addJoinBuilderToRootComposer: $addJoinBuilderToRootComposer,
              joinBuilder: joinBuilder,
              $removeJoinBuilderFromRootComposer:
                  $removeJoinBuilderFromRootComposer,
            ));
    return composer;
  }
}

class $$InspectionDraftPositionsTableOrderingComposer
    extends Composer<_$AppDatabase, $InspectionDraftPositionsTable> {
  $$InspectionDraftPositionsTableOrderingComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  ColumnOrderings<String> get id => $composableBuilder(
      column: $table.id, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<String> get position => $composableBuilder(
      column: $table.position, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<String> get condition => $composableBuilder(
      column: $table.condition, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<double> get pressurePsi => $composableBuilder(
      column: $table.pressurePsi, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<double> get treadDepthMm => $composableBuilder(
      column: $table.treadDepthMm,
      builder: (column) => ColumnOrderings(column));

  ColumnOrderings<String> get serialNo => $composableBuilder(
      column: $table.serialNo, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<bool> get checked => $composableBuilder(
      column: $table.checked, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<DateTime> get updatedAt => $composableBuilder(
      column: $table.updatedAt, builder: (column) => ColumnOrderings(column));

  $$InspectionDraftsTableOrderingComposer get draftKey {
    final $$InspectionDraftsTableOrderingComposer composer = $composerBuilder(
        composer: this,
        getCurrentColumn: (t) => t.draftKey,
        referencedTable: $db.inspectionDrafts,
        getReferencedColumn: (t) => t.draftKey,
        builder: (joinBuilder,
                {$addJoinBuilderToRootComposer,
                $removeJoinBuilderFromRootComposer}) =>
            $$InspectionDraftsTableOrderingComposer(
              $db: $db,
              $table: $db.inspectionDrafts,
              $addJoinBuilderToRootComposer: $addJoinBuilderToRootComposer,
              joinBuilder: joinBuilder,
              $removeJoinBuilderFromRootComposer:
                  $removeJoinBuilderFromRootComposer,
            ));
    return composer;
  }
}

class $$InspectionDraftPositionsTableAnnotationComposer
    extends Composer<_$AppDatabase, $InspectionDraftPositionsTable> {
  $$InspectionDraftPositionsTableAnnotationComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  GeneratedColumn<String> get id =>
      $composableBuilder(column: $table.id, builder: (column) => column);

  GeneratedColumn<String> get position =>
      $composableBuilder(column: $table.position, builder: (column) => column);

  GeneratedColumn<String> get condition =>
      $composableBuilder(column: $table.condition, builder: (column) => column);

  GeneratedColumn<double> get pressurePsi => $composableBuilder(
      column: $table.pressurePsi, builder: (column) => column);

  GeneratedColumn<double> get treadDepthMm => $composableBuilder(
      column: $table.treadDepthMm, builder: (column) => column);

  GeneratedColumn<String> get serialNo =>
      $composableBuilder(column: $table.serialNo, builder: (column) => column);

  GeneratedColumn<bool> get checked =>
      $composableBuilder(column: $table.checked, builder: (column) => column);

  GeneratedColumn<DateTime> get updatedAt =>
      $composableBuilder(column: $table.updatedAt, builder: (column) => column);

  $$InspectionDraftsTableAnnotationComposer get draftKey {
    final $$InspectionDraftsTableAnnotationComposer composer = $composerBuilder(
        composer: this,
        getCurrentColumn: (t) => t.draftKey,
        referencedTable: $db.inspectionDrafts,
        getReferencedColumn: (t) => t.draftKey,
        builder: (joinBuilder,
                {$addJoinBuilderToRootComposer,
                $removeJoinBuilderFromRootComposer}) =>
            $$InspectionDraftsTableAnnotationComposer(
              $db: $db,
              $table: $db.inspectionDrafts,
              $addJoinBuilderToRootComposer: $addJoinBuilderToRootComposer,
              joinBuilder: joinBuilder,
              $removeJoinBuilderFromRootComposer:
                  $removeJoinBuilderFromRootComposer,
            ));
    return composer;
  }
}

class $$InspectionDraftPositionsTableTableManager extends RootTableManager<
    _$AppDatabase,
    $InspectionDraftPositionsTable,
    InspectionDraftPosition,
    $$InspectionDraftPositionsTableFilterComposer,
    $$InspectionDraftPositionsTableOrderingComposer,
    $$InspectionDraftPositionsTableAnnotationComposer,
    $$InspectionDraftPositionsTableCreateCompanionBuilder,
    $$InspectionDraftPositionsTableUpdateCompanionBuilder,
    (InspectionDraftPosition, $$InspectionDraftPositionsTableReferences),
    InspectionDraftPosition,
    PrefetchHooks Function({bool draftKey})> {
  $$InspectionDraftPositionsTableTableManager(
      _$AppDatabase db, $InspectionDraftPositionsTable table)
      : super(TableManagerState(
          db: db,
          table: table,
          createFilteringComposer: () =>
              $$InspectionDraftPositionsTableFilterComposer(
                  $db: db, $table: table),
          createOrderingComposer: () =>
              $$InspectionDraftPositionsTableOrderingComposer(
                  $db: db, $table: table),
          createComputedFieldComposer: () =>
              $$InspectionDraftPositionsTableAnnotationComposer(
                  $db: db, $table: table),
          updateCompanionCallback: ({
            Value<String> id = const Value.absent(),
            Value<String> draftKey = const Value.absent(),
            Value<String> position = const Value.absent(),
            Value<String?> condition = const Value.absent(),
            Value<double?> pressurePsi = const Value.absent(),
            Value<double?> treadDepthMm = const Value.absent(),
            Value<String?> serialNo = const Value.absent(),
            Value<bool> checked = const Value.absent(),
            Value<DateTime> updatedAt = const Value.absent(),
            Value<int> rowid = const Value.absent(),
          }) =>
              InspectionDraftPositionsCompanion(
            id: id,
            draftKey: draftKey,
            position: position,
            condition: condition,
            pressurePsi: pressurePsi,
            treadDepthMm: treadDepthMm,
            serialNo: serialNo,
            checked: checked,
            updatedAt: updatedAt,
            rowid: rowid,
          ),
          createCompanionCallback: ({
            required String id,
            required String draftKey,
            required String position,
            Value<String?> condition = const Value.absent(),
            Value<double?> pressurePsi = const Value.absent(),
            Value<double?> treadDepthMm = const Value.absent(),
            Value<String?> serialNo = const Value.absent(),
            Value<bool> checked = const Value.absent(),
            required DateTime updatedAt,
            Value<int> rowid = const Value.absent(),
          }) =>
              InspectionDraftPositionsCompanion.insert(
            id: id,
            draftKey: draftKey,
            position: position,
            condition: condition,
            pressurePsi: pressurePsi,
            treadDepthMm: treadDepthMm,
            serialNo: serialNo,
            checked: checked,
            updatedAt: updatedAt,
            rowid: rowid,
          ),
          withReferenceMapper: (p0) => p0
              .map((e) => (
                    e.readTable(table),
                    $$InspectionDraftPositionsTableReferences(db, table, e)
                  ))
              .toList(),
          prefetchHooksCallback: ({draftKey = false}) {
            return PrefetchHooks(
              db: db,
              explicitlyWatchedTables: [],
              addJoins: <
                  T extends TableManagerState<
                      dynamic,
                      dynamic,
                      dynamic,
                      dynamic,
                      dynamic,
                      dynamic,
                      dynamic,
                      dynamic,
                      dynamic,
                      dynamic,
                      dynamic>>(state) {
                if (draftKey) {
                  state = state.withJoin(
                    currentTable: table,
                    currentColumn: table.draftKey,
                    referencedTable: $$InspectionDraftPositionsTableReferences
                        ._draftKeyTable(db),
                    referencedColumn: $$InspectionDraftPositionsTableReferences
                        ._draftKeyTable(db)
                        .draftKey,
                  ) as T;
                }

                return state;
              },
              getPrefetchedDataCallback: (items) async {
                return [];
              },
            );
          },
        ));
}

typedef $$InspectionDraftPositionsTableProcessedTableManager
    = ProcessedTableManager<
        _$AppDatabase,
        $InspectionDraftPositionsTable,
        InspectionDraftPosition,
        $$InspectionDraftPositionsTableFilterComposer,
        $$InspectionDraftPositionsTableOrderingComposer,
        $$InspectionDraftPositionsTableAnnotationComposer,
        $$InspectionDraftPositionsTableCreateCompanionBuilder,
        $$InspectionDraftPositionsTableUpdateCompanionBuilder,
        (InspectionDraftPosition, $$InspectionDraftPositionsTableReferences),
        InspectionDraftPosition,
        PrefetchHooks Function({bool draftKey})>;
typedef $$ChecklistDraftsTableCreateCompanionBuilder = ChecklistDraftsCompanion
    Function({
  required String draftKey,
  required String userId,
  required String workspaceId,
  required String templateId,
  required String templateName,
  required int templateVersion,
  required String assetNo,
  Value<String?> assignmentId,
  Value<String?> site,
  Value<String?> title,
  Value<String?> readLang,
  required String answersJson,
  required String notesJson,
  Value<String?> printedName,
  required int filled,
  required int total,
  required DateTime createdAt,
  required DateTime updatedAt,
  Value<int> rowid,
});
typedef $$ChecklistDraftsTableUpdateCompanionBuilder = ChecklistDraftsCompanion
    Function({
  Value<String> draftKey,
  Value<String> userId,
  Value<String> workspaceId,
  Value<String> templateId,
  Value<String> templateName,
  Value<int> templateVersion,
  Value<String> assetNo,
  Value<String?> assignmentId,
  Value<String?> site,
  Value<String?> title,
  Value<String?> readLang,
  Value<String> answersJson,
  Value<String> notesJson,
  Value<String?> printedName,
  Value<int> filled,
  Value<int> total,
  Value<DateTime> createdAt,
  Value<DateTime> updatedAt,
  Value<int> rowid,
});

class $$ChecklistDraftsTableFilterComposer
    extends Composer<_$AppDatabase, $ChecklistDraftsTable> {
  $$ChecklistDraftsTableFilterComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  ColumnFilters<String> get draftKey => $composableBuilder(
      column: $table.draftKey, builder: (column) => ColumnFilters(column));

  ColumnFilters<String> get userId => $composableBuilder(
      column: $table.userId, builder: (column) => ColumnFilters(column));

  ColumnFilters<String> get workspaceId => $composableBuilder(
      column: $table.workspaceId, builder: (column) => ColumnFilters(column));

  ColumnFilters<String> get templateId => $composableBuilder(
      column: $table.templateId, builder: (column) => ColumnFilters(column));

  ColumnFilters<String> get templateName => $composableBuilder(
      column: $table.templateName, builder: (column) => ColumnFilters(column));

  ColumnFilters<int> get templateVersion => $composableBuilder(
      column: $table.templateVersion,
      builder: (column) => ColumnFilters(column));

  ColumnFilters<String> get assetNo => $composableBuilder(
      column: $table.assetNo, builder: (column) => ColumnFilters(column));

  ColumnFilters<String> get assignmentId => $composableBuilder(
      column: $table.assignmentId, builder: (column) => ColumnFilters(column));

  ColumnFilters<String> get site => $composableBuilder(
      column: $table.site, builder: (column) => ColumnFilters(column));

  ColumnFilters<String> get title => $composableBuilder(
      column: $table.title, builder: (column) => ColumnFilters(column));

  ColumnFilters<String> get readLang => $composableBuilder(
      column: $table.readLang, builder: (column) => ColumnFilters(column));

  ColumnFilters<String> get answersJson => $composableBuilder(
      column: $table.answersJson, builder: (column) => ColumnFilters(column));

  ColumnFilters<String> get notesJson => $composableBuilder(
      column: $table.notesJson, builder: (column) => ColumnFilters(column));

  ColumnFilters<String> get printedName => $composableBuilder(
      column: $table.printedName, builder: (column) => ColumnFilters(column));

  ColumnFilters<int> get filled => $composableBuilder(
      column: $table.filled, builder: (column) => ColumnFilters(column));

  ColumnFilters<int> get total => $composableBuilder(
      column: $table.total, builder: (column) => ColumnFilters(column));

  ColumnFilters<DateTime> get createdAt => $composableBuilder(
      column: $table.createdAt, builder: (column) => ColumnFilters(column));

  ColumnFilters<DateTime> get updatedAt => $composableBuilder(
      column: $table.updatedAt, builder: (column) => ColumnFilters(column));
}

class $$ChecklistDraftsTableOrderingComposer
    extends Composer<_$AppDatabase, $ChecklistDraftsTable> {
  $$ChecklistDraftsTableOrderingComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  ColumnOrderings<String> get draftKey => $composableBuilder(
      column: $table.draftKey, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<String> get userId => $composableBuilder(
      column: $table.userId, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<String> get workspaceId => $composableBuilder(
      column: $table.workspaceId, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<String> get templateId => $composableBuilder(
      column: $table.templateId, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<String> get templateName => $composableBuilder(
      column: $table.templateName,
      builder: (column) => ColumnOrderings(column));

  ColumnOrderings<int> get templateVersion => $composableBuilder(
      column: $table.templateVersion,
      builder: (column) => ColumnOrderings(column));

  ColumnOrderings<String> get assetNo => $composableBuilder(
      column: $table.assetNo, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<String> get assignmentId => $composableBuilder(
      column: $table.assignmentId,
      builder: (column) => ColumnOrderings(column));

  ColumnOrderings<String> get site => $composableBuilder(
      column: $table.site, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<String> get title => $composableBuilder(
      column: $table.title, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<String> get readLang => $composableBuilder(
      column: $table.readLang, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<String> get answersJson => $composableBuilder(
      column: $table.answersJson, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<String> get notesJson => $composableBuilder(
      column: $table.notesJson, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<String> get printedName => $composableBuilder(
      column: $table.printedName, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<int> get filled => $composableBuilder(
      column: $table.filled, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<int> get total => $composableBuilder(
      column: $table.total, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<DateTime> get createdAt => $composableBuilder(
      column: $table.createdAt, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<DateTime> get updatedAt => $composableBuilder(
      column: $table.updatedAt, builder: (column) => ColumnOrderings(column));
}

class $$ChecklistDraftsTableAnnotationComposer
    extends Composer<_$AppDatabase, $ChecklistDraftsTable> {
  $$ChecklistDraftsTableAnnotationComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  GeneratedColumn<String> get draftKey =>
      $composableBuilder(column: $table.draftKey, builder: (column) => column);

  GeneratedColumn<String> get userId =>
      $composableBuilder(column: $table.userId, builder: (column) => column);

  GeneratedColumn<String> get workspaceId => $composableBuilder(
      column: $table.workspaceId, builder: (column) => column);

  GeneratedColumn<String> get templateId => $composableBuilder(
      column: $table.templateId, builder: (column) => column);

  GeneratedColumn<String> get templateName => $composableBuilder(
      column: $table.templateName, builder: (column) => column);

  GeneratedColumn<int> get templateVersion => $composableBuilder(
      column: $table.templateVersion, builder: (column) => column);

  GeneratedColumn<String> get assetNo =>
      $composableBuilder(column: $table.assetNo, builder: (column) => column);

  GeneratedColumn<String> get assignmentId => $composableBuilder(
      column: $table.assignmentId, builder: (column) => column);

  GeneratedColumn<String> get site =>
      $composableBuilder(column: $table.site, builder: (column) => column);

  GeneratedColumn<String> get title =>
      $composableBuilder(column: $table.title, builder: (column) => column);

  GeneratedColumn<String> get readLang =>
      $composableBuilder(column: $table.readLang, builder: (column) => column);

  GeneratedColumn<String> get answersJson => $composableBuilder(
      column: $table.answersJson, builder: (column) => column);

  GeneratedColumn<String> get notesJson =>
      $composableBuilder(column: $table.notesJson, builder: (column) => column);

  GeneratedColumn<String> get printedName => $composableBuilder(
      column: $table.printedName, builder: (column) => column);

  GeneratedColumn<int> get filled =>
      $composableBuilder(column: $table.filled, builder: (column) => column);

  GeneratedColumn<int> get total =>
      $composableBuilder(column: $table.total, builder: (column) => column);

  GeneratedColumn<DateTime> get createdAt =>
      $composableBuilder(column: $table.createdAt, builder: (column) => column);

  GeneratedColumn<DateTime> get updatedAt =>
      $composableBuilder(column: $table.updatedAt, builder: (column) => column);
}

class $$ChecklistDraftsTableTableManager extends RootTableManager<
    _$AppDatabase,
    $ChecklistDraftsTable,
    ChecklistDraft,
    $$ChecklistDraftsTableFilterComposer,
    $$ChecklistDraftsTableOrderingComposer,
    $$ChecklistDraftsTableAnnotationComposer,
    $$ChecklistDraftsTableCreateCompanionBuilder,
    $$ChecklistDraftsTableUpdateCompanionBuilder,
    (
      ChecklistDraft,
      BaseReferences<_$AppDatabase, $ChecklistDraftsTable, ChecklistDraft>
    ),
    ChecklistDraft,
    PrefetchHooks Function()> {
  $$ChecklistDraftsTableTableManager(
      _$AppDatabase db, $ChecklistDraftsTable table)
      : super(TableManagerState(
          db: db,
          table: table,
          createFilteringComposer: () =>
              $$ChecklistDraftsTableFilterComposer($db: db, $table: table),
          createOrderingComposer: () =>
              $$ChecklistDraftsTableOrderingComposer($db: db, $table: table),
          createComputedFieldComposer: () =>
              $$ChecklistDraftsTableAnnotationComposer($db: db, $table: table),
          updateCompanionCallback: ({
            Value<String> draftKey = const Value.absent(),
            Value<String> userId = const Value.absent(),
            Value<String> workspaceId = const Value.absent(),
            Value<String> templateId = const Value.absent(),
            Value<String> templateName = const Value.absent(),
            Value<int> templateVersion = const Value.absent(),
            Value<String> assetNo = const Value.absent(),
            Value<String?> assignmentId = const Value.absent(),
            Value<String?> site = const Value.absent(),
            Value<String?> title = const Value.absent(),
            Value<String?> readLang = const Value.absent(),
            Value<String> answersJson = const Value.absent(),
            Value<String> notesJson = const Value.absent(),
            Value<String?> printedName = const Value.absent(),
            Value<int> filled = const Value.absent(),
            Value<int> total = const Value.absent(),
            Value<DateTime> createdAt = const Value.absent(),
            Value<DateTime> updatedAt = const Value.absent(),
            Value<int> rowid = const Value.absent(),
          }) =>
              ChecklistDraftsCompanion(
            draftKey: draftKey,
            userId: userId,
            workspaceId: workspaceId,
            templateId: templateId,
            templateName: templateName,
            templateVersion: templateVersion,
            assetNo: assetNo,
            assignmentId: assignmentId,
            site: site,
            title: title,
            readLang: readLang,
            answersJson: answersJson,
            notesJson: notesJson,
            printedName: printedName,
            filled: filled,
            total: total,
            createdAt: createdAt,
            updatedAt: updatedAt,
            rowid: rowid,
          ),
          createCompanionCallback: ({
            required String draftKey,
            required String userId,
            required String workspaceId,
            required String templateId,
            required String templateName,
            required int templateVersion,
            required String assetNo,
            Value<String?> assignmentId = const Value.absent(),
            Value<String?> site = const Value.absent(),
            Value<String?> title = const Value.absent(),
            Value<String?> readLang = const Value.absent(),
            required String answersJson,
            required String notesJson,
            Value<String?> printedName = const Value.absent(),
            required int filled,
            required int total,
            required DateTime createdAt,
            required DateTime updatedAt,
            Value<int> rowid = const Value.absent(),
          }) =>
              ChecklistDraftsCompanion.insert(
            draftKey: draftKey,
            userId: userId,
            workspaceId: workspaceId,
            templateId: templateId,
            templateName: templateName,
            templateVersion: templateVersion,
            assetNo: assetNo,
            assignmentId: assignmentId,
            site: site,
            title: title,
            readLang: readLang,
            answersJson: answersJson,
            notesJson: notesJson,
            printedName: printedName,
            filled: filled,
            total: total,
            createdAt: createdAt,
            updatedAt: updatedAt,
            rowid: rowid,
          ),
          withReferenceMapper: (p0) => p0
              .map((e) => (e.readTable(table), BaseReferences(db, table, e)))
              .toList(),
          prefetchHooksCallback: null,
        ));
}

typedef $$ChecklistDraftsTableProcessedTableManager = ProcessedTableManager<
    _$AppDatabase,
    $ChecklistDraftsTable,
    ChecklistDraft,
    $$ChecklistDraftsTableFilterComposer,
    $$ChecklistDraftsTableOrderingComposer,
    $$ChecklistDraftsTableAnnotationComposer,
    $$ChecklistDraftsTableCreateCompanionBuilder,
    $$ChecklistDraftsTableUpdateCompanionBuilder,
    (
      ChecklistDraft,
      BaseReferences<_$AppDatabase, $ChecklistDraftsTable, ChecklistDraft>
    ),
    ChecklistDraft,
    PrefetchHooks Function()>;
typedef $$DraftPhotosTableCreateCompanionBuilder = DraftPhotosCompanion
    Function({
  required String id,
  required String ownerKind,
  required String ownerKey,
  Value<String?> fieldKey,
  required String localPath,
  required String fileName,
  Value<int?> sizeBytes,
  Value<String?> mimeType,
  Value<String?> checksum,
  required DateTime capturedAt,
  Value<int> rowid,
});
typedef $$DraftPhotosTableUpdateCompanionBuilder = DraftPhotosCompanion
    Function({
  Value<String> id,
  Value<String> ownerKind,
  Value<String> ownerKey,
  Value<String?> fieldKey,
  Value<String> localPath,
  Value<String> fileName,
  Value<int?> sizeBytes,
  Value<String?> mimeType,
  Value<String?> checksum,
  Value<DateTime> capturedAt,
  Value<int> rowid,
});

class $$DraftPhotosTableFilterComposer
    extends Composer<_$AppDatabase, $DraftPhotosTable> {
  $$DraftPhotosTableFilterComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  ColumnFilters<String> get id => $composableBuilder(
      column: $table.id, builder: (column) => ColumnFilters(column));

  ColumnFilters<String> get ownerKind => $composableBuilder(
      column: $table.ownerKind, builder: (column) => ColumnFilters(column));

  ColumnFilters<String> get ownerKey => $composableBuilder(
      column: $table.ownerKey, builder: (column) => ColumnFilters(column));

  ColumnFilters<String> get fieldKey => $composableBuilder(
      column: $table.fieldKey, builder: (column) => ColumnFilters(column));

  ColumnFilters<String> get localPath => $composableBuilder(
      column: $table.localPath, builder: (column) => ColumnFilters(column));

  ColumnFilters<String> get fileName => $composableBuilder(
      column: $table.fileName, builder: (column) => ColumnFilters(column));

  ColumnFilters<int> get sizeBytes => $composableBuilder(
      column: $table.sizeBytes, builder: (column) => ColumnFilters(column));

  ColumnFilters<String> get mimeType => $composableBuilder(
      column: $table.mimeType, builder: (column) => ColumnFilters(column));

  ColumnFilters<String> get checksum => $composableBuilder(
      column: $table.checksum, builder: (column) => ColumnFilters(column));

  ColumnFilters<DateTime> get capturedAt => $composableBuilder(
      column: $table.capturedAt, builder: (column) => ColumnFilters(column));
}

class $$DraftPhotosTableOrderingComposer
    extends Composer<_$AppDatabase, $DraftPhotosTable> {
  $$DraftPhotosTableOrderingComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  ColumnOrderings<String> get id => $composableBuilder(
      column: $table.id, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<String> get ownerKind => $composableBuilder(
      column: $table.ownerKind, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<String> get ownerKey => $composableBuilder(
      column: $table.ownerKey, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<String> get fieldKey => $composableBuilder(
      column: $table.fieldKey, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<String> get localPath => $composableBuilder(
      column: $table.localPath, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<String> get fileName => $composableBuilder(
      column: $table.fileName, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<int> get sizeBytes => $composableBuilder(
      column: $table.sizeBytes, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<String> get mimeType => $composableBuilder(
      column: $table.mimeType, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<String> get checksum => $composableBuilder(
      column: $table.checksum, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<DateTime> get capturedAt => $composableBuilder(
      column: $table.capturedAt, builder: (column) => ColumnOrderings(column));
}

class $$DraftPhotosTableAnnotationComposer
    extends Composer<_$AppDatabase, $DraftPhotosTable> {
  $$DraftPhotosTableAnnotationComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  GeneratedColumn<String> get id =>
      $composableBuilder(column: $table.id, builder: (column) => column);

  GeneratedColumn<String> get ownerKind =>
      $composableBuilder(column: $table.ownerKind, builder: (column) => column);

  GeneratedColumn<String> get ownerKey =>
      $composableBuilder(column: $table.ownerKey, builder: (column) => column);

  GeneratedColumn<String> get fieldKey =>
      $composableBuilder(column: $table.fieldKey, builder: (column) => column);

  GeneratedColumn<String> get localPath =>
      $composableBuilder(column: $table.localPath, builder: (column) => column);

  GeneratedColumn<String> get fileName =>
      $composableBuilder(column: $table.fileName, builder: (column) => column);

  GeneratedColumn<int> get sizeBytes =>
      $composableBuilder(column: $table.sizeBytes, builder: (column) => column);

  GeneratedColumn<String> get mimeType =>
      $composableBuilder(column: $table.mimeType, builder: (column) => column);

  GeneratedColumn<String> get checksum =>
      $composableBuilder(column: $table.checksum, builder: (column) => column);

  GeneratedColumn<DateTime> get capturedAt => $composableBuilder(
      column: $table.capturedAt, builder: (column) => column);
}

class $$DraftPhotosTableTableManager extends RootTableManager<
    _$AppDatabase,
    $DraftPhotosTable,
    DraftPhoto,
    $$DraftPhotosTableFilterComposer,
    $$DraftPhotosTableOrderingComposer,
    $$DraftPhotosTableAnnotationComposer,
    $$DraftPhotosTableCreateCompanionBuilder,
    $$DraftPhotosTableUpdateCompanionBuilder,
    (DraftPhoto, BaseReferences<_$AppDatabase, $DraftPhotosTable, DraftPhoto>),
    DraftPhoto,
    PrefetchHooks Function()> {
  $$DraftPhotosTableTableManager(_$AppDatabase db, $DraftPhotosTable table)
      : super(TableManagerState(
          db: db,
          table: table,
          createFilteringComposer: () =>
              $$DraftPhotosTableFilterComposer($db: db, $table: table),
          createOrderingComposer: () =>
              $$DraftPhotosTableOrderingComposer($db: db, $table: table),
          createComputedFieldComposer: () =>
              $$DraftPhotosTableAnnotationComposer($db: db, $table: table),
          updateCompanionCallback: ({
            Value<String> id = const Value.absent(),
            Value<String> ownerKind = const Value.absent(),
            Value<String> ownerKey = const Value.absent(),
            Value<String?> fieldKey = const Value.absent(),
            Value<String> localPath = const Value.absent(),
            Value<String> fileName = const Value.absent(),
            Value<int?> sizeBytes = const Value.absent(),
            Value<String?> mimeType = const Value.absent(),
            Value<String?> checksum = const Value.absent(),
            Value<DateTime> capturedAt = const Value.absent(),
            Value<int> rowid = const Value.absent(),
          }) =>
              DraftPhotosCompanion(
            id: id,
            ownerKind: ownerKind,
            ownerKey: ownerKey,
            fieldKey: fieldKey,
            localPath: localPath,
            fileName: fileName,
            sizeBytes: sizeBytes,
            mimeType: mimeType,
            checksum: checksum,
            capturedAt: capturedAt,
            rowid: rowid,
          ),
          createCompanionCallback: ({
            required String id,
            required String ownerKind,
            required String ownerKey,
            Value<String?> fieldKey = const Value.absent(),
            required String localPath,
            required String fileName,
            Value<int?> sizeBytes = const Value.absent(),
            Value<String?> mimeType = const Value.absent(),
            Value<String?> checksum = const Value.absent(),
            required DateTime capturedAt,
            Value<int> rowid = const Value.absent(),
          }) =>
              DraftPhotosCompanion.insert(
            id: id,
            ownerKind: ownerKind,
            ownerKey: ownerKey,
            fieldKey: fieldKey,
            localPath: localPath,
            fileName: fileName,
            sizeBytes: sizeBytes,
            mimeType: mimeType,
            checksum: checksum,
            capturedAt: capturedAt,
            rowid: rowid,
          ),
          withReferenceMapper: (p0) => p0
              .map((e) => (e.readTable(table), BaseReferences(db, table, e)))
              .toList(),
          prefetchHooksCallback: null,
        ));
}

typedef $$DraftPhotosTableProcessedTableManager = ProcessedTableManager<
    _$AppDatabase,
    $DraftPhotosTable,
    DraftPhoto,
    $$DraftPhotosTableFilterComposer,
    $$DraftPhotosTableOrderingComposer,
    $$DraftPhotosTableAnnotationComposer,
    $$DraftPhotosTableCreateCompanionBuilder,
    $$DraftPhotosTableUpdateCompanionBuilder,
    (DraftPhoto, BaseReferences<_$AppDatabase, $DraftPhotosTable, DraftPhoto>),
    DraftPhoto,
    PrefetchHooks Function()>;
typedef $$CapturedSignaturesTableCreateCompanionBuilder
    = CapturedSignaturesCompanion Function({
  required String id,
  required String ownerKind,
  required String ownerKey,
  required String fieldKey,
  required String format,
  required String payload,
  Value<String?> strokesJson,
  Value<String?> signerUserId,
  Value<String?> signerName,
  Value<String?> signerRole,
  required String source,
  required DateTime signedAt,
  Value<int> rowid,
});
typedef $$CapturedSignaturesTableUpdateCompanionBuilder
    = CapturedSignaturesCompanion Function({
  Value<String> id,
  Value<String> ownerKind,
  Value<String> ownerKey,
  Value<String> fieldKey,
  Value<String> format,
  Value<String> payload,
  Value<String?> strokesJson,
  Value<String?> signerUserId,
  Value<String?> signerName,
  Value<String?> signerRole,
  Value<String> source,
  Value<DateTime> signedAt,
  Value<int> rowid,
});

class $$CapturedSignaturesTableFilterComposer
    extends Composer<_$AppDatabase, $CapturedSignaturesTable> {
  $$CapturedSignaturesTableFilterComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  ColumnFilters<String> get id => $composableBuilder(
      column: $table.id, builder: (column) => ColumnFilters(column));

  ColumnFilters<String> get ownerKind => $composableBuilder(
      column: $table.ownerKind, builder: (column) => ColumnFilters(column));

  ColumnFilters<String> get ownerKey => $composableBuilder(
      column: $table.ownerKey, builder: (column) => ColumnFilters(column));

  ColumnFilters<String> get fieldKey => $composableBuilder(
      column: $table.fieldKey, builder: (column) => ColumnFilters(column));

  ColumnFilters<String> get format => $composableBuilder(
      column: $table.format, builder: (column) => ColumnFilters(column));

  ColumnFilters<String> get payload => $composableBuilder(
      column: $table.payload, builder: (column) => ColumnFilters(column));

  ColumnFilters<String> get strokesJson => $composableBuilder(
      column: $table.strokesJson, builder: (column) => ColumnFilters(column));

  ColumnFilters<String> get signerUserId => $composableBuilder(
      column: $table.signerUserId, builder: (column) => ColumnFilters(column));

  ColumnFilters<String> get signerName => $composableBuilder(
      column: $table.signerName, builder: (column) => ColumnFilters(column));

  ColumnFilters<String> get signerRole => $composableBuilder(
      column: $table.signerRole, builder: (column) => ColumnFilters(column));

  ColumnFilters<String> get source => $composableBuilder(
      column: $table.source, builder: (column) => ColumnFilters(column));

  ColumnFilters<DateTime> get signedAt => $composableBuilder(
      column: $table.signedAt, builder: (column) => ColumnFilters(column));
}

class $$CapturedSignaturesTableOrderingComposer
    extends Composer<_$AppDatabase, $CapturedSignaturesTable> {
  $$CapturedSignaturesTableOrderingComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  ColumnOrderings<String> get id => $composableBuilder(
      column: $table.id, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<String> get ownerKind => $composableBuilder(
      column: $table.ownerKind, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<String> get ownerKey => $composableBuilder(
      column: $table.ownerKey, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<String> get fieldKey => $composableBuilder(
      column: $table.fieldKey, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<String> get format => $composableBuilder(
      column: $table.format, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<String> get payload => $composableBuilder(
      column: $table.payload, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<String> get strokesJson => $composableBuilder(
      column: $table.strokesJson, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<String> get signerUserId => $composableBuilder(
      column: $table.signerUserId,
      builder: (column) => ColumnOrderings(column));

  ColumnOrderings<String> get signerName => $composableBuilder(
      column: $table.signerName, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<String> get signerRole => $composableBuilder(
      column: $table.signerRole, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<String> get source => $composableBuilder(
      column: $table.source, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<DateTime> get signedAt => $composableBuilder(
      column: $table.signedAt, builder: (column) => ColumnOrderings(column));
}

class $$CapturedSignaturesTableAnnotationComposer
    extends Composer<_$AppDatabase, $CapturedSignaturesTable> {
  $$CapturedSignaturesTableAnnotationComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  GeneratedColumn<String> get id =>
      $composableBuilder(column: $table.id, builder: (column) => column);

  GeneratedColumn<String> get ownerKind =>
      $composableBuilder(column: $table.ownerKind, builder: (column) => column);

  GeneratedColumn<String> get ownerKey =>
      $composableBuilder(column: $table.ownerKey, builder: (column) => column);

  GeneratedColumn<String> get fieldKey =>
      $composableBuilder(column: $table.fieldKey, builder: (column) => column);

  GeneratedColumn<String> get format =>
      $composableBuilder(column: $table.format, builder: (column) => column);

  GeneratedColumn<String> get payload =>
      $composableBuilder(column: $table.payload, builder: (column) => column);

  GeneratedColumn<String> get strokesJson => $composableBuilder(
      column: $table.strokesJson, builder: (column) => column);

  GeneratedColumn<String> get signerUserId => $composableBuilder(
      column: $table.signerUserId, builder: (column) => column);

  GeneratedColumn<String> get signerName => $composableBuilder(
      column: $table.signerName, builder: (column) => column);

  GeneratedColumn<String> get signerRole => $composableBuilder(
      column: $table.signerRole, builder: (column) => column);

  GeneratedColumn<String> get source =>
      $composableBuilder(column: $table.source, builder: (column) => column);

  GeneratedColumn<DateTime> get signedAt =>
      $composableBuilder(column: $table.signedAt, builder: (column) => column);
}

class $$CapturedSignaturesTableTableManager extends RootTableManager<
    _$AppDatabase,
    $CapturedSignaturesTable,
    CapturedSignature,
    $$CapturedSignaturesTableFilterComposer,
    $$CapturedSignaturesTableOrderingComposer,
    $$CapturedSignaturesTableAnnotationComposer,
    $$CapturedSignaturesTableCreateCompanionBuilder,
    $$CapturedSignaturesTableUpdateCompanionBuilder,
    (
      CapturedSignature,
      BaseReferences<_$AppDatabase, $CapturedSignaturesTable, CapturedSignature>
    ),
    CapturedSignature,
    PrefetchHooks Function()> {
  $$CapturedSignaturesTableTableManager(
      _$AppDatabase db, $CapturedSignaturesTable table)
      : super(TableManagerState(
          db: db,
          table: table,
          createFilteringComposer: () =>
              $$CapturedSignaturesTableFilterComposer($db: db, $table: table),
          createOrderingComposer: () =>
              $$CapturedSignaturesTableOrderingComposer($db: db, $table: table),
          createComputedFieldComposer: () =>
              $$CapturedSignaturesTableAnnotationComposer(
                  $db: db, $table: table),
          updateCompanionCallback: ({
            Value<String> id = const Value.absent(),
            Value<String> ownerKind = const Value.absent(),
            Value<String> ownerKey = const Value.absent(),
            Value<String> fieldKey = const Value.absent(),
            Value<String> format = const Value.absent(),
            Value<String> payload = const Value.absent(),
            Value<String?> strokesJson = const Value.absent(),
            Value<String?> signerUserId = const Value.absent(),
            Value<String?> signerName = const Value.absent(),
            Value<String?> signerRole = const Value.absent(),
            Value<String> source = const Value.absent(),
            Value<DateTime> signedAt = const Value.absent(),
            Value<int> rowid = const Value.absent(),
          }) =>
              CapturedSignaturesCompanion(
            id: id,
            ownerKind: ownerKind,
            ownerKey: ownerKey,
            fieldKey: fieldKey,
            format: format,
            payload: payload,
            strokesJson: strokesJson,
            signerUserId: signerUserId,
            signerName: signerName,
            signerRole: signerRole,
            source: source,
            signedAt: signedAt,
            rowid: rowid,
          ),
          createCompanionCallback: ({
            required String id,
            required String ownerKind,
            required String ownerKey,
            required String fieldKey,
            required String format,
            required String payload,
            Value<String?> strokesJson = const Value.absent(),
            Value<String?> signerUserId = const Value.absent(),
            Value<String?> signerName = const Value.absent(),
            Value<String?> signerRole = const Value.absent(),
            required String source,
            required DateTime signedAt,
            Value<int> rowid = const Value.absent(),
          }) =>
              CapturedSignaturesCompanion.insert(
            id: id,
            ownerKind: ownerKind,
            ownerKey: ownerKey,
            fieldKey: fieldKey,
            format: format,
            payload: payload,
            strokesJson: strokesJson,
            signerUserId: signerUserId,
            signerName: signerName,
            signerRole: signerRole,
            source: source,
            signedAt: signedAt,
            rowid: rowid,
          ),
          withReferenceMapper: (p0) => p0
              .map((e) => (e.readTable(table), BaseReferences(db, table, e)))
              .toList(),
          prefetchHooksCallback: null,
        ));
}

typedef $$CapturedSignaturesTableProcessedTableManager = ProcessedTableManager<
    _$AppDatabase,
    $CapturedSignaturesTable,
    CapturedSignature,
    $$CapturedSignaturesTableFilterComposer,
    $$CapturedSignaturesTableOrderingComposer,
    $$CapturedSignaturesTableAnnotationComposer,
    $$CapturedSignaturesTableCreateCompanionBuilder,
    $$CapturedSignaturesTableUpdateCompanionBuilder,
    (
      CapturedSignature,
      BaseReferences<_$AppDatabase, $CapturedSignaturesTable, CapturedSignature>
    ),
    CapturedSignature,
    PrefetchHooks Function()>;
typedef $$PendingCommandsTableCreateCompanionBuilder = PendingCommandsCompanion
    Function({
  required String id,
  required String commandType,
  required String entityType,
  Value<String?> entityId,
  required String payloadJson,
  required DateTime createdAt,
  required String createdBy,
  required String workspaceId,
  Value<String?> country,
  Value<int> retryCount,
  required DateTime nextRetryAt,
  required String status,
  Value<String?> lastError,
  required String idempotencyKey,
  Value<DateTime?> syncedAt,
  Value<String?> dependsOn,
  Value<int> rowid,
});
typedef $$PendingCommandsTableUpdateCompanionBuilder = PendingCommandsCompanion
    Function({
  Value<String> id,
  Value<String> commandType,
  Value<String> entityType,
  Value<String?> entityId,
  Value<String> payloadJson,
  Value<DateTime> createdAt,
  Value<String> createdBy,
  Value<String> workspaceId,
  Value<String?> country,
  Value<int> retryCount,
  Value<DateTime> nextRetryAt,
  Value<String> status,
  Value<String?> lastError,
  Value<String> idempotencyKey,
  Value<DateTime?> syncedAt,
  Value<String?> dependsOn,
  Value<int> rowid,
});

final class $$PendingCommandsTableReferences extends BaseReferences<
    _$AppDatabase, $PendingCommandsTable, PendingCommand> {
  $$PendingCommandsTableReferences(
      super.$_db, super.$_table, super.$_typedResult);

  static MultiTypedResultKey<$PendingMediaUploadsTable,
      List<PendingMediaUpload>> _pendingMediaUploadsRefsTable(
          _$AppDatabase db) =>
      MultiTypedResultKey.fromTable(db.pendingMediaUploads,
          aliasName: 'pending_commands__id__pending_media_uploads__command_id');

  $$PendingMediaUploadsTableProcessedTableManager get pendingMediaUploadsRefs {
    final manager = $$PendingMediaUploadsTableTableManager(
            $_db, $_db.pendingMediaUploads)
        .filter((f) => f.commandId.id.sqlEquals($_itemColumn<String>('id')!));

    final cache =
        $_typedResult.readTableOrNull(_pendingMediaUploadsRefsTable($_db));
    return ProcessedTableManager(
        manager.$state.copyWith(prefetchedData: cache));
  }
}

class $$PendingCommandsTableFilterComposer
    extends Composer<_$AppDatabase, $PendingCommandsTable> {
  $$PendingCommandsTableFilterComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  ColumnFilters<String> get id => $composableBuilder(
      column: $table.id, builder: (column) => ColumnFilters(column));

  ColumnFilters<String> get commandType => $composableBuilder(
      column: $table.commandType, builder: (column) => ColumnFilters(column));

  ColumnFilters<String> get entityType => $composableBuilder(
      column: $table.entityType, builder: (column) => ColumnFilters(column));

  ColumnFilters<String> get entityId => $composableBuilder(
      column: $table.entityId, builder: (column) => ColumnFilters(column));

  ColumnFilters<String> get payloadJson => $composableBuilder(
      column: $table.payloadJson, builder: (column) => ColumnFilters(column));

  ColumnFilters<DateTime> get createdAt => $composableBuilder(
      column: $table.createdAt, builder: (column) => ColumnFilters(column));

  ColumnFilters<String> get createdBy => $composableBuilder(
      column: $table.createdBy, builder: (column) => ColumnFilters(column));

  ColumnFilters<String> get workspaceId => $composableBuilder(
      column: $table.workspaceId, builder: (column) => ColumnFilters(column));

  ColumnFilters<String> get country => $composableBuilder(
      column: $table.country, builder: (column) => ColumnFilters(column));

  ColumnFilters<int> get retryCount => $composableBuilder(
      column: $table.retryCount, builder: (column) => ColumnFilters(column));

  ColumnFilters<DateTime> get nextRetryAt => $composableBuilder(
      column: $table.nextRetryAt, builder: (column) => ColumnFilters(column));

  ColumnFilters<String> get status => $composableBuilder(
      column: $table.status, builder: (column) => ColumnFilters(column));

  ColumnFilters<String> get lastError => $composableBuilder(
      column: $table.lastError, builder: (column) => ColumnFilters(column));

  ColumnFilters<String> get idempotencyKey => $composableBuilder(
      column: $table.idempotencyKey,
      builder: (column) => ColumnFilters(column));

  ColumnFilters<DateTime> get syncedAt => $composableBuilder(
      column: $table.syncedAt, builder: (column) => ColumnFilters(column));

  ColumnFilters<String> get dependsOn => $composableBuilder(
      column: $table.dependsOn, builder: (column) => ColumnFilters(column));

  Expression<bool> pendingMediaUploadsRefs(
      Expression<bool> Function($$PendingMediaUploadsTableFilterComposer f) f) {
    final $$PendingMediaUploadsTableFilterComposer composer = $composerBuilder(
        composer: this,
        getCurrentColumn: (t) => t.id,
        referencedTable: $db.pendingMediaUploads,
        getReferencedColumn: (t) => t.commandId,
        builder: (joinBuilder,
                {$addJoinBuilderToRootComposer,
                $removeJoinBuilderFromRootComposer}) =>
            $$PendingMediaUploadsTableFilterComposer(
              $db: $db,
              $table: $db.pendingMediaUploads,
              $addJoinBuilderToRootComposer: $addJoinBuilderToRootComposer,
              joinBuilder: joinBuilder,
              $removeJoinBuilderFromRootComposer:
                  $removeJoinBuilderFromRootComposer,
            ));
    return f(composer);
  }
}

class $$PendingCommandsTableOrderingComposer
    extends Composer<_$AppDatabase, $PendingCommandsTable> {
  $$PendingCommandsTableOrderingComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  ColumnOrderings<String> get id => $composableBuilder(
      column: $table.id, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<String> get commandType => $composableBuilder(
      column: $table.commandType, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<String> get entityType => $composableBuilder(
      column: $table.entityType, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<String> get entityId => $composableBuilder(
      column: $table.entityId, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<String> get payloadJson => $composableBuilder(
      column: $table.payloadJson, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<DateTime> get createdAt => $composableBuilder(
      column: $table.createdAt, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<String> get createdBy => $composableBuilder(
      column: $table.createdBy, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<String> get workspaceId => $composableBuilder(
      column: $table.workspaceId, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<String> get country => $composableBuilder(
      column: $table.country, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<int> get retryCount => $composableBuilder(
      column: $table.retryCount, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<DateTime> get nextRetryAt => $composableBuilder(
      column: $table.nextRetryAt, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<String> get status => $composableBuilder(
      column: $table.status, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<String> get lastError => $composableBuilder(
      column: $table.lastError, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<String> get idempotencyKey => $composableBuilder(
      column: $table.idempotencyKey,
      builder: (column) => ColumnOrderings(column));

  ColumnOrderings<DateTime> get syncedAt => $composableBuilder(
      column: $table.syncedAt, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<String> get dependsOn => $composableBuilder(
      column: $table.dependsOn, builder: (column) => ColumnOrderings(column));
}

class $$PendingCommandsTableAnnotationComposer
    extends Composer<_$AppDatabase, $PendingCommandsTable> {
  $$PendingCommandsTableAnnotationComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  GeneratedColumn<String> get id =>
      $composableBuilder(column: $table.id, builder: (column) => column);

  GeneratedColumn<String> get commandType => $composableBuilder(
      column: $table.commandType, builder: (column) => column);

  GeneratedColumn<String> get entityType => $composableBuilder(
      column: $table.entityType, builder: (column) => column);

  GeneratedColumn<String> get entityId =>
      $composableBuilder(column: $table.entityId, builder: (column) => column);

  GeneratedColumn<String> get payloadJson => $composableBuilder(
      column: $table.payloadJson, builder: (column) => column);

  GeneratedColumn<DateTime> get createdAt =>
      $composableBuilder(column: $table.createdAt, builder: (column) => column);

  GeneratedColumn<String> get createdBy =>
      $composableBuilder(column: $table.createdBy, builder: (column) => column);

  GeneratedColumn<String> get workspaceId => $composableBuilder(
      column: $table.workspaceId, builder: (column) => column);

  GeneratedColumn<String> get country =>
      $composableBuilder(column: $table.country, builder: (column) => column);

  GeneratedColumn<int> get retryCount => $composableBuilder(
      column: $table.retryCount, builder: (column) => column);

  GeneratedColumn<DateTime> get nextRetryAt => $composableBuilder(
      column: $table.nextRetryAt, builder: (column) => column);

  GeneratedColumn<String> get status =>
      $composableBuilder(column: $table.status, builder: (column) => column);

  GeneratedColumn<String> get lastError =>
      $composableBuilder(column: $table.lastError, builder: (column) => column);

  GeneratedColumn<String> get idempotencyKey => $composableBuilder(
      column: $table.idempotencyKey, builder: (column) => column);

  GeneratedColumn<DateTime> get syncedAt =>
      $composableBuilder(column: $table.syncedAt, builder: (column) => column);

  GeneratedColumn<String> get dependsOn =>
      $composableBuilder(column: $table.dependsOn, builder: (column) => column);

  Expression<T> pendingMediaUploadsRefs<T extends Object>(
      Expression<T> Function($$PendingMediaUploadsTableAnnotationComposer a)
          f) {
    final $$PendingMediaUploadsTableAnnotationComposer composer =
        $composerBuilder(
            composer: this,
            getCurrentColumn: (t) => t.id,
            referencedTable: $db.pendingMediaUploads,
            getReferencedColumn: (t) => t.commandId,
            builder: (joinBuilder,
                    {$addJoinBuilderToRootComposer,
                    $removeJoinBuilderFromRootComposer}) =>
                $$PendingMediaUploadsTableAnnotationComposer(
                  $db: $db,
                  $table: $db.pendingMediaUploads,
                  $addJoinBuilderToRootComposer: $addJoinBuilderToRootComposer,
                  joinBuilder: joinBuilder,
                  $removeJoinBuilderFromRootComposer:
                      $removeJoinBuilderFromRootComposer,
                ));
    return f(composer);
  }
}

class $$PendingCommandsTableTableManager extends RootTableManager<
    _$AppDatabase,
    $PendingCommandsTable,
    PendingCommand,
    $$PendingCommandsTableFilterComposer,
    $$PendingCommandsTableOrderingComposer,
    $$PendingCommandsTableAnnotationComposer,
    $$PendingCommandsTableCreateCompanionBuilder,
    $$PendingCommandsTableUpdateCompanionBuilder,
    (PendingCommand, $$PendingCommandsTableReferences),
    PendingCommand,
    PrefetchHooks Function({bool pendingMediaUploadsRefs})> {
  $$PendingCommandsTableTableManager(
      _$AppDatabase db, $PendingCommandsTable table)
      : super(TableManagerState(
          db: db,
          table: table,
          createFilteringComposer: () =>
              $$PendingCommandsTableFilterComposer($db: db, $table: table),
          createOrderingComposer: () =>
              $$PendingCommandsTableOrderingComposer($db: db, $table: table),
          createComputedFieldComposer: () =>
              $$PendingCommandsTableAnnotationComposer($db: db, $table: table),
          updateCompanionCallback: ({
            Value<String> id = const Value.absent(),
            Value<String> commandType = const Value.absent(),
            Value<String> entityType = const Value.absent(),
            Value<String?> entityId = const Value.absent(),
            Value<String> payloadJson = const Value.absent(),
            Value<DateTime> createdAt = const Value.absent(),
            Value<String> createdBy = const Value.absent(),
            Value<String> workspaceId = const Value.absent(),
            Value<String?> country = const Value.absent(),
            Value<int> retryCount = const Value.absent(),
            Value<DateTime> nextRetryAt = const Value.absent(),
            Value<String> status = const Value.absent(),
            Value<String?> lastError = const Value.absent(),
            Value<String> idempotencyKey = const Value.absent(),
            Value<DateTime?> syncedAt = const Value.absent(),
            Value<String?> dependsOn = const Value.absent(),
            Value<int> rowid = const Value.absent(),
          }) =>
              PendingCommandsCompanion(
            id: id,
            commandType: commandType,
            entityType: entityType,
            entityId: entityId,
            payloadJson: payloadJson,
            createdAt: createdAt,
            createdBy: createdBy,
            workspaceId: workspaceId,
            country: country,
            retryCount: retryCount,
            nextRetryAt: nextRetryAt,
            status: status,
            lastError: lastError,
            idempotencyKey: idempotencyKey,
            syncedAt: syncedAt,
            dependsOn: dependsOn,
            rowid: rowid,
          ),
          createCompanionCallback: ({
            required String id,
            required String commandType,
            required String entityType,
            Value<String?> entityId = const Value.absent(),
            required String payloadJson,
            required DateTime createdAt,
            required String createdBy,
            required String workspaceId,
            Value<String?> country = const Value.absent(),
            Value<int> retryCount = const Value.absent(),
            required DateTime nextRetryAt,
            required String status,
            Value<String?> lastError = const Value.absent(),
            required String idempotencyKey,
            Value<DateTime?> syncedAt = const Value.absent(),
            Value<String?> dependsOn = const Value.absent(),
            Value<int> rowid = const Value.absent(),
          }) =>
              PendingCommandsCompanion.insert(
            id: id,
            commandType: commandType,
            entityType: entityType,
            entityId: entityId,
            payloadJson: payloadJson,
            createdAt: createdAt,
            createdBy: createdBy,
            workspaceId: workspaceId,
            country: country,
            retryCount: retryCount,
            nextRetryAt: nextRetryAt,
            status: status,
            lastError: lastError,
            idempotencyKey: idempotencyKey,
            syncedAt: syncedAt,
            dependsOn: dependsOn,
            rowid: rowid,
          ),
          withReferenceMapper: (p0) => p0
              .map((e) => (
                    e.readTable(table),
                    $$PendingCommandsTableReferences(db, table, e)
                  ))
              .toList(),
          prefetchHooksCallback: ({pendingMediaUploadsRefs = false}) {
            return PrefetchHooks(
              db: db,
              explicitlyWatchedTables: [
                if (pendingMediaUploadsRefs) db.pendingMediaUploads
              ],
              addJoins: null,
              getPrefetchedDataCallback: (items) async {
                return [
                  if (pendingMediaUploadsRefs)
                    await $_getPrefetchedData<PendingCommand,
                            $PendingCommandsTable, PendingMediaUpload>(
                        currentTable: table,
                        referencedTable: $$PendingCommandsTableReferences
                            ._pendingMediaUploadsRefsTable(db),
                        managerFromTypedResult: (p0) =>
                            $$PendingCommandsTableReferences(db, table, p0)
                                .pendingMediaUploadsRefs,
                        referencedItemsForCurrentItem:
                            (item, referencedItems) => referencedItems
                                .where((e) => e.commandId == item.id),
                        typedResults: items)
                ];
              },
            );
          },
        ));
}

typedef $$PendingCommandsTableProcessedTableManager = ProcessedTableManager<
    _$AppDatabase,
    $PendingCommandsTable,
    PendingCommand,
    $$PendingCommandsTableFilterComposer,
    $$PendingCommandsTableOrderingComposer,
    $$PendingCommandsTableAnnotationComposer,
    $$PendingCommandsTableCreateCompanionBuilder,
    $$PendingCommandsTableUpdateCompanionBuilder,
    (PendingCommand, $$PendingCommandsTableReferences),
    PendingCommand,
    PrefetchHooks Function({bool pendingMediaUploadsRefs})>;
typedef $$PendingMediaUploadsTableCreateCompanionBuilder
    = PendingMediaUploadsCompanion Function({
  required String id,
  required String commandId,
  Value<String?> fieldKey,
  required int orderIndex,
  required String localPath,
  required String fileName,
  Value<int?> sizeBytes,
  Value<String?> mimeType,
  Value<String?> checksum,
  Value<String?> bucket,
  Value<String?> remotePath,
  Value<String?> remoteRef,
  required String state,
  Value<int> attempts,
  Value<String?> lastError,
  required DateTime capturedAt,
  Value<DateTime?> uploadedAt,
  Value<int> rowid,
});
typedef $$PendingMediaUploadsTableUpdateCompanionBuilder
    = PendingMediaUploadsCompanion Function({
  Value<String> id,
  Value<String> commandId,
  Value<String?> fieldKey,
  Value<int> orderIndex,
  Value<String> localPath,
  Value<String> fileName,
  Value<int?> sizeBytes,
  Value<String?> mimeType,
  Value<String?> checksum,
  Value<String?> bucket,
  Value<String?> remotePath,
  Value<String?> remoteRef,
  Value<String> state,
  Value<int> attempts,
  Value<String?> lastError,
  Value<DateTime> capturedAt,
  Value<DateTime?> uploadedAt,
  Value<int> rowid,
});

final class $$PendingMediaUploadsTableReferences extends BaseReferences<
    _$AppDatabase, $PendingMediaUploadsTable, PendingMediaUpload> {
  $$PendingMediaUploadsTableReferences(
      super.$_db, super.$_table, super.$_typedResult);

  static $PendingCommandsTable _commandIdTable(_$AppDatabase db) => db
      .pendingCommands
      .createAlias('pending_media_uploads__command_id__pending_commands__id');

  $$PendingCommandsTableProcessedTableManager get commandId {
    final $_column = $_itemColumn<String>('command_id')!;

    final manager =
        $$PendingCommandsTableTableManager($_db, $_db.pendingCommands)
            .filter((f) => f.id.sqlEquals($_column));
    final item = $_typedResult.readTableOrNull(_commandIdTable($_db));
    if (item == null) return manager;
    return ProcessedTableManager(
        manager.$state.copyWith(prefetchedData: [item]));
  }
}

class $$PendingMediaUploadsTableFilterComposer
    extends Composer<_$AppDatabase, $PendingMediaUploadsTable> {
  $$PendingMediaUploadsTableFilterComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  ColumnFilters<String> get id => $composableBuilder(
      column: $table.id, builder: (column) => ColumnFilters(column));

  ColumnFilters<String> get fieldKey => $composableBuilder(
      column: $table.fieldKey, builder: (column) => ColumnFilters(column));

  ColumnFilters<int> get orderIndex => $composableBuilder(
      column: $table.orderIndex, builder: (column) => ColumnFilters(column));

  ColumnFilters<String> get localPath => $composableBuilder(
      column: $table.localPath, builder: (column) => ColumnFilters(column));

  ColumnFilters<String> get fileName => $composableBuilder(
      column: $table.fileName, builder: (column) => ColumnFilters(column));

  ColumnFilters<int> get sizeBytes => $composableBuilder(
      column: $table.sizeBytes, builder: (column) => ColumnFilters(column));

  ColumnFilters<String> get mimeType => $composableBuilder(
      column: $table.mimeType, builder: (column) => ColumnFilters(column));

  ColumnFilters<String> get checksum => $composableBuilder(
      column: $table.checksum, builder: (column) => ColumnFilters(column));

  ColumnFilters<String> get bucket => $composableBuilder(
      column: $table.bucket, builder: (column) => ColumnFilters(column));

  ColumnFilters<String> get remotePath => $composableBuilder(
      column: $table.remotePath, builder: (column) => ColumnFilters(column));

  ColumnFilters<String> get remoteRef => $composableBuilder(
      column: $table.remoteRef, builder: (column) => ColumnFilters(column));

  ColumnFilters<String> get state => $composableBuilder(
      column: $table.state, builder: (column) => ColumnFilters(column));

  ColumnFilters<int> get attempts => $composableBuilder(
      column: $table.attempts, builder: (column) => ColumnFilters(column));

  ColumnFilters<String> get lastError => $composableBuilder(
      column: $table.lastError, builder: (column) => ColumnFilters(column));

  ColumnFilters<DateTime> get capturedAt => $composableBuilder(
      column: $table.capturedAt, builder: (column) => ColumnFilters(column));

  ColumnFilters<DateTime> get uploadedAt => $composableBuilder(
      column: $table.uploadedAt, builder: (column) => ColumnFilters(column));

  $$PendingCommandsTableFilterComposer get commandId {
    final $$PendingCommandsTableFilterComposer composer = $composerBuilder(
        composer: this,
        getCurrentColumn: (t) => t.commandId,
        referencedTable: $db.pendingCommands,
        getReferencedColumn: (t) => t.id,
        builder: (joinBuilder,
                {$addJoinBuilderToRootComposer,
                $removeJoinBuilderFromRootComposer}) =>
            $$PendingCommandsTableFilterComposer(
              $db: $db,
              $table: $db.pendingCommands,
              $addJoinBuilderToRootComposer: $addJoinBuilderToRootComposer,
              joinBuilder: joinBuilder,
              $removeJoinBuilderFromRootComposer:
                  $removeJoinBuilderFromRootComposer,
            ));
    return composer;
  }
}

class $$PendingMediaUploadsTableOrderingComposer
    extends Composer<_$AppDatabase, $PendingMediaUploadsTable> {
  $$PendingMediaUploadsTableOrderingComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  ColumnOrderings<String> get id => $composableBuilder(
      column: $table.id, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<String> get fieldKey => $composableBuilder(
      column: $table.fieldKey, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<int> get orderIndex => $composableBuilder(
      column: $table.orderIndex, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<String> get localPath => $composableBuilder(
      column: $table.localPath, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<String> get fileName => $composableBuilder(
      column: $table.fileName, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<int> get sizeBytes => $composableBuilder(
      column: $table.sizeBytes, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<String> get mimeType => $composableBuilder(
      column: $table.mimeType, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<String> get checksum => $composableBuilder(
      column: $table.checksum, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<String> get bucket => $composableBuilder(
      column: $table.bucket, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<String> get remotePath => $composableBuilder(
      column: $table.remotePath, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<String> get remoteRef => $composableBuilder(
      column: $table.remoteRef, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<String> get state => $composableBuilder(
      column: $table.state, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<int> get attempts => $composableBuilder(
      column: $table.attempts, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<String> get lastError => $composableBuilder(
      column: $table.lastError, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<DateTime> get capturedAt => $composableBuilder(
      column: $table.capturedAt, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<DateTime> get uploadedAt => $composableBuilder(
      column: $table.uploadedAt, builder: (column) => ColumnOrderings(column));

  $$PendingCommandsTableOrderingComposer get commandId {
    final $$PendingCommandsTableOrderingComposer composer = $composerBuilder(
        composer: this,
        getCurrentColumn: (t) => t.commandId,
        referencedTable: $db.pendingCommands,
        getReferencedColumn: (t) => t.id,
        builder: (joinBuilder,
                {$addJoinBuilderToRootComposer,
                $removeJoinBuilderFromRootComposer}) =>
            $$PendingCommandsTableOrderingComposer(
              $db: $db,
              $table: $db.pendingCommands,
              $addJoinBuilderToRootComposer: $addJoinBuilderToRootComposer,
              joinBuilder: joinBuilder,
              $removeJoinBuilderFromRootComposer:
                  $removeJoinBuilderFromRootComposer,
            ));
    return composer;
  }
}

class $$PendingMediaUploadsTableAnnotationComposer
    extends Composer<_$AppDatabase, $PendingMediaUploadsTable> {
  $$PendingMediaUploadsTableAnnotationComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  GeneratedColumn<String> get id =>
      $composableBuilder(column: $table.id, builder: (column) => column);

  GeneratedColumn<String> get fieldKey =>
      $composableBuilder(column: $table.fieldKey, builder: (column) => column);

  GeneratedColumn<int> get orderIndex => $composableBuilder(
      column: $table.orderIndex, builder: (column) => column);

  GeneratedColumn<String> get localPath =>
      $composableBuilder(column: $table.localPath, builder: (column) => column);

  GeneratedColumn<String> get fileName =>
      $composableBuilder(column: $table.fileName, builder: (column) => column);

  GeneratedColumn<int> get sizeBytes =>
      $composableBuilder(column: $table.sizeBytes, builder: (column) => column);

  GeneratedColumn<String> get mimeType =>
      $composableBuilder(column: $table.mimeType, builder: (column) => column);

  GeneratedColumn<String> get checksum =>
      $composableBuilder(column: $table.checksum, builder: (column) => column);

  GeneratedColumn<String> get bucket =>
      $composableBuilder(column: $table.bucket, builder: (column) => column);

  GeneratedColumn<String> get remotePath => $composableBuilder(
      column: $table.remotePath, builder: (column) => column);

  GeneratedColumn<String> get remoteRef =>
      $composableBuilder(column: $table.remoteRef, builder: (column) => column);

  GeneratedColumn<String> get state =>
      $composableBuilder(column: $table.state, builder: (column) => column);

  GeneratedColumn<int> get attempts =>
      $composableBuilder(column: $table.attempts, builder: (column) => column);

  GeneratedColumn<String> get lastError =>
      $composableBuilder(column: $table.lastError, builder: (column) => column);

  GeneratedColumn<DateTime> get capturedAt => $composableBuilder(
      column: $table.capturedAt, builder: (column) => column);

  GeneratedColumn<DateTime> get uploadedAt => $composableBuilder(
      column: $table.uploadedAt, builder: (column) => column);

  $$PendingCommandsTableAnnotationComposer get commandId {
    final $$PendingCommandsTableAnnotationComposer composer = $composerBuilder(
        composer: this,
        getCurrentColumn: (t) => t.commandId,
        referencedTable: $db.pendingCommands,
        getReferencedColumn: (t) => t.id,
        builder: (joinBuilder,
                {$addJoinBuilderToRootComposer,
                $removeJoinBuilderFromRootComposer}) =>
            $$PendingCommandsTableAnnotationComposer(
              $db: $db,
              $table: $db.pendingCommands,
              $addJoinBuilderToRootComposer: $addJoinBuilderToRootComposer,
              joinBuilder: joinBuilder,
              $removeJoinBuilderFromRootComposer:
                  $removeJoinBuilderFromRootComposer,
            ));
    return composer;
  }
}

class $$PendingMediaUploadsTableTableManager extends RootTableManager<
    _$AppDatabase,
    $PendingMediaUploadsTable,
    PendingMediaUpload,
    $$PendingMediaUploadsTableFilterComposer,
    $$PendingMediaUploadsTableOrderingComposer,
    $$PendingMediaUploadsTableAnnotationComposer,
    $$PendingMediaUploadsTableCreateCompanionBuilder,
    $$PendingMediaUploadsTableUpdateCompanionBuilder,
    (PendingMediaUpload, $$PendingMediaUploadsTableReferences),
    PendingMediaUpload,
    PrefetchHooks Function({bool commandId})> {
  $$PendingMediaUploadsTableTableManager(
      _$AppDatabase db, $PendingMediaUploadsTable table)
      : super(TableManagerState(
          db: db,
          table: table,
          createFilteringComposer: () =>
              $$PendingMediaUploadsTableFilterComposer($db: db, $table: table),
          createOrderingComposer: () =>
              $$PendingMediaUploadsTableOrderingComposer(
                  $db: db, $table: table),
          createComputedFieldComposer: () =>
              $$PendingMediaUploadsTableAnnotationComposer(
                  $db: db, $table: table),
          updateCompanionCallback: ({
            Value<String> id = const Value.absent(),
            Value<String> commandId = const Value.absent(),
            Value<String?> fieldKey = const Value.absent(),
            Value<int> orderIndex = const Value.absent(),
            Value<String> localPath = const Value.absent(),
            Value<String> fileName = const Value.absent(),
            Value<int?> sizeBytes = const Value.absent(),
            Value<String?> mimeType = const Value.absent(),
            Value<String?> checksum = const Value.absent(),
            Value<String?> bucket = const Value.absent(),
            Value<String?> remotePath = const Value.absent(),
            Value<String?> remoteRef = const Value.absent(),
            Value<String> state = const Value.absent(),
            Value<int> attempts = const Value.absent(),
            Value<String?> lastError = const Value.absent(),
            Value<DateTime> capturedAt = const Value.absent(),
            Value<DateTime?> uploadedAt = const Value.absent(),
            Value<int> rowid = const Value.absent(),
          }) =>
              PendingMediaUploadsCompanion(
            id: id,
            commandId: commandId,
            fieldKey: fieldKey,
            orderIndex: orderIndex,
            localPath: localPath,
            fileName: fileName,
            sizeBytes: sizeBytes,
            mimeType: mimeType,
            checksum: checksum,
            bucket: bucket,
            remotePath: remotePath,
            remoteRef: remoteRef,
            state: state,
            attempts: attempts,
            lastError: lastError,
            capturedAt: capturedAt,
            uploadedAt: uploadedAt,
            rowid: rowid,
          ),
          createCompanionCallback: ({
            required String id,
            required String commandId,
            Value<String?> fieldKey = const Value.absent(),
            required int orderIndex,
            required String localPath,
            required String fileName,
            Value<int?> sizeBytes = const Value.absent(),
            Value<String?> mimeType = const Value.absent(),
            Value<String?> checksum = const Value.absent(),
            Value<String?> bucket = const Value.absent(),
            Value<String?> remotePath = const Value.absent(),
            Value<String?> remoteRef = const Value.absent(),
            required String state,
            Value<int> attempts = const Value.absent(),
            Value<String?> lastError = const Value.absent(),
            required DateTime capturedAt,
            Value<DateTime?> uploadedAt = const Value.absent(),
            Value<int> rowid = const Value.absent(),
          }) =>
              PendingMediaUploadsCompanion.insert(
            id: id,
            commandId: commandId,
            fieldKey: fieldKey,
            orderIndex: orderIndex,
            localPath: localPath,
            fileName: fileName,
            sizeBytes: sizeBytes,
            mimeType: mimeType,
            checksum: checksum,
            bucket: bucket,
            remotePath: remotePath,
            remoteRef: remoteRef,
            state: state,
            attempts: attempts,
            lastError: lastError,
            capturedAt: capturedAt,
            uploadedAt: uploadedAt,
            rowid: rowid,
          ),
          withReferenceMapper: (p0) => p0
              .map((e) => (
                    e.readTable(table),
                    $$PendingMediaUploadsTableReferences(db, table, e)
                  ))
              .toList(),
          prefetchHooksCallback: ({commandId = false}) {
            return PrefetchHooks(
              db: db,
              explicitlyWatchedTables: [],
              addJoins: <
                  T extends TableManagerState<
                      dynamic,
                      dynamic,
                      dynamic,
                      dynamic,
                      dynamic,
                      dynamic,
                      dynamic,
                      dynamic,
                      dynamic,
                      dynamic,
                      dynamic>>(state) {
                if (commandId) {
                  state = state.withJoin(
                    currentTable: table,
                    currentColumn: table.commandId,
                    referencedTable: $$PendingMediaUploadsTableReferences
                        ._commandIdTable(db),
                    referencedColumn: $$PendingMediaUploadsTableReferences
                        ._commandIdTable(db)
                        .id,
                  ) as T;
                }

                return state;
              },
              getPrefetchedDataCallback: (items) async {
                return [];
              },
            );
          },
        ));
}

typedef $$PendingMediaUploadsTableProcessedTableManager = ProcessedTableManager<
    _$AppDatabase,
    $PendingMediaUploadsTable,
    PendingMediaUpload,
    $$PendingMediaUploadsTableFilterComposer,
    $$PendingMediaUploadsTableOrderingComposer,
    $$PendingMediaUploadsTableAnnotationComposer,
    $$PendingMediaUploadsTableCreateCompanionBuilder,
    $$PendingMediaUploadsTableUpdateCompanionBuilder,
    (PendingMediaUpload, $$PendingMediaUploadsTableReferences),
    PendingMediaUpload,
    PrefetchHooks Function({bool commandId})>;
typedef $$SyncFailuresTableCreateCompanionBuilder = SyncFailuresCompanion
    Function({
  required String id,
  Value<String?> commandId,
  Value<String?> commandType,
  Value<String?> entityType,
  Value<String?> workspaceId,
  required DateTime occurredAt,
  required int attempt,
  Value<String?> errorCode,
  required String errorClass,
  Value<String?> messageSafe,
  Value<String?> payloadSnapshotJson,
  Value<int> rowid,
});
typedef $$SyncFailuresTableUpdateCompanionBuilder = SyncFailuresCompanion
    Function({
  Value<String> id,
  Value<String?> commandId,
  Value<String?> commandType,
  Value<String?> entityType,
  Value<String?> workspaceId,
  Value<DateTime> occurredAt,
  Value<int> attempt,
  Value<String?> errorCode,
  Value<String> errorClass,
  Value<String?> messageSafe,
  Value<String?> payloadSnapshotJson,
  Value<int> rowid,
});

class $$SyncFailuresTableFilterComposer
    extends Composer<_$AppDatabase, $SyncFailuresTable> {
  $$SyncFailuresTableFilterComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  ColumnFilters<String> get id => $composableBuilder(
      column: $table.id, builder: (column) => ColumnFilters(column));

  ColumnFilters<String> get commandId => $composableBuilder(
      column: $table.commandId, builder: (column) => ColumnFilters(column));

  ColumnFilters<String> get commandType => $composableBuilder(
      column: $table.commandType, builder: (column) => ColumnFilters(column));

  ColumnFilters<String> get entityType => $composableBuilder(
      column: $table.entityType, builder: (column) => ColumnFilters(column));

  ColumnFilters<String> get workspaceId => $composableBuilder(
      column: $table.workspaceId, builder: (column) => ColumnFilters(column));

  ColumnFilters<DateTime> get occurredAt => $composableBuilder(
      column: $table.occurredAt, builder: (column) => ColumnFilters(column));

  ColumnFilters<int> get attempt => $composableBuilder(
      column: $table.attempt, builder: (column) => ColumnFilters(column));

  ColumnFilters<String> get errorCode => $composableBuilder(
      column: $table.errorCode, builder: (column) => ColumnFilters(column));

  ColumnFilters<String> get errorClass => $composableBuilder(
      column: $table.errorClass, builder: (column) => ColumnFilters(column));

  ColumnFilters<String> get messageSafe => $composableBuilder(
      column: $table.messageSafe, builder: (column) => ColumnFilters(column));

  ColumnFilters<String> get payloadSnapshotJson => $composableBuilder(
      column: $table.payloadSnapshotJson,
      builder: (column) => ColumnFilters(column));
}

class $$SyncFailuresTableOrderingComposer
    extends Composer<_$AppDatabase, $SyncFailuresTable> {
  $$SyncFailuresTableOrderingComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  ColumnOrderings<String> get id => $composableBuilder(
      column: $table.id, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<String> get commandId => $composableBuilder(
      column: $table.commandId, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<String> get commandType => $composableBuilder(
      column: $table.commandType, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<String> get entityType => $composableBuilder(
      column: $table.entityType, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<String> get workspaceId => $composableBuilder(
      column: $table.workspaceId, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<DateTime> get occurredAt => $composableBuilder(
      column: $table.occurredAt, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<int> get attempt => $composableBuilder(
      column: $table.attempt, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<String> get errorCode => $composableBuilder(
      column: $table.errorCode, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<String> get errorClass => $composableBuilder(
      column: $table.errorClass, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<String> get messageSafe => $composableBuilder(
      column: $table.messageSafe, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<String> get payloadSnapshotJson => $composableBuilder(
      column: $table.payloadSnapshotJson,
      builder: (column) => ColumnOrderings(column));
}

class $$SyncFailuresTableAnnotationComposer
    extends Composer<_$AppDatabase, $SyncFailuresTable> {
  $$SyncFailuresTableAnnotationComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  GeneratedColumn<String> get id =>
      $composableBuilder(column: $table.id, builder: (column) => column);

  GeneratedColumn<String> get commandId =>
      $composableBuilder(column: $table.commandId, builder: (column) => column);

  GeneratedColumn<String> get commandType => $composableBuilder(
      column: $table.commandType, builder: (column) => column);

  GeneratedColumn<String> get entityType => $composableBuilder(
      column: $table.entityType, builder: (column) => column);

  GeneratedColumn<String> get workspaceId => $composableBuilder(
      column: $table.workspaceId, builder: (column) => column);

  GeneratedColumn<DateTime> get occurredAt => $composableBuilder(
      column: $table.occurredAt, builder: (column) => column);

  GeneratedColumn<int> get attempt =>
      $composableBuilder(column: $table.attempt, builder: (column) => column);

  GeneratedColumn<String> get errorCode =>
      $composableBuilder(column: $table.errorCode, builder: (column) => column);

  GeneratedColumn<String> get errorClass => $composableBuilder(
      column: $table.errorClass, builder: (column) => column);

  GeneratedColumn<String> get messageSafe => $composableBuilder(
      column: $table.messageSafe, builder: (column) => column);

  GeneratedColumn<String> get payloadSnapshotJson => $composableBuilder(
      column: $table.payloadSnapshotJson, builder: (column) => column);
}

class $$SyncFailuresTableTableManager extends RootTableManager<
    _$AppDatabase,
    $SyncFailuresTable,
    SyncFailure,
    $$SyncFailuresTableFilterComposer,
    $$SyncFailuresTableOrderingComposer,
    $$SyncFailuresTableAnnotationComposer,
    $$SyncFailuresTableCreateCompanionBuilder,
    $$SyncFailuresTableUpdateCompanionBuilder,
    (
      SyncFailure,
      BaseReferences<_$AppDatabase, $SyncFailuresTable, SyncFailure>
    ),
    SyncFailure,
    PrefetchHooks Function()> {
  $$SyncFailuresTableTableManager(_$AppDatabase db, $SyncFailuresTable table)
      : super(TableManagerState(
          db: db,
          table: table,
          createFilteringComposer: () =>
              $$SyncFailuresTableFilterComposer($db: db, $table: table),
          createOrderingComposer: () =>
              $$SyncFailuresTableOrderingComposer($db: db, $table: table),
          createComputedFieldComposer: () =>
              $$SyncFailuresTableAnnotationComposer($db: db, $table: table),
          updateCompanionCallback: ({
            Value<String> id = const Value.absent(),
            Value<String?> commandId = const Value.absent(),
            Value<String?> commandType = const Value.absent(),
            Value<String?> entityType = const Value.absent(),
            Value<String?> workspaceId = const Value.absent(),
            Value<DateTime> occurredAt = const Value.absent(),
            Value<int> attempt = const Value.absent(),
            Value<String?> errorCode = const Value.absent(),
            Value<String> errorClass = const Value.absent(),
            Value<String?> messageSafe = const Value.absent(),
            Value<String?> payloadSnapshotJson = const Value.absent(),
            Value<int> rowid = const Value.absent(),
          }) =>
              SyncFailuresCompanion(
            id: id,
            commandId: commandId,
            commandType: commandType,
            entityType: entityType,
            workspaceId: workspaceId,
            occurredAt: occurredAt,
            attempt: attempt,
            errorCode: errorCode,
            errorClass: errorClass,
            messageSafe: messageSafe,
            payloadSnapshotJson: payloadSnapshotJson,
            rowid: rowid,
          ),
          createCompanionCallback: ({
            required String id,
            Value<String?> commandId = const Value.absent(),
            Value<String?> commandType = const Value.absent(),
            Value<String?> entityType = const Value.absent(),
            Value<String?> workspaceId = const Value.absent(),
            required DateTime occurredAt,
            required int attempt,
            Value<String?> errorCode = const Value.absent(),
            required String errorClass,
            Value<String?> messageSafe = const Value.absent(),
            Value<String?> payloadSnapshotJson = const Value.absent(),
            Value<int> rowid = const Value.absent(),
          }) =>
              SyncFailuresCompanion.insert(
            id: id,
            commandId: commandId,
            commandType: commandType,
            entityType: entityType,
            workspaceId: workspaceId,
            occurredAt: occurredAt,
            attempt: attempt,
            errorCode: errorCode,
            errorClass: errorClass,
            messageSafe: messageSafe,
            payloadSnapshotJson: payloadSnapshotJson,
            rowid: rowid,
          ),
          withReferenceMapper: (p0) => p0
              .map((e) => (e.readTable(table), BaseReferences(db, table, e)))
              .toList(),
          prefetchHooksCallback: null,
        ));
}

typedef $$SyncFailuresTableProcessedTableManager = ProcessedTableManager<
    _$AppDatabase,
    $SyncFailuresTable,
    SyncFailure,
    $$SyncFailuresTableFilterComposer,
    $$SyncFailuresTableOrderingComposer,
    $$SyncFailuresTableAnnotationComposer,
    $$SyncFailuresTableCreateCompanionBuilder,
    $$SyncFailuresTableUpdateCompanionBuilder,
    (
      SyncFailure,
      BaseReferences<_$AppDatabase, $SyncFailuresTable, SyncFailure>
    ),
    SyncFailure,
    PrefetchHooks Function()>;
typedef $$SyncMetadataTableCreateCompanionBuilder = SyncMetadataCompanion
    Function({
  required String key,
  Value<String?> workspaceId,
  required String valueJson,
  required DateTime updatedAt,
  Value<int> rowid,
});
typedef $$SyncMetadataTableUpdateCompanionBuilder = SyncMetadataCompanion
    Function({
  Value<String> key,
  Value<String?> workspaceId,
  Value<String> valueJson,
  Value<DateTime> updatedAt,
  Value<int> rowid,
});

class $$SyncMetadataTableFilterComposer
    extends Composer<_$AppDatabase, $SyncMetadataTable> {
  $$SyncMetadataTableFilterComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  ColumnFilters<String> get key => $composableBuilder(
      column: $table.key, builder: (column) => ColumnFilters(column));

  ColumnFilters<String> get workspaceId => $composableBuilder(
      column: $table.workspaceId, builder: (column) => ColumnFilters(column));

  ColumnFilters<String> get valueJson => $composableBuilder(
      column: $table.valueJson, builder: (column) => ColumnFilters(column));

  ColumnFilters<DateTime> get updatedAt => $composableBuilder(
      column: $table.updatedAt, builder: (column) => ColumnFilters(column));
}

class $$SyncMetadataTableOrderingComposer
    extends Composer<_$AppDatabase, $SyncMetadataTable> {
  $$SyncMetadataTableOrderingComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  ColumnOrderings<String> get key => $composableBuilder(
      column: $table.key, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<String> get workspaceId => $composableBuilder(
      column: $table.workspaceId, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<String> get valueJson => $composableBuilder(
      column: $table.valueJson, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<DateTime> get updatedAt => $composableBuilder(
      column: $table.updatedAt, builder: (column) => ColumnOrderings(column));
}

class $$SyncMetadataTableAnnotationComposer
    extends Composer<_$AppDatabase, $SyncMetadataTable> {
  $$SyncMetadataTableAnnotationComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  GeneratedColumn<String> get key =>
      $composableBuilder(column: $table.key, builder: (column) => column);

  GeneratedColumn<String> get workspaceId => $composableBuilder(
      column: $table.workspaceId, builder: (column) => column);

  GeneratedColumn<String> get valueJson =>
      $composableBuilder(column: $table.valueJson, builder: (column) => column);

  GeneratedColumn<DateTime> get updatedAt =>
      $composableBuilder(column: $table.updatedAt, builder: (column) => column);
}

class $$SyncMetadataTableTableManager extends RootTableManager<
    _$AppDatabase,
    $SyncMetadataTable,
    SyncMetadataEntry,
    $$SyncMetadataTableFilterComposer,
    $$SyncMetadataTableOrderingComposer,
    $$SyncMetadataTableAnnotationComposer,
    $$SyncMetadataTableCreateCompanionBuilder,
    $$SyncMetadataTableUpdateCompanionBuilder,
    (
      SyncMetadataEntry,
      BaseReferences<_$AppDatabase, $SyncMetadataTable, SyncMetadataEntry>
    ),
    SyncMetadataEntry,
    PrefetchHooks Function()> {
  $$SyncMetadataTableTableManager(_$AppDatabase db, $SyncMetadataTable table)
      : super(TableManagerState(
          db: db,
          table: table,
          createFilteringComposer: () =>
              $$SyncMetadataTableFilterComposer($db: db, $table: table),
          createOrderingComposer: () =>
              $$SyncMetadataTableOrderingComposer($db: db, $table: table),
          createComputedFieldComposer: () =>
              $$SyncMetadataTableAnnotationComposer($db: db, $table: table),
          updateCompanionCallback: ({
            Value<String> key = const Value.absent(),
            Value<String?> workspaceId = const Value.absent(),
            Value<String> valueJson = const Value.absent(),
            Value<DateTime> updatedAt = const Value.absent(),
            Value<int> rowid = const Value.absent(),
          }) =>
              SyncMetadataCompanion(
            key: key,
            workspaceId: workspaceId,
            valueJson: valueJson,
            updatedAt: updatedAt,
            rowid: rowid,
          ),
          createCompanionCallback: ({
            required String key,
            Value<String?> workspaceId = const Value.absent(),
            required String valueJson,
            required DateTime updatedAt,
            Value<int> rowid = const Value.absent(),
          }) =>
              SyncMetadataCompanion.insert(
            key: key,
            workspaceId: workspaceId,
            valueJson: valueJson,
            updatedAt: updatedAt,
            rowid: rowid,
          ),
          withReferenceMapper: (p0) => p0
              .map((e) => (e.readTable(table), BaseReferences(db, table, e)))
              .toList(),
          prefetchHooksCallback: null,
        ));
}

typedef $$SyncMetadataTableProcessedTableManager = ProcessedTableManager<
    _$AppDatabase,
    $SyncMetadataTable,
    SyncMetadataEntry,
    $$SyncMetadataTableFilterComposer,
    $$SyncMetadataTableOrderingComposer,
    $$SyncMetadataTableAnnotationComposer,
    $$SyncMetadataTableCreateCompanionBuilder,
    $$SyncMetadataTableUpdateCompanionBuilder,
    (
      SyncMetadataEntry,
      BaseReferences<_$AppDatabase, $SyncMetadataTable, SyncMetadataEntry>
    ),
    SyncMetadataEntry,
    PrefetchHooks Function()>;
typedef $$RecentSearchesTableCreateCompanionBuilder = RecentSearchesCompanion
    Function({
  required String id,
  required String userId,
  required String workspaceId,
  required String term,
  required String termNorm,
  Value<String?> resultKind,
  Value<String?> resultId,
  required DateTime searchedAt,
  Value<int> rowid,
});
typedef $$RecentSearchesTableUpdateCompanionBuilder = RecentSearchesCompanion
    Function({
  Value<String> id,
  Value<String> userId,
  Value<String> workspaceId,
  Value<String> term,
  Value<String> termNorm,
  Value<String?> resultKind,
  Value<String?> resultId,
  Value<DateTime> searchedAt,
  Value<int> rowid,
});

class $$RecentSearchesTableFilterComposer
    extends Composer<_$AppDatabase, $RecentSearchesTable> {
  $$RecentSearchesTableFilterComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  ColumnFilters<String> get id => $composableBuilder(
      column: $table.id, builder: (column) => ColumnFilters(column));

  ColumnFilters<String> get userId => $composableBuilder(
      column: $table.userId, builder: (column) => ColumnFilters(column));

  ColumnFilters<String> get workspaceId => $composableBuilder(
      column: $table.workspaceId, builder: (column) => ColumnFilters(column));

  ColumnFilters<String> get term => $composableBuilder(
      column: $table.term, builder: (column) => ColumnFilters(column));

  ColumnFilters<String> get termNorm => $composableBuilder(
      column: $table.termNorm, builder: (column) => ColumnFilters(column));

  ColumnFilters<String> get resultKind => $composableBuilder(
      column: $table.resultKind, builder: (column) => ColumnFilters(column));

  ColumnFilters<String> get resultId => $composableBuilder(
      column: $table.resultId, builder: (column) => ColumnFilters(column));

  ColumnFilters<DateTime> get searchedAt => $composableBuilder(
      column: $table.searchedAt, builder: (column) => ColumnFilters(column));
}

class $$RecentSearchesTableOrderingComposer
    extends Composer<_$AppDatabase, $RecentSearchesTable> {
  $$RecentSearchesTableOrderingComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  ColumnOrderings<String> get id => $composableBuilder(
      column: $table.id, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<String> get userId => $composableBuilder(
      column: $table.userId, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<String> get workspaceId => $composableBuilder(
      column: $table.workspaceId, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<String> get term => $composableBuilder(
      column: $table.term, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<String> get termNorm => $composableBuilder(
      column: $table.termNorm, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<String> get resultKind => $composableBuilder(
      column: $table.resultKind, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<String> get resultId => $composableBuilder(
      column: $table.resultId, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<DateTime> get searchedAt => $composableBuilder(
      column: $table.searchedAt, builder: (column) => ColumnOrderings(column));
}

class $$RecentSearchesTableAnnotationComposer
    extends Composer<_$AppDatabase, $RecentSearchesTable> {
  $$RecentSearchesTableAnnotationComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  GeneratedColumn<String> get id =>
      $composableBuilder(column: $table.id, builder: (column) => column);

  GeneratedColumn<String> get userId =>
      $composableBuilder(column: $table.userId, builder: (column) => column);

  GeneratedColumn<String> get workspaceId => $composableBuilder(
      column: $table.workspaceId, builder: (column) => column);

  GeneratedColumn<String> get term =>
      $composableBuilder(column: $table.term, builder: (column) => column);

  GeneratedColumn<String> get termNorm =>
      $composableBuilder(column: $table.termNorm, builder: (column) => column);

  GeneratedColumn<String> get resultKind => $composableBuilder(
      column: $table.resultKind, builder: (column) => column);

  GeneratedColumn<String> get resultId =>
      $composableBuilder(column: $table.resultId, builder: (column) => column);

  GeneratedColumn<DateTime> get searchedAt => $composableBuilder(
      column: $table.searchedAt, builder: (column) => column);
}

class $$RecentSearchesTableTableManager extends RootTableManager<
    _$AppDatabase,
    $RecentSearchesTable,
    RecentSearch,
    $$RecentSearchesTableFilterComposer,
    $$RecentSearchesTableOrderingComposer,
    $$RecentSearchesTableAnnotationComposer,
    $$RecentSearchesTableCreateCompanionBuilder,
    $$RecentSearchesTableUpdateCompanionBuilder,
    (
      RecentSearch,
      BaseReferences<_$AppDatabase, $RecentSearchesTable, RecentSearch>
    ),
    RecentSearch,
    PrefetchHooks Function()> {
  $$RecentSearchesTableTableManager(
      _$AppDatabase db, $RecentSearchesTable table)
      : super(TableManagerState(
          db: db,
          table: table,
          createFilteringComposer: () =>
              $$RecentSearchesTableFilterComposer($db: db, $table: table),
          createOrderingComposer: () =>
              $$RecentSearchesTableOrderingComposer($db: db, $table: table),
          createComputedFieldComposer: () =>
              $$RecentSearchesTableAnnotationComposer($db: db, $table: table),
          updateCompanionCallback: ({
            Value<String> id = const Value.absent(),
            Value<String> userId = const Value.absent(),
            Value<String> workspaceId = const Value.absent(),
            Value<String> term = const Value.absent(),
            Value<String> termNorm = const Value.absent(),
            Value<String?> resultKind = const Value.absent(),
            Value<String?> resultId = const Value.absent(),
            Value<DateTime> searchedAt = const Value.absent(),
            Value<int> rowid = const Value.absent(),
          }) =>
              RecentSearchesCompanion(
            id: id,
            userId: userId,
            workspaceId: workspaceId,
            term: term,
            termNorm: termNorm,
            resultKind: resultKind,
            resultId: resultId,
            searchedAt: searchedAt,
            rowid: rowid,
          ),
          createCompanionCallback: ({
            required String id,
            required String userId,
            required String workspaceId,
            required String term,
            required String termNorm,
            Value<String?> resultKind = const Value.absent(),
            Value<String?> resultId = const Value.absent(),
            required DateTime searchedAt,
            Value<int> rowid = const Value.absent(),
          }) =>
              RecentSearchesCompanion.insert(
            id: id,
            userId: userId,
            workspaceId: workspaceId,
            term: term,
            termNorm: termNorm,
            resultKind: resultKind,
            resultId: resultId,
            searchedAt: searchedAt,
            rowid: rowid,
          ),
          withReferenceMapper: (p0) => p0
              .map((e) => (e.readTable(table), BaseReferences(db, table, e)))
              .toList(),
          prefetchHooksCallback: null,
        ));
}

typedef $$RecentSearchesTableProcessedTableManager = ProcessedTableManager<
    _$AppDatabase,
    $RecentSearchesTable,
    RecentSearch,
    $$RecentSearchesTableFilterComposer,
    $$RecentSearchesTableOrderingComposer,
    $$RecentSearchesTableAnnotationComposer,
    $$RecentSearchesTableCreateCompanionBuilder,
    $$RecentSearchesTableUpdateCompanionBuilder,
    (
      RecentSearch,
      BaseReferences<_$AppDatabase, $RecentSearchesTable, RecentSearch>
    ),
    RecentSearch,
    PrefetchHooks Function()>;

class $AppDatabaseManager {
  final _$AppDatabase _db;
  $AppDatabaseManager(this._db);
  $$WorkspaceScopesTableTableManager get workspaceScopes =>
      $$WorkspaceScopesTableTableManager(_db, _db.workspaceScopes);
  $$CachedUsersTableTableManager get cachedUsers =>
      $$CachedUsersTableTableManager(_db, _db.cachedUsers);
  $$CachedSitesTableTableManager get cachedSites =>
      $$CachedSitesTableTableManager(_db, _db.cachedSites);
  $$CachedAssetsTableTableManager get cachedAssets =>
      $$CachedAssetsTableTableManager(_db, _db.cachedAssets);
  $$CachedTyresTableTableManager get cachedTyres =>
      $$CachedTyresTableTableManager(_db, _db.cachedTyres);
  $$CachedChecklistTemplatesTableTableManager get cachedChecklistTemplates =>
      $$CachedChecklistTemplatesTableTableManager(
          _db, _db.cachedChecklistTemplates);
  $$CachedPermissionsTableTableManager get cachedPermissions =>
      $$CachedPermissionsTableTableManager(_db, _db.cachedPermissions);
  $$InspectionDraftsTableTableManager get inspectionDrafts =>
      $$InspectionDraftsTableTableManager(_db, _db.inspectionDrafts);
  $$InspectionDraftPositionsTableTableManager get inspectionDraftPositions =>
      $$InspectionDraftPositionsTableTableManager(
          _db, _db.inspectionDraftPositions);
  $$ChecklistDraftsTableTableManager get checklistDrafts =>
      $$ChecklistDraftsTableTableManager(_db, _db.checklistDrafts);
  $$DraftPhotosTableTableManager get draftPhotos =>
      $$DraftPhotosTableTableManager(_db, _db.draftPhotos);
  $$CapturedSignaturesTableTableManager get capturedSignatures =>
      $$CapturedSignaturesTableTableManager(_db, _db.capturedSignatures);
  $$PendingCommandsTableTableManager get pendingCommands =>
      $$PendingCommandsTableTableManager(_db, _db.pendingCommands);
  $$PendingMediaUploadsTableTableManager get pendingMediaUploads =>
      $$PendingMediaUploadsTableTableManager(_db, _db.pendingMediaUploads);
  $$SyncFailuresTableTableManager get syncFailures =>
      $$SyncFailuresTableTableManager(_db, _db.syncFailures);
  $$SyncMetadataTableTableManager get syncMetadata =>
      $$SyncMetadataTableTableManager(_db, _db.syncMetadata);
  $$RecentSearchesTableTableManager get recentSearches =>
      $$RecentSearchesTableTableManager(_db, _db.recentSearches);
}
