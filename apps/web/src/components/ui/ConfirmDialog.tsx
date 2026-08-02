import { useState, type ReactElement } from 'react';

import { Button } from './Button';
import { Modal } from './Modal';

import { FILTER_INPUT } from './control-styles';

export interface ConfirmOptions {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  /** When set, the confirm button stays disabled until a reason is typed. */
  requireReason?: boolean;
  reasonLabel?: string;
}

interface ConfirmDialogProps extends ConfirmOptions {
  open: boolean;
  onCancel: () => void;
  onConfirm: (reason: string) => void | Promise<void>;
}

/**
 * Confirmation dialog with an optional mandatory reason.
 *
 * Several workflow transitions require a reason (requirements 8.3 and 14.1), and the
 * backend rejects the request without one, so the control is disabled until it is
 * supplied rather than letting the user discover the rule through a failed request.
 */
export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = 'Тийм',
  cancelLabel = 'Цуцлах',
  danger = false,
  requireReason = false,
  reasonLabel = 'Шалтгаан',
  onCancel,
  onConfirm,
}: ConfirmDialogProps): ReactElement {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  async function handleConfirm(): Promise<void> {
    setBusy(true);
    try {
      await onConfirm(reason.trim());
      setReason('');
    } finally {
      setBusy(false);
    }
  }

  function handleCancel(): void {
    setReason('');
    onCancel();
  }

  const blocked = requireReason && reason.trim().length === 0;

  return (
    <Modal
      open={open}
      title={title}
      onClose={handleCancel}
      footer={
        <>
          <Button variant="secondary" onClick={handleCancel} disabled={busy}>
            {cancelLabel}
          </Button>
          <Button
            variant={danger ? 'danger' : 'primary'}
            onClick={() => void handleConfirm()}
            loading={busy}
            disabled={blocked}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      <p className="text-sm text-slate-700">{message}</p>

      {requireReason && (
        <div className="mt-3">
          <label htmlFor="confirm-reason" className="mb-1 block text-xs font-medium text-slate-600">
            {reasonLabel}
            <span className="ml-0.5 text-red-600">*</span>
          </label>
          <textarea
            id="confirm-reason"
            rows={3}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            disabled={busy}
            className={FILTER_INPUT}
          />
          {blocked && <p className="mt-1 text-xs text-red-600">Шалтгаан заавал бөглөнө.</p>}
        </div>
      )}
    </Modal>
  );
}
