import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../presentation/theme/employee_tokens.dart';
import '../../data/models/report_record_models.dart';
import '../../domain/entities/risk_level.dart';
import '../format.dart';
import '../providers/project_providers.dart';
import 'authenticated_image.dart';
import 'project_async_view.dart';
import 'project_ui.dart';

/// `sheet-report-record` — one report from the central registry, as one piece of
/// equipment sees it.
///
/// A SEPARATE SHEET FROM [ReportSheet] rather than another `ReportView` factory, and
/// deliberately. `ReportView` is assessment-shaped: it requires a non-null score, and it
/// has nowhere to put a report number, a type, a review status or an approver. A report
/// has all four and may carry no score at all, so squeezing one through that projection
/// would mean inventing a zero for "not scored" — the one thing this codebase refuses to
/// do with a missing figure — and dropping the review state, which is the fact that
/// decides whether a finding is believed yet.
///
/// Read-only. There is no PATCH for a report from this app and no PDF anywhere in the
/// API, so there is nothing here to edit and nothing to download.
class ReportRecordSheet extends ConsumerWidget {
  const ReportRecordSheet({
    super.key,
    required this.reportId,
    required this.objectId,
    required this.deviceLabel,
  });

  final String reportId;

  /// Which equipment the reader came from. A report covers a visit and may carry a
  /// finding for every device touched; this is the one being asked about.
  final String objectId;

  final String deviceLabel;

  static Future<void> show(
    BuildContext context, {
    required String reportId,
    required String objectId,
    required String deviceLabel,
  }) {
    return showModalBottomSheet<void>(
      context: context,
      backgroundColor: Colors.transparent,
      isScrollControlled: true,
      builder: (BuildContext _) => ReportRecordSheet(
        reportId: reportId,
        objectId: objectId,
        deviceLabel: deviceLabel,
      ),
    );
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return Container(
      constraints: BoxConstraints(
        maxHeight: MediaQuery.sizeOf(context).height * 0.92,
      ),
      decoration: const BoxDecoration(
        color: EmployeeTokens.bg,
        borderRadius: BorderRadius.vertical(
          top: Radius.circular(EmployeeTokens.radiusSheet),
        ),
        border: Border(
          top: BorderSide(
            color: EmployeeTokens.line,
            width: EmployeeTokens.hairline,
          ),
        ),
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: <Widget>[
          Container(
            width: 36,
            height: 4,
            margin: const EdgeInsets.symmetric(vertical: 10),
            decoration: BoxDecoration(
              color: EmployeeTokens.line,
              borderRadius: BorderRadius.circular(2),
            ),
          ),
          Flexible(
            child: ProjectAsyncView<ReportRecordDetailModel>(
              value: ref.watch(reportRecordProvider(reportId)),
              onRetry: () => ref.invalidate(reportRecordProvider(reportId)),
              loading: const ProjectLoading(height: 220),
              builder: (BuildContext ctx, ReportRecordDetailModel report) =>
                  _Body(report: report, objectId: objectId, deviceLabel: deviceLabel),
            ),
          ),
        ],
      ),
    );
  }
}

class _Body extends StatelessWidget {
  const _Body({
    required this.report,
    required this.objectId,
    required this.deviceLabel,
  });

  final ReportRecordDetailModel report;
  final String objectId;
  final String deviceLabel;

