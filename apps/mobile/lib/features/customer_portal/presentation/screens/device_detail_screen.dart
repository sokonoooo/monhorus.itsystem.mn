import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../core/network/api_result.dart';
import '../../data/models/object_master_model.dart';
import '../../data/models/project_model.dart';
import '../../domain/entities/customer_scope.dart';
import '../../domain/entities/object_master_enums.dart';
import '../../domain/entities/risk_level.dart';
import '../format.dart';
import '../providers/customer_portal_providers.dart';
import '../theme/customer_tokens.dart';
import '../widgets/create_request_sheet.dart';
import '../widgets/customer_async_view.dart';
import '../widgets/customer_ui.dart';
import '../widgets/photo_source_sheet.dart';
import '../widgets/risk_widgets.dart';
import 'customer_shell_screen.dart';
import 'service_request_detail_screen.dart';

/// s-device-detail: one object, its үнэлгээ, its measurements and its history.
///
/// The prototype's metric grid shows voltage, current, temperature and load. The API
/// carries none of the first three - an object has load figures and an assessment
/// score, and nothing electrical beyond that - so the grid renders the load values
/// the contract does define rather than four invented readings.
class DeviceDetailScreen extends ConsumerWidget {
  const DeviceDetailScreen({
    super.key,
    required this.objectId,
    this.pickPhoto = pickServiceRequestPhoto,
  });

  final String objectId;

  /// Forwarded to the request sheet this screen opens. Overridden in tests only, for
  /// the reason [CreateRequestSheet.pickPhoto] states: `image_picker` has no test
  /// binding, so without an injected picker the submit path behind this screen's
  /// sticky action is unreachable and what it puts on the wire cannot be asserted.
  final PortalPhotoPicker pickPhoto;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final AsyncValue<ObjectDetailModel> object =
        ref.watch(objectDetailProvider(objectId));
    final ObjectDetailModel? loaded = object.valueOrNull;

    return CustomerScaffold(
      navBar: CustomerNavBar(
        title: loaded?.name ?? 'Объект',
        subtitle: loaded == null
            ? 'Объектын дэлгэрэнгүй'
            : <String>[
                loaded.objectType?.name ?? loaded.category?.label ?? '',
                loaded.status?.label ?? '',
              ].where((String part) => part.isNotEmpty).join(' · '),
      ),
      body: RefreshIndicator(
        onRefresh: () async {
          ref
            ..invalidate(objectDetailProvider(objectId))
            ..invalidate(objectHistoryProvider(objectId));
        },
        child: CustomerAsyncView<ObjectDetailModel>(
          value: object,
          onRetry: () => ref.invalidate(objectDetailProvider(objectId)),
          builder: (BuildContext ctx, ObjectDetailModel data) =>
              _Body(object: data),
        ),
      ),
      bottomAction: loaded == null
          ? null
          : _RequestAction(object: loaded, pickPhoto: pickPhoto),
    );
  }
}

class _Body extends ConsumerWidget {
  const _Body({required this.object});

  final ObjectDetailModel object;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final LatestAssessmentModel? assessment = object.latestAssessment;
    final RiskLevel? level = assessment?.riskLevel;
    final bool severe =
        level == RiskLevel.critical || level == RiskLevel.outOfService;

