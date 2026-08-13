import {
  MATERIAL_UNIT_LABELS,
  type PlannedWorkDto,
  type PlannedWorkTaskDto,
} from '@monhorus/shared';
import { useCallback, useEffect, useState, type ReactElement } from 'react';
import { useNavigate, useParams } from 'react-router-dom';

import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { PageHeader } from '../../components/ui/PageHeader';
import { ErrorState, Skeleton } from '../../components/ui/States';
import { useToast } from '../../components/ui/ToastProvider';
import { ApiError } from '../../lib/api-client';
import { portalService } from '../../services/portal.service';
import {
  LateBadge,
  PlannedWorkStatusBadge,
  ProgressBar,
  TaskStatusBadge,
} from '../planned-work/PlannedWorkBadges';
import { groupTasksByFloor } from '../planned-work/PlannedWorkFloorSections';
import { TransitionActions } from '../planned-work/TransitionActions';
import { TaskFormDrawer } from '../planned-work/TaskFormDrawer';

function formatDate(iso: string | null): string {
  if (!iso) return '-';
  return new Date(iso).toLocaleDateString('mn-MN', { timeZone: 'Asia/Ulaanbaatar' });
}

function Row({ label, value }: { label: string; value: string }): ReactElement {
  return (
    <div>
      <dt className="text-xs font-medium text-slate-500">{label}</dt>
      <dd className="mt-0.5 text-sm text-slate-800">{value}</dd>
    </div>
  );
}

/**
 * One planned work, as its customer sees it.
 *
 * Shows where the request stands and nothing about how the company runs it. It renders no
 * crew, no pause history and no lifecycle actions — the staff detail screen exists for that
 * and is keyed on permissions no customer holds.
 *
 * THE SUB-TASK BREAKDOWN IS THE ONE THING THEY MAY EDIT, and only while the request is still
 * PENDING_APPROVAL. A customer describing the work they want is the point of the request;
 * once an approver has agreed to it the scope is settled, and the server starts refusing —
 * so the controls below disappear at exactly the moment the API stops accepting them. The
 * drawer is the staff `TaskFormDrawer` in its portal variant, not a second implementation.
 *
 * NOTE THE LIMIT THIS LEAVES: `GET /planned-work/:id` still SENDS the staff payload. The
 * omissions here are a presentation choice, not a boundary. Narrowing that DTO server-side
 * would be a further backend change and is deliberately not part of this one; it is worth
 * doing before the portal carries anything more sensitive than a work's own schedule.
 */
/**
 * The five stages a request passes through, in order.
 *
 * Deliberately fewer stages than the lifecycle has. PAUSED, OVERDUE and ARCHIVED are real
 * statuses but they are not *steps* — they say something about a stage rather than advancing
 * past one, and putting them in a row of arrows would suggest a request travels through them.
 * The badge and the alerts carry those; this answers only "how far along is it".
 */
const STAGES: readonly { key: string; label: string; reached: readonly string[] }[] = [
  { key: 'draft', label: 'Ноорог', reached: ['DRAFT', 'REJECTED'] },
  { key: 'pending', label: 'Хүлээгдэж буй', reached: ['PENDING_APPROVAL'] },
  { key: 'planned', label: 'Батлагдсан', reached: ['PLANNED'] },
  { key: 'started', label: 'Хэрэгжиж байна', reached: ['STARTED', 'PAUSED'] },
  { key: 'done', label: 'Дууссан', reached: ['COMPLETED', 'ARCHIVED'] },
];

/**
 * Where the request has got to.
 *
 * A customer's first question on opening one of these is not what its status is called, it
 * is whether anything is expected of them. A row of stages answers that in one glance in a
 * way a single chip cannot: it shows what has already happened and what comes next.
 *
 * A returned request is drawn back at the first stage, because that is exactly where it is —
 * the work of correcting and resubmitting is all still to do.
 */
