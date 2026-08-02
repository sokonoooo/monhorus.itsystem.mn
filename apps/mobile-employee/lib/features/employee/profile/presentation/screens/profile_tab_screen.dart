import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../../core/error/failure.dart';
import '../../../../auth/domain/entities/app_user.dart';
import '../../../../auth/presentation/providers/auth_provider.dart';
import '../../../../auth/presentation/screens/change_password_screen.dart';
import '../../../presentation/theme/employee_tokens.dart';
import '../../../presentation/widgets/employee_top_bar.dart';
import '../../domain/entities/employee_profile.dart';
import '../../domain/entities/employee_record_state.dart';
import '../../../../../core/util/format.dart';
import '../providers/profile_providers.dart';
import '../widgets/profile_avatar.dart';
import '../widgets/profile_ui.dart';

/// Tab 4 — "Профайл" (`s-profile`).
///
/// Three things, in the order the prototype puts them: who the signed-in employee is,
/// what the API will tell us about their HR record, and the two account actions the
/// backend actually supports — change password and sign out.
///
/// What is deliberately absent, and why:
///
///   * The prototype's yearly figures ("Нийт ажил 147 · 2024 онд", "Дүгнэлт тайлан
///     89") have no endpoint behind them. `EmployeeWorkloadDto` is the only
///     per-employee counter the API exposes, so the strip shows those three,
///     captioned for exactly what they are, and invents nothing.
///   * "Мэдэгдэл" is not a switch. Delivery is in-app only and there is no per-user
///     notification preference anywhere in the API, so a toggle here would either do
///     nothing or imply a setting that does not exist.
///   * "Хэл" is not offered. The app ships in Mongolian only and has no locale
///     setting to change.
class ProfileTabScreen extends ConsumerWidget {
  const ProfileTabScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    // Note: unwinding pushed routes when the session drops (which is what changing a
    // password does — the server revokes every session) is handled once by
    // EmployeeShellScreen, and ChangePasswordScreen now pops itself on success. This
    // tab used to carry a private copy of that listener; it does not need one.
    final AppUser? user = ref.watch(currentUserProvider);
    if (user == null) {
      return const Scaffold(
        backgroundColor: EmployeeTokens.bg,
        body: Center(child: CircularProgressIndicator()),
      );
    }

    final AsyncValue<EmployeeRecordState> record =
        ref.watch(employeeRecordProvider);
    final EmployeeProfile? profile = switch (record.valueOrNull) {
      EmployeeRecordResolved(profile: final EmployeeProfile value) => value,
      _ => null,
    };