    return ListView(
      padding: const EdgeInsets.only(top: 8, bottom: 24),
      children: <Widget>[
        Breadcrumb(
          parts: <String>[
            if (object.buildingName != null) object.buildingName!,
            if (object.floorName != null) object.floorName!,
            object.name,
          ],
        ),

        if (severe)
          const NoticeBanner.alert(
            text: 'Энэ объект эрсдэлтэй үнэлгээтэй байна. Засварын хүсэлт '
                'илгээж техникч дуудна уу.',
          ),

        ScoreCircleCard(
          score: assessment?.score,
          level: level,
          title: <String>[
            object.name,
            level?.label ?? unassessedLabel,
          ].join(' · '),
          body: assessment == null
              ? object.canAssess
                  ? 'Энэ объектод үнэлгээ хараахан бүртгэгдээгүй байна.'
                  : 'Энэ төрлийн объектод дүгнэлт бүртгэхээр тохируулагдаагүй байна.'
              : assessment.recommendation ??
                  assessment.conclusion ??
                  'Сүүлийн үнэлгээ: ${formatDate(assessment.assessedAt)}',
        ),

        const SectionCaption('Ачааллын үзүүлэлт'),
        MetricGrid(
          cards: <Widget>[
            _LoadCard(
              label: 'Тооцоолсон ачаалал',
              value: object.calculatedLoad,
              unit: ' kW',
              note: 'Тоноглолын чадлаар тооцов',
            ),
            MetricCard(
              label: 'Хэмжсэн ачаалал',
              value: formatDecimal(object.measuredLoadKw),
              unit: object.measuredLoadKw == null ? null : ' kW',
              note: 'Сүүлийн хэмжилт',
            ),
            _LoadCard(
              label: 'Зөрүү',
              value: object.loadVariance,
              unit: ' kW',
              note: 'Хэмжсэн хасах тооцоолсон',
              tone: _varianceTone(object.loadVariance),
            ),
            _LoadCard(
              label: 'Ачаалал',
              value: object.loadPercent,
              unit: '%',
              note: 'Хүчин чадалд эзлэх хувь',
              tone: _percentTone(object.loadPercent),
            ),
          ],
        ),

        // Rendered even when the reserve is incomplete: the card then reads
        // "Бүрэн бус" with the reason, which is information. Hiding it would leave
        // the customer unable to tell an unknown reserve from an unlisted one.
        MetricGrid(
          cards: <Widget>[
            _LoadCard(
              label: 'Нөөц',
              value: object.reserveKw,
              unit: ' kW',
              note: 'Үлдэгдэл хүчин чадал',
            ),
            MetricCard(
              label: 'Ангилал',
              value: object.category?.label ?? '-',
              note: object.objectType?.name ?? '',
            ),
          ],
        ),

        ..._attributeSection(object),

        if (assessment != null) ...<Widget>[
          const SectionCaption('Дүгнэлт ба зөвлөмж'),
          PanelCard(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: <Widget>[
                if (assessment.conclusion != null) ...<Widget>[
                  const _MiniLabel('Дүгнэлт'),
                  Text(
                    assessment.conclusion!,
                    style: CustomerTokens.body.copyWith(
                      color: CustomerTokens.ink,
                    ),
                  ),
                  const SizedBox(height: 12),
                ],
                if (assessment.recommendation != null) ...<Widget>[
                  const _MiniLabel('Зөвлөмж'),
                  Text(
                    assessment.recommendation!,
                    style: CustomerTokens.body.copyWith(
                      color: CustomerTokens.ink,
                    ),
                  ),
                  const SizedBox(height: 12),
                ],
                Wrap(
                  spacing: 7,
                  runSpacing: 5,
                  children: <Widget>[
                    if (assessment.repairRequired)
                      const StatusPill(label: 'Засвар шаардлагатай', tone: AccentTone.red),
                    if (assessment.revisitRequired)
                      const StatusPill(
                          label: 'Дахин үзлэг', tone: AccentTone.yellow),
                    if (assessment.revisitDate != null)
                      StatusPill(
                        label: formatDate(assessment.revisitDate),
                        tone: AccentTone.neutral,
                      ),
                  ],
                ),
                const SizedBox(height: 10),
                Text(
                  <String>[
                    formatDateTime(assessment.assessedAt),
                    if (assessment.assessedByName != null)
                      assessment.assessedByName!,
                  ].join(' · '),
                  style: CustomerTokens.rowSub,
                ),
              ],
            ),
          ),
        ],

        // Hidden entirely, rather than shown and refused, for an account without
        // `object_master.view`. The timeline endpoint is staff-only by decision -
        // it folds in audit rows, planned-work tasks and internal request detail -
        // so for a customer this section could only ever render its error state.
        if (ref.watch(canViewObjectHistoryProvider)) ...<Widget>[
          const SectionCaption('Объектын түүх'),
          _HistorySection(objectId: object.id),
        ],
      ],
    );
  }

  List<Widget> _attributeSection(ObjectDetailModel object) {
    final PanelAttributesModel? panel = object.panel;
    final CircuitAttributesModel? circuit = object.circuit;
    final EquipmentAttributesModel? equipment = object.equipment;

    final List<Widget> rows = <Widget>[];

    if (panel != null) {
      rows.addAll(<Widget>[
        _AttrRow('Хүчин чадал', panel.capacityKw == null
            ? '-'
            : '${formatDecimal(panel.capacityKw)} kW'),
        _AttrRow('Байршил', panel.location ?? '-'),
        _AttrRow('Хамгаалалт', panel.protection ?? '-'),
      ]);
    } else if (circuit != null) {
      rows.addAll(<Widget>[
        _AttrRow('Тэжээгдэх самбар', circuit.panel?.name ?? '-'),
        _AttrRow('Таслуурын гүйдэл', circuit.breakerRating ?? '-'),
        _AttrRow('Кабелийн төрөл', circuit.cableType ?? '-'),
        _AttrRow('Кабелийн огтлол', circuit.cableSectionMm2 == null
            ? '-'
            : '${formatDecimal(circuit.cableSectionMm2)} мм²'),
        _AttrRow('Кабелийн урт', circuit.cableLengthM == null
            ? '-'
            : '${formatDecimal(circuit.cableLengthM)} м'),
        _AttrRow('Зөвшөөрөгдөх чадал', circuit.permittedCapacityKw == null
            ? '-'
            : '${formatDecimal(circuit.permittedCapacityKw)} kW'),
      ]);
    } else if (equipment != null) {
      rows.addAll(<Widget>[
        _AttrRow('Холбогдсон хэлхээ', equipment.circuit?.name ?? '-'),
        _AttrRow('Нэрлэсэн чадал', equipment.ratedPowerKw == null
            ? '-'
            : '${formatDecimal(equipment.ratedPowerKw)} kW'),
        _AttrRow('Тоо ширхэг', equipment.quantity?.toString() ?? '-'),
        _AttrRow('Ашиглалтын коэффициент',
            formatDecimal(equipment.usageCoefficient)),
        _AttrRow('Суурилуулсан', formatDate(equipment.installedAt)),
        _AttrRow('Баталгаат хугацаа', formatDate(equipment.warrantyUntil)),
      ]);
    }

    if (rows.isEmpty) return const <Widget>[];

    return <Widget>[
      const SectionCaption('Техникийн үзүүлэлт'),
      PanelCard(
        padding: EdgeInsets.zero,
        child: Column(mainAxisSize: MainAxisSize.min, children: rows),
      ),
    ];
  }

  static Color _varianceTone(LoadValueModel value) {
    if (!value.hasValue) return CustomerTokens.ink;
    final double amount = value.valueKw!;
    if (amount > 0) return CustomerTokens.red;
    if (amount < 0) return CustomerTokens.yellow;
    return CustomerTokens.ink;
  }

  static Color _percentTone(LoadValueModel value) {
    if (!value.hasValue) return CustomerTokens.ink;
    final double percent = value.valueKw!;
    if (percent > 100) return CustomerTokens.red;
    if (percent >= 90) return CustomerTokens.yellow;
    return CustomerTokens.green;
  }
}

