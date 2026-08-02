import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../presentation/theme/employee_tokens.dart';
import '../providers/conclusion_providers.dart';
import '../widgets/work_ui.dart';
import 'conclusion_editor_screen.dart';

/// One service request, and the way into its conclusion.
///
/// THE CONCLUSION FORM IS NOT ON THIS SCREEN. `GET /service-requests/:id/report` creates
/// the draft on first read and attributes it to the caller, so a form rendered here would
/// make every technician who merely opened a request its author. The actions below are
/// therefore the only way in, and each is an explicit tap.
///
/// Deliberately no extra fetch either: everything shown comes from the row the caller
/// already had. A detail read would duplicate a model the list already carries, and the
/// facts a technician needs on site — number, subject, location, SLA, who holds it — are
/// all in it.
class ServiceRequestDetailScreen extends ConsumerWidget {
  const ServiceRequestDetailScreen({
    super.key,
    required this.requestId,
    required this.requestNumber,
    required this.subject,
    required this.location,
    this.buildingId,
    this.buildingName,
    this.statusLabel,
    this.slaLabel,
  });

  final String requestId;
  final String requestNumber;
  final String subject;
  final String location;
  final String? buildingId;
  final String? buildingName;
  final String? statusLabel;
  final String? slaLabel;

  static Route<void> route({
    required String requestId,
    required String requestNumber,
    required String subject,
    required String location,
    String? buildingId,
    String? buildingName,
    String? statusLabel,
    String? slaLabel,
  }) {
    return MaterialPageRoute<void>(
      builder: (_) => ServiceRequestDetailScreen(
        requestId: requestId,
        requestNumber: requestNumber,
        subject: subject,
        location: location,
        buildingId: buildingId,
        buildingName: buildingName,
        statusLabel: statusLabel,
        slaLabel: slaLabel,
      ),
    );
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final ConclusionGrants grants = ref.watch(conclusionGrantsProvider);

    return Scaffold(
      backgroundColor: EmployeeTokens.bg,
      appBar: AppBar(
        title: Text(requestNumber),
        backgroundColor: EmployeeTokens.white,
      ),
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.fromLTRB(
            EmployeeTokens.gutter,
            12,
            EmployeeTokens.gutter,
            EmployeeTokens.scrollBottomSpacer,
          ),
          children: <Widget>[
            WorkCard(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                mainAxisSize: MainAxisSize.min,
                children: <Widget>[
                  Text(subject, style: EmployeeTokens.cardTitle),
                  const SizedBox(height: 8),
                  InfoRow(label: 'Байршил', value: location.isEmpty ? '-' : location),
                  if (statusLabel != null)
                    InfoRow(label: 'Төлөв', value: statusLabel!),
                  InfoRow(
                    label: 'SLA',
                    value: slaLabel ?? '-',
                    divider: false,
                  ),
                ],
              ),
            ),

            const SizedBox(height: 16),
            const FieldLabel('Ажлын дүгнэлт'),

            if (!grants.canAuthor)
              const NoticeBanner(
                margin: EdgeInsets.zero,
                tone: EmployeeTokens.muted,
                icon: Icons.lock_outline,
                title: 'Бичих эрх байхгүй',
                text: 'Танд "service_request.update" эрх байхгүй тул дүгнэлт бичих '
                    'боломжгүй. Бичигдсэн дүгнэлтийг харах боломжтой.',
              )
            else
              const NoticeBanner(
                margin: EdgeInsets.zero,
                tone: EmployeeTokens.muted,
                icon: Icons.info_outline,
                text: 'Дүгнэлтийг тоноглол тус бүрээр бичнэ. Сонгосон тоноглол бүр '
                    '"Үзлэг ба дүгнэлт" хэсэгт тусдаа мөр болж харагдана.',
              ),

            const SizedBox(height: 12),
            // One full-width pill per line. Never a Row child: a WorkButton has no
            // intrinsic width and cannot lay out unconstrained.
            WorkButton(
              label: grants.canAuthor ? 'Дүгнэлт бичих' : 'Дүгнэлт харах',
              onPressed: () => Navigator.of(context).push(
                ConclusionEditorScreen.route(
                  requestId: requestId,
                  requestNumber: requestNumber,
                  buildingId: buildingId,
                  buildingName: buildingName,
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