    return Scaffold(
      backgroundColor: EmployeeTokens.bg,
      body: SafeArea(
        bottom: false,
        child: RefreshIndicator(
          color: EmployeeTokens.ink,
          onRefresh: () => _refresh(ref),
          child: ListView(
            physics: const AlwaysScrollableScrollPhysics(),
            padding: const EdgeInsets.only(
              bottom: EmployeeTokens.scrollBottomSpacer,
            ),
            children: <Widget>[
              // `.tnav` on `s-profile`: the title, then the shared `.hdr-actions`
              // pair — calendar first, bell second — which every tab carries.
              const Padding(
                padding: EdgeInsets.fromLTRB(
                  EmployeeTokens.labelGutter,
                  14,
                  EmployeeTokens.labelGutter,
                  10,
                ),
                child: Row(
                  children: <Widget>[
                    Expanded(
                      child: Text('Профайл', style: EmployeeTokens.screenTitle),
                    ),
                    SizedBox(width: 10),
                    EmployeeHeaderActions(),
                  ],
                ),
              ),

              _IdentityCard(user: user, profile: profile),

              if (profile != null) ...<Widget>[
                const SectionHeading('Миний ачаалал'),
                _WorkloadStrip(workload: profile.workload),
              ],

              const SectionHeading('Ажилтны мэдээлэл'),
              _EmployeeSection(record: record),

              if (profile != null && _hasQualifications(profile)) ...<Widget>[
                const SectionHeading('Мэргэшил'),
                _QualificationCard(profile: profile),
              ],

              const SectionHeading('Бүртгэл'),
              _AccountCard(user: user),

              const SectionHeading('Тохиргоо'),
              const TappableRow(
                icon: Icons.notifications_none,
                title: 'Мэдэгдэл',
                subtitle: 'Ажлын хуваарилалт, эрсдэлийн мэдэгдэл зөвхөн апп дотор '
                    'хүргэгдэнэ. Тусдаа тохиргоо байхгүй.',
                showChevron: false,
              ),
              TappableRow(
                icon: Icons.lock_outline,
                title: 'Нууц үг солих',
                subtitle: 'Солисны дараа бүх төхөөрөмж дээр дахин нэвтэрнэ.',
                onTap: () => Navigator.of(context).push(
                  MaterialPageRoute<void>(
                    builder: (_) => const ChangePasswordScreen(),
                  ),
                ),
              ),
              TappableRow(
                icon: Icons.logout,
                tone: Tone.red,
                title: 'Гарах',
                subtitle: 'Энэ төхөөрөмжөөс бүртгэлээс гарна.',
                showChevron: false,
                onTap: () => _confirmLogout(context, ref),
              ),
            ],
          ),
        ),
      ),
    );
  }

  static bool _hasQualifications(EmployeeProfile profile) =>
      profile.qualificationLevel != null ||
      profile.safetyGrade != null ||
      profile.skills.isNotEmpty ||
      profile.permittedJobTypes.isNotEmpty ||
      profile.hasDriverLicense;

  /// Re-reads the identity and the employee record together.
  ///
  /// The permission set is re-resolved server-side on every request, so a role change
  /// made by an administrator lands here on the next pull rather than at the next
  /// cold start.
  static Future<void> _refresh(WidgetRef ref) async {
    ref.invalidate(profileIdentityRefreshProvider);
    ref.invalidate(employeeRecordProvider);
    try {
      await ref.read(employeeRecordProvider.future);
    } catch (_) {
      // Swallowed on purpose: the same failure is already sitting in the provider's
      // AsyncValue and is rendered as a banner with the backend's own message.
      // Letting it escape would only turn a handled state into an unhandled future
      // error inside RefreshIndicator.
    }
  }

  Future<void> _confirmLogout(BuildContext context, WidgetRef ref) async {
    final bool? confirmed = await showDialog<bool>(
      context: context,
      builder: (BuildContext ctx) => AlertDialog(
        title: const Text('Гарах'),
        content: const Text('Бүртгэлээс гарах уу?'),
        actions: <Widget>[
          TextButton(
            onPressed: () => Navigator.of(ctx).pop(false),
            child: const Text('Болих'),
          ),
          FilledButton(
            onPressed: () => Navigator.of(ctx).pop(true),
            style: FilledButton.styleFrom(backgroundColor: EmployeeTokens.red),
            child: const Text('Гарах'),
          ),
        ],
      ),
    );

    if (confirmed != true) return;
    await ref.read(authControllerProvider.notifier).logout();
  }
}

// -- Identity ----------------------------------------------------------------

/// The prototype's identity card: avatar, name, role and a status pill.
///
/// Renders from the session alone when the HR record is unavailable, so an account
/// that is not linked to an employee card still sees who it is signed in as instead
/// of a blank panel.
class _IdentityCard extends StatelessWidget {
  const _IdentityCard({required this.user, this.profile});

  final AppUser user;
  final EmployeeProfile? profile;

