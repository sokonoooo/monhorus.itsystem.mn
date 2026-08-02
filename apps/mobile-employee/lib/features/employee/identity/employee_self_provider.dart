import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/error/exceptions.dart';
import '../../../core/util/json_parse.dart';
import '../../auth/domain/entities/app_user.dart';
import '../../auth/presentation/providers/auth_provider.dart';
import 'employee_self.dart';
import 'employee_self_data_source.dart';

/// Resolves [EmployeeSelf] once per session, for the whole app.
///
/// Riverpod caches the future, so the four data-driven tabs (home, work, calendar,
/// profile) share one answer and one request. Invalidate this provider to force a
/// re-read — the profile tab's pull-to-refresh does, which is how an administrator's
/// re-link reaches the screen without a restart.
///
/// It is a single GET now. The version this replaced spent up to eleven directory
/// calls on a cold start, and every one of them read a colleague's HR record.
///
/// No permission is checked before calling. `/employees/me` is authentication-only by
/// design: the record is chosen by the server from the session, so there is nothing
/// to authorise. Gating the call on a client-side permission guess would be the old
/// mistake in a new place — it would hide the caller's own identity from them the
/// moment an administrator trimmed a role.
final FutureProvider<EmployeeSelf> employeeSelfProvider =
    FutureProvider<EmployeeSelf>((Ref ref) async {
  // Watched rather than read, so signing in as somebody else re-resolves rather than
  // serving the previous account's card out of the cache.
  final AppUser? user = ref.watch(currentUserProvider);
  if (user == null) {
    return const EmployeeSelfUnavailable(EmployeeSelfProblem.noSession);
  }

  final EmployeeSelfRemoteDataSource source =
      EmployeeSelfRemoteDataSource(ref.watch(dioClientProvider));

  try {
    final Map<String, dynamic> record = await source.fetchSelf();

    final String? employeeId = parseString(record['id']);
    if (employeeId == null) {
      // A 200 with no id is not an answer about the account, so it is reported as a
      // failed read rather than as "you have no employee card".
      return const EmployeeSelfUnavailable(EmployeeSelfProblem.lookupFailed);
    }

    return EmployeeSelfResolved(employeeId: employeeId, record: record);
  } on ServerException catch (error) {
    return EmployeeSelfUnavailable(
      // 404 is the endpoint's own "this account is linked to no employee card", and
      // it is the only status that says anything definite about the account. Every
      // other refusal — including a 403, which this route should never produce —
      // means the app could not find out, which is a different thing to report.
      error.statusCode == 404
          ? EmployeeSelfProblem.notLinked
          : EmployeeSelfProblem.lookupFailed,
      serverMessage: error.message,
    );
  } on NetworkException catch (error) {
    return EmployeeSelfUnavailable(
      EmployeeSelfProblem.lookupFailed,
      serverMessage: error.message,
    );
  }
});