/// A [MetricCard] fed from a [LoadValueModel].
///
/// An incomplete calculation prints "Бүрэн бус" and never a zero, so a missing
/// technical field cannot be read as a genuine measurement.
class _LoadCard extends StatelessWidget {
  const _LoadCard({
    required this.label,
    required this.value,
    required this.unit,
    required this.note,
    this.tone = CustomerTokens.ink,
  });

  final String label;
  final LoadValueModel value;
  final String unit;
  final String note;
  final Color tone;

  @override
  Widget build(BuildContext context) {
    if (!value.hasValue) {
      return MetricCard(
        label: label,
        value: loadIncompleteLabel,
        note: note,
        valueColor: CustomerTokens.yellow,
      );
    }

    return MetricCard(
      label: label,
      value: formatDecimal(value.valueKw),
      unit: unit,
      note: note,
      valueColor: tone,
    );
  }
}

class _MiniLabel extends StatelessWidget {
  const _MiniLabel(this.text);

  final String text;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 5),
      child: Text(text.toUpperCase(), style: CustomerTokens.sectionLabel),
    );
  }
}

class _HistorySection extends ConsumerWidget {
  const _HistorySection({required this.objectId});

  final String objectId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return CustomerAsyncView<ObjectHistoryModel>(
      value: ref.watch(objectHistoryProvider(objectId)),
      onRetry: () => ref.invalidate(objectHistoryProvider(objectId)),
      builder: (BuildContext ctx, ObjectHistoryModel history) {
        if (history.timeline.isEmpty) {
          return const CustomerEmptyState(
            icon: Icons.history_outlined,
            message: 'Энэ объектод бүртгэгдсэн түүх алга байна.',
          );
        }

        return Timeline(
          entries: <TimelineEntry>[
            for (int i = 0; i < history.timeline.length; i++)
              TimelineEntry(
                title: history.timeline[i].title,
                meta: <String>[
                  formatEventStamp(history.timeline[i].occurredAt),
                  if (history.timeline[i].actorName != null)
                    history.timeline[i].actorName!,
                  if (history.timeline[i].kind != null)
                    history.timeline[i].kind!.label,
                ].join(' · '),
                tone: history.timeline[i].riskLevel?.tone ?? AccentTone.blue,
                icon: _iconFor(history.timeline[i].kind),
                isLast: i == history.timeline.length - 1,
              ),
          ],
        );
      },
    );
  }

  static IconData _iconFor(ObjectHistoryKind? kind) {
    return switch (kind) {
      ObjectHistoryKind.assessment => Icons.fact_check_outlined,
      ObjectHistoryKind.measurement => Icons.straighten_outlined,
      ObjectHistoryKind.inspection => Icons.search_outlined,
      ObjectHistoryKind.repair => Icons.build_outlined,
      ObjectHistoryKind.plannedWork => Icons.event_outlined,
      ObjectHistoryKind.audit => Icons.edit_note_outlined,
      null => Icons.circle_outlined,
    };
  }
}