  @override
  Widget build(BuildContext context) {
    final EmployeeProfile? record = profile;
    final String recordName = record?.displayName ?? '';
    final String name = recordName.isNotEmpty ? recordName : user.fullName;
    final String subtitle = record?.position?.name ?? user.role.label;

    return ProfileCard(
      accent: EmployeeTokens.ink,
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          ProfileAvatar(name: name, fileId: record?.photoFileId),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: <Widget>[
                Text(
                  name,
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  style: EmployeeTokens.headerTitle.copyWith(
                    fontWeight: FontWeight.w900,
                  ),
                ),
                const SizedBox(height: 3),
                Text(
                  subtitle,
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  style: EmployeeTokens.detailValue.copyWith(
                    fontWeight: FontWeight.w400,
                    color: EmployeeTokens.muted,
                  ),
                ),
                const SizedBox(height: 9),
                Wrap(
                  spacing: 6,
                  runSpacing: 6,
                  children: <Widget>[
                    EmployeePill(
                      label: record?.status.label ?? user.status.label,
                      tone: record == null
                          ? _accountTone(user.status)
                          : _recordTone(record.status),
                    ),
                    if (record != null && record.employeeCode.isNotEmpty)
                      EmployeePill(label: record.employeeCode, tone: Tone.neutral),
                  ],
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  static Tone _accountTone(AccountStatus status) => switch (status) {
        AccountStatus.active => Tone.green,
        AccountStatus.mustChangePassword => Tone.yellow,
        AccountStatus.suspended => Tone.red,
      };

  static Tone _recordTone(EmployeeRecordStatus status) => switch (status) {
        EmployeeRecordStatus.active => Tone.green,
        EmployeeRecordStatus.draft ||
        EmployeeRecordStatus.onLeave ||
        EmployeeRecordStatus.suspended =>
          Tone.yellow,
        EmployeeRecordStatus.terminated ||
        EmployeeRecordStatus.inactive =>
          Tone.red,
        EmployeeRecordStatus.unknown => Tone.neutral,
      };
}

// -- Workload ----------------------------------------------------------------

/// `EmployeeWorkloadDto`, captioned for what it is.
///
/// These are live counters, not a period total: `getEmployeeWorkload` counts current
/// assignments, so "Дууссан" is the lifetime figure and not a monthly one. The
/// captions say so, because the prototype's "2024 онд" framing would be a claim the
/// data does not make.
class _WorkloadStrip extends StatelessWidget {
  const _WorkloadStrip({required this.workload});

  final EmployeeWorkload workload;

  @override
  Widget build(BuildContext context) {
    return KpiStrip(
      tiles: <KpiTile>[
        KpiTile(
          value: '${workload.activeAssignments}',
          label: 'Идэвхтэй ажил',
          valueColor: EmployeeTokens.yellow,
        ),
        KpiTile(
          value: '${workload.completedAssignments}',
          label: 'Дууссан (нийт)',
          valueColor: EmployeeTokens.green,
        ),
        KpiTile(
          value: '${workload.openServiceRequests}',
          label: 'Нээлттэй хүсэлт',
        ),
      ],
    );
  }
}

// -- Employee record ---------------------------------------------------------

/// Renders whichever outcome the read produced: the record, the amber "no card"
/// configuration state, or a red retry panel for a failure that says nothing about
/// the account.
class _EmployeeSection extends ConsumerWidget {
  const _EmployeeSection({required this.record});

  final AsyncValue<EmployeeRecordState> record;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return record.when(
      loading: () => const ProfileCard(
        child: Padding(
          padding: EdgeInsets.symmetric(vertical: 12),
          child: Center(
            child: SizedBox(
              width: 20,
              height: 20,
              child: CircularProgressIndicator(strokeWidth: 2),
            ),
          ),
        ),
      ),
      error: (Object error, StackTrace _) => Column(
        mainAxisSize: MainAxisSize.min,
        children: <Widget>[
          NoticeBanner(
            tone: Tone.red,
            icon: Icons.cloud_off_outlined,
            title: 'Ажилтны бүртгэл ачаалж чадсангүй',
            // The backend's own Mongolian message says more than any local wording.
            text: error is Failure ? error.message : 'Тодорхойгүй алдаа гарлаа.',
          ),
          ProfileEmptyState(
            icon: Icons.badge_outlined,
            message: 'Холболтоо шалгаад дахин оролдоно уу.',
            actionLabel: 'Дахин оролдох',
            onAction: () => ref.invalidate(employeeRecordProvider),
          ),
        ],
      ),
      data: (EmployeeRecordState state) => switch (state) {
        EmployeeRecordResolved(profile: final EmployeeProfile profile) =>
          _EmployeeDetailCard(profile: profile),
        // The amber configuration state. Not an error and not a permission problem:
        // the server answered definitively that this login has no employee card, and
        // only an administrator can change that. The backend's own sentence is shown
        // first because it names the remedy.
        EmployeeRecordUnlinked(message: final String? message) => NoticeBanner(
            icon: Icons.link_off,
            title: 'Ажилтны карт холбогдоогүй байна',
            text: '${message ?? 'Таны нэвтрэх бүртгэл ажилтны картад '
                    'холбогдоогүй байна.'}\n\nАдминистратор холбосны дараа ажилтны '
                'мэдээлэл, миний ажил, хуваарь энд харагдана. Нэвтрэх бүртгэл '
                'өөрөө хэвийн ажиллана.',
          ),
      },
    );
  }
}

/// The prototype's "Мэдээлэл" key/value block.
class _EmployeeDetailCard extends StatelessWidget {
  const _EmployeeDetailCard({required this.profile});

  final EmployeeProfile profile;

  @override
  Widget build(BuildContext context) {
    final List<_Field> fields = <_Field>[
      if (profile.employeeCode.isNotEmpty)
        _Field('Ажилтны дугаар', profile.employeeCode, mono: true),
      if (profile.position != null) _Field('Албан тушаал', profile.position!.name),
      if (profile.department != null) _Field('Хэлтэс', profile.department!.name),
      if (profile.team != null) _Field('Баг', profile.team!.name),
      if (profile.company != null) _Field('Байгууллага', profile.company!.name),
      if (profile.workLocation != null)
        _Field('Ажлын байр', profile.workLocation!),
      if (profile.employmentStartDate != null)
        _Field('Ажилд орсон', formatDate(profile.employmentStartDate), mono: true),
      if (profile.employeeType != null)
        _Field('Ажилтны төрөл', profile.employeeType!.label),
      if (profile.phone != null) _Field('Утас', profile.phone!, mono: true),
      if (profile.email != null) _Field('Имэйл', profile.email!),
    ];

    if (fields.isEmpty) {
      return const ProfileCard(
        child: ProfileEmptyState(
          icon: Icons.badge_outlined,
          message: 'Ажилтны картад бөглөсөн мэдээлэл алга байна.',
        ),
      );
    }

    return ProfileCard(padding: EdgeInsets.zero, child: _FieldList(fields: fields));
  }
}

/// Qualification, safety grade and the skill / permitted-job chips.
class _QualificationCard extends StatelessWidget {
  const _QualificationCard({required this.profile});

  final EmployeeProfile profile;

  @override
  Widget build(BuildContext context) {
    return ProfileCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisSize: MainAxisSize.min,
        children: <Widget>[
          if (profile.qualificationLevel != null)
            _Line(
              label: 'Мэргэшлийн зэрэг',
              value: profile.qualificationLevel!.label,
            ),
          if (profile.safetyGrade != null)
            _Line(
              label: 'Аюулгүй ажиллагааны зэрэг',
              value: '${profile.safetyGrade!} зэрэг',
            ),
          _Line(
            label: 'Жолооны үнэмлэх',
            value: profile.hasDriverLicense ? 'Байгаа' : 'Байхгүй',
          ),
          if (profile.skills.isNotEmpty) ...<Widget>[
            const SizedBox(height: 6),
            const _MiniLabel('Ур чадвар'),
            const SizedBox(height: 6),
            ChipWrap(labels: profile.skills),
          ],
          if (profile.permittedJobTypes.isNotEmpty) ...<Widget>[
            const SizedBox(height: 12),
            const _MiniLabel('Гүйцэтгэх ажлын төрөл'),
            const SizedBox(height: 6),
            ChipWrap(labels: profile.permittedJobTypes),
          ],
        ],
      ),
    );
  }
}

