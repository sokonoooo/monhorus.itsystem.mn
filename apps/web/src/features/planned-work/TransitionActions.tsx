import type { PlannedWorkAvailableActionDto, PlannedWorkDto } from '@monhorus/shared';
import { useState, type ReactElement } from 'react';

import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { Modal } from '../../components/ui/Modal';
import { useToast } from '../../components/ui/ToastProvider';
import { FIELD_TEXTAREA, FILTER_LABEL } from '../../components/ui/control-styles';
import { ApiError } from '../../lib/api-client';
import { plannedWorkService } from '../../services/planned-work.service';

interface TransitionActionsProps {
  work: PlannedWorkDto;
  onChanged: (work: PlannedWorkDto) => void;
}

/**
 * Lifecycle action buttons.
 *
 * Every button is generated from `work.availableActions`, which the backend computes from
 * the transition matrix plus the caller's permissions. The client holds no copy of the
 * matrix, so it cannot offer an action the server would reject, and a permission change
 * takes effect on the next read.
 */
export function TransitionActions({ work, onChanged }: TransitionActionsProps): ReactElement {
  const { notify } = useToast();
  const [pending, setPending] = useState<PlannedWorkAvailableActionDto | null>(null);
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(action: PlannedWorkAvailableActionDto, withReason: string | null) {
    setSubmitting(true);
    setError(null);
    try {
      const updated = await plannedWorkService.transition(work.id, action.action, withReason);
      onChanged(updated);
      notify('Төлөв шинэчлэгдлээ.', 'success');
      setPending(null);
      setReason('');
    } catch (caught) {
      const message =
        caught instanceof ApiError
          ? [caught.message, ...caught.issues.map((issue) => issue.message)].join(' ')
          : 'Гэнэтийн алдаа гарлаа.';
      // A reason-carrying action keeps its dialog open so the message stays visible.
      if (action.requiresReason) setError(message);
      else notify(message, 'error');
    } finally {
      setSubmitting(false);
    }
  }

  function start(action: PlannedWorkAvailableActionDto): void {
    if (action.requiresReason) {
      setReason('');
      setError(null);
      setPending(action);
      return;
    }
    void run(action, null);
  }

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
        title={pending ? `${pending.label} - шалтгаан` : ''}
        onClose={() => setPending(null)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setPending(null)} disabled={submitting}>
              Хаах
            </Button>
            <Button
              variant={pending?.action === 'CANCEL' ? 'danger' : 'primary'}
              onClick={() => pending && void run(pending, reason)}
              loading={submitting}
            >
              Батлах
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          {error && <Alert variant="error">{error}</Alert>}
          <p className="text-sm text-slate-600">
            Энэ үйлдэлд шалтгаан бүртгэх шаардлагатай. Шалтгаан audit log-д хадгалагдана.
          </p>
          <div>
            <label
              htmlFor="transition-reason"
              className={FILTER_LABEL}
            >
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
        </div>
      </Modal>
    </>
  );
}
