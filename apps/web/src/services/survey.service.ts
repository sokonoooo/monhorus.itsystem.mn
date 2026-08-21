import type {
  ApiResponse,
  CreateSurveyQuestionInput,
  PaginatedData,
  ReorderSurveyQuestionsInput,
  SurveyQuestionDto,
  SurveyResponseDto,
  SurveyResponseListQuery,
  SurveyResultsDto,
  SurveyResultsQuery,
  UpdateSurveyQuestionInput,
} from '@monhorus/shared';

import { apiClient, unwrap } from '../lib/api-client';

function toParams(query: Record<string, unknown>): Record<string, string | number> {
  const params: Record<string, string | number> = {};
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === '') continue;
    params[key] = typeof value === 'boolean' ? String(value) : (value as string | number);
  }
  return params;
}

/**
 * The customer satisfaction survey (section 16).
 *
 * Two audiences behind one service: the question catalogue, gated `survey.manage_questions`,
 * and the analytics reads, gated `survey.view_results`. The submit endpoint is not here —
 * answering belongs to the customer portal and the phone, not to the admin console.
 */
export const surveyService = {
  /**
   * The whole catalogue in one response.
   *
   * Not paginated, deliberately: MAX_SURVEY_QUESTIONS caps it at twenty, and reordering a
   * list you can only see a page of is not a thing anybody can do correctly.
   */
  async listQuestions(): Promise<SurveyQuestionDto[]> {
    return unwrap(await apiClient.get<ApiResponse<SurveyQuestionDto[]>>('/surveys/questions'));
  },

  async createQuestion(payload: CreateSurveyQuestionInput): Promise<SurveyQuestionDto> {
    return unwrap(
      await apiClient.post<ApiResponse<SurveyQuestionDto>>('/surveys/questions', payload),
    );
  },

  async updateQuestion(
    questionId: string,
    payload: UpdateSurveyQuestionInput,
  ): Promise<SurveyQuestionDto> {
    return unwrap(
      await apiClient.patch<ApiResponse<SurveyQuestionDto>>(
        `/surveys/questions/${questionId}`,
        payload,
      ),
    );
  },

  /** Refused by the server once any response references the question. */
  async deleteQuestion(questionId: string): Promise<void> {
    await apiClient.delete(`/surveys/questions/${questionId}`);
  },

  /**
   * Restates the whole order, and gets the whole catalogue back.
   *
   * The ids are sent as a list rather than as one moved question with a new position,
   * because a position is only meaningful against the order everything else is in: two
   * admins renumbering at once would otherwise each be right about their own row and wrong
   * about the list.
   */
  async reorderQuestions(payload: ReorderSurveyQuestionsInput): Promise<SurveyQuestionDto[]> {
    return unwrap(
      await apiClient.post<ApiResponse<SurveyQuestionDto[]>>(
        '/surveys/questions/reorder',
        payload,
      ),
    );
  },

  async results(query: SurveyResultsQuery = {}): Promise<SurveyResultsDto> {
    return unwrap(
      await apiClient.get<ApiResponse<SurveyResultsDto>>('/surveys/results', {
        params: toParams(query as Record<string, unknown>),
      }),
    );
  },

  async listResponses(
    query: SurveyResponseListQuery = {},
  ): Promise<PaginatedData<SurveyResponseDto>> {
    return unwrap(
      await apiClient.get<ApiResponse<PaginatedData<SurveyResponseDto>>>('/surveys/responses', {
        params: toParams(query as Record<string, unknown>),
      }),
    );
  },
};
