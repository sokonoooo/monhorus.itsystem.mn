import {
  RISK_LEVELS,
  SLA_AT_RISK_RATIO,
  SLA_HOURS_STANDARD,
  SLA_HOURS_URGENT,
  type RiskBand,
  type RiskLevel,
} from './service-request';

/**
 * System settings catalogue (requirements section 16.1).
 *
 * This is the single source of truth, in the same spirit as the permission catalogue: a
 * key that is not declared here cannot be read or written, and every key carries its own
 * type, default, bounds and Mongolian label.
 *
 * Deliberately narrow. Section 16.1 also lists dispatch modes, plan object types, line
 * styles, notification templates, billing days and tax rates. Those configure modules
 * that do not exist yet, and a setting nothing reads is a placeholder pretending to be a
 * feature. Keys are added here as the module that consumes them is built.
 *
 * Every default reproduces the behaviour that was previously hardcoded, so installing
 * this module changes nothing until an administrator edits a value.
 */

/**
 * Hard ceiling on the uploaded company logo, in bytes.
 *
 * Shared so the settings form can refuse an over-large file before spending the round
 * trip, and so it refuses the SAME file the server would. A client-side cap that
 * disagrees with the server is worse than none: it either rejects uploads that would
 * have worked or promises ones that will not.
 *
 * 2 MB. A letterhead is drawn a centimetre tall on a page; anything approaching this is
 * already far more detail than the document can show.
 */
import {
  DEFAULT_RISK_BANDS,
  resolveRiskBands,
  validateRiskBands,
  type RiskBandConfig,
} from './risk-band';
import {
  DEFAULT_SERVICE_REQUEST_STAGES,
  validateStages,
  type ServiceRequestStage,
} from './service-request-stage';

export const MAX_COMPANY_LOGO_BYTES = 2 * 1024 * 1024;

export const SETTING_GROUPS = ['general', 'sla', 'workflow', 'evaluation', 'finance'] as const;
export type SettingGroup = (typeof SETTING_GROUPS)[number];

export const SETTING_GROUP_LABELS: Record<SettingGroup, string> = {
  general: 'Ерөнхий',
  sla: 'SLA',
  workflow: 'Ажлын урсгал',
  evaluation: 'Үнэлгээний түвшин',
  finance: 'Санхүү',
};

export const SETTING_GROUP_DESCRIPTIONS: Record<SettingGroup, string> = {
  general: 'Байгууллагын нэр, лого, валют.',
  sla: 'Яаралтай болон энгийн дуудлагын хугацаа, анхааруулгын босго.',
  workflow:
    'Үйлчилгээний хүсэлтийн үе шат: нэр, өнгө, аль төлвүүдийг нэгтгэхийг тохируулна.',
  evaluation: '0-100 оноог хэдэн түвшинд хуваах, тус бүрийн нэр, өнгө, доод оноо.',
  finance: 'Нэхэмжлэлийн татвар, төлөх хугацаа.',
};

export const SETTING_KEYS = {
  /**
   * The stages an operator sees, each grouping one or more engine statuses. See
   * `service-request-stage.ts` for why the engine keeps fourteen while the board shows nine.
   */
  REQUEST_STAGES: 'workflow.request_stages',
  COMPANY_NAME: 'general.company_name',
  /**
   * Who carried the inspection out, printed as "Үзлэг хийсэн" on a report cover.
   *
   * Separate from COMPANY_NAME because they are not always the same organisation: the
   * report is issued by the operator, and the inspection may be performed by a named
   * subsidiary or crew. Blank on purpose — an operator who has not distinguished the two
   * gets the company name, which is what the reports printed before this key existed.
   */
  INSPECTION_COMPANY: 'general.inspection_company',
  /** The letterhead, as a stored-file id. Blank means the report prints without one. */
  COMPANY_LOGO: 'general.company_logo',
  CURRENCY: 'general.currency',

  SLA_URGENT_HOURS: 'sla.urgent_hours',
  SLA_STANDARD_HOURS: 'sla.standard_hours',
  SLA_NEAR_BREACH_RATIO: 'sla.near_breach_ratio',
  SLA_AT_RISK_RATIO: 'sla.at_risk_ratio',

  /**
   * Lower bound of each band. The top band runs to 100 and the bottom band runs to 0, so
   * four thresholds fully describe five bands and they cannot overlap or leave a gap.
   */
  /**
   * The whole risk ladder — how many bands, their names, colours, cut points and what
   * each one demands. Supersedes the four scalar thresholds this replaced; see
   * `scripts/migrate-risk-bands.ts` for how an existing installation carries over.
   */
  EVAL_RISK_BANDS: 'evaluation.risk_bands',

  /**
   * Requirements 12.2 sources tax from the finance settings but never states a rate, so
   * the default is zero and finance must set the real figure. A zero here produces an
   * untaxed invoice rather than a rate nobody approved; the invoice screen says so.
   */
  FINANCE_TAX_PERCENT: 'finance.tax_percent',
  /** Prefills the due date on a new invoice. The date itself stays editable. */
  FINANCE_INVOICE_DUE_DAYS: 'finance.invoice_due_days',
} as const;

