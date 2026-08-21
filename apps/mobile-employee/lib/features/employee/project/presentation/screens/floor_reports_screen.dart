import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../presentation/theme/employee_tokens.dart';
import '../../data/models/inspection_models.dart';
import '../../../presentation/widgets/risk_glyph.dart';
import '../../domain/entities/risk_level.dart';
import '../format.dart';
import '../providers/project_providers.dart';
import '../widgets/project_async_view.dart';
import '../widgets/project_ui.dart';
import '../widgets/report_sheet.dart';

/// `s-reports` — the floor's written conclusions, with band filter chips.
///
/// Backed by `GET /inspections?floorId=`, the consolidated device conclusion report
/// (Нэгдсэн төхөөрөмжийн тайлан). That endpoint is a cross-cutting read over the
/// append-only assessment history, so a row here is the same record a device's
/// history shows — which is why both open the same read-only sheet.
///
/// The chips are built from `GET /inspections/summary`, so a band only appears when
/// the floor actually has conclusions in it and each chip carries a real count. The
/// prototype's hardcoded "Улаан (3) · Шар (5) · Ногоон (10)" is replaced by whatever
/// the floor holds.
class FloorReportsScreen extends ConsumerStatefulWidget {
  const FloorReportsScreen({
    super.key,
    required this.floorId,
    required this.floorName,
    required this.buildingName,
  });

  final String floorId;
  final String floorName;
  final String buildingName;

  @override
  ConsumerState<FloorReportsScreen> createState() => _FloorReportsScreenState();
}

class _FloorReportsScreenState extends ConsumerState<FloorReportsScreen> {
  /// Null is the "Бүгд" chip: no band on the wire.
  RiskLevel? _band;

  @override
  Widget build(BuildContext context) {
    final AsyncValue<InspectionSummaryModel> summary =
        ref.watch(floorReportSummaryProvider(widget.floorId));

    final FloorReportQuery query =
        FloorReportQuery(floorId: widget.floorId, riskLevel: _band);

    return ProjectScaffold(
      navBar: const ProjectNavBar(
        title: 'Тайлангийн жагсаалт',
        subtitle: 'Бүртгэгдсэн дүгнэлтүүд',
      ),
      body: RefreshIndicator(
        onRefresh: () async {
          ref
            ..invalidate(floorReportSummaryProvider(widget.floorId))
            ..invalidate(floorReportsProvider(query));
        },
        child: ListView(
          physics: const AlwaysScrollableScrollPhysics(),
          padding: const EdgeInsets.only(bottom: 28),
          children: <Widget>[
            Breadcrumb(
              parts: <String>[
                widget.buildingName,
                widget.floorName,
                'Тайлангууд',
              ],
            ),
            // The four figures and the chips are the summary's answer, so they wait
            // for it. Rendering `InspectionSummaryModel.empty` while the request is
            // in flight — or after it failed — put "0 · 0 · 0 · 0" and "Нийт 0
            // төхөөрөмж" on screen in a form indistinguishable from a floor that
            // genuinely holds nothing, which is the claim this screen cannot make
            // yet. Same rule the Нүүр hero states: "four zeroes would be a claim the
            // screen cannot make yet."
            ProjectAsyncView<InspectionSummaryModel>(
              value: summary,
              onRetry: () =>
                  ref.invalidate(floorReportSummaryProvider(widget.floorId)),
              loading: const ProjectLoading(height: 132),
              builder: (BuildContext ctx, InspectionSummaryModel counts) {
                final List<RiskLevel> bands = riskBandsInUse()
                    .where((RiskLevel level) => counts.countOf(level) > 0)
                    .toList(growable: false);

                return Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  mainAxisSize: MainAxisSize.min,
                  children: <Widget>[
                    MetricGrid(
                      cards: <Widget>[
                        MetricCard(
                          label: 'Үнэлгээтэй',
                          value: '${counts.assessedObjects}',
                          note: 'Нийт ${counts.totalObjects} төхөөрөмж',
                        ),
                        MetricCard(
                          label: 'Үнэлгээгүй',
                          value: '${counts.unassessedObjects}',
                          note: 'Дүгнэлт бичигдээгүй',
                        ),
                        MetricCard(
                          label: 'Засвар шаардсан',
                          value: '${counts.repairRequiredCount}',
                          note: 'Дүгнэлтээр',
                          valueColor: counts.repairRequiredCount > 0
                              ? EmployeeTokens.red
                              : EmployeeTokens.ink,
                        ),
                        MetricCard(
                          label: 'Дахин очих',
                          value: '${counts.revisitRequiredCount}',
                          note: 'Дүгнэлтээр',
                          valueColor: counts.revisitRequiredCount > 0
                              ? EmployeeTokens.yellow
                              : EmployeeTokens.ink,
                        ),
                      ],
                    ),
                    if (bands.isNotEmpty) ...<Widget>[
                      const SectionHeading('Шүүлтүүр', topPadding: 4),
                      _BandChips(
                        bands: bands,
                        counts: counts,
                        selected: _band,
                        onSelected: (RiskLevel? level) =>
                            setState(() => _band = level),
                      ),
                    ],
                  ],
                );
              },
            ),
            const SectionHeading('Тайлангууд'),
            ProjectAsyncView<List<InspectionListItemModel>>(
              value: ref.watch(floorReportsProvider(query)),
              onRetry: () => ref.invalidate(floorReportsProvider(query)),
              builder: (BuildContext ctx, List<InspectionListItemModel> reports) {
                if (reports.isEmpty) {
                  return ProjectEmptyState(
                    icon: Icons.description_outlined,
                    message: _band == null
                        ? 'Энэ давхарт бүртгэгдсэн дүгнэлт тайлан алга байна.'
                        : '${_band!.label} зэрэглэлтэй тайлан алга байна.',
                  );
                }
                return Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: <Widget>[
                    for (final InspectionListItemModel report in reports)
                      _ReportRow(report: report),
                  ],
                );
              },
            ),
          ],
        ),
      ),
    );
  }
}

