import { useState, type FormEvent, type ReactElement } from 'react';
import { useNavigate } from 'react-router-dom';

import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { useAuth } from '../../contexts/auth-context';
import { ApiError } from '../../lib/api-client';

export function ChangePasswordPage(): ReactElement {
  const { changePassword, mustChangePassword, user } = useAuth();
  const navigate = useNavigate();

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();

    if (newPassword !== confirmPassword) {
      setFieldErrors({ confirmPassword: 'Нууц үг таарахгүй байна.' });
      return;
    }

    setSubmitting(true);
    setFormError(null);
    setFieldErrors({});

    try {
      await changePassword(currentPassword, newPassword);
      // Every session was revoked server-side, so the user must sign in again.
      navigate('/login', {
        replace: true,
        state: { notice: 'Нууц үг амжилттай солигдлоо. Шинэ нууц үгээрээ нэвтэрнэ үү.' },
      });
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

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-100 px-4 py-12">
      <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-sm ring-1 ring-slate-200 sm:p-8">
        <h1 className="text-lg font-semibold text-slate-900">Нууц үг солих</h1>
        {user && <p className="mt-1 text-sm text-slate-600">{user.email}</p>}

        {mustChangePassword && (
          <div className="mt-4">
            <Alert variant="warning" title="Нууц үг солих шаардлагатай">
              Администратор танд түр нууц үг олгосон байна. Үргэлжлүүлэхийн тулд шинэ нууц үг
              тохируулна уу.
            </Alert>
          </div>
        )}

        <form onSubmit={handleSubmit} className="mt-6 space-y-4" noValidate>
          {formError && <Alert variant="error">{formError}</Alert>}

          <Input
            label="Одоогийн нууц үг"
            type="password"
            autoComplete="current-password"
            required
            value={currentPassword}
            onChange={(event) => setCurrentPassword(event.target.value)}
            error={fieldErrors.currentPassword}
            disabled={submitting}
          />
          <Input
            label="Шинэ нууц үг"
            type="password"
            autoComplete="new-password"
            required
            value={newPassword}
            onChange={(event) => setNewPassword(event.target.value)}
            error={fieldErrors.newPassword}
            hint="Дор хаяж 10 тэмдэгт, нэг үсэг, нэг тоо."
            disabled={submitting}
          />
          <Input
            label="Шинэ нууц үг давтах"
            type="password"
            autoComplete="new-password"
            required
            value={confirmPassword}
            onChange={(event) => setConfirmPassword(event.target.value)}
            error={fieldErrors.confirmPassword}
            disabled={submitting}
          />

          <Button type="submit" loading={submitting} className="w-full">
            Нууц үг солих
          </Button>
        </form>
      </div>
    </div>
  );
}
