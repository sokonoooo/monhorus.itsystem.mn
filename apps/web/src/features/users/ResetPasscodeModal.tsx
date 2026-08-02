import type { ResetPasscodeResponse } from '@monhorus/shared';
import { useState, type FormEvent, type ReactElement } from 'react';

import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Modal } from '../../components/ui/Modal';
import { ApiError } from '../../lib/api-client';
import { generatePasscode } from '../../lib/passcode';
import { userService } from '../../services/user.service';

/**
 * The account this modal is resetting.
 *
 * Deliberately narrower than `UserDto`, which is all this ever used. The employee
 * screen reaches the same modal holding an `EmployeeSystemAccessDto` — a different type
 * carrying these three fields under these three names — and widening the prop is what
 * lets both screens share one implementation of a security-sensitive action instead of
 * growing a second copy. `UserDto` still satisfies this structurally, so the users page
 * passes its rows through unchanged.
 */
export interface PasscodeResetTarget {
  id: string;
  fullName: string;
  email: string;
}

interface ResetPasscodeModalProps {
  target: PasscodeResetTarget | null;
  onClose: () => void;
  onReset: () => void;
}

/**
 * Administrative passcode reset, the only recovery path in V1. The copy makes both
 * side effects explicit: the target is signed out everywhere, and must change the
 * passcode at next login.
 */
export function ResetPasscodeModal({
  target,
  onClose,
  onReset,
}: ResetPasscodeModalProps): ReactElement | null {
  const [newPassword, setNewPassword] = useState(generatePasscode);
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [result, setResult] = useState<ResetPasscodeResponse | null>(null);

  if (!target) return null;

  function handleClose(): void {
    setNewPassword(generatePasscode());
    setReason('');
    setFormError(null);
    setFieldErrors({});
    setResult(null);
    onClose();
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!target) return;

    setSubmitting(true);
    setFormError(null);
    setFieldErrors({});

    try {
      const response = await userService.resetPasscode(target.id, {
        newPassword,
        ...(reason.trim() ? { reason: reason.trim() } : {}),
      });
      setResult(response);
      onReset();
    } catch (error) {
      if (error instanceof ApiError) {
        setFormError(error.message);
        setFieldErrors(error.fieldErrors);
      } else {
        setFormError('Гэнэтийн алдаа гарлаа.');
      }
    } finally {
      setSubmitting(false);
    }
  }

  if (result) {
    return (
      <Modal
        open
        title="Нууц үг шинэчлэгдлээ"
        onClose={handleClose}
        footer={<Button onClick={handleClose}>Хаах</Button>}
      >
        <div className="space-y-4">
          <Alert variant="success">
            <strong>{result.user.fullName}</strong>-ийн нууц үг шинэчлэгдэж, бүх идэвхтэй сесс
            цуцлагдлаа.
          </Alert>

          <div className="rounded-lg bg-slate-50 p-4 ring-1 ring-slate-200">
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
              Шинэ түр нууц үг
            </p>
            <p className="mt-1 select-all break-all font-mono text-base font-semibold text-slate-900">
              {result.temporaryPassword}
            </p>
            <button
              type="button"
              onClick={() => void navigator.clipboard.writeText(result.temporaryPassword)}
              className="mt-2 text-xs font-medium text-blue-600 hover:text-blue-700"
            >
              Хуулах
            </button>
          </div>

          <Alert variant="warning">
            Энэ нууц үг дахин харагдахгүй. Хэрэглэгч дараагийн нэвтрэлтээр заавал солино.
          </Alert>
        </div>
      </Modal>
    );
  }

  return (
    <Modal
      open
      title="Нууц үг шинэчлэх"
      onClose={handleClose}
      footer={
        <>
          <Button variant="secondary" onClick={handleClose} disabled={submitting}>
            Цуцлах
          </Button>
          <Button type="submit" form="reset-passcode-form" variant="danger" loading={submitting}>
            Шинэчлэх
          </Button>
        </>
      }
    >
      <form id="reset-passcode-form" onSubmit={handleSubmit} className="space-y-4" noValidate>
        {formError && <Alert variant="error">{formError}</Alert>}

        <div className="rounded-lg bg-slate-50 p-3 text-sm ring-1 ring-slate-200">
          <p className="font-medium text-slate-900">{target.fullName}</p>
          <p className="text-slate-600">{target.email}</p>
        </div>

        <Alert variant="warning" title="Энэ үйлдэл дараах үр дагавартай">
          Тухайн хэрэглэгчийн бүх идэвхтэй сесс цуцлагдаж, дараагийн нэвтрэлтээр нууц үгээ заавал
          солих шаардлагатай болно.
        </Alert>

        <div className="space-y-1.5">
          <Input
            label="Шинэ түр нууц үг"
            required
            value={newPassword}
            onChange={(event) => setNewPassword(event.target.value)}
            error={fieldErrors.newPassword}
            className="font-mono"
            disabled={submitting}
          />
          <button
            type="button"
            onClick={() => setNewPassword(generatePasscode())}
            className="text-xs font-medium text-blue-600 hover:text-blue-700"
            disabled={submitting}
          >
            Шинээр үүсгэх
          </button>
        </div>

        <Input
          label="Шалтгаан"
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          error={fieldErrors.reason}
          hint="Сонголттой. Audit log-д хадгалагдана."
          disabled={submitting}
        />
      </form>
    </Modal>
  );
}