  @override
  Widget build(BuildContext context) {
    final ReportItemModel? item = report.itemFor(objectId);
    // The band this equipment was given, falling back to the report's overall band —
    // which is the worst item's, so it is a statement about the visit rather than about
    // this device, and only stands in when the device has no finding of its own.
    final RiskLevel? band = item?.riskLevel ?? report.riskLevel;
    final int? score = item?.score ?? report.overallScore;

    return ListView(
      padding: const EdgeInsets.only(bottom: 24),
      shrinkWrap: true,
      children: <Widget>[
        ProjectCard(
          accent: band?.tone.foreground ?? EmployeeTokens.line,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            mainAxisSize: MainAxisSize.min,
            children: <Widget>[
              Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: <Widget>[
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      mainAxisSize: MainAxisSize.min,
                      children: <Widget>[
                        Text(
                          report.reportNumber,
                          style: EmployeeTokens.headerTitle,
                        ),
                        const SizedBox(height: 3),
                        Text(
                          joinParts(<String?>[
                            report.type?.label,
                            deviceLabel,
                            formatDate(report.occurredAt),
                          ]),
                          style: EmployeeTokens.rowSub,
                        ),
                      ],
                    ),
                  ),
                  // Absent rather than zero: a report may record a finding in words and
                  // no number, and a ring reading 0 would state a score nobody gave.
                  if (score != null) ScoreRing(score: score, level: band),
                ],
              ),
              const SizedBox(height: 10),
              Wrap(
                spacing: 6,
                runSpacing: 6,
                children: <Widget>[
                  if (band != null)
                    EmployeePill(
                      label: band.label,
                      tone: band.tone,
                      showGlyph: true,
                      glyphLevel: band,
                      semanticLabel: band.label,
                    ),
                  if (report.status != null)
                    EmployeePill(
                      label: report.status!.label,
                      tone: report.status!.tone,
                    ),
                ],
              ),
            ],
          ),
        ),

        // The finding about THIS device, which is what the reader opened the report for.
        if (item == null)
          const NoticeBanner.neutral(
            text: 'Энэ тайланд тухайн төхөөрөмжийн тусгай дүгнэлт бүртгэгдээгүй '
                'байна. Доорх нь тайлангийн ерөнхий дүгнэлт.',
          )
        else ...<Widget>[
          if (item.observation != null && item.observation!.isNotEmpty) ...<Widget>[
            const SectionHeading('Ажиглалт', topPadding: 4),
            NoticeBanner.neutral(text: item.observation!),
          ],
          if (item.conclusion != null && item.conclusion!.isNotEmpty) ...<Widget>[
            const SectionHeading('Дүгнэлт', topPadding: 4),
            NoticeBanner.neutral(text: item.conclusion!),
          ],
          if (item.recommendation != null &&
              item.recommendation!.isNotEmpty) ...<Widget>[
            const SectionHeading('Зөвлөмж', topPadding: 4),
            NoticeBanner.info(text: item.recommendation!),
          ],
          if (item.measuredLoadKw != null) ...<Widget>[
            const SectionHeading('Хэмжсэн ачаалал', topPadding: 4),
            ProjectCard(
              child: DetailRow(
                label: 'Хэмжсэн',
                value: '${formatDecimal(item.measuredLoadKw)} kW',
              ),
            ),
          ],
          if (item.evidence.isNotEmpty) ...<Widget>[
            const SectionHeading('Нотлох зураг', topPadding: 4),
            _EvidenceStrip(evidence: item.evidence),
          ],
        ],

        // The report's own narrative, shown when the item carried none of its own so the
        // sheet is never a header over nothing.
        if (item == null ||
            ((item.conclusion == null || item.conclusion!.isEmpty) &&
                (item.observation == null || item.observation!.isEmpty))) ...<Widget>[
          if (report.conclusion != null && report.conclusion!.isNotEmpty) ...<Widget>[
            const SectionHeading('Тайлангийн дүгнэлт', topPadding: 4),
            NoticeBanner.neutral(text: report.conclusion!),
          ],
          if (report.recommendation != null &&
              report.recommendation!.isNotEmpty) ...<Widget>[
            const SectionHeading('Тайлангийн зөвлөмж', topPadding: 4),
            NoticeBanner.info(text: report.recommendation!),
          ],
        ],

        const SectionHeading('Бүртгэл', topPadding: 4),
        ProjectCard(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: <Widget>[
              DetailRow(label: 'Тайлангийн дугаар', value: report.reportNumber),
              if (report.type != null)
                DetailRow(label: 'Төрөл', value: report.type!.label),
              if (report.status != null)
                DetailRow(label: 'Төлөв', value: report.status!.label),
              DetailRow(
                label: 'Огноо',
                value: formatDateTime(report.occurredAt),
              ),
              if (report.createdByName != null)
                DetailRow(label: 'Бичсэн', value: report.createdByName!),
              // Who signed it off, and when. The one fact that separates a finding
              // being believed from a finding merely being written down.
              if (report.approvedByName != null)
                DetailRow(label: 'Баталсан', value: report.approvedByName!),
              if (report.approvedAt != null)
                DetailRow(
                  label: 'Батлагдсан',
                  value: formatDateTime(report.approvedAt),
                ),
              DetailRow(
                label: 'Хамрагдсан тоноглол',
                value: '${report.itemCount}',
                isLast: true,
              ),
            ],
          ),
        ),
      ],
    );
  }
}

/// The evidence attached to this device's finding.
///
/// Fetched through the authenticated file route like every other stored picture — the
/// download url on the attachment wants the bearer header, so it cannot be handed to a
/// plain network image.
class _EvidenceStrip extends StatelessWidget {
  const _EvidenceStrip({required this.evidence});

  final List<ReportAttachmentModel> evidence;

  @override
  Widget build(BuildContext context) {
    final List<ReportAttachmentModel> images = evidence
        .where((ReportAttachmentModel file) => file.isImage)
        .toList(growable: false);
    if (images.isEmpty) return const SizedBox.shrink();

    return SizedBox(
      height: 170,
      child: ListView.separated(
        scrollDirection: Axis.horizontal,
        padding: const EdgeInsets.fromLTRB(
          EmployeeTokens.gutter,
          0,
          EmployeeTokens.gutter,
          10,
        ),
        itemCount: images.length,
        separatorBuilder: (BuildContext _, int __) => const SizedBox(width: 8),
        itemBuilder: (BuildContext _, int index) => ClipRRect(
          borderRadius: BorderRadius.circular(EmployeeTokens.radiusRow),
          child: Container(
            width: 200,
            decoration: BoxDecoration(
              color: EmployeeTokens.white,
              border: Border.all(
                color: EmployeeTokens.line,
                width: EmployeeTokens.hairline,
              ),
              borderRadius: BorderRadius.circular(EmployeeTokens.radiusRow),
            ),
            child: AuthenticatedImage(fileId: images[index].id, fit: BoxFit.cover),
          ),
        ),
      ),
    );
  }
}