/// The sticky "Засварын хүсэлт илгээх" action.
///
/// Hidden entirely, rather than disabled, when the account holds neither create
/// permission: the endpoint would answer 403 and a permanently dead button is worse
/// than none.
class _RequestAction extends ConsumerWidget {
  const _RequestAction({required this.object, required this.pickPhoto});

  final ObjectDetailModel object;
  final PortalPhotoPicker pickPhoto;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final bool canCreate = ref.watch(canCreateServiceRequestProvider);
    final CustomerScope scope = ref.watch(customerScopeProvider);

    if (!canCreate || scope is! ResolvedCustomerScope) {
      return const SizedBox.shrink();
    }

    final bool decommissioned = object.status == ObjectStatus.decommissioned;
    final RiskLevel? level = object.latestAssessment?.riskLevel;
    final bool severe =
        level == RiskLevel.critical || level == RiskLevel.outOfService;

    return StickyAction(
      label: decommissioned
          ? 'Ашиглалтаас гарсан'
          : 'Засварын хүсэлт илгээх',
      icon: decommissioned ? Icons.block : Icons.build_outlined,
      danger: severe,
      onPressed: decommissioned ? null : () => _open(context, ref, scope),
    );
  }

  Future<void> _open(
    BuildContext context,
    WidgetRef ref,
    ResolvedCustomerScope scope,
  ) async {
    // The object detail carries a floorId and a building *name*, but the create
    // request needs a building *id*. The floor knows its parent, so one lookup
    // spares the customer from re-picking a building they are already standing in.
    String? buildingId;
    final String? floorId = object.floorId;
    if (floorId != null) {
      final ApiResult<FloorModel> floor =
          await ref.read(customerPortalRepositoryProvider).getFloor(floorId);
      buildingId = floor.dataOrNull?.buildingId;
    }

    if (!context.mounted) return;

    final String? createdId = await CreateRequestSheet.show(
      context,
      scope: scope,
      initialBuildingId: buildingId,
      initialFloorId: buildingId == null ? null : floorId,
      // The equipment's own spot on the floor plan, COPIED onto the request rather than
      // referenced. A customer standing at a device should not be asked to point at a
      // drawing to say where it is — the register already knows — but what the request
      // stores is where the fault was reported, so it stays true if the object is later
      // moved or re-placed, and the customer can still move or clear the pin because
      // they can see the fault and the register cannot.
      //
      // Null for the objects nobody has placed, which is most of them; the sheet then
      // says so and asks for a pin instead of showing a bare plan.
      initialPlanPosition: object.planPosition,
      // No id travels with the device, only its name and its identity in the text.
      //
      // `deviceId` names an `ObjectNode` of kind DEVICE and the server resolves it with
      // `ObjectNode.findById`. `object` is an `ObjectDetailModel` — a row of the object
      // MASTER register, a different collection — so its id resolved to nothing and
      // every request raised from this screen came back 400 `Төхөөрөмж олдсонгүй.`
      // There is no node id available here to send instead: this app has no screen
      // built on the node hierarchy below a floor. So the link is carried where it is
      // actually read — the subtitle names the device, and the description opens with
      // its code and name so the dispatcher who receives the request knows what it is
      // about even after the customer edits the rest.
      deviceName: object.name,
      initialUrgent: object.latestAssessment?.riskLevel == RiskLevel.critical ||
          object.latestAssessment?.riskLevel == RiskLevel.outOfService,
      initialDescription: _describe(object),
      pickPhoto: pickPhoto,
    );

    if (createdId == null || !context.mounted) return;
    await Navigator.of(context).push(
      MaterialPageRoute<void>(
        builder: (_) => ServiceRequestDetailScreen(requestId: createdId),
      ),
    );
  }

  /// The description the sheet opens with.
  ///
  /// The first line names the device, because with no resolvable `deviceId` to send
  /// this text is the only place the record says which piece of equipment the customer
  /// was standing in front of. The assessor's own recommendation follows it when there
  /// is one, so the dispatcher reads what the platform already concluded rather than
  /// only what the customer typed.
  ///
  /// The code is dropped when the register holds none, so an unnamed identifier never
  /// renders as a dangling separator.
  static String _describe(ObjectDetailModel object) {
    final String identity = object.code.isEmpty
        ? object.name
        : '${object.name} (${object.code})';
    final String? recommendation = object.latestAssessment?.recommendation;

    return <String>[
      '$identity төхөөрөмж дээр асуудал гарлаа.',
      if (recommendation != null && recommendation.trim().isNotEmpty)
        recommendation.trim(),
    ].join('\n');
  }
}

/// One technical attribute line, forwarded to the shared [DetailRow].
class _AttrRow extends StatelessWidget {
  const _AttrRow(this.label, this.value);

  final String label;
  final String value;

  @override
  Widget build(BuildContext context) => DetailRow(label: label, value: value);
}
