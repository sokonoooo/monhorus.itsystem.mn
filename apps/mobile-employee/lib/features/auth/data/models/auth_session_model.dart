import '../../domain/entities/auth_tokens.dart';
import 'user_model.dart';

class AuthTokensModel extends AuthTokens {
  const AuthTokensModel({
    required super.accessToken,
    required super.refreshToken,
    required super.expiresIn,
  });

  factory AuthTokensModel.fromJson(Map<String, dynamic> json) {
    return AuthTokensModel(
      accessToken: json['accessToken'] as String,
      refreshToken: json['refreshToken'] as String,
      expiresIn: (json['expiresIn'] as num?)?.toInt() ?? 0,
    );
  }

  Map<String, dynamic> toJson() => <String, dynamic>{
        'accessToken': accessToken,
        'refreshToken': refreshToken,
        'expiresIn': expiresIn,
      };
}

/// Full login response: user, tokens and the forced-change flag together.
class AuthSessionModel {
  const AuthSessionModel({
    required this.user,
    required this.tokens,
    required this.mustChangePassword,
  });

  final UserModel user;
  final AuthTokensModel tokens;
  final bool mustChangePassword;

  factory AuthSessionModel.fromJson(Map<String, dynamic> json) {
    return AuthSessionModel(
      user: UserModel.fromJson(json['user'] as Map<String, dynamic>),
      tokens: AuthTokensModel.fromJson(json['tokens'] as Map<String, dynamic>),
      mustChangePassword: json['mustChangePassword'] as bool? ?? false,
    );
  }

  Map<String, dynamic> toJson() => <String, dynamic>{
        'user': user.toJson(),
        'tokens': tokens.toJson(),
        'mustChangePassword': mustChangePassword,
      };
}