function StatusTrail({ status }: { status: string }): ReactElement | null {
  // A cancelled request never reaches an end stage; the alert above already explains it, and
  // a trail frozen mid-way would read as "still in progress".
  if (status === 'CANCELLED') return null;

  const currentIndex = STAGES.findIndex((stage) => stage.reached.includes(status));
  const returned = status === 'REJECTED';

  return (
    <div className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
      <ol className="flex flex-wrap items-center gap-x-2 gap-y-2" aria-label="Явц">
      {STAGES.map((stage, index) => {
        const done = currentIndex >= 0 && index < currentIndex;
        const current = index === currentIndex;
        const tone = current
          ? returned
            ? 'bg-red-600 text-white ring-red-600'
            : 'bg-blue-600 text-white ring-blue-600'
          : done
            ? 'bg-blue-50 text-blue-700 ring-blue-200'
            : 'bg-white text-slate-400 ring-slate-200';
        return (
          <li key={stage.key} className="flex items-center gap-2">
            <span
              aria-current={current ? 'step' : undefined}
              className={`rounded-full px-3 py-1 text-xs font-medium ring-1 ring-inset ${tone}`}
            >
              {stage.label}
            </span>
            {index < STAGES.length - 1 && <span className="text-slate-300">→</span>}
          </li>
          );
        })}
      </ol>
    </div>
  );
}

