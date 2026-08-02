import 'package:flutter/material.dart';

import '../../../presentation/theme/employee_tokens.dart';
import '../../data/models/inspection_models.dart';
import '../../data/models/object_models.dart';
import '../../domain/entities/risk_level.dart';
import '../format.dart';
import 'authenticated_image.dart';
import 'project_ui.dart';

/// One written conclusion, in the shape the read-only sheet needs.
///
/// The same record reaches this screen by two routes — as an `ObjectAssessmentDto`
/// inside a device's history, and as an `InspectionListItemDto` in the floor's report
/// list — so the sheet takes a small view model rather than being written twice. Both
/// sources are projections of the same append-only assessment row.
@immutable
class ReportView {
  const ReportView({
    required this.reference,
    required this.subject,
    required this.score,
    required this.previousScore,
    required this.riskLevel,
    required this.conclusion,
    required this.recommendation,
    required this.actionTaken,
    required this.measuredLoadKw,
    required this.repairRequired,
    required this.revisitRequired,
    required this.revisitDate,
    required this.revisitOwnerName,
    required this.authorName,
    required this.writtenAt,
    required this.sourceLabel,
    required this.photos,
  });

  /// The report's own identifier where there is one, otherwise the device code.
  final String reference;

  /// What the conclusion is about: the device and where it sits.
  final String subject;

  final int score;
  final int? previousScore;
  final RiskLevel? riskLevel;

  final String? conclusion;
  final String? recommendation;
  final String? actionTaken;
  final double? measuredLoadKw;

  final bool repairRequired;
  final bool revisitRequired;
  final DateTime? revisitDate;
  final String? revisitOwnerName;

  final String? authorName;
  final DateTime? writtenAt;
  final String? sourceLabel;

  /// Evidence photos. Empty for an assessment recorded before the evidence rule was
  /// introduced — those entries are grandfathered server-side and stay readable.
  final List<ObjectPhotoModel> photos;

  factory ReportView.fromAssessment(
    ObjectAssessmentModel assessment, {
    required String deviceLabel,
  }) {
    return ReportView(
      reference: deviceLabel,
      subject: assessment.sourceLabel ?? deviceLabel,
      score: assessment.newScore,
      previousScore: assessment.previousScore,
      riskLevel: assessment.riskLevel,
      conclusion: assessment.conclusion,
      recommendation: assessment.recommendation,
      actionTaken: assessment.actionTaken,
      measuredLoadKw: assessment.measuredLoadKw,
      repairRequired: assessment.repairRequired,
      revisitRequired: assessment.revisitRequired,
      revisitDate: assessment.revisitDate,
      revisitOwnerName: assessment.revisitOwnerName,
      authorName: assessment.assessedByName,
      writtenAt: assessment.assessedAt,
      sourceLabel: assessment.sourceLabel,
      photos: assessment.photos,
    );
  }

  /// The report list carries no photos — `InspectionListItemDto` omits them — so the
  /// gallery is simply absent on this route rather than shown as empty.
  factory ReportView.fromInspection(InspectionListItemModel item) {
    return ReportView(
      reference: item.reportNumber.isEmpty ? item.objectCode : item.reportNumber,
      subject: joinParts(<String?>[
        item.objectCode.isEmpty ? item.objectName : item.objectCode,
        item.locationPath,
      ]),
      score: item.score,
      previousScore: item.previousScore,
      riskLevel: item.riskLevel,
      conclusion: item.conclusion,
      recommendation: item.recommendation,
      actionTaken: item.actionTaken,
      measuredLoadKw: item.measuredLoadKw,
      repairRequired: item.repairRequired,
      revisitRequired: item.revisitRequired,
      revisitDate: item.revisitDate,
      revisitOwnerName: item.revisitOwnerName,
      authorName: item.assessedByName,
      writtenAt: item.assessedAt,
      sourceLabel: item.sourceLabel,
      photos: const <ObjectPhotoModel>[],
    );
  }

  /// The change against the previous conclusion, e.g. "+24" or "-12".
  String? get delta {
    final int? previous = previousScore;
    if (previous == null) return null;
    final int change = score - previous;
    if (change == 0) return '±0';
    return change > 0 ? '+$change' : '$change';
  }
}

/// `sheet-report-view` — the read-only view of a written conclusion.
///
/// Read-only because an assessment is immutable once written (requirements 10.1,
/// rule 17.15): there is no PATCH and no DELETE for one anywhere in the API, so there
/// is nothing here to edit. The prototype's "PDF татах" button is not reproduced —
/// no endpoint renders one.
class ReportSheet extends StatelessWidget {
  const ReportSheet({super.key, required this.report});

  final ReportView report;

  static Future<void> show(BuildContext context, ReportView report) {
    return showModalBottomSheet<void>(
      context: context,
      backgroundColor: Colors.transparent,
      isScrollControlled: true,
      builder: (BuildContext _) => ReportSheet(report: report),
    );
  }

