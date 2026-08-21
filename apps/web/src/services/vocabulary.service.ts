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
 * The four behaviour flags (`requiresConclusion` and friends) are deliberately NOT here.
 * They govern what the API accepts, and the API is where they are enforced; publishing them
 * to every signed-in caller would invite a client to decide a question the server owns.
 */
export interface VocabularyRiskBandDto {
  level: RiskLevel;
  label: string;
  colour: RiskColour;
  min: number;
  max: number;
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
