import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../../core/error/failure.dart';
import 'project_ui.dart';

/// Renders the three states of an [AsyncValue] the same way everywhere in this tab.
///
/// The error branch prints the backend's own Mongolian message when there is one:
/// "Энэ үйлдлийг хийх эрх байхгүй байна." tells a technician far more than a generic
/// failure line, and it is the most likely error here — no seeded role is
/// technician-shaped, so an account can very reasonably arrive without `object.view`.
/// A raw exception is never shown.
class ProjectAsyncView<T> extends StatelessWidget {
  const ProjectAsyncView({
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
      loading: () => loading ?? const ProjectLoading(),
      error: (Object error, StackTrace _) {
        final bool denied = error is AuthFailure;
        return ProjectEmptyState(
          icon: denied ? Icons.lock_outline : Icons.cloud_off_outlined,
          message: error is Failure ? error.message : 'Мэдээлэл ачаалж чадсангүй.',
          // Retrying a refusal would just repeat it, so the button is only offered
          // for a failure that could plausibly succeed on a second attempt.
          actionLabel: denied || onRetry == null ? null : 'Дахин оролдох',
          onAction: denied ? null : onRetry,
        );
      },
    );
  }
}

/// The tab's single loading treatment.
class ProjectLoading extends StatelessWidget {
  const ProjectLoading({super.key, this.height = 96});

  final double height;

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      height: height,
      child: const Center(
        child: SizedBox(
          width: 22,
          height: 22,
          child: CircularProgressIndicator(strokeWidth: 2.4),
        ),
      ),
    );
  }
}
