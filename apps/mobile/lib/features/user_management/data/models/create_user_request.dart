import '../../../auth/data/models/user_model.dart';
import '../../../auth/domain/entities/app_user.dart';

/// Request body for POST /users. There is no self-registration equivalent anywhere.
class CreateUserRequest {
  const CreateUserRequest({
    required this.fullName,
    required this.email,
    required this.password,
    required this.role,
    this.phone,
    this.requirePasswordChange = true,
  });

  final String fullName;
  final String email;
  final String password;
  final String? phone;
  final UserRole role;
  final bool requirePasswordChange;

  Map<String, dynamic> toJson() => <String, dynamic>{
        'fullName': fullName,
        'email': email,
        'password': password,
        if (phone != null && phone!.isNotEmpty) 'phone': phone,
        'role': role.wireValue,
        'requirePasswordChange': requirePasswordChange,
      };
}

class ResetPasscodeRequest {
  const ResetPasscodeRequest({required this.newPassword, this.reason});

  final String newPassword;
  final String? reason;

  Map<String, dynamic> toJson() => <String, dynamic>{
        'newPassword': newPassword,
        if (reason != null && reason!.isNotEmpty) 'reason': reason,
      };
}

/// Response for both user creation and passcode reset.
///
/// [temporaryPassword] is present exactly once and must never be written to disk or
/// logged; it is shown to the admin and then discarded with the screen state.
class ProvisionedUser {
  const ProvisionedUser({required this.user, required this.temporaryPassword});

  final UserModel user;
  final String temporaryPassword;

  factory ProvisionedUser.fromJson(Map<String, dynamic> json) {
    return ProvisionedUser(
      user: UserModel.fromJson(json['user'] as Map<String, dynamic>),
      temporaryPassword: json['temporaryPassword'] as String,
    );
  }
}

class PaginatedUsers {
  const PaginatedUsers({
    required this.items,
    required this.page,
    required this.total,
    required this.totalPages,
  });

  final List<UserModel> items;
  final int page;
  final int total;
  final int totalPages;

  factory PaginatedUsers.fromJson(Map<String, dynamic> json) {
    return PaginatedUsers(
      items: (json['items'] as List<dynamic>)
          .map((dynamic item) => UserModel.fromJson(item as Map<String, dynamic>))
          .toList(growable: false),
      page: (json['page'] as num?)?.toInt() ?? 1,
      total: (json['total'] as num?)?.toInt() ?? 0,
      totalPages: (json['totalPages'] as num?)?.toInt() ?? 1,
    );
  }

  static const PaginatedUsers empty = PaginatedUsers(
    items: <UserModel>[],
    page: 1,
    total: 0,
    totalPages: 1,
  );
}