export type SettingKey = (typeof SETTING_KEYS)[keyof typeof SETTING_KEYS];

/**
 * A setting is usually a scalar an administrator types. `stages` is the exception: it is
 * an ordered list, and order is the configuration — there is no separate sort field, the
 * array *is* the sequence, which is the same rule the equipment-type attribute editor
 * follows.
 */
export type SettingValue =
  | string
  | number
  | readonly ServiceRequestStage[]
  | readonly RiskBandConfig[];

export interface SettingDefinition {
  key: SettingKey;
  group: SettingGroup;
  label: string;
  /** Why the value matters, shown under the control. */
  hint: string;
  /**
   * `file` holds the id of an uploaded `StoredFile` rather than a value a person types.
   * It is still a string as far as storage and validation are concerned — the settings
   * table has no file column and does not need one — but the UI renders a picker and the
   * consumer resolves the id to bytes.
   */
  type: 'string' | 'integer' | 'ratio' | 'percent' | 'file' | 'stages' | 'riskBands';
  default: SettingValue;
  min?: number;
  max?: number;
  /** Suffix rendered beside the control, for example "цаг". */
  unit?: string;
}

export const SETTING_DEFINITIONS: Record<SettingKey, SettingDefinition> = {
  [SETTING_KEYS.REQUEST_STAGES]: {
    key: SETTING_KEYS.REQUEST_STAGES,
    group: 'workflow',
    label: 'Хүсэлтийн үе шат',
    hint:
      'Жагсаалт, самбар, шүүлтүүрт харагдах үе шат. Хэд хэдэн төлвийг нэг үе шатанд ' +
      'нэгтгэж болно; төлөв бүр яг нэг үе шатанд хамаарна.',
    type: 'stages',
    default: DEFAULT_SERVICE_REQUEST_STAGES,
  },
  [SETTING_KEYS.EVAL_RISK_BANDS]: {
    key: SETTING_KEYS.EVAL_RISK_BANDS,
    group: 'evaluation',
    label: 'Эрсдэлийн түвшин',
    hint:
      '0-100 оноог хуваах түвшин. Нэр, өнгө, доод оноог өөрчилж, түвшин нэмэх, хасах ' +
      'боломжтой. Доод түвшин 0 оноогоор эхэлж, түвшнүүд хоорондоо завсаргүй байна.',
    type: 'riskBands',
    default: DEFAULT_RISK_BANDS,
  },
  [SETTING_KEYS.COMPANY_NAME]: {
    key: SETTING_KEYS.COMPANY_NAME,
    group: 'general',
    label: 'Байгууллагын нэр',
    hint: 'Тайлан, хэвлэх баримт дээр гарна.',
    type: 'string',
    default: 'Монхорус ХХК',
  },
  [SETTING_KEYS.INSPECTION_COMPANY]: {
    key: SETTING_KEYS.INSPECTION_COMPANY,
    group: 'general',
    label: 'Үзлэг хийсэн байгууллага',
    hint: 'Тайлангийн нүүрэн дээр "Үзлэг хийсэн" мөрөнд гарна. Хоосон бол байгууллагын нэрийг хэрэглэнэ.',
    type: 'string',
    default: '',
  },
  [SETTING_KEYS.COMPANY_LOGO]: {
    key: SETTING_KEYS.COMPANY_LOGO,
    group: 'general',
    label: 'Байгууллагын лого',
    hint: 'Тайлангийн толгой хэсэгт хэвлэгдэнэ. PNG эсвэл JPEG.',
    type: 'file',
    default: '',
  },
  [SETTING_KEYS.CURRENCY]: {
    key: SETTING_KEYS.CURRENCY,
    group: 'general',
    label: 'Валют',
    hint: 'Материалын өртөг, нэхэмжлэлд ашиглана.',
    type: 'string',
    default: 'MNT',
  },

  [SETTING_KEYS.SLA_URGENT_HOURS]: {
    key: SETTING_KEYS.SLA_URGENT_HOURS,
    group: 'sla',
    label: 'Яаралтай дуудлагын хугацаа',
    hint: 'Шаардлага 8.1 ба дүрэм 17.10-ын үндсэн утга 6 цаг.',
    type: 'integer',
    default: SLA_HOURS_URGENT,
    min: 1,
    max: 720,
    unit: 'цаг',
  },
  [SETTING_KEYS.SLA_STANDARD_HOURS]: {
    key: SETTING_KEYS.SLA_STANDARD_HOURS,
    group: 'sla',
    label: 'Энгийн дуудлагын хугацаа',
    hint: 'Шаардлага 8.1 ба дүрэм 17.10-ын үндсэн утга 24 цаг.',
    type: 'integer',
    default: SLA_HOURS_STANDARD,
    min: 1,
    max: 720,
    unit: 'цаг',
  },
  [SETTING_KEYS.SLA_NEAR_BREACH_RATIO]: {
    key: SETTING_KEYS.SLA_NEAR_BREACH_RATIO,
    group: 'sla',
    label: 'Анхаарах босго',
    hint: 'Хугацааны энэ хувь өнгөрөхөд ажил "Ойртсон" төлөвт шилжинэ.',
    type: 'ratio',
    default: 0.75,
    min: 0.1,
    max: 0.99,
  },
  [SETTING_KEYS.SLA_AT_RISK_RATIO]: {
    key: SETTING_KEYS.SLA_AT_RISK_RATIO,
    group: 'sla',
    label: 'Эрсдэлтэй босго',
    hint: 'Анхаарах босгоос их байх ёстой.',
    type: 'ratio',
    default: SLA_AT_RISK_RATIO,
    min: 0.1,
    max: 0.99,
  },


  [SETTING_KEYS.FINANCE_TAX_PERCENT]: {
    key: SETTING_KEYS.FINANCE_TAX_PERCENT,
    group: 'finance',
    label: 'НӨАТ/татварын хувь',
    hint: 'Шаардлага 12.2. Хувь тогтоогоогүй тул үндсэн утга 0. Санхүү бодит хувийг оруулна.',
    type: 'percent',
    default: 0,
    min: 0,
    max: 100,
    unit: '%',
  },
  [SETTING_KEYS.FINANCE_INVOICE_DUE_DAYS]: {
    key: SETTING_KEYS.FINANCE_INVOICE_DUE_DAYS,
    group: 'finance',
    label: 'Төлөх хугацаа',
    hint: 'Шинэ нэхэмжлэлийн төлөх огноог урьдчилан бөглөнө. Огноог гараар өөрчилж болно.',
    type: 'integer',
    default: 30,
    min: 1,
    max: 365,
    unit: 'хоног',
  },
};

