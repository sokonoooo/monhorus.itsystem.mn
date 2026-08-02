import '../error/failure.dart';

/// Explicit success-or-failure wrapper, so a caller cannot forget the error path.
sealed class ApiResult<T> {
  const ApiResult();

  R when<R>({
    required R Function(T data) success,
    required R Function(Failure failure) failure,
  }) {
    return switch (this) {
      Success<T>(data: final T value) => success(value),
      FailureResult<T>(failure: final Failure value) => failure(value),
    };
  }

  bool get isSuccess => this is Success<T>;

  T? get dataOrNull => this is Success<T> ? (this as Success<T>).data : null;

  Failure? get failureOrNull =>
      this is FailureResult<T> ? (this as FailureResult<T>).failure : null;
}

class Success<T> extends ApiResult<T> {
  const Success(this.data);

  final T data;
}

class FailureResult<T> extends ApiResult<T> {
  const FailureResult(this.failure);

  final Failure failure;
}
