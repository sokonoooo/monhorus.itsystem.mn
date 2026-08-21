import type {
  DispatchCandidateDto,
  PlannedWorkAvailableActionDto,
  PlannedWorkDto,
} from '@monhorus/shared';
import { useEffect, useState, type ReactElement } from 'react';

import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { Modal } from '../../components/ui/Modal';
import { useToast } from '../../components/ui/ToastProvider';
import { FIELD_TEXTAREA, FILTER_LABEL } from '../../components/ui/control-styles';
import { ApiError } from '../../lib/api-client';
import { plannedWorkService } from '../../services/planned-work.service';
import { portalService } from '../../services/portal.service';
import { dispatchService } from '../../services/service-request.service';
import type { PlannedWorkFormVariant } from './PlannedWorkFormPage';

interface TransitionActionsProps {
  work: PlannedWorkDto;
  onChanged: (work: PlannedWorkDto) => void;
  /**
   * Which console the buttons are rendered in.
   *
   * The portal reaches the same endpoint through its own client, and never opens the crew
   * picker: APPROVE is the only action that assigns, no customer holds the approve key, so
   * the action never appears in a customer's list in the first place.
   */
  variant?: PlannedWorkFormVariant;
}

/**
 * Lifecycle action buttons.
 *
 * Every button is generated from `work.availableActions`, which the backend computes from
 * the transition matrix plus the caller's permissions. The client holds no copy of the
 * matrix, so it cannot offer an action the server would reject, and a permission change
 * takes effect on the next read. The same is true of the two dialogs below: an action asks
 * for a reason or a crew because the server said it needs one, not because of its name.
 */
export function TransitionActions({
  work,
  onChanged,
  variant = 'staff',
}: TransitionActionsProps): ReactElement {
  const isPortal = variant === 'portal';
  const { notify } = useToast();
  const [pending, setPending] = useState<PlannedWorkAvailableActionDto | null>(null);
  const [reason, setReason] = useState('');
  const [crew, setCrew] = useState<string[]>([]);
  const [candidates, setCandidates] = useState<DispatchCandidateDto[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const needsCrew = pending?.assignsCrew === true;

  // The roster, fetched only once an action that needs it is actually opened. It is behind
  // `dispatch.view`, and there is no reason to ask for it to render a row of buttons.
  useEffect(() => {
    if (!needsCrew || isPortal) return undefined;
    let cancelled = false;
    dispatchService
      .employeeCandidates({})
      .then((found) => {
        if (!cancelled) setCandidates(found);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [needsCrew, isPortal]);

  async function run(
    action: PlannedWorkAvailableActionDto,
    withReason: string | null,
    withCrew: readonly string[],
  ) {
    setSubmitting(true);
    setError(null);
    try {
      const updated = isPortal
        ? await portalService.transition(work.id, action.action, withReason)
        : await plannedWorkService.transition(work.id, action.action, withReason, withCrew);
      onChanged(updated);
      notify('Төлөв шинэчлэгдлээ.', 'success');
      setPending(null);
      setReason('');
      setCrew([]);
    } catch (caught) {
      const message =
        caught instanceof ApiError
          ? [caught.message, ...caught.issues.map((issue) => issue.message)].join(' ')
          : 'Гэнэтийн алдаа гарлаа.';
      // A dialog-carrying action keeps its dialog open so the message stays visible.
      if (action.requiresReason || action.assignsCrew) setError(message);
      else notify(message, 'error');
    } finally {
      setSubmitting(false);
    }
  }

  function start(action: PlannedWorkAvailableActionDto): void {
    if (action.requiresReason || action.assignsCrew) {
      setReason('');
      setCrew([]);
      setError(null);
      setPending(action);
      return;
    }
    void run(action, null, []);
  }

  const confirmDisabled = submitting || (needsCrew && crew.length === 0);

  return (
    <>
      {work.availableActions.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {work.availableActions.map((action) => (
            <Button
              key={action.action}
              variant={action.action === 'CANCEL' ? 'danger' : 'secondary'}
              size="sm"
              onClick={() => start(action)}
              disabled={submitting}
            >
              {action.label}
            </Button>
          ))}
        </div>
      )}

      <Modal
        open={pending !== null}
        title={pending ? `${pending.label}${needsCrew ? '' : ' - шалтгаан'}` : ''}
        onClose={() => setPending(null)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setPending(null)} disabled={submitting}>
              Хаах
            </Button>
            <Button
              variant={pending?.action === 'CANCEL' ? 'danger' : 'primary'}
              // An action that asks only for a crew sends no reason at all, rather than the
              // empty string its unused textarea would otherwise contribute.
              onClick={() =>
                pending && void run(pending, pending.requiresReason ? reason : null, crew)
              }
              loading={submitting}
              disabled={confirmDisabled}
            >
              Батлах
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          {error && <Alert variant="error">{error}</Alert>}

          {/*
            Approving and staffing are one decision, so the crew is chosen here rather than
            left to a later edit. The confirm button stays disabled until somebody is picked,
            because the server refuses the action outright without one.
          */}
          {needsCrew && (
            <fieldset aria-label="Хариуцах ажилтан">
              <p className="mb-2 text-xs font-medium text-slate-600">
                Батлахдаа гүйцэтгэх ажилтныг сонгоно уу.
              </p>
              <div className="grid max-h-52 grid-cols-1 gap-1 overflow-y-auto rounded-lg p-2 ring-1 ring-inset ring-slate-200 sm:grid-cols-2">
                {candidates.length === 0 && (
                  <p className="text-xs text-slate-500">Ажилтны мэдээлэл ачаалагдсангүй.</p>
                )}
                {candidates.map((employee) => (
                  <label
                    key={employee.id}
                    className="flex items-center gap-2 text-sm text-slate-700"
                  >
                    <input
                      type="checkbox"
                      checked={crew.includes(employee.id)}
                      onChange={(event) =>
                        setCrew((current) =>
                          event.target.checked
                            ? [...current, employee.id]
                            : current.filter((id) => id !== employee.id),
                        )
                      }
                      disabled={submitting}
                      className="h-4 w-4 rounded border-slate-300"
                    />
                    <span className="truncate">
                      {employee.lastName} {employee.firstName}
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
          )}

          {pending?.requiresReason && (
            <>
              <p className="text-sm text-slate-600">
                Энэ үйлдэлд шалтгаан бүртгэх шаардлагатай. Шалтгаан audit log-д хадгалагдана.
              </p>
              <div>
                <label htmlFor="transition-reason" className={FILTER_LABEL}>
                  Шалтгаан
                </label>
                <textarea
                  id="transition-reason"
                  rows={3}
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                  disabled={submitting}
                  className={FIELD_TEXTAREA}
                />
              </div>
            </>
          )}
        </div>
      </Modal>
    </>
  );
}