export const ALL_SETTING_KEYS: readonly SettingKey[] = Object.keys(
  SETTING_DEFINITIONS,
) as SettingKey[];

/** A fully resolved settings map: every declared key, defaults filled in. */
export type SettingsMap = Record<SettingKey, SettingValue>;

export function defaultSettings(): SettingsMap {
  const map = {} as SettingsMap;
  for (const key of ALL_SETTING_KEYS) {
    map[key] = SETTING_DEFINITIONS[key].default;
  }
  return map;
}

export function settingGroupOf(key: SettingKey): SettingGroup {
  return SETTING_DEFINITIONS[key].group;
}

// -- Derived views over the settings map -------------------------------------

export interface SlaConfig {
  urgentHours: number;
  standardHours: number;
  nearBreachRatio: number;
  atRiskRatio: number;
}

/**
 * SLA configuration.
 *
 * Passed explicitly into the SLA functions rather than read by them, so those functions
 * stay pure and a test can exercise a non-default window without touching a database.
 */
export function slaConfigOf(settings: SettingsMap): SlaConfig {
  return {
    urgentHours: Number(settings[SETTING_KEYS.SLA_URGENT_HOURS]),
    standardHours: Number(settings[SETTING_KEYS.SLA_STANDARD_HOURS]),
    nearBreachRatio: Number(settings[SETTING_KEYS.SLA_NEAR_BREACH_RATIO]),
    atRiskRatio: Number(settings[SETTING_KEYS.SLA_AT_RISK_RATIO]),
  };
}