export function PortalPlannedWorkDetailPage(): ReactElement {
  const { plannedWorkId } = useParams<{ plannedWorkId: string }>();
  const navigate = useNavigate();
  const detailPath = `/portal/planned-work/${plannedWorkId ?? ''}`;

  const { notify } = useToast();

  const [work, setWork] = useState<PlannedWorkDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  /** An existing sub-task, the literal 'new', or null when the drawer is closed. */
  const [taskTarget, setTaskTarget] = useState<PlannedWorkTaskDto | null | 'new'>(null);
  const [removingTaskId, setRemovingTaskId] = useState<string | null>(null);

  const load = useCallback(async (): Promise<void> => {
    if (!plannedWorkId) return;
    setLoading(true);
    setError(null);
    try {
      setWork(await portalService.getPlannedWork(plannedWorkId));
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Ажил ачаалж чадсангүй.');
    } finally {
      setLoading(false);
    }
  }, [plannedWorkId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-8 w-72" />
        <Skeleton className="h-56 w-full" />
      </div>
    );
  }

  if (error || !work) {
    return (
      <ErrorState
        description={error ?? 'Ажил олдсонгүй.'}
        action={<Button onClick={() => void load()}>Дахин оролдох</Button>}
      />
    );
  }

  // Defaulted rather than assumed present: a work with no sub-tasks yet — which every
  // freshly raised request is — must render its status, not throw on an absent array.
  const floorGroups = groupTasksByFloor(work.tasks ?? [], work.floorProgress ?? []);

  /**
   * Whether the request is still the customer's to shape.
   *
   * Mirrors `CREATOR_EDITABLE_STATUSES` server-side so the UI offers nothing that would be
   * refused. It is mirrored, not enforced — `findRawForOwnerEdit` and `findRawForTaskWrite`
   * are what actually decide. Submitting hands it over; a returned request comes back.
   */
  const canEdit = work.lifecycleStatus === 'DRAFT' || work.lifecycleStatus === 'REJECTED';

  async function removeTask(taskId: string): Promise<void> {
    if (!work) return;
    setRemovingTaskId(taskId);
    try {
      setWork(await portalService.deleteTask(work.id, taskId));
      notify('Дэд ажил устгагдлаа.', 'success');
    } catch (caught) {
      notify(
        caught instanceof ApiError ? caught.message : 'Дэд ажил устгаж чадсангүй.',
        'error',
      );
    } finally {
      setRemovingTaskId(null);
    }
  }

  return (
    <>
      <PageHeader
        title={work.title}
        description={work.workNumber}
        backTo={{ to: '/portal/planned-work', label: 'Төлөвлөгөөт ажил руу буцах' }}
        breadcrumbs={[
          { label: 'Нүүр', to: '/portal' },
          { label: 'Төлөвлөгөөт ажил', to: '/portal/planned-work' },
          { label: work.workNumber },
        ]}
      />

      <div className="space-y-4">
        <StatusTrail status={work.lifecycleStatus} />

        {/*
          The states a customer acts on. Each says who is waiting on whom, rather than
          leaving them to infer it from a coloured chip.
        */}
        {work.lifecycleStatus === 'DRAFT' && (
          <Alert variant="info" title="Илгээгээгүй байна">
            Энэ хүсэлт хараахан илгээгдээгүй. Мэдээллээ гүйцээж, дэд ажлуудаа оруулаад
            «Төлөвлөх» дарж батлуулахаар илгээнэ үү.
          </Alert>
        )}

        {/*
          A returned request, with the objection it came back with. This is the one state
          where the customer is the person holding things up, so the reason is shown as the
          headline rather than buried among the facts below.
        */}
        {work.lifecycleStatus === 'REJECTED' && (
          <Alert variant="error" title="Буцаагдсан — засаад дахин илгээнэ үү">
            {work.cancelReason ?? 'Шалтгаан бүртгэгдээгүй байна.'}
          </Alert>
        )}

        {work.lifecycleStatus === 'PENDING_APPROVAL' && (
          <Alert variant="warning" title="Батлахыг хүлээж байна">
            Хүсэлт хүлээн авсан. Эрх бүхий ажилтан хянаж байна — батлагдсаны дараа гүйцэтгэх
            ажилтан томилогдож, товлосон хугацаа баталгаажна.
          </Alert>
        )}

        {work.lifecycleStatus === 'CANCELLED' && (
          <Alert variant="error" title="Цуцлагдсан">
            {work.cancelReason ?? 'Энэ ажил цуцлагдсан байна.'}
          </Alert>
        )}

        {work.lifecycleStatus === 'PLANNED' && (
          <Alert variant="success" title="Батлагдсан">
            Ажил батлагдаж, төлөвлөгөөнд орлоо.
          </Alert>
        )}

        {/*
          The creator's own actions. «Төлөвлөх» is rendered by the SAME component the staff
          detail uses, from the server's `availableActions` — so the customer cannot be
          offered a transition the server would refuse, and gains any future one for free.
        */}
        {canEdit && (
          <div className="flex flex-wrap items-center gap-2 rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
            <Button size="sm" variant="secondary" onClick={() => navigate(`${detailPath}/edit`)}>
              Засах
            </Button>
            <TransitionActions work={work} variant="portal" onChanged={setWork} />
          </div>
        )}

        <div className="rounded-xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
          <div className="mb-4">
            <PlannedWorkStatusBadge status={work.effectiveStatus} />
            {work.completedLate && <LateBadge delayMinutes={work.delayMinutes} />}
          </div>

          <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
            <Row label="Барилга" value={work.building?.name ?? '-'} />
            <Row label="Төсөл" value={work.project?.name ?? '-'} />
            <Row label="Эхлэх" value={formatDate(work.plannedStartDate)} />
            <Row label="Дуусах" value={formatDate(work.plannedEndDate)} />
            <Row label="Илгээсэн" value={formatDate(work.createdAt)} />
          </dl>

          {work.description && (
            <div className="mt-4">
              <p className="text-xs font-medium text-slate-500">Тайлбар</p>
              <p className="mt-0.5 whitespace-pre-wrap text-sm text-slate-800">
                {work.description}
              </p>
            </div>
          )}

          <div className="mt-4">
            <p className="mb-1 text-xs font-medium text-slate-500">Биелэлт</p>
            <ProgressBar
              percent={work.progressPercent}
              completedQuantity={work.completedQuantity}
              totalQuantity={work.totalQuantity}
            />
          </div>
        </div>

        {/*
          The work breakdown, floor by floor, exactly as the staff detail groups it —
          `groupTasksByFloor` is imported rather than reimplemented so the two cannot order
          or bucket things differently.

          WHAT IS OMITTED, AND WHY. Each `PlannedWorkTaskDto` also carries
          `assignedEmployeeName`, `conclusionByName` and the technician's working note. None
          of it is rendered: the customer is being shown WHAT is being done and how far along
          it is, not who is doing it or what they wrote to each other on the way. The signed
          conclusion reaches them through the approved report instead.
        */}
        {(floorGroups.length > 0 || canEdit) && (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-3">
              <h2 className="text-sm font-semibold text-slate-900">Ажлын задаргаа</h2>
              {canEdit && (
                <Button size="sm" className="ml-auto" onClick={() => setTaskTarget('new')}>
                  Дэд ажил нэмэх
                </Button>
              )}
            </div>

            {/*
              A pending request with no breakdown is the normal starting state, not an error.
              It is also the state that stops the work being completed later, so it is said
              plainly rather than left as an empty panel.
            */}
            {floorGroups.length === 0 && canEdit && (
              <Alert variant="info">
                Хийгдэх ажлуудаа дэд ажил болгон задалж оруулна уу. Батлагдсаны дараа
                задаргааг өөрчлөх боломжгүй.
              </Alert>
            )}
            {floorGroups.map((group) => (
              <div
                key={group.key}
                className="overflow-hidden rounded-xl bg-white shadow-sm ring-1 ring-slate-200"
              >
                <div className="flex flex-wrap items-center gap-3 border-b border-slate-200 px-5 py-3">
                  <h2 className="text-sm font-semibold text-slate-900">{group.name}</h2>
                  <span className="text-xs text-slate-500">{group.tasks.length} дэд ажил</span>
                  {group.progress && (
                    <div className="ml-auto">
                      <ProgressBar
                        percent={group.progress.progressPercent}
                        completedQuantity={group.progress.completedQuantity}
                        totalQuantity={group.progress.totalQuantity}
                      />
                    </div>
                  )}
                </div>

                <ul className="divide-y divide-slate-100">
                  {group.tasks.map((task) => (
                    <li key={task.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-slate-900">
                          {task.title}
                        </p>
                        <p className="text-xs text-slate-500">
                          {formatDate(task.plannedStartDate)} — {formatDate(task.plannedEndDate)}
                        </p>
                      </div>
                      <TaskStatusBadge status={task.status} />
                      <div className="w-40">
                        <ProgressBar
                          percent={task.progressPercent}
                          completedQuantity={task.completedQuantity}
                          totalQuantity={task.totalQuantity}
                        />
                      </div>
                      {canEdit && (
                        <div className="flex items-center gap-1">
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => setTaskTarget(task)}
                          >
                            Засах
                          </Button>
                          <Button
                            size="sm"
                            variant="secondary"
                            loading={removingTaskId === task.id}
                            onClick={() => void removeTask(task.id)}
                          >
                            Устгах
                          </Button>
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}

        {/*
          Materials, read-only. The admin page puts an "edit" button beside this; there is
          none here because `PUT /planned-work/:id/materials` is keyed on `planned_work.update`,
          which no customer holds. The sub-task routes above are the only planned-work writes
          widened to a portal key, so a button here would be an offer the server refuses.
        */}
        {(work.materials ?? []).length > 0 && (
          <div className="overflow-hidden rounded-xl bg-white shadow-sm ring-1 ring-slate-200">
            <div className="border-b border-slate-200 px-5 py-3">
              <h2 className="text-sm font-semibold text-slate-900">Төлөвлөсөн материал</h2>
            </div>
            <ul className="divide-y divide-slate-100">
              {(work.materials ?? []).map((material) => (
                <li
                  key={`${material.name}-${material.unit}`}
                  className="flex items-center justify-between gap-3 px-5 py-2.5"
                >
                  <span className="truncate text-sm text-slate-800">{material.name}</span>
                  <span className="shrink-0 text-sm text-slate-600">
                    {material.quantity} {MATERIAL_UNIT_LABELS[material.unit]}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/*
          The conclusion, and only once it has been signed off.
          `visibleToCustomer` is the server's own answer to that question — it is
          `status === 'APPROVED'` — so the gate is read from the record rather than
          re-derived here. The actor stamps on the report carry user ids and staff names and
          are deliberately not rendered.
        */}
        <div className="rounded-xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
          <h2 className="mb-2 text-sm font-semibold text-slate-900">Тайлан</h2>

          {!work.report?.visibleToCustomer ? (
            <p className="text-sm text-slate-600">
              Ажил дуусаж, тайлан батлагдсаны дараа энд харагдана.
            </p>
          ) : (
            <div className="space-y-3">
              {work.report.conclusion && (
                <div>
                  <p className="text-xs font-medium text-slate-500">Дүгнэлт</p>
                  <p className="mt-0.5 whitespace-pre-wrap text-sm text-slate-800">
                    {work.report.conclusion}
                  </p>
                </div>
              )}
              {work.report.recommendation && (
                <div>
                  <p className="text-xs font-medium text-slate-500">Зөвлөмж</p>
                  <p className="mt-0.5 whitespace-pre-wrap text-sm text-slate-800">
                    {work.report.recommendation}
                  </p>
                </div>
              )}
              {!work.report.conclusion && !work.report.recommendation && (
                <p className="text-sm text-slate-600">Тайлангийн бичвэр оруулаагүй байна.</p>
              )}
            </div>
          )}
        </div>
      </div>

      {/* The staff drawer in its portal variant — no assignee control, floors from `/floors`. */}
      {taskTarget !== null && (
        <TaskFormDrawer
          work={work}
          target={taskTarget}
          variant="portal"
          onClose={() => setTaskTarget(null)}
          onSaved={(updated) => {
            setWork(updated);
            setTaskTarget(null);
          }}
        />
      )}
    </>
  );
}