/// The band chips, laid out as a wrap so five bands plus "Бүгд" never overflow.
class _BandChips extends StatelessWidget {
  const _BandChips({
    required this.bands,
    required this.counts,
    required this.selected,
    required this.onSelected,
  });

  final List<RiskLevel> bands;
  final InspectionSummaryModel counts;
  final RiskLevel? selected;
  final ValueChanged<RiskLevel?> onSelected;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(
        EmployeeTokens.gutter,
        0,
        EmployeeTokens.gutter,
        10,
      ),
      child: Wrap(
        spacing: 6,
        runSpacing: 6,
        children: <Widget>[
          _Chip(
            label: 'Бүгд (${counts.assessedObjects})',
            tone: selected == null ? Tone.ink : Tone.outline,
            onTap: () => onSelected(null),
          ),
          for (final RiskLevel band in bands)
            _Chip(
              // The abbreviation and the band's own silhouette. The filter used to
              // read "УЛААН (3)", which named the chip's colour and nothing else.
              label: '${band.shortLabel} (${counts.countOf(band)})',
              tone: selected == band ? Tone.ink : band.tone,
              band: band,
              semanticLabel: '${band.label}: ${counts.countOf(band)}',
              onTap: () => onSelected(band),
            ),
        ],
      ),
    );
  }
}

class _Chip extends StatelessWidget {
  const _Chip({
    required this.label,
    required this.tone,
    required this.onTap,
    this.band,
    this.semanticLabel,
  });

  final String label;
  final Tone tone;
  final VoidCallback onTap;

  /// Set on a risk filter, unset on the "Бүгд" chip, which is not a band.
  final RiskLevel? band;
  final String? semanticLabel;

  @override
  Widget build(BuildContext context) {
    final Widget chip = Material(
      color: tone.background,
      borderRadius: BorderRadius.circular(EmployeeTokens.radiusPill),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(EmployeeTokens.radiusPill),
        splashFactory: NoSplash.splashFactory,
        highlightColor: EmployeeTokens.soft2,
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 11, vertical: 6),
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(EmployeeTokens.radiusPill),
            border: Border.all(color: tone.border),
          ),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: <Widget>[
              if (band != null) ...<Widget>[
                RiskGlyph(level: band, size: 9, color: tone.foreground),
                const SizedBox(width: 5),
              ],
              Text(
                label.toUpperCase(),
                style: EmployeeTokens.pillLabel.copyWith(color: tone.foreground),
              ),
            ],
          ),
        ),
      ),
    );

    if (semanticLabel == null) return chip;
    return Semantics(label: semanticLabel, button: true, child: chip);
  }
}

class _ReportRow extends StatelessWidget {
  const _ReportRow({required this.report});

  final InspectionListItemModel report;

  @override
  Widget build(BuildContext context) {
    final RiskLevel? band = report.riskLevel;

    return ProjectRow(
      leading: RowTile(
        tone: riskTone(band),
        text: '${report.score}',
        level: band,
        showGlyph: true,
      ),
      title: report.titleLine,
      subtitle: joinParts(<String?>[
        formatDate(report.assessedAt),
        report.assessedByName,
        report.objectName,
        report.sourceLabel,
      ]),
      trailing: band == null
          ? null
          : EmployeePill(
              label: band.shortLabel,
              tone: band.tone,
              showGlyph: true,
              glyphLevel: band,
              semanticLabel: band.label,
            ),
      onTap: () => ReportSheet.show(context, ReportView.fromInspection(report)),
    );
  }
}
