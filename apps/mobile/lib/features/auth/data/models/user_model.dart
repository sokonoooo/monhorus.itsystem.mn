import '../../domain/entities/app_user.dart';

/// Data-layer representation of a user. Owns JSON translation so the domain entity
/// stays free of transport concerns.
class UserModel extends AppUser {
  const UserModel({
    required super.id,
    required super.fullName,
    required super.email,
    required super.role,
    required super.status,
    super.phone,
    super.customerId,
    super.customerName,
    super.lastLoginAt,
    super.permissions,
  });

  factory UserModel.fromJson(Map<String, dynamic> json) {
    // GET /auth/me returns CurrentUserDto, which is a UserDto plus roleIds and
    // permissions. The login response is a bare UserDto, so the key is absent there
    // and the set is empty until the next /auth/me.
    final Object? rawPermissions = json['permissions'];

    return UserModel(
      id: json['id'] as String,
      fullName: json['fullName'] as String,
      email: json['email'] as String,
      phone: json['phone'] as String?,
      role: UserRole.fromWire(json['role'] as String?),
      status: AccountStatus.fromWire(json['status'] as String?),
      // `UserDto.customerId` is `string | null`. An empty string is read as absent
      // too, because a missing relation must never become a customer id that scopes
      // reads to nothing while looking resolved.
      customerId: _nonEmpty(json['customerId']),
      customerName: _nonEmpty(json['customerName']),
      lastLoginAt: json['lastLoginAt'] == null
          ? null
          : DateTime.tryParse(json['lastLoginAt'] as String),
      permissions: rawPermissions is List
          ? rawPermissions.whereType<String>().toSet()
          : const <String>{},
    );
  }

  factory UserModel.fromEntity(AppUser user) {
    return UserModel(
      id: user.id,
      fullName: user.fullName,
      email: user.email,
      phone: user.phone,
      role: user.role,
      status: user.status,
      customerId: user.customerId,
      customerName: user.customerName,
      lastLoginAt: user.lastLoginAt,
      permissions: user.permissions,
    );
  }

  Map<String, dynamic> toJson() {
    return <String, dynamic>{
      'id': id,
      'fullName': fullName,
      'email': email,
      'phone': phone,
      'role': role.wireValue,
      'status': status.wireValue,
      'customerId': customerId,
      'customerName': customerName,
      'lastLoginAt': lastLoginAt?.toIso8601String(),
      'permissions': permissions.toList(growable: false),
    };
  }

  static String? _nonEmpty(Object? value) {
    if (value is! String) return null;
    final String trimmed = value.trim();
    return trimmed.isEmpty ? null : trimmed;
  }
}
