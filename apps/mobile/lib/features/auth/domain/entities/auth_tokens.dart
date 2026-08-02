import 'package:equatable/equatable.dart';

class AuthTokens extends Equatable {
  const AuthTokens({
    required this.accessToken,
    required this.refreshToken,
    required this.expiresIn,
  });

  final String accessToken;
  final String refreshToken;

  /// Seconds until the access token expires.
  final int expiresIn;

  @override
  List<Object?> get props => <Object?>[accessToken, refreshToken, expiresIn];
}
