import type {
  ApiResponse,
  RiskColour,
  RiskLevel,
  ServiceRequestStatus,
  StageColour,
} from '@monhorus/shared';

import { apiClient, unwrap } from '../lib/api-client';

/**
 * The words and colours an administrator has configured, readable by anyone signed in.
 *
 * NOT `GET /settings`, and that distinction is the whole reason this exists. Settings are
 * configuration and are gated on `settings.view` — a technician and a customer do not hold
 * it and should not, because the SLA windows and the finance keys are none of their
 * business. The VOCABULARY derived from those settings is: if an administrator renames a
 * band to «Яаралтай» or gives it a new colour, every screen has to say «Яаралтай»,
 * including the customer portal.
 *
 * Before this endpoint the two band hooks read `/settings`, which 403s for a customer, so
 * the portal silently kept painting the labels compiled into the bundle while the staff
 * console followed the configuration. The two surfaces disagreed about the same equipment.
 *
 * Declared here rather than imported, the same way `SettingsLogoUploadDto` is: the shared
 * package types the settings CATALOGUE, and this is the derived presentation shape the
 * endpoint owns. Stating it in full means a change to the endpoint is a compile error
 * rather than an `undefined` that reaches a label.
 */
export interface VocabularyStageDto {
  key: string;
  label: string;
  colour: StageColour;
  statuses: readonly ServiceRequestStatus[];
  hidden: boolean;
}

/**
 * One resolved band.
 *
 * ALREADY RESOLVED, which is what makes this different from the stored configuration: the
 * server has sorted the ladder and derived each band's upper bound, so `min`/`max` are the
 * range the backend itself is banding scores against rather than a cut point a client would
 * have to re-derive.
 *
 * `requiresConclusion` AND `requiresRecommendation` ARE HERE, and the distinction they draw
 * is worth stating. They govern what the API accepts, and the API is still where that is
 * ENFORCED — `recordObjectAssessment` resolves the band itself and is the only thing that
 * can refuse a write. What they are published FOR is the other half: so a form can ask for
 * the fields the server is about to demand instead of deriving them from the band's NAME.
 *
 * That derivation is what this omission actually produced. `ObjectFormPage` gated its
 * conditional fields on `level === 'CRITICAL' || level === 'OUT_OF_SERVICE'` — the exact
 * construction the backend discarded, with a comment saying that written this way the rule
 * silently means "the two bands that happened to be called that". It asked for nothing at
 * all in the bands between, so a score there wrote the object and then lost its assessment
 * to a refusal naming a control the page had never rendered.
 *
 * `decommissions` and `notifies` stay behind: they are consequences the server carries out,
 * not fields a form collects, and nothing on a screen depends on knowing them.
 */
export interface VocabularyRiskBandDto {
  level: RiskLevel;
  label: string;
  colour: RiskColour;
  min: number;
  max: number;
  /** A finding in this band must carry a written conclusion and what was done about it. */
  requiresConclusion: boolean;
  /**
   * A finding in this band must carry a recommendation — and, unless it already carries a
   * conclusion, a repair or a revisit alongside it.
   */
  requiresRecommendation: boolean;
}

export interface VocabularyDto {
  requestStages: readonly VocabularyStageDto[];
  riskBands: readonly VocabularyRiskBandDto[];
}

export const vocabularyService = {
  async get(): Promise<VocabularyDto> {
    return unwrap(await apiClient.get<ApiResponse<VocabularyDto>>('/vocabulary'));
  },
};
