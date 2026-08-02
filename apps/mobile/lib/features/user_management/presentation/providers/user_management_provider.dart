import 'dart:math';

import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../core/error/failure.dart';
import '../../../../core/network/api_result.dart';
import '../../../auth/domain/entities/app_user.dart';
import '../../../auth/presentation/providers/auth_provider.dart';
import '../../data/datasources/user_remote_data_source.dart';
import '../../data/models/create_user_request.dart';
import '../../data/repositories/user_repository_impl.dart';
import '../../domain/repositories/user_repository.dart';

final Provider<UserRepository> userRepositoryProvider = Provider<UserRepository>((Ref ref) {
  return UserRepositoryImpl(UserRemoteDataSource(ref.watch(dioClientProvider)));
});

/// Filter state for the user list. Immutable so a change produces a new fetch key.
class UserListFilter {
  const UserListFilter({this.role, this.status, this.search = '', this.page = 1});

  final UserRole? role;
  final AccountStatus? status;
  final String search;
  final int page;

  UserListFilter copyWith({
    UserRole? role,
    AccountStatus? status,
    String? search,
    int? page,
    bool clearRole = false,
    bool clearStatus = false,
  }) {
    return UserListFilter(
      role: clearRole ? null : (role ?? this.role),
      status: clearStatus ? null : (status ?? this.status),
      search: search ?? this.search,
      page: page ?? this.page,
    );
  }
}

class UserListState {
  const UserListState({
    this.data = PaginatedUsers.empty,
    this.loading = true,
    this.failure,
    this.filter = const UserListFilter(),
  });

  final PaginatedUsers data;
  final bool loading;
  final Failure? failure;
  final UserListFilter filter;

  UserListState copyWith({
    PaginatedUsers? data,
    bool? loading,
    Failure? failure,
    UserListFilter? filter,
    bool clearFailure = false,
  }) {
    return UserListState(
      data: data ?? this.data,
      loading: loading ?? this.loading,
      failure: clearFailure ? null : (failure ?? this.failure),
      filter: filter ?? this.filter,
    );
  }
}

class UserListController extends Notifier<UserListState> {
  @override
  UserListState build() {
    Future<void>.microtask(load);
    return const UserListState();
  }

  UserRepository get _repository => ref.read(userRepositoryProvider);

  Future<void> load() async {
    state = state.copyWith(loading: true, clearFailure: true);

    final UserListFilter filter = state.filter;
    final ApiResult<PaginatedUsers> result = await _repository.list(
      page: filter.page,
      role: filter.role,
      status: filter.status,
      search: filter.search,
    );

    state = result.when(
      success: (PaginatedUsers data) => state.copyWith(data: data, loading: false),
      failure: (Failure failure) => state.copyWith(loading: false, failure: failure),
    );
  }

  Future<void> applyFilter(UserListFilter filter) async {
    // Any filter change resets to the first page; page 5 of the old filter is
    // meaningless under the new one.
    state = state.copyWith(filter: filter.copyWith(page: 1));
    await load();
  }

  Future<void> goToPage(int page) async {
    state = state.copyWith(filter: state.filter.copyWith(page: page));
    await load();
  }

  Future<ProvisionedUser?> createUser(CreateUserRequest request) async {
    final ApiResult<ProvisionedUser> result = await _repository.create(request);

    return result.when(
      success: (ProvisionedUser provisioned) {
        Future<void>.microtask(load);
        return provisioned;
      },
      failure: (Failure failure) {
        state = state.copyWith(failure: failure);
        return null;
      },
    );
  }

  Future<ProvisionedUser?> resetPasscode(String userId, ResetPasscodeRequest request) async {
    final ApiResult<ProvisionedUser> result =
        await _repository.resetPasscode(userId, request);

    return result.when(
      success: (ProvisionedUser provisioned) {
        Future<void>.microtask(load);
        return provisioned;
      },
      failure: (Failure failure) {
        state = state.copyWith(failure: failure);
        return null;
      },
    );
  }

  Future<bool> toggleSuspension(AppUser target) async {
    final AccountStatus next = target.status == AccountStatus.suspended
        ? AccountStatus.active
        : AccountStatus.suspended;

    final ApiResult<void> result = await _repository.updateStatus(target.id, next);

    return result.when(
      success: (_) {
        Future<void>.microtask(load);
        return true;
      },
      failure: (Failure failure) {
        state = state.copyWith(failure: failure);
        return false;
      },
    );
  }

  void clearFailure() => state = state.copyWith(clearFailure: true);
}

final NotifierProvider<UserListController, UserListState> userListControllerProvider =
    NotifierProvider<UserListController, UserListState>(UserListController.new);

/// Generates a temporary passcode satisfying the backend policy: at least 10
/// characters with a letter and a digit.
///
/// Ambiguous glyphs (O/0, I/l/1) are excluded because an admin reads these aloud or
/// retypes them by hand when handing one to a field technician.
String generatePasscode() {
  const String letters = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz';
  const String digits = '23456789';
  final Random random = Random.secure();

  final List<String> chars = <String>[
    for (int i = 0; i < 11; i++) letters[random.nextInt(letters.length)],
    for (int i = 0; i < 3; i++) digits[random.nextInt(digits.length)],
  ];

  return chars.join();
}
