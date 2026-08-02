/**
 * Asset diagram vocabulary.
 *
 * A dashboard diagram of the electrical estate: panels, transformers, substations and the
 * lines between them. Every property is authored, so this is not the section 11 floor-plan
 * editor, which places objects at coordinates on a scanned plan and whose format section
 * 19.2 still leaves unapproved.
 */

/** Node kinds. Extensible: the list is the vocabulary, not a rule about what may exist. */
export const DIAGRAM_ASSET_KINDS = [
  'PANEL',
  'TRANSFORMER',
  'SUBSTATION',
  'METER',
  'PUMP',
  'SERVER',
  'GENERATOR',
  'UPS',
  'MOTOR',
  'BREAKER',
  'SENSOR',
  'OTHER',
] as const;
export type DiagramAssetKind = (typeof DIAGRAM_ASSET_KINDS)[number];

export const DIAGRAM_ASSET_KIND_LABELS: Record<DiagramAssetKind, string> = {
  PANEL: 'Самбар',
  TRANSFORMER: 'Трансформатор',
  SUBSTATION: 'Дэд станц',
  METER: 'Тоолуур',
  PUMP: 'Насос',
  SERVER: 'Сервер',
  GENERATOR: 'Генератор',
  UPS: 'UPS',
  MOTOR: 'Мотор',
  BREAKER: 'Автомат таслуур',
  SENSOR: 'Мэдрэгч',
  OTHER: 'Бусад',
};

/**
 * Status badge shown on a node.
 *
 * Operational state, deliberately not the section 10 risk band: that band is derived from
 * an assessment and must never be hand-set. These are authored, so they carry their own
 * vocabulary and cannot be mistaken for an assessment result.
 */
export const DIAGRAM_NODE_STATUSES = ['OK', 'WARNING', 'FAULT', 'OFFLINE', 'MAINTENANCE'] as const;
export type DiagramNodeStatus = (typeof DIAGRAM_NODE_STATUSES)[number];

export const DIAGRAM_NODE_STATUS_LABELS: Record<DiagramNodeStatus, string> = {
  OK: 'Хэвийн',
  WARNING: 'Анхаарах',
  FAULT: 'Гэмтэлтэй',
  OFFLINE: 'Унтраалттай',
  MAINTENANCE: 'Засварт',
};

export const DIAGRAM_NODE_STATUS_COLOURS: Record<DiagramNodeStatus, string> = {
  OK: '#16a34a',
  WARNING: '#f59e0b',
  FAULT: '#dc2626',
  OFFLINE: '#64748b',
  MAINTENANCE: '#2563eb',
};

/** Which of the four handles an edge attaches to. */
export const DIAGRAM_HANDLES = ['top', 'right', 'bottom', 'left'] as const;
export type DiagramHandle = (typeof DIAGRAM_HANDLES)[number];

export const DIAGRAM_HANDLE_LABELS: Record<DiagramHandle, string> = {
  top: 'Дээд',
  right: 'Баруун',
  bottom: 'Доод',
  left: 'Зүүн',
};

/** Where the arrowheads sit, which is what "direction" means on the wire. */
export const DIAGRAM_EDGE_DIRECTIONS = ['NONE', 'FORWARD', 'BACKWARD', 'BOTH'] as const;
export type DiagramEdgeDirection = (typeof DIAGRAM_EDGE_DIRECTIONS)[number];

export const DIAGRAM_EDGE_DIRECTION_LABELS: Record<DiagramEdgeDirection, string> = {
  NONE: 'Сумгүй',
  FORWARD: 'Урагш',
  BACKWARD: 'Ухрах',
  BOTH: 'Хоёр тийш',
};

export const DIAGRAM_ARROW_TYPES = ['ARROW', 'ARROW_CLOSED'] as const;
export type DiagramArrowType = (typeof DIAGRAM_ARROW_TYPES)[number];

export const DIAGRAM_ARROW_TYPE_LABELS: Record<DiagramArrowType, string> = {
  ARROW: 'Нээлттэй сум',
  ARROW_CLOSED: 'Дүүрэн сум',
};

/** How the line is routed between two handles. */
export const DIAGRAM_LINE_TYPES = ['SMOOTHSTEP', 'STEP', 'STRAIGHT', 'BEZIER'] as const;
export type DiagramLineType = (typeof DIAGRAM_LINE_TYPES)[number];

export const DIAGRAM_LINE_TYPE_LABELS: Record<DiagramLineType, string> = {
  SMOOTHSTEP: 'Тэгш өнцөгт (гөлгөр)',
  STEP: 'Тэгш өнцөгт',
  STRAIGHT: 'Шулуун',
  BEZIER: 'Муруй',
};

export const DIAGRAM_DASH_STYLES = ['SOLID', 'DASHED', 'DOTTED'] as const;
export type DiagramDashStyle = (typeof DIAGRAM_DASH_STYLES)[number];

export const DIAGRAM_DASH_STYLE_LABELS: Record<DiagramDashStyle, string> = {
  SOLID: 'Тасралтгүй',
  DASHED: 'Тасархай',
  DOTTED: 'Цэгэн',
};

/** SVG `stroke-dasharray` for each style. Null means an unbroken line. */
export const DIAGRAM_DASH_ARRAYS: Record<DiagramDashStyle, string | null> = {
  SOLID: null,
  DASHED: '8 6',
  DOTTED: '2 5',
};

/** Bounds, so a stored diagram cannot describe something unrenderable. */
export const DIAGRAM_LIMITS = {
  nodeMinWidth: 80,
  nodeMaxWidth: 640,
  nodeMinHeight: 48,
  nodeMaxHeight: 480,
  edgeMinThickness: 1,
  edgeMaxThickness: 12,
  zoomMin: 0.1,
  zoomMax: 4,
  maxNodes: 400,
  maxEdges: 800,
  maxMetricsPerNode: 8,
  maxTimelineSteps: 60,
} as const;

export const DIAGRAM_GRID_SIZES = [8, 12, 16, 24, 32] as const;
export type DiagramGridSize = (typeof DIAGRAM_GRID_SIZES)[number];

/** Default accent, used when a node is created without one being chosen. */
export const DIAGRAM_DEFAULT_ACCENT = '#2563eb';
export const DIAGRAM_DEFAULT_EDGE_COLOUR = '#64748b';

/** A `#rrggbb` colour. Anything else is rejected rather than rendered as black. */
export const HEX_COLOUR_PATTERN = /^#[0-9a-fA-F]{6}$/;

/**
 * What the timeline is, and what it is not.
 *
 * A timeline is a list of authored steps. Each step carries the operational state its
 * nodes and edges should show, and selecting one applies that state to the diagram.
 *
 * It is explicitly not an edit history: the structure lives in one document, steps store
 * only per-node and per-edge state, and no prior version of the diagram is ever kept.
 * Removing a step discards it outright.
 */
export const TIMELINE_NOT_VERSIONING_NOTE =
  'Timeline нь оператор төлөвийн алхмууд бөгөөд диаграмын хувилбарын түүх биш. Өмнөх хувилбар хадгалагдахгүй.';
