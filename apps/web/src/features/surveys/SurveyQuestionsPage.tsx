import {
  MAX_SURVEY_QUESTIONS,
  PERMISSIONS,
  SURVEY_QUESTION_TYPES,
  SURVEY_QUESTION_TYPE_HINTS,
  SURVEY_QUESTION_TYPE_LABELS,
  createSurveyQuestionSchema,
  type SurveyQuestionDto,
  type SurveyQuestionOptionDto,
  type SurveyQuestionType,
  type UpdateSurveyQuestionInput,
} from '@monhorus/shared';
import { useCallback, useEffect, useState, type ReactElement } from 'react';

import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { DataTable, type Column } from '../../components/ui/DataTable';
import { Drawer } from '../../components/ui/Drawer';
import { PageHeader } from '../../components/ui/PageHeader';
import { RowActions, type RowActionItem } from '../../components/ui/RowActions';
import { useToast } from '../../components/ui/ToastProvider';
import { useAuth } from '../../contexts/auth-context';
import { ApiError } from '../../lib/api-client';
import { surveyService } from '../../services/survey.service';
import { Field, SelectInput, TextInput } from '../employees/FormControls';
import { SurveyQuestionOptionsEditor } from './SurveyQuestionOptionsEditor';

/**
 * The question builder for the customer satisfaction survey (section 16).
 *
 * One question at a time in a drawer, one catalogue in the table behind it. The catalogue is
 * capped at MAX_SURVEY_QUESTIONS, so there is deliberately no pager: everything a reorder has
 * to see is on screen at once.
 */
