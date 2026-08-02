import '../../../core/network/dio_client.dart';

/// Transport for the one endpoint that answers "who am I, as an employee".
///
///   GET /employees/me
///
/// Throws [ServerException] or [NetworkException] from the shared [DioClient]; the
/// provider above turns those into an [EmployeeSelf] value.
///
/// This is the ONLY employee endpoint the app calls. There is no directory list and
/// no employee-by-id read anywhere in this client any more: `GET /employees` and
/// `GET /employees/:id` are gated on `employee.view`, which the TECHNICIAN role
/// deliberately no longer holds, and a field employee reading colleagues' HR files in
/// order to find their own row was the reason that grant existed.
class EmployeeSelfRemoteDataSource {
  const EmployeeSelfRemoteDataSource(this._client);

  final DioClient _client;

  /// The caller's own employee card.
  ///
  /// Takes no parameters, on purpose. The server chooses the record from the
  /// authenticated session, so there is no id this app could pass — and therefore no
  /// id it could get wrong.
  Future<Map<String, dynamic>> fetchSelf() {
    return _client.request<Map<String, dynamic>>(
      path: '/employees/me',
      method: 'GET',
      decoder: (Object? json) =>
          json is Map<String, dynamic> ? json : <String, dynamic>{},
    );
  }
}