/**
 * The configured risk ladder, resolved to the shape every consumer already reads.
 *
 * A stored ladder that does not tile 0..100 is discarded rather than served: a score that
 * matched no band would be stored as whatever the fallback happened to be, and a silently
 * mis-banded assessment is worse than an ignored override.
 */
export function riskBandsOf(settings: SettingsMap): RiskBand[] {
  const stored = settings[SETTING_KEYS.EVAL_RISK_BANDS];
  const configured =
    Array.isArray(stored) && validateRiskBands(stored as RiskBandConfig[]).length === 0
      ? (stored as readonly RiskBandConfig[])
      : DEFAULT_RISK_BANDS;

  // Highest score first, which is the order `RISK_BANDS` shipped in and every existing
  // consumer already iterates — the configured ladder is stored worst-first because that
  // reads better in the editor, so it is reversed here rather than at each call site.
  return [...resolveRiskBands(configured)]
    .reverse()
    .map((band) => ({
      level: band.key,
      min: band.min,
      max: band.max,
      labelMn: band.label,
      colour: band.colour,
      requiresConclusion: band.requiresConclusion,
      requiresRecommendation: band.requiresRecommendation,
      decommissions: band.decommissions,
      notifies: band.notifies,
    }));
}

/**
 * The configured stages, falling back to the shipped default.
 *
 * A stored value that no longer describes every status is discarded rather than used: a
 * partial mapping would leave requests with no stage to appear under, and silently losing
 * rows from a board is worse than ignoring a bad override.
 */
export function requestStagesOf(settings: SettingsMap): readonly ServiceRequestStage[] {
  const stored = settings[SETTING_KEYS.REQUEST_STAGES];
  if (!Array.isArray(stored)) return DEFAULT_SERVICE_REQUEST_STAGES;
  const stages = stored as readonly ServiceRequestStage[];
  return validateStages(stages).length === 0 ? stages : DEFAULT_SERVICE_REQUEST_STAGES;
}

export function riskLevelFor(score: number, bands: readonly RiskBand[]): RiskLevel {
  const band = bands.find((entry) => score >= entry.min && score <= entry.max);
  return band?.level ?? 'OUT_OF_SERVICE';
}

// -- Validation --------------------------------------------------------------

export interface SettingIssue {
  key: SettingKey | null;
  message: string;
}

/**
 * Cross-field rules that a per-field schema cannot express.
 *
 * Returned as issues rather than thrown so the API can report every problem at once and
 * the form can mark each offending field.
 */
export function validateSettings(settings: SettingsMap): SettingIssue[] {
  const issues: SettingIssue[] = [];

  const nearBreach = Number(settings[SETTING_KEYS.SLA_NEAR_BREACH_RATIO]);
  const atRisk = Number(settings[SETTING_KEYS.SLA_AT_RISK_RATIO]);
  if (atRisk <= nearBreach) {
    issues.push({
      key: SETTING_KEYS.SLA_AT_RISK_RATIO,
      message: 'Эрсдэлтэй босго нь анхаарах босгоос их байх ёстой.',
    });
  }

  // The ladder must still tile 0..100 after an edit; `validateRiskBands` owns those rules
  // so the same answer is given whether the check runs here, in the API schema, or in the
  // form the administrator is typing into.
  const bands = settings[SETTING_KEYS.EVAL_RISK_BANDS];
  if (Array.isArray(bands)) {
    for (const message of validateRiskBands(bands as RiskBandConfig[])) {
      issues.push({ key: SETTING_KEYS.EVAL_RISK_BANDS, message });
    }
  }

  return issues;
}