function QuestionDrawer({
  target,
  onClose,
  onSaved,
}: {
  target: SurveyQuestionDto | null | 'new';
  onClose: () => void;
  onSaved: () => void;
}): ReactElement {
  const { notify } = useToast();
  const isNew = target === 'new';
  const existing = target !== null && target !== 'new' ? target : null;

  const [text, setText] = useState('');
  const [helpText, setHelpText] = useState('');
  const [type, setType] = useState<SurveyQuestionType>('RATING_1_5');
  const [options, setOptions] = useState<SurveyQuestionOptionDto[]>([]);
  const [isRequired, setIsRequired] = useState(true);
  const [isActive, setIsActive] = useState(true);

  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (target === null) return;
    setFormError(null);
    setFieldErrors({});

    if (existing) {
      setText(existing.text);
      setHelpText(existing.helpText ?? '');
      setType(existing.type);
      // Copied rather than referenced: the editor replaces rows wholesale, and holding the
      // list row's own objects would let an unsaved edit show up in the table behind.
      setOptions(existing.options.map((option) => ({ ...option })));
      setIsRequired(existing.isRequired);
      setIsActive(existing.isActive);
    } else {
      setText('');
      setHelpText('');
      setType('RATING_1_5');
      setOptions([]);
      setIsRequired(true);
      setIsActive(true);
    }
  }, [target, existing]);

  /**
   * Changing the type drops the choice list when the new type cannot carry one.
   *
   * The schema refuses options on anything but SINGLE_CHOICE, so leaving them behind would
   * hand the user a rejection for a dropdown change made two fields away from the message.
   */
  function changeType(next: SurveyQuestionType): void {
    setType(next);
    if (next !== 'SINGLE_CHOICE') setOptions([]);
  }

  async function handleSubmit(): Promise<void> {
    setFormError(null);
    setFieldErrors({});

    /*
      Validated with the CREATE schema on both paths, including edits.

      `updateSurveyQuestionSchema` is `.partial()` and carries no cross-field refinement — it
      cannot, because a patch that sends only `text` has no type to check the options
      against. This drawer always holds a whole question, so the whole question is what gets
      checked, and a one-option SINGLE_CHOICE is refused here rather than by a round trip.

      `isOverallScore` is fed in from the SAVED question and is never edited here. It is what
      makes "change the flagged question to Тийм / Үгүй" fail on `isOverallScore` with the
      shared schema's own words, instead of being accepted and then refused by the server.
    */
    const parsed = createSurveyQuestionSchema.safeParse({
      text: text.trim(),
      helpText: helpText.trim() || null,
      type,
      options,
      isRequired,
      isOverallScore: existing?.isOverallScore ?? false,
      isActive,
    });

    if (!parsed.success) {
      const errors: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path.join('.') || '_';
        if (!errors[key]) errors[key] = issue.message;
      }
      setFieldErrors(errors);
      setFormError('Оруулсан мэдээлэл шаардлага хангахгүй байна.');
      return;
    }

    setSubmitting(true);
    try {
      if (isNew) {
        await surveyService.createQuestion(parsed.data);
        notify('Асуулт нэмэгдлээ.', 'success');
      } else if (existing) {
        /*
          The overall-score flag is deliberately NOT in the update payload.

          Only one question may carry it and the server is what moves it, under a partial
          unique index. Re-stating it from a form would mean every save of every other
          question asserted "and I am not the overall score" — which is either a no-op or, if
          this is the flagged question, a silent way to clear the flag by editing its wording.
        */
        const { isOverallScore: _flag, ...payload } = parsed.data;
        await surveyService.updateQuestion(existing.id, payload as UpdateSurveyQuestionInput);
        notify('Асуулт шинэчлэгдлээ.', 'success');
      }
      onSaved();
    } catch (caught) {
      if (caught instanceof ApiError) {
        setFormError(caught.message);
        setFieldErrors(caught.fieldErrors);
      } else {
        setFormError('Гэнэтийн алдаа гарлаа.');
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Drawer
      open={target !== null}
      title={isNew ? 'Шинэ асуулт' : 'Асуулт засах'}
      width="lg"
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={submitting}>
            Цуцлах
          </Button>
          <Button onClick={() => void handleSubmit()} loading={submitting}>
            Хадгалах
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {formError && <Alert variant="error">{formError}</Alert>}

        <Field label="Асуулт" required error={fieldErrors.text}>
          <TextInput value={text} onChange={setText} disabled={submitting} />
        </Field>

        <Field
          label="Тайлбар"
          error={fieldErrors.helpText}
          hint="Асуултын доор жижиг үсгээр харагдана. Хоосон орхиж болно."
        >
          <TextInput value={helpText} onChange={setHelpText} disabled={submitting} />
        </Field>

        <Field
          label="Төрөл"
          required
          error={fieldErrors.type}
          hint={SURVEY_QUESTION_TYPE_HINTS[type]}
        >
          <SelectInput
            value={type}
            onChange={(value) => changeType(value as SurveyQuestionType)}
            options={SURVEY_QUESTION_TYPES.map((entry) => ({
              value: entry,
              label: SURVEY_QUESTION_TYPE_LABELS[entry],
            }))}
            disabled={submitting}
          />
        </Field>

        {fieldErrors.isOverallScore && (
          <Alert variant="error">{fieldErrors.isOverallScore}</Alert>
        )}

        <fieldset aria-label="Тохиргоо" className="space-y-2">
          <label className="flex items-start gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={isRequired}
              onChange={(event) => setIsRequired(event.target.checked)}
              disabled={submitting}
              className="mt-0.5 h-4 w-4 rounded border-slate-300"
            />
            <span>
              Заавал хариулна
              <span className="block text-xs text-slate-500">
                Идэвхгүй бол хэрэглэгч алгасаад судалгаагаа илгээж болно.
              </span>
            </span>
          </label>

          {!isNew && (
            <label className="flex items-start gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={isActive}
                onChange={(event) => setIsActive(event.target.checked)}
                disabled={submitting}
                className="mt-0.5 h-4 w-4 rounded border-slate-300"
              />
              <span>
                Идэвхтэй
                <span className="block text-xs text-slate-500">
                  Идэвхгүй асуултыг шинэ судалгаанд асуухаа болино. Өмнөх хариултууд хэвээр
                  үлдэж, дүнд тооцогдсоор байна.
                </span>
              </span>
            </label>
          )}
        </fieldset>

        {type === 'SINGLE_CHOICE' && (
          <SurveyQuestionOptionsEditor
            value={options}
            onChange={setOptions}
            disabled={submitting}
            /*
              Read off the SAVED question rather than off the editor's own state, so a value
              answers may already record stays fixed while a row added in this session stays
              editable. Empty for a new question, which nobody can have answered yet.
            */
            savedValues={new Set((existing?.options ?? []).map((option) => option.value))}
            fieldErrors={fieldErrors}
          />
        )}
      </div>
    </Drawer>
  );
}