// -- Account -----------------------------------------------------------------

/// What `GET /auth/me` reports about the login itself.
///
/// Always rendered, because it needs no permission beyond being signed in — it is
/// the part of this screen a technician can always see.
///
/// The "Системийн эрх" row is gone: it listed the account's RBAC roles, which came
/// off `EmployeeDetailDto.systemAccess.roles`, and `EmployeeSelfDto` deliberately
/// carries no `systemAccess` block. The coarse tier below is what `/auth/me` reports
/// and is the honest remainder.
class _AccountCard extends StatelessWidget {
  const _AccountCard({required this.user});

  final AppUser user;

  @override
  Widget build(BuildContext context) {
    final List<_Field> fields = <_Field>[
      _Field('Нэвтрэх имэйл', user.email),
      if (user.phone != null) _Field('Утас', user.phone!, mono: true),
      _Field('Эрхийн түвшин', user.role.label),
      _Field(
        'Бүртгэлийн төлөв',
        user.status.label,
        valueColor: user.status == AccountStatus.active
            ? EmployeeTokens.ink
            : EmployeeTokens.yellow,
      ),
      _Field('Сүүлд нэвтэрсэн', formatDateTime(user.lastLoginAt), mono: true),
    ];

    return ProfileCard(padding: EdgeInsets.zero, child: _FieldList(fields: fields));
  }
}

// -- Small parts -------------------------------------------------------------

/// One key/value pair, before it knows whether it is the last row in its card.
class _Field {
  const _Field(this.label, this.value, {this.mono = false, this.valueColor});

  final String label;
  final String value;
  final bool mono;
  final Color? valueColor;
}

/// Renders [_Field]s as hairline-separated rows, suppressing the final divider.
class _FieldList extends StatelessWidget {
  const _FieldList({required this.fields});

  final List<_Field> fields;

  @override
  Widget build(BuildContext context) {
    return Column(
      mainAxisSize: MainAxisSize.min,
      children: <Widget>[
        for (int i = 0; i < fields.length; i++)
          InfoRow(
            label: fields[i].label,
            value: fields[i].value,
            mono: fields[i].mono,
            valueColor: fields[i].valueColor,
            last: i == fields.length - 1,
          ),
      ],
    );
  }
}

class _Line extends StatelessWidget {
  const _Line({required this.label, required this.value});

  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Expanded(
            child: Text(
              label,
              style: EmployeeTokens.rowSub,
            ),
          ),
          const SizedBox(width: 12),
          Text(
            value,
            style: EmployeeTokens.detailValue,
          ),
        ],
      ),
    );
  }
}

class _MiniLabel extends StatelessWidget {
  const _MiniLabel(this.text);

  final String text;

  @override
  Widget build(BuildContext context) {
    return Text(text.toUpperCase(), style: EmployeeTokens.sectionLabel);
  }
}
