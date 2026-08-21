import '../../presentation/theme/customer_tokens.dart';
import 'server_vocabulary.dart';

/// Mirrors `ServiceRequestStatus` / `SERVICE_REQUEST_STATUS_LABELS` in
/// packages/shared/src/constants/service-request.ts. All fourteen values, in the
/// order the shared constant declares them.
///
/// The tone was a presentation choice made here, because the shared package assigns no
/// colour to a status. It still is - as a DEFAULT. An administrator groups the fourteen
/// statuses into named, coloured stages, and `GET /vocabulary` is where this app reads
/// them; [label] and [tone] are getters over that answer so a rename reaches the card,
/// the detail header and the timeline without any of them changing.
enum ServiceRequestStatus {
  newRequest('NEW', 'Шинэ', AccentTone.blue),
  unassigned('UNASSIGNED', 'Хуваарилагдаагүй', AccentTone.yellow),
  assigned('ASSIGNED', 'Хуваарилагдсан', AccentTone.blue),
  accepted('ACCEPTED', 'Хүлээн авсан', AccentTone.blue),
  onTheWay('ON_THE_WAY', 'Замдаа', AccentTone.blue),
  onSite('ON_SITE', 'Очсон', AccentTone.blue),
  inProgress('IN_PROGRESS', 'Гүйцэтгэж байна', AccentTone.green),
  waiting('WAITING', 'Түр хүлээгдсэн', AccentTone.yellow),
  reportSubmitted('REPORT_SUBMITTED', 'Дүгнэлт илгээсэн', AccentTone.purple),
  verification('VERIFICATION', 'Баталгаажуулах', AccentTone.purple),
  completed('COMPLETED', 'Дууссан', AccentTone.green),
  revisitRequired('REVISIT_REQUIRED', 'Дахин очих', AccentTone.orange),
  returned('RETURNED', 'Буцаасан', AccentTone.orange),
  cancelled('CANCELLED', 'Цуцалсан', AccentTone.neutral);

  const ServiceRequestStatus(this.wireValue, this._bundledLabel, this._bundledTone);

  final String wireValue;

  /// The status name as `SERVICE_REQUEST_STATUS_LABELS` had it at build time.
  final String _bundledLabel;

  /// The triad this status was drawn in before an administrator could recolour it.
  final AccentTone _bundledTone;

  /// What this installation calls the step, falling back to the compiled name.
  ///
  /// A stage renames a status only when it covers that status alone - see
  /// `serverStageLabelForStatus`, which explains why a coarser stage name must not be
  /// substituted here. The timeline lists every status a request passed through, and
  /// one word repeated three times down it would report three different events as the
  /// same one.
  String get label => serverStageLabelForStatus(wireValue) ?? _bundledLabel;

  /// The colour of the stage this status sits in, falling back to the designed one.
  AccentTone get tone =>
      AccentTone.named(serverStageColourForStatus(wireValue)) ?? _bundledTone;

  static ServiceRequestStatus? fromWire(String? value) {
    if (value == null) return null;
    for (final ServiceRequestStatus status in ServiceRequestStatus.values) {
      if (status.wireValue == value) return status;
    }
    return null;
  }

  /// A request the customer still has an open interest in.
  ///
  /// Derived from `SERVICE_REQUEST_TRANSITIONS`: COMPLETED and CANCELLED are the two
  /// statuses with no outgoing transition, so they are the terminal pair. This is
  /// read off the shared workflow rather than being a rule of its own.
  bool get isTerminal =>
      this == ServiceRequestStatus.completed || this == ServiceRequestStatus.cancelled;

  bool get isActive => !isTerminal;

  /// How far along the workflow this status sits, 0 to 1 — or null when the status
  /// is not a point on that workflow at all.
  ///
  /// Used only for the thin progress rail the prototype draws on a request card. It
  /// is a display ordering of the statuses as the shared `DISPATCH_BOARD_COLUMNS`
  /// lists them, not a claim about elapsed work. The backend reports no completion
  /// figure for a service request — `GET /calendar` sends `progressPercent: null` for
  /// one, because a request has no quantity to be a percentage of — so this is the
  /// card's own positional reading and nothing more.
  ///
  /// Null for every status [order] does not contain. CANCELLED is the one that
  /// mattered: it used to return 0.35, drawing a request that was called off as a
  /// third of the way done, which is a figure nobody ever stated. UNASSIGNED,
  /// WAITING, REVISIT_REQUIRED and RETURNED are null for the same reason — each sits
  /// off the linear path, so there is no position to read. The card omits the rail
  /// rather than drawing one at an invented fill.
  double? get progress {
    const List<ServiceRequestStatus> order = <ServiceRequestStatus>[
      ServiceRequestStatus.newRequest,
      ServiceRequestStatus.unassigned,
      ServiceRequestStatus.assigned,
      ServiceRequestStatus.accepted,
      ServiceRequestStatus.onTheWay,
      ServiceRequestStatus.onSite,
      ServiceRequestStatus.inProgress,
      ServiceRequestStatus.reportSubmitted,
      ServiceRequestStatus.verification,
      ServiceRequestStatus.completed,
    ];
    final int index = order.indexOf(this);
    if (index < 0) return null;
    return (index + 1) / order.length;
  }
}


/// Mirrors `SlaState` / `SLA_STATE_LABELS` in
/// packages/shared/src/constants/service-request.ts.
enum SlaState {
  started('STARTED', 'Эхэлсэн', AccentTone.blue),
  nearBreach('NEAR_BREACH', 'Ойртсон', AccentTone.yellow),
  atRisk('AT_RISK', 'Зөрчих эрсдэлтэй', AccentTone.orange),
  breached('BREACHED', 'Зөрчсөн', AccentTone.red),
  withinSla('WITHIN_SLA', 'SLA дотор дууссан', AccentTone.green),
  late('LATE', 'Хоцорсон', AccentTone.red);

  const SlaState(this.wireValue, this.label, this.tone);

  final String wireValue;
  final String label;
  final AccentTone tone;

  static SlaState? fromWire(String? value) {
    if (value == null) return null;
    for (final SlaState state in SlaState.values) {
      if (state.wireValue == value) return state;
    }
    return null;
  }
}

/// Mirrors `SLA_HOURS_URGENT` and `SLA_HOURS_STANDARD`.
const int slaHoursUrgent = 6;
const int slaHoursStandard = 24;

/// Mirrors `ObjectNodeKind` / `OBJECT_NODE_KIND_LABELS` in
/// packages/shared/src/types/object.types.ts.
enum ObjectNodeKind {
  customer('CUSTOMER', 'Харилцагч байгууллага'),
  project('PROJECT', 'Төсөл'),
  building('BUILDING', 'Барилга/Объект'),
  floor('FLOOR', 'Давхар'),
  room('ROOM', 'Өрөө/Бүс'),
  panel('PANEL', 'Самбар'),
  circuit('CIRCUIT', 'Хэлхээ/Шугам'),
  device('DEVICE', 'Төхөөрөмж');

  const ObjectNodeKind(this.wireValue, this.label);

  final String wireValue;
  final String label;

  static ObjectNodeKind? fromWire(String? value) {
    if (value == null) return null;
    for (final ObjectNodeKind kind in ObjectNodeKind.values) {
      if (kind.wireValue == value) return kind;
    }
    return null;
  }
}
