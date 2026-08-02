import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../presentation/theme/employee_tokens.dart';
import '../../../../../core/util/format.dart';
import '../providers/profile_providers.dart';

/// The identity card's avatar: a 54px circle, white on a 2px ink ring, as the
/// prototype draws it.
///
/// Shows the employee photo when the record carries one and the initials otherwise.
/// The photo cannot be handed to `Image.network`: `GET /files/:fileId` still requires
/// the Bearer header, so the bytes come through the shared Dio client. A failed or
/// pending fetch falls back to the initials rather than to a spinner or a broken
/// image — the circle is decoration, and it should never look like an error.
class ProfileAvatar extends ConsumerWidget {
  const ProfileAvatar({
    super.key,
    required this.name,
    this.fileId,
    this.size = 54,
  });

  final String name;
  final String? fileId;
  final double size;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final String? id = fileId;

    Widget content = _Initials(name: name, size: size);
    if (id != null) {
      final AsyncValue<Uint8List> bytes = ref.watch(employeePhotoProvider(id));
      content = bytes.maybeWhen(
        data: (Uint8List data) => Image.memory(
          data,
          width: size,
          height: size,
          fit: BoxFit.cover,
          errorBuilder: (_, __, ___) => _Initials(name: name, size: size),
        ),
        orElse: () => _Initials(name: name, size: size),
      );
    }

    return Container(
      width: size,
      height: size,
      clipBehavior: Clip.antiAlias,
      decoration: BoxDecoration(
        color: EmployeeTokens.white,
        shape: BoxShape.circle,
        border: Border.all(color: EmployeeTokens.ink, width: 2),
      ),
      child: content,
    );
  }
}

class _Initials extends StatelessWidget {
  const _Initials({required this.name, required this.size});

  final String name;
  final double size;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Text(
        initialsOf(name),
        maxLines: 1,
        style: TextStyle(
          fontSize: size * 0.33,
          fontWeight: FontWeight.w900,
          letterSpacing: 0.5,
          color: EmployeeTokens.ink,
        ),
      ),
    );
  }
}
