import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../../core/error/failure.dart';
import '../../../presentation/theme/employee_tokens.dart';
import '../providers/work_providers.dart';
import 'work_ui.dart';

/// Renders the three states of an [AsyncValue] the same way everywhere in this tab.
///
/// The error branch prints the backend's own Mongolian message when there is one.
/// "Энэ үйлдлийг хийх эрх байхгүй байна." tells a technician far more than a generic
/// failure line, and it is the message they will need to quote to whoever fixes it.
/// A raw exception is never shown: anything that is not a [Failure] or a
/// [WorkScopeUnavailable] falls back to a written sentence.
///
/// [WorkScopeUnavailable] is deliberately not styled as an error. Nothing went wrong
/// when an account has not been linked to an employee card yet, or is in no team, or
/// does not hold the permission a segment's read needs — so those get an explanation,
/// an icon that is not an alert, and no "try again" button that would only fail
/// identically.
class WorkAsyncView<T> extends StatelessWidget {
  const WorkAsyncView({
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
      skipLoadingOnRefresh: false,
      data: (T data) => builder(context, data),
      loading: () => loading ?? const WorkLoading(),
      error: (Object error, StackTrace _) {
        if (error is WorkScopeUnavailable) {
          // No action offered. Every remaining situation of this kind is stable and has
          // no honest second thing to look at instead: the "show me every planned work"
          // escape hatch that used to sit here promised an unfiltered list the server no
          // longer returns to a scoped caller, so it would have been a button that
          // silently produced the very same rows under a different heading.
          return WorkEmptyState(
            icon: Icons.info_outline,
            title: error.title,
            message: error.detail,
          );
        }

        final bool isDenied = error is AuthFailure;
        final String message = error is Failure
            ? error.message
            : 'Мэдээлэл ачаалж чадсангүй. Дахин оролдоно уу.';

        return WorkEmptyState(
          icon: isDenied ? Icons.lock_outline : Icons.cloud_off_outlined,
          title: isDenied ? 'Хандах эрх алга' : 'Ачаалж чадсангүй',
          message: message,
          // Retrying a 403 would fail identically, so the button is only offered
          // where another attempt could plausibly succeed.
          actionLabel: isDenied || onRetry == null ? null : 'Дахин оролдох',
          onAction: isDenied ? null : onRetry,
        );
      },
    );
  }
}

class WorkLoading extends StatelessWidget {
  const WorkLoading({super.key, this.height = 200});

  final double height;

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      height: height,
      child: const Center(
        child: SizedBox(
          width: 22,
          height: 22,
          child: CircularProgressIndicator(
            strokeWidth: 2.2,
            valueColor: AlwaysStoppedAnimation<Color>(EmployeeTokens.ink),
          ),
        ),
      ),
    );
  }
}
