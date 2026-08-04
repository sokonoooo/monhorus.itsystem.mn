import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../auth/presentation/providers/auth_provider.dart';
import '../../../presentation/theme/employee_tokens.dart';
import '../../../presentation/widgets/employee_top_bar.dart';
import '../../data/models/project_models.dart';
import '../../domain/entities/risk_level.dart';
import '../format.dart';
import '../providers/project_providers.dart';
import '../widgets/project_async_view.dart';
import '../widgets/project_ui.dart';
import 'project_detail_screen.dart';

/// Tab 3 — "Төсөл".
///
/// Root of the object drill-down: project → building → floor → device. Each level is
/// a pushed route, so the bottom nav stays put on this screen and disappears on the
/// detail screens, exactly as the prototype behaves.
///
/// Everything below is read from the API. The prototype's floor and device creation
/// sheets are not reproduced: both are gated on `object.manage` /
/// `object_master.manage`, which is master-data authorship rather than field work,
/// and a technician's role is not built to hold them.
class ProjectTabScreen extends ConsumerStatefulWidget {
  const ProjectTabScreen({super.key});

  @override
  ConsumerState<ProjectTabScreen> createState() => _ProjectTabScreenState();
}

class _ProjectTabScreenState extends ConsumerState<ProjectTabScreen> {
  @override
  void initState() {
    super.initState();
    // The login response is a bare UserDto with no permission list, so the effective
    // set is only known after an /auth/me. Asking once here keeps the permission
    // explanations on the device screen honest rather than guessed.
    Future<void>.microtask(
      () => ref.read(authControllerProvider.notifier).refreshCurrentUser(),
    );
  }

  @override
  Widget build(BuildContext context) {
    final AsyncValue<ProjectListView> projects =
        ref.watch(employeeProjectsProvider);

    return Scaffold(
      backgroundColor: EmployeeTokens.bg,
      body: SafeArea(
        bottom: false,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: <Widget>[
            // `.tnav` on `s-projects`: the title, then the shared `.hdr-actions`
            // pair — calendar first, bell second — which every tab carries.
            Padding(
              padding: const EdgeInsets.fromLTRB(
                EmployeeTokens.labelGutter,
                14,
                EmployeeTokens.labelGutter,
                12,
              ),
              child: Row(
                children: <Widget>[
                  Expanded(
                    child: Text('Төслүүд', style: EmployeeTokens.screenTitle),
                  ),
                  const SizedBox(width: 10),
                  const EmployeeHeaderActions(),
                ],
              ),
            ),
            Expanded(
              child: RefreshIndicator(
                onRefresh: () async => ref.invalidate(employeeProjectsProvider),
                child: ListView(
                  physics: const AlwaysScrollableScrollPhysics(),
                  padding: const EdgeInsets.only(
                    bottom: EmployeeTokens.scrollBottomSpacer,
                  ),
                  children: <Widget>[
                    ProjectAsyncView<ProjectListView>(
                      value: projects,
                      onRetry: () => ref.invalidate(employeeProjectsProvider),
                      loading: const ProjectLoading(height: 200),
                      builder: (BuildContext ctx, ProjectListView data) =>
                          _Body(data: data),
                    ),
                  ],
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _Body extends StatelessWidget {
  const _Body({required this.data});

  final ProjectListView data;

  @override
  Widget build(BuildContext context) {
    if (data.projects.isEmpty) {
      return const ProjectEmptyState(
        icon: Icons.folder_outlined,
        message: 'Танд харагдах төсөл алга байна.',
      );
    }

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: <Widget>[
        MetricGrid(
          cards: <Widget>[
            MetricCard(
              label: 'Нийт төсөл',
              value: formatCount(data.total),
              note: data.isComplete ? 'Бүртгэлтэй' : 'Эхний ${data.projects.length}',
            ),
            MetricCard(
              label: 'Төхөөрөмж',
              value: formatCount(data.deviceCount),
              note: data.isComplete
                  ? 'Нийт бүртгэгдсэн'
                  : 'Харагдаж буй төслүүдэд',
            ),
          ],
        ),
        const SectionHeading('Төслүүд', topPadding: 4),
        for (final ProjectModel project in data.projects)
          _ProjectRow(project: project),
        // The API has no employee filter on /projects, and /auth/me reports no
        // employeeId to filter by, so this is every project the account may read
        // rather than the prototype's "Миний төслүүд". Saying so is better than a
        // heading that claims a scope the data does not have.
        Padding(
          padding: const EdgeInsets.fromLTRB(
            EmployeeTokens.labelGutter,
            6,
            EmployeeTokens.labelGutter,
            0,
          ),
          child: Text(
            'Эрхийн хүрээнд харагдах бүх төсөл. Ажилтнаар шүүх боломж системд '
            'одоогоор алга.',
            style: EmployeeTokens.microNote,
          ),
        ),
      ],
    );
  }
}

class _ProjectRow extends StatelessWidget {
  const _ProjectRow({required this.project});

  final ProjectModel project;

  @override
  Widget build(BuildContext context) {
    final RiskLevel? worst = project.riskSummary.worstLevel;

    return ProjectRow(
      leading: RowTile(
        tone: riskTone(worst),
        text: project.shortCode,
        level: worst,
        showGlyph: true,
      ),
      title: project.name,
      subtitle: joinParts(<String?>[
        project.customerName,
        '${project.buildingCount} барилга',
        '${project.objectCount} төхөөрөмж',
        formatMonthRange(project.startDate, project.endDate),
      ]),
      trailing: _StatePill(project: project),
      onTap: () => Navigator.of(context).push(
        MaterialPageRoute<void>(
          builder: (BuildContext _) => ProjectDetailScreen(project: project),
        ),
      ),
    );
  }
}

/// The prototype's row pill.
///
/// It reports the two facts the API actually carries — whether the project is active,
/// and whether anything under it is in a critical band — rather than the prototype's
/// invented lifecycle labels ("Ноорог", "Дууссан"), which `ProjectDto` has no field
/// for.
class _StatePill extends StatelessWidget {
  const _StatePill({required this.project});

  final ProjectModel project;

  @override
  Widget build(BuildContext context) {
    if (!project.isActive) {
      return const EmployeePill(label: 'Идэвхгүй', tone: Tone.neutral);
    }
    if (project.riskSummary.hasCritical) {
      return const EmployeePill(
        label: 'Эрсдэл',
        tone: Tone.red,
        showDot: true,
      );
    }
    if (project.riskSummary.attentionCount > 0) {
      return const EmployeePill(label: 'Анхааруулга', tone: Tone.yellow);
    }
    return const EmployeePill(label: 'Идэвхтэй', tone: Tone.green);
  }
}
