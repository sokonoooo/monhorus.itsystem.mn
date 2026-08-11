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

export const SETTING_GROUPS = ['general', 'sla', 'evaluation', 'finance'] as const;
export type SettingGroup = (typeof SETTING_GROUPS)[number];

export const SETTING_GROUP_LABELS: Record<SettingGroup, string> = {
  general: 'Ерөнхий',
  sla: 'SLA',
  evaluation: 'Үнэлгээний түвшин',
  finance: 'Санхүү',
};

export const SETTING_GROUP_DESCRIPTIONS: Record<SettingGroup, string> = {
  general: 'Байгууллагын нэр, лого, валют.',
  sla: 'Яаралтай болон энгийн дуудлагын хугацаа, анхааруулгын босго.',
  evaluation: '0-100 оноог 5 түвшинд хуваах босго.',
  finance: 'Нэхэмжлэлийн татвар, төлөх хугацаа.',
};

export const SETTING_KEYS = {
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
  EVAL_NORMAL_MIN: 'evaluation.normal_min',
  EVAL_ATTENTION_MIN: 'evaluation.attention_min',
  EVAL_SCHEDULE_REPAIR_MIN: 'evaluation.schedule_repair_min',
  EVAL_CRITICAL_MIN: 'evaluation.critical_min',

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

export type SettingValue = string | number;

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
  type: 'string' | 'integer' | 'ratio' | 'percent' | 'file';
  default: SettingValue;
  min?: number;
  max?: number;
  /** Suffix rendered beside the control, for example "цаг". */
  unit?: string;
}

export const SETTING_DEFINITIONS: Record<SettingKey, SettingDefinition> = {
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

  [SETTING_KEYS.EVAL_NORMAL_MIN]: {
    key: SETTING_KEYS.EVAL_NORMAL_MIN,
    group: 'evaluation',
    label: 'Хэвийн (ногоон) доод оноо',
    hint: 'Энэ оноо ба түүнээс дээш нь хэвийн. Үндсэн утга 81.',
    type: 'integer',
    default: 81,
    min: 1,
    max: 100,
    unit: 'оноо',
  },
  [SETTING_KEYS.EVAL_ATTENTION_MIN]: {
    key: SETTING_KEYS.EVAL_ATTENTION_MIN,
    group: 'evaluation',
    label: 'Анхаарах (шар) доод оноо',
    hint: 'Үндсэн утга 61.',
    type: 'integer',
    default: 61,
    min: 1,
    max: 100,
    unit: 'оноо',
  },
  [SETTING_KEYS.EVAL_SCHEDULE_REPAIR_MIN]: {
    key: SETTING_KEYS.EVAL_SCHEDULE_REPAIR_MIN,
    group: 'evaluation',
    label: 'Ойрын хугацаанд засварлах (улбар шар) доод оноо',
    hint: 'Үндсэн утга 41.',
    type: 'integer',
    default: 41,
    min: 1,
    max: 100,
    unit: 'оноо',
  },
  [SETTING_KEYS.EVAL_CRITICAL_MIN]: {
    key: SETTING_KEYS.EVAL_CRITICAL_MIN,
    group: 'evaluation',
    label: 'Ноцтой эрсдэлтэй (улаан) доод оноо',
    hint: 'Үүнээс доош нь ашиглах боломжгүй (хар). Үндсэн утга 21.',
    type: 'integer',
    default: 21,
    min: 1,
    max: 100,
    unit: 'оноо',
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

const BAND_ORDER: readonly RiskLevel[] = RISK_LEVELS;

const BAND_LABELS: Record<RiskLevel, string> = {
  NORMAL: 'Хэвийн',
  ATTENTION: 'Анхаарах шаардлагатай',
  SCHEDULE_REPAIR: 'Ойрын хугацаанд засварлах',
  CRITICAL: 'Ноцтой эрсдэлтэй',
  OUT_OF_SERVICE: 'Ашиглах боломжгүй',
};

const BAND_COLOURS: Record<RiskLevel, RiskBand['colour']> = {
  NORMAL: 'green',
  ATTENTION: 'yellow',
  SCHEDULE_REPAIR: 'orange',
  CRITICAL: 'red',
  OUT_OF_SERVICE: 'black',
};

/**
 * Builds the five bands from the four configured thresholds.
 *
 * Each band runs from its own minimum up to one below the next band's minimum, so the
 * bands always tile 0..100 with no overlap and no gap regardless of the thresholds.
 */
export function riskBandsOf(settings: SettingsMap): RiskBand[] {
  const minimums: Record<RiskLevel, number> = {
    NORMAL: Number(settings[SETTING_KEYS.EVAL_NORMAL_MIN]),
    ATTENTION: Number(settings[SETTING_KEYS.EVAL_ATTENTION_MIN]),
    SCHEDULE_REPAIR: Number(settings[SETTING_KEYS.EVAL_SCHEDULE_REPAIR_MIN]),
    CRITICAL: Number(settings[SETTING_KEYS.EVAL_CRITICAL_MIN]),
    OUT_OF_SERVICE: 0,
  };

  return BAND_ORDER.map((level, index) => {
    // The band above this one, whose minimum sets this band's ceiling. The top band has
    // no predecessor and runs to 100.
    const above = index === 0 ? undefined : BAND_ORDER[index - 1];
    return {
      level,
      min: minimums[level],
      max: above === undefined ? 100 : minimums[above] - 1,
      labelMn: BAND_LABELS[level],
      colour: BAND_COLOURS[level],
    };
  });
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

  const thresholds: { key: SettingKey; label: string; value: number }[] = [
    {
      key: SETTING_KEYS.EVAL_NORMAL_MIN,
      label: 'Хэвийн',
      value: Number(settings[SETTING_KEYS.EVAL_NORMAL_MIN]),
    },
    {
      key: SETTING_KEYS.EVAL_ATTENTION_MIN,
      label: 'Анхаарах',
      value: Number(settings[SETTING_KEYS.EVAL_ATTENTION_MIN]),
    },
    {
      key: SETTING_KEYS.EVAL_SCHEDULE_REPAIR_MIN,
      label: 'Ойрын хугацаанд засварлах',
      value: Number(settings[SETTING_KEYS.EVAL_SCHEDULE_REPAIR_MIN]),
    },
    {
      key: SETTING_KEYS.EVAL_CRITICAL_MIN,
      label: 'Ноцтой эрсдэлтэй',
      value: Number(settings[SETTING_KEYS.EVAL_CRITICAL_MIN]),
    },
  ];

  // Strictly descending, otherwise a score could fall into two bands or into none.
  for (let index = 1; index < thresholds.length; index += 1) {
    const higher = thresholds[index - 1]!;
    const lower = thresholds[index]!;
    if (lower.value >= higher.value) {
      issues.push({
        key: lower.key,
        message: `"${lower.label}" босго нь "${higher.label}" босгоос бага байх ёстой.`,
      });
    }
  }

  return issues;
}
