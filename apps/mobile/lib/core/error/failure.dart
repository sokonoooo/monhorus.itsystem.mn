import 'package:equatable/equatable.dart';

/// Domain-layer error. The presentation layer only ever sees these.
sealed class Failure extends Equatable {
  const Failure(this.message);

  final String message;

  @override
  List<Object?> get props => <Object?>[message];
}

class ServerFailure extends Failure {
  const ServerFailure(
    super.message, {
    required this.code,
    this.fieldErrors = const <String, String>{},
  });

  final String code;
  final Map<String, String> fieldErrors;

  @override
  List<Object?> get props => <Object?>[message, code, fieldErrors];
}

class NetworkFailure extends Failure {
  const NetworkFailure([super.message = 'Сүлжээнд холбогдож чадсангүй.']);
}

/// Authentication or authorisation refusal. `code` carries the backend error code so
/// the UI can distinguish a wrong password from a suspended account.
class AuthFailure extends Failure {
  const AuthFailure(super.message, {required this.code});

  final String code;

  @override
  List<Object?> get props => <Object?>[message, code];
}

class CacheFailure extends Failure {
  const CacheFailure([super.message = 'Хадгалсан мэдээлэл уншиж чадсангүй.']);
}
