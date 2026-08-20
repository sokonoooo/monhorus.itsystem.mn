import { PERMISSIONS, type SurveyQuestionDto } from '@monhorus/shared';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiError } from '../../lib/api-client';
import { surveyService } from '../../services/survey.service';
import { renderWithAuth } from '../../test/render';
import { SurveyQuestionsPage } from './SurveyQuestionsPage';

function makeQuestion(overrides: Partial<SurveyQuestionDto> = {}): SurveyQuestionDto {
  return {
    id: 'q1',
    text: 'Ажилтны ур чадварыг үнэлнэ үү',
    helpText: null,
    type: 'RATING_1_5',
    options: [],
    isRequired: true,
    isOverallScore: true,
    isActive: true,
    sortOrder: 1,
    hasAnswers: false,
    ...overrides,
  };
}

const ADMIN = [PERMISSIONS.SURVEY_MANAGE_QUESTIONS];

describe('SurveyQuestionsPage', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('lists the catalogue with its type and overall-score flag', async () => {
    vi.spyOn(surveyService, 'listQuestions').mockResolvedValue([
      makeQuestion(),
      makeQuestion({ id: 'q2', text: 'Цаг тухайд нь ирсэн үү?', type: 'YES_NO', isOverallScore: false }),
    ]);

    renderWithAuth(<SurveyQuestionsPage />, { permissions: ADMIN });

    expect(await screen.findByText('Ажилтны ур чадварыг үнэлнэ үү')).toBeInTheDocument();
    const table = screen.getByRole('table');
    expect(within(table).getByText('1-5 үнэлгээ')).toBeInTheDocument();
    expect(within(table).getByText('Тийм / Үгүй')).toBeInTheDocument();

    // The flag is a radio group across the rows, not a checkbox per row: only one question
    // can carry it, and a checkbox would offer to tick a second.
    const flag = screen.getByRole('radio', { name: 'Ажилтны ур чадварыг үнэлнэ үү — нийт үнэлгээ' });
    expect(flag).toBeChecked();

    // A yes/no question cannot be the overall score - there would be nothing to average.
    expect(screen.getByRole('radio', { name: 'Цаг тухайд нь ирсэн үү? — нийт үнэлгээ' })).toBeDisabled();
  });

  /** The server owns the move; the page never clears the previous holder itself. */
  it('hands the overall score to another rating question with a single true', async () => {
    vi.spyOn(surveyService, 'listQuestions').mockResolvedValue([
      makeQuestion(),
      makeQuestion({ id: 'q2', text: 'Ажлын чанар', isOverallScore: false }),
    ]);
    const update = vi.spyOn(surveyService, 'updateQuestion').mockResolvedValue(makeQuestion());
    const user = userEvent.setup();

    renderWithAuth(<SurveyQuestionsPage />, { permissions: ADMIN });
    await screen.findByText('Ажлын чанар');

    await user.click(screen.getByRole('radio', { name: 'Ажлын чанар — нийт үнэлгээ' }));

    await waitFor(() => expect(update).toHaveBeenCalledWith('q2', { isOverallScore: true }));
    expect(update).toHaveBeenCalledTimes(1);
  });

  it('refuses a single-choice question with one option without calling the server', async () => {
    vi.spyOn(surveyService, 'listQuestions').mockResolvedValue([]);
    const create = vi.spyOn(surveyService, 'createQuestion').mockResolvedValue(makeQuestion());
    const user = userEvent.setup();

    renderWithAuth(<SurveyQuestionsPage />, { permissions: ADMIN });

    await user.click(await screen.findByRole('button', { name: 'Шинэ асуулт' }));
    const drawer = await screen.findByRole('dialog');

    await user.type(within(drawer).getByLabelText(/^Асуулт/), 'Ажилтан хэрхэн ирсэн бэ?');
    await user.selectOptions(within(drawer).getByLabelText(/^Төрөл/), 'SINGLE_CHOICE');
    await user.click(within(drawer).getByRole('button', { name: 'Сонголт нэмэх' }));
    await user.type(within(drawer).getByLabelText('Сонголт 1 нэр'), 'Цагтаа');

    await user.click(within(drawer).getByRole('button', { name: 'Хадгалах' }));

    expect(await within(drawer).findByText('Дор хаяж хоёр сонголт оруулна.')).toBeInTheDocument();
    expect(create).not.toHaveBeenCalled();
  });

  /**
   * Editing must never restate the overall-score flag. Re-sending it from a form is either a
   * no-op or, on the flagged question, a silent way to clear it by fixing a typo.
   */
  it('saves an edit without touching the overall-score flag', async () => {
    vi.spyOn(surveyService, 'listQuestions').mockResolvedValue([makeQuestion()]);
    const update = vi.spyOn(surveyService, 'updateQuestion').mockResolvedValue(makeQuestion());
    const user = userEvent.setup();

    renderWithAuth(<SurveyQuestionsPage />, { permissions: ADMIN });
    await screen.findByText('Ажилтны ур чадварыг үнэлнэ үү');

    await user.click(within(screen.getByRole('table')).getByRole('button', { name: 'Үйлдэл' }));
    await user.click(screen.getByRole('menuitem', { name: 'Засах' }));

    const drawer = await screen.findByRole('dialog');
    await user.type(within(drawer).getByLabelText(/^Тайлбар/), 'Эелдэг байдал');
    await user.click(within(drawer).getByRole('button', { name: 'Хадгалах' }));

    await waitFor(() => expect(update).toHaveBeenCalled());
    expect(update.mock.calls[0]?.[1]).not.toHaveProperty('isOverallScore');
    expect(update.mock.calls[0]?.[1]).toMatchObject({ helpText: 'Эелдэг байдал' });
  });

  it('surfaces the server refusal to delete an answered question and offers deactivation', async () => {
    vi.spyOn(surveyService, 'listQuestions').mockResolvedValue([
      makeQuestion({ hasAnswers: true, isOverallScore: false }),
    ]);
    vi.spyOn(surveyService, 'deleteQuestion').mockRejectedValue(
      new ApiError('Хариулт бүртгэгдсэн асуултыг устгах боломжгүй.', 'CONFLICT', 409),
    );
    const update = vi.spyOn(surveyService, 'updateQuestion').mockResolvedValue(makeQuestion());
    const user = userEvent.setup();

    renderWithAuth(<SurveyQuestionsPage />, { permissions: ADMIN });
    await screen.findByText('Ажилтны ур чадварыг үнэлнэ үү');

    await user.click(within(screen.getByRole('table')).getByRole('button', { name: 'Үйлдэл' }));
    await user.click(screen.getByRole('menuitem', { name: 'Устгах' }));
    await user.click(screen.getByRole('button', { name: 'Устгах' }));

    // The server's own words, and a way forward rather than a dead end.
    expect(
      await screen.findByText(/Хариулт бүртгэгдсэн асуултыг устгах боломжгүй\./),
    ).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Идэвхгүй болгох' }));
    await waitFor(() => expect(update).toHaveBeenCalledWith('q1', { isActive: false }));
  });

  it('restates the whole order when a question is moved', async () => {
    vi.spyOn(surveyService, 'listQuestions').mockResolvedValue([
      makeQuestion(),
      makeQuestion({ id: 'q2', text: 'Ажлын чанар', isOverallScore: false }),
    ]);
    const reorder = vi.spyOn(surveyService, 'reorderQuestions').mockResolvedValue([]);
    const user = userEvent.setup();

    renderWithAuth(<SurveyQuestionsPage />, { permissions: ADMIN });
    await screen.findByText('Ажлын чанар');

    const menus = within(screen.getByRole('table')).getAllByRole('button', { name: 'Үйлдэл' });
    await user.click(menus[1]!);
    await user.click(screen.getByRole('menuitem', { name: 'Дээш' }));

    await waitFor(() =>
      expect(reorder).toHaveBeenCalledWith({ questionIds: ['q2', 'q1'] }),
    );
  });

  it('offers no editing control without survey.manage_questions', async () => {
    vi.spyOn(surveyService, 'listQuestions').mockResolvedValue([makeQuestion()]);

    renderWithAuth(<SurveyQuestionsPage />, { permissions: [PERMISSIONS.SURVEY_VIEW_RESULTS] });
    await screen.findByText('Ажилтны ур чадварыг үнэлнэ үү');

    expect(screen.queryByRole('button', { name: 'Шинэ асуулт' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Үйлдэл' })).not.toBeInTheDocument();
    // The flag is still readable, just not movable.
    expect(
      screen.getByRole('radio', { name: 'Ажилтны ур чадварыг үнэлнэ үү — нийт үнэлгээ' }),
    ).toBeDisabled();
  });
});
