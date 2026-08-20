import 'package:equatable/equatable.dart';

/// Mirrors the backend role enum. Parsed defensively so an unknown value from a
/// newer API version degrades to the least-privileged role rather than crashing.
enum UserRole {
  customer('customer', 'Харилцагч'),
  technician('technician', 'Ажилтан'),
  admin('admin', 'Админ'),
  headAdmin('head_admin', 'Ерөнхий админ');

  const UserRole(this.wireValue, this.label);

  final String wireValue;
  final String label;

  static UserRole fromWire(String? value) {
    return UserRole.values.firstWhere(
      (UserRole role) => role.wireValue == value,
      orElse: () => UserRole.customer,
    );
  }

  bool get isAdmin => this == UserRole.admin || this == UserRole.headAdmin;

  bool get isHeadAdmin => this == UserRole.headAdmin;
}

enum AccountStatus {
  active('active', 'Идэвхтэй'),
  suspended('suspended', 'Түр хаагдсан'),
  mustChangePassword('must_change_password', 'Нууц үг солих шаардлагатай');

  const AccountStatus(this.wireValue, this.label);

  final String wireValue;
  final String label;

  static AccountStatus fromWire(String? value) {
    return AccountStatus.values.firstWhere(
      (AccountStatus status) => status.wireValue == value,
      orElse: () => AccountStatus.active,
    );
  }
}

/// Permission keys this app checks before offering an action.
///
/// Mirrors the subset of `PERMISSIONS` in
/// packages/shared/src/constants/permissions.ts that the mobile client needs. The
/// backend remains the authority; these exist so the UI does not present a control
/// the API is going to refuse.
class PermissionKeys {
  const PermissionKeys._();

  static const String serviceRequestView = 'service_request.view';
  static const String serviceRequestCreate = 'service_request.create';
  static const String objectView = 'object.view';
  static const String objectMasterView = 'object_master.view';
  static const String notificationView = 'notification.view';
  static const String customerView = 'customer.view';

  /// The portal grants a signed-in customer holds.
  ///
  /// `DEFAULT_ROLE_PERMISSIONS.CUSTOMER` in permissions.ts carries the `portal.*`
  /// keys and not one staff key, so a customer account raises a request under
  /// `portal.service_request.create` while a staff account does it under
  /// `service_request.create`.
  static const String portalServiceRequestView = 'portal.service_request.view';
  static const String portalServiceRequestCreate = 'portal.service_request.create';

  /// Rating the technicians who attended a finished job.
  ///
  /// A portal key with no staff counterpart, deliberately: `survey.view_results` and
  /// `survey.manage_questions` are the staff keys and neither of them submits a
  /// response. A customer is the only party who can say what dealing with somebody was
  /// like, so this is the only key that opens the form.
  static const String portalSurveySubmit = 'portal.survey.submit';
}

class AppUser extends Equatable {
  const AppUser({
    required this.id,
    required this.fullName,
    required this.email,
    required this.role,
    required this.status,
    this.phone,
    this.customerId,
    this.customerName,
    this.lastLoginAt,
    this.permissions = const <String>{},
  });

  final String id;
  final String fullName;
  final String email;
  final String? phone;
  final UserRole role;
  final AccountStatus status;

  /// The customer organisation this account belongs to.
  ///
  /// Mirrors `UserDto.customerId` in packages/shared/src/types/user.types.ts:
  /// populated for a `customer` account and null for staff. This is the security
  /// boundary for every customer-owned read, so the server resolves it from the
  /// account and never accepts it from a request. The app treats it the same way -
  /// it is read from the session and is never chosen, defaulted or overridden here.
  final String? customerId;

  /// Mirrors `UserDto.customerName`. Display only.
  ///
  /// Null whenever the server sent the relation unpopulated, so no screen may infer
  /// "not linked" from a missing name; [customerId] is the only signal for that.
  final String? customerName;

  final DateTime? lastLoginAt;

  /// Effective permission set, as reported by GET /auth/me.
  ///
  /// Empty after a login, because the login response carries a plain `UserDto` with
  /// no permission list; it fills in on the next /auth/me. Callers must therefore
  /// treat an empty set as "not known yet" for enabling UI, never as a licence.
  final Set<String> permissions;

  bool has(String permission) => permissions.contains(permission);

  bool get mustChangePassword => status == AccountStatus.mustChangePassword;

  /// Mirrors the backend assertCanManageRole rule, so the UI never offers an action
  /// the API would reject with 403. A plain admin manages customers and technicians;
  /// acting on another administrator is reserved for the head_admin.
  bool canManage(AppUser target) {
    if (target.id == id) return false;
    if (role == UserRole.headAdmin) return true;
    if (role == UserRole.admin) {
      return target.role == UserRole.customer || target.role == UserRole.technician;
    }
    return false;
  }

  /// Whether this actor may create an account with [targetRole].
  bool canCreateRole(UserRole targetRole) {
    if (role == UserRole.headAdmin) return true;
    if (role == UserRole.admin) {
      return targetRole == UserRole.customer || targetRole == UserRole.technician;
    }
    return false;
  }

  @override
  List<Object?> get props => <Object?>[
        id,
        fullName,
        email,
        phone,
        role,
        status,
        customerId,
        customerName,
        lastLoginAt,
        permissions,
      ];
}
