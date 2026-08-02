import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../../core/error/failure.dart';
import 'home_ui.dart';

/// Renders the three states of an [AsyncValue] the same way everywhere on this tab.
///
/// The error branch prints the backend's own Mongolian message when there is one,
/// because "Энэ үйлдлийг хийх эрх байхгүй байна." tells a technician far more than a
/// generic failure line would. A raw exception is never shown: anything that is not
/// a [Failure] is reported as a generic load error, since a stack trace on a phone
/// in a switch room helps nobody.
class HomeAsyncView<T> extends StatelessWidget {
  const HomeAsyncView({
    super.key,
    required this.value,
    required this.builder,
    this.onRetry,
    this.loading,
  });

  final AsyncValue<T> value;
  final Widget Function(BuildContext context, T data) builder;
  final VoidCallback? onRetry;
  final Widget? loading;

  @override
  Widget build(BuildContext context) {
    return value.when(
      data: (T data) => builder(context, data),
      loading: () =>
          loading ??
          const Padding(
            padding: EdgeInsets.symmetric(vertical: 56),
            child: Center(child: CircularProgressIndicator(strokeWidth: 2.4)),
          ),
      error: (Object error, StackTrace _) => HomeFailureView(
        failure: error is Failure ? error : null,
        onRetry: onRetry,
      ),
    );
  }
}

/// The failure state, shared by the async view and by any block that failed on its
/// own while its neighbours loaded.
class HomeFailureView extends StatelessWidget {
  const HomeFailureView({super.key, this.failure, this.onRetry});

  final Failure? failure;
  final VoidCallback? onRetry;

  @override
  Widget build(BuildContext context) {
    final Failure? value = failure;
    final bool isNetwork = value is NetworkFailure;

    return HomeEmptyState(
      icon: isNetwork ? Icons.wifi_off_outlined : Icons.cloud_off_outlined,
      message: value?.message ?? 'Мэдээлэл ачаалж чадсангүй.',
      actionLabel: onRetry == null ? null : 'Дахин оролдох',
      onAction: onRetry,
    );
  }
}