export function SurveyQuestionsPage(): ReactElement {
  const { can } = useAuth();
  const { notify } = useToast();

  const canManage = can(PERMISSIONS.SURVEY_MANAGE_QUESTIONS);

  const [questions, setQuestions] = useState<SurveyQuestionDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [target, setTarget] = useState<SurveyQuestionDto | null | 'new'>(null);
  const [deleteTarget, setDeleteTarget] = useState<SurveyQuestionDto | null>(null);
  /**
   * A deletion the server refused, and what it said.
   *
   * Held rather than shown once and forgotten, because the refusal has a next step: a
   * question that has been answered can still be taken out of circulation by deactivating
   * it, which is what the reader was actually trying to achieve.
   */
  const [refusal, setRefusal] = useState<{ question: SurveyQuestionDto; message: string } | null>(
    null,
  );

  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      setQuestions(await surveyService.listQuestions());
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Асуулт ачаалж чадсангүй.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleDelete(): Promise<void> {
    if (!deleteTarget) return;
    const question = deleteTarget;
    try {
      await surveyService.deleteQuestion(question.id);
      notify('Асуулт устгагдлаа.', 'success');
      setDeleteTarget(null);
      await load();
    } catch (caught) {
      setDeleteTarget(null);
      // The server's own words, not a guess at them: it refuses a question with answers, and
      // may refuse for reasons this page does not know about.
      setRefusal({
        question,
        message: caught instanceof ApiError ? caught.message : 'Асуултыг устгаж чадсангүй.',
      });
    }
  }

  /** The way out of a refused deletion: stop asking it, keep what was already answered. */
  async function handleDeactivate(): Promise<void> {
    if (!refusal) return;
    const question = refusal.question;
    setRefusal(null);
    try {
      await surveyService.updateQuestion(question.id, { isActive: false });
      notify('Асуулт идэвхгүй боллоо.', 'success');
      await load();
    } catch (caught) {
      notify(
        caught instanceof ApiError ? caught.message : 'Идэвхгүй болгож чадсангүй.',
        'error',
      );
    }
  }

  /**
   * Moves a question one place and restates the WHOLE order.
   *
   * Never optimistic: the list on screen is replaced by what the server answers with, so a
   * rejected reorder cannot leave the table showing an order the catalogue is not in.
   */
  async function handleMove(index: number, direction: -1 | 1): Promise<void> {
    const swapWith = index + direction;
    if (swapWith < 0 || swapWith >= questions.length) return;

    const ids = questions.map((question) => question.id);
    const moved = ids[index]!;
    ids[index] = ids[swapWith]!;
    ids[swapWith] = moved;

    try {
      await surveyService.reorderQuestions({ questionIds: ids });
      await load();
    } catch (caught) {
      notify(caught instanceof ApiError ? caught.message : 'Дараалал өөрчилж чадсангүй.', 'error');
    }
  }

  /**
   * Hands the overall-score flag to one question.
   *
   * Only `true` is ever sent. Exactly one question may carry the flag, and the server moves
   * it under a partial unique index; clearing the previous holder from here would be a second
   * write that can fail on its own and leave the survey with no scored question at all.
   */
  async function handleSetOverallScore(question: SurveyQuestionDto): Promise<void> {
    try {
      await surveyService.updateQuestion(question.id, { isOverallScore: true });
      notify('Нийт үнэлгээний асуулт солигдлоо.', 'success');
      await load();
    } catch (caught) {
      notify(
        caught instanceof ApiError ? caught.message : 'Нийт үнэлгээг тохируулж чадсангүй.',
        'error',
      );
    }
  }

  const columns: ReadonlyArray<Column<SurveyQuestionDto>> = [
    {
      key: 'text',
      header: 'Асуулт',
      render: (row) => (
        <div className="min-w-0">
          <span className="block truncate font-medium text-slate-900">{row.text}</span>
          {row.helpText && (
            <span className="block truncate text-xs text-slate-500">{row.helpText}</span>
          )}
        </div>
      ),
    },
    {
      key: 'type',
      header: 'Төрөл',
      render: (row) => (
        <div className="min-w-0">
          <span className="whitespace-nowrap text-slate-700">
            {SURVEY_QUESTION_TYPE_LABELS[row.type]}
          </span>
          {row.type === 'SINGLE_CHOICE' && (
            <span className="block text-xs text-slate-500">{row.options.length} сонголт</span>
          )}
        </div>
      ),
    },
    {
      key: 'isOverallScore',
      header: 'Нийт үнэлгээ',
      align: 'center',
      /*
        A RADIO across the rows, not a checkbox per row.

        Only one question can be the overall score, and a checkbox says the opposite: it
        offers to tick a second one and then has to explain that it did not work. A radio
        group says "one of these" in the control itself. Non-rating rows are disabled rather
        than hidden, so the reason a question cannot be chosen stays visible.
      */
      render: (row) => (
        <input
          type="radio"
          name="survey-overall-score"
          checked={row.isOverallScore}
          disabled={!canManage || row.type !== 'RATING_1_5'}
          aria-label={`${row.text} — нийт үнэлгээ`}
          title={
            row.type === 'RATING_1_5'
              ? 'Энэ асуултын оноогоор ажилтны дундаж бодогдоно.'
              : 'Зөвхөн "1-5 үнэлгээ" төрлийн асуулт нийт үнэлгээ болно.'
          }
          onChange={() => void handleSetOverallScore(row)}
          className="h-4 w-4 border-slate-300 text-blue-600 disabled:opacity-30"
        />
      ),
    },
    {
      key: 'isRequired',
      header: 'Заавал',
      render: (row) =>
        row.isRequired ? (
          <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-700">Тийм</span>
        ) : (
          <span className="text-xs text-slate-400">Үгүй</span>
        ),
    },
    {
      key: 'isActive',
      header: 'Төлөв',
      render: (row) =>
        row.isActive ? (
          <span className="rounded bg-green-50 px-1.5 py-0.5 text-xs text-green-700">Идэвхтэй</span>
        ) : (
          <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-500">
            Идэвхгүй
          </span>
        ),
    },
    {
      key: 'hasAnswers',
      header: 'Хариулт',
      render: (row) =>
        row.hasAnswers ? (
          <span className="whitespace-nowrap text-xs text-slate-600">Бүртгэгдсэн</span>
        ) : (
          <span className="text-xs text-slate-400">Байхгүй</span>
        ),
    },
    {
      key: 'actions',
      header: 'Үйлдэл',
      align: 'right',
      render: (row) => {
        const items: RowActionItem[] = [];
        if (canManage) {
          const index = questions.findIndex((question) => question.id === row.id);
          items.push({ label: 'Засах', onSelect: () => setTarget(row) });
          items.push({
            label: 'Дээш',
            onSelect: () => void handleMove(index, -1),
            disabled: index <= 0,
            ...(index <= 0 ? { disabledReason: 'Эхний асуулт байна.' } : {}),
          });
          items.push({
            label: 'Доош',
            onSelect: () => void handleMove(index, 1),
            disabled: index === questions.length - 1,
            ...(index === questions.length - 1 ? { disabledReason: 'Сүүлийн асуулт байна.' } : {}),
          });
          /*
            Offered even where it is known to be refused, and the refusal is explained when it
            comes back. `hasAnswers` says which rows to expect it for, but the server is what
            actually decides — an answer can arrive between this render and the click.
          */
          items.push({
            label: 'Устгах',
            onSelect: () => setDeleteTarget(row),
            tone: 'danger',
          });
        }
        return <RowActions items={items} />;
      },
    },
  ];

  const activeCount = questions.filter((question) => question.isActive).length;
  const hasOverallScore = questions.some((question) => question.isOverallScore);

  return (
    <>
      <PageHeader
        title="Судалгааны асуулт"
        breadcrumbs={[{ label: 'Нүүр', to: '/dashboard' }, { label: 'Судалгааны асуулт' }]}
        actions={
          canManage && (
            <Button
              onClick={() => setTarget('new')}
              disabled={questions.length >= MAX_SURVEY_QUESTIONS}
            >
              Шинэ асуулт
            </Button>
          )
        }
      />

      <p className="mb-3 text-xs text-slate-500">
        Ажил дууссаны дараа харилцагчаас ажилтан тус бүрээр асуух асуултууд. Эндхийн дарааллаар
        харагдана. Нийт {questions.length} асуултаас {activeCount} нь идэвхтэй, дээд хязгаар{' '}
        {MAX_SURVEY_QUESTIONS}.
      </p>

      {!loading && !error && questions.length > 0 && !hasOverallScore && (
        <div className="mb-3">
          <Alert variant="warning">
            Нийт үнэлгээний асуулт сонгогдоогүй байна. Сонгох хүртэл ажилтны дундаж оноо
            бодогдохгүй.
          </Alert>
        </div>
      )}

      {!loading && !error && questions.length > 0 && activeCount === 0 && (
        <div className="mb-3">
          <Alert variant="warning">
            Идэвхтэй асуулт алга. Бүх асуулт идэвхгүй байхад шинэ судалгаа илгээгдэхгүй.
          </Alert>
        </div>
      )}

      <div className="overflow-hidden rounded-xl bg-white shadow-sm ring-1 ring-slate-200">
        {/* No pager: the catalogue is capped at twenty and a reorder has to see all of it. */}
        <DataTable
          columns={columns}
          rows={questions}
          rowKey={(row) => row.id}
          numbering
          loading={loading}
          error={error}
          onRetry={() => void load()}
          ariaLabel="Судалгааны асуулт"
          emptyTitle="Асуулт бүртгээгүй байна"
          emptyDescription="Асуулт нэмэх хүртэл харилцагчид судалгаа илгээгдэхгүй."
        />
      </div>

      <QuestionDrawer
        target={target}
        onClose={() => setTarget(null)}
        onSaved={() => {
          setTarget(null);
          void load();
        }}
      />

      <ConfirmDialog
        open={deleteTarget !== null}
        title="Асуулт устгах"
        message={
          deleteTarget?.hasAnswers
            ? `"${deleteTarget.text}" асуултад хариулт бүртгэгдсэн тул устгах хүсэлтийг сервер татгалзаж магадгүй. Үргэлжлүүлэх үү?`
            : `"${deleteTarget?.text ?? ''}" асуултыг устгах уу?`
        }
        confirmLabel="Устгах"
        danger
        onCancel={() => setDeleteTarget(null)}
        onConfirm={() => handleDelete()}
      />

      <ConfirmDialog
        open={refusal !== null}
        title="Устгах боломжгүй"
        message={`${refusal?.message ?? ''} Оронд нь идэвхгүй болговол шинэ судалгаанд асуухаа болих бөгөөд өмнөх хариултууд хэвээр үлдэнэ.`}
        confirmLabel="Идэвхгүй болгох"
        cancelLabel="Хаах"
        onCancel={() => setRefusal(null)}
        onConfirm={() => handleDeactivate()}
      />
    </>
  );
}
