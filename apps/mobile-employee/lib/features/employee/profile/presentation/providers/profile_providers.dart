import 'dart:typed_data';

import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../../core/error/failure.dart';
import '../../../../../core/network/api_result.dart';
import '../../../../auth/presentation/providers/auth_provider.dart';
import '../../../identity/employee_self.dart';
import '../../../identity/employee_self_provider.dart';
import '../../data/datasources/profile_remote_data_source.dart';
import '../../data/models/employee_model.dart';
import '../../data/repositories/profile_repository_impl.dart';
import '../../domain/entities/employee_record_state.dart';
import '../../domain/repositories/profile_repository.dart';

// -- Dependency graph --------------------------------------------------------

final Provider<ProfileRepository> profileRepositoryProvider =
    Provider<ProfileRepository>((Ref ref) {
  // The shared Dio client from lib/features/auth — the same instance that holds the
  // session and performs the 401 refresh. This tab never builds its own.
  return ProfileRepositoryImpl(
    ProfileRemoteDataSource(ref.watch(dioClientProvider)),
  );
});

// -- Helpers -----------------------------------------------------------------

/// Unwraps an [ApiResult] for an async provider, throwing the [Failure] so it lands
/// in `AsyncValue.error` with its Mongolian message intact.
T _unwrap<T>(ApiResult<T> result) => result.when(
      success: (T data) => data,
      failure: (Failure failure) => throw failure,
    );

// -- Identity ----------------------------------------------------------------

/// Re-reads `GET /auth/me` once, so the tab renders the effective permission set
/// rather than the empty one a fresh login leaves behind.
///
/// `POST /auth/login` answers with a bare `UserDto` that carries no `permissions`,
/// and `authenticate.middleware` re-resolves the set on every request, so the array
/// on `/auth/me` is the only source of truth for what this account may do. The
/// controller swallows a failure here by design; the tab still renders from the
/// session it already holds.
///
/// Deliberately watches nothing: it must run exactly once per mount and is refreshed
/// only by an explicit `ref.invalidate`, otherwise the state it writes would
/// re-trigger it.
final FutureProvider<void> profileIdentityRefreshProvider =
    FutureProvider<void>((Ref ref) async {
  await ref.read(authControllerProvider.notifier).refreshCurrentUser();
});

// -- Employee record ---------------------------------------------------------

/// The signed-in account's own employee (HR) record.
///
/// One `GET /employees/me`, shared with the other tabs that need the same answer —
/// see [employeeSelfProvider] — and this provider only translates its result into the
/// two outcomes this screen distinguishes.
///
/// Every outcome the app can put into words (resolved, unlinked) arrives as data;
/// only a transport or unexpected server failure reaches `AsyncValue.error`, which is
/// what earns the red banner and the retry button.
final FutureProvider<EmployeeRecordState> employeeRecordProvider =
    FutureProvider<EmployeeRecordState>((Ref ref) async {
  // The record itself no longer depends on the permission set — `/employees/me` is
  // authentication-only — but the Бүртгэл card below it renders what `/auth/me`
  // reports, and this is the one provider on the tab that runs on mount. Awaiting it
  // keeps that card off a stale login response.
  await ref.watch(profileIdentityRefreshProvider.future);

  final EmployeeSelf self = await ref.watch(employeeSelfProvider.future);

  return switch (self) {
    EmployeeSelfResolved(:final Map<String, dynamic> record) =>
      EmployeeRecordResolved(EmployeeProfileModel.fromJson(record)),
    EmployeeSelfUnavailable(
      problem: EmployeeSelfProblem.notLinked,
      :final String? serverMessage,
    ) =>
      EmployeeRecordUnlinked(message: serverMessage),
    // Neither a failed read nor a missing session is an answer about the account, so
    // both are raised rather than rendered as "no record": telling someone they have
    // no employee card because the network dropped would state a fact the app does
    // not have.
    EmployeeSelfUnavailable(:final String? serverMessage) => throw ServerFailure(
        serverMessage ?? 'Ажилтны мэдээлэл татаж чадсангүй.',
        code: 'LOOKUP_FAILED',
      ),
  };
});

/// Bytes of the employee photo behind `GET /files/:fileId`.
final FutureProviderFamily<Uint8List, String> employeePhotoProvider =
    FutureProvider.family<Uint8List, String>((Ref ref, String fileId) async {
  final ProfileRepository repository = ref.watch(profileRepositoryProvider);
  return _unwrap(await repository.downloadFile(fileId));
});