  @override
  Widget build(BuildContext context) {
    final RiskLevel? band = report.riskLevel;

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
            child: ListView(
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
                                  report.reference,
                                  style: EmployeeTokens.headerTitle,
                                ),
                                const SizedBox(height: 3),
                                Text(
                                  joinParts(<String?>[
                                    report.subject,
                                    formatDate(report.writtenAt),
                                  ]),
                                  style: EmployeeTokens.microNote
                                      .merge(EmployeeTokens.mono),
                                ),
                              ],
                            ),
                          ),
                          const SizedBox(width: 10),
                          if (band != null)
                            EmployeePill(
                              label: band.shortLabel,
                              tone: band.tone,
                              showGlyph: true,
                              glyphLevel: band,
                              semanticLabel: band.label,
                            ),
                        ],
                      ),
                      const SizedBox(height: 14),
                      Row(
                        crossAxisAlignment: CrossAxisAlignment.center,
                        children: <Widget>[
                          ScoreRing(
                            score: report.score,
                            level: band,
                            size: 78,
                          ),
                          const SizedBox(width: 14),
                          Expanded(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              mainAxisSize: MainAxisSize.min,
                              children: <Widget>[
                                Text(
                                  band?.label ?? 'Эрсдэлийн зэрэглэл тодорхойгүй',
                                  style: EmployeeTokens.rowTitle
                                      .copyWith(fontWeight: FontWeight.w800),
                                ),
                                if (report.delta != null) ...<Widget>[
                                  const SizedBox(height: 4),
                                  Text(
                                    'Өмнөх оноо ${report.previousScore} · '
                                    '${report.delta}',
                                    style: EmployeeTokens.rowSub,
                                  ),
                                ],
                                if (report.measuredLoadKw != null) ...<Widget>[
                                  const SizedBox(height: 4),
                                  Text(
                                    'Хэмжсэн ачаалал '
                                    '${formatDecimal(report.measuredLoadKw)} kW',
                                    style: EmployeeTokens.rowSub,
                                  ),
                                ],
                              ],
                            ),
                          ),
                        ],
                      ),
                      if (report.repairRequired || report.revisitRequired) ...<Widget>[
                        const SizedBox(height: 12),
                        Wrap(
                          spacing: 5,
                          runSpacing: 5,
                          children: <Widget>[
                            if (report.repairRequired)
                              const EmployeePill(
                                label: 'Засвар шаардлагатай',
                                tone: Tone.red,
                              ),
                            if (report.revisitRequired)
                              EmployeePill(
                                label: report.revisitDate == null
                                    ? 'Дахин очих'
                                    : 'Дахин очих ${formatDate(report.revisitDate)}',
                                tone: Tone.yellow,
                              ),
                          ],
                        ),
                      ],
                    ],
                  ),
                ),

                if (report.conclusion != null && report.conclusion!.isNotEmpty) ...<Widget>[
                  const SectionHeading('Дүгнэлт', topPadding: 4),
                  NoticeBanner.info(text: report.conclusion!),
                ],

                if (report.recommendation != null &&
                    report.recommendation!.isNotEmpty) ...<Widget>[
                  const SectionHeading('Зөвлөмж', topPadding: 4),
                  NoticeBanner.neutral(text: report.recommendation!),
                ],

                if (report.actionTaken != null && report.actionTaken!.isNotEmpty) ...<Widget>[
                  const SectionHeading('Хийсэн ажил', topPadding: 4),
                  NoticeBanner.neutral(text: report.actionTaken!),
                ],

                if (report.photos.isNotEmpty) ...<Widget>[
                  const SectionHeading('Нотлох зураг', topPadding: 4),
                  _PhotoStrip(photos: report.photos),
                ],

                const SectionHeading('Бичсэн', topPadding: 4),
                ProjectCard(
                  padding: const EdgeInsets.symmetric(horizontal: 14),
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    children: <Widget>[
                      DetailRow(
                        label: 'Гүйцэтгэгч',
                        value: report.authorName ?? 'Тодорхойгүй',
                      ),
                      DetailRow(
                        label: 'Огноо',
                        value: formatDateTime(report.writtenAt),
                        mono: true,
                      ),
                      if (report.revisitOwnerName != null)
                        DetailRow(
                          label: 'Дахин очих хариуцагч',
                          value: report.revisitOwnerName!,
                        ),
                      DetailRow(
                        label: 'Эх сурвалж',
                        value: report.sourceLabel ?? 'Төхөөрөмжийн үнэлгээ',
                        isLast: true,
                      ),
                    ],
                  ),
                ),

                const Padding(
                  padding: EdgeInsets.fromLTRB(
                    EmployeeTokens.labelGutter,
                    2,
                    EmployeeTokens.labelGutter,
                    0,
                  ),
                  child: Text(
                    'Бүртгэгдсэн дүгнэлт нь өөрчлөгддөггүй. Шинэ дүгнэлт нэмж '
                    'бүртгэнэ.',
                    style: EmployeeTokens.microNote,
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _PhotoStrip extends StatelessWidget {
  const _PhotoStrip({required this.photos});

  final List<ObjectPhotoModel> photos;

  @override
  Widget build(BuildContext context) {
    final List<ObjectPhotoModel> images =
        photos.where((ObjectPhotoModel photo) => photo.isImage).toList();

    if (images.isEmpty) {
      return ProjectCard(
        child: Text(
          '${photos.length} хавсралт байна. Зураг биш тул энд харуулах боломжгүй.',
          style: EmployeeTokens.rowSub,
        ),
      );
    }

    return SizedBox(
      height: 150,
      child: ListView.separated(
        scrollDirection: Axis.horizontal,
        padding: const EdgeInsets.symmetric(horizontal: EmployeeTokens.gutter),
        itemCount: images.length,
        separatorBuilder: (BuildContext _, int __) => const SizedBox(width: 8),
        itemBuilder: (BuildContext _, int index) {
          return ClipRRect(
            borderRadius: BorderRadius.circular(EmployeeTokens.radiusRow),
            child: Container(
              width: 190,
              decoration: BoxDecoration(
                color: EmployeeTokens.white,
                border: Border.all(
                  color: EmployeeTokens.line,
                  width: EmployeeTokens.hairline,
                ),
                borderRadius: BorderRadius.circular(EmployeeTokens.radiusRow),
              ),
              child: AuthenticatedImage(
                fileId: images[index].id,
                fit: BoxFit.cover,
              ),
            ),
          );
        },
      ),
    );
  }
}
