import { useState, type FormEvent, type ReactElement } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';

import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { ApiError } from '../../lib/api-client';
import { authService } from '../../services/auth.service';

/** Matches the backend's strongPasswordSchema, so the hint and the server agree. */
const PASSWORD_HINT = 'Дор хаяж 10 тэмдэгт, нэг үсэг, нэг тоо.';

/**
 * Setting a new password from an emailed link.
 *
 * The token is read from the URL and never shown or typed. It is not validated on arrival:
 * a link is checked when it is redeemed, so the reader is not told their link is dead until
 * they have committed to using it. Checking early would also mean a second endpoint whose
 * only job is to confirm that a token is live, which is a free oracle for anyone holding a
 * leaked one.
 */
export function ResetPasswordPage(): ReactElement {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();

  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setFormError(null);
    setFieldErrors({});

    // Checked here rather than server-side: the confirmation field exists to catch a typo,
    // and the server has no use for a second copy of the password.
    if (newPassword !== confirmPassword) {
      setFieldErrors({ confirmPassword: 'Нууц үг таарахгүй байна.' });
      return;
    }

    setSubmitting(true);
    try {
      await authService.resetPassword({ token: token ?? '', newPassword });
      // Success is carried to the login screen the same way a password change is, so there
      // is one place in the app that announces "now sign in with the new one".
      navigate('/login', {
        replace: true,
        state: { notice: 'Нууц үг шинэчлэгдлээ. Шинэ нууц үгээрээ нэвтэрнэ үү.' },
      });
    } catch (error) {
      if (error instanceof ApiError) {
        setFormError(error.message);
        setFieldErrors(error.fieldErrors);
      } else {
        setFormError('Гэнэтийн алдаа гарлаа. Дахин оролдоно уу.');
      }
      setSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-100 px-4 py-12">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">Monhorus</h1>
        </div>
        <div className="rounded-xl bg-white p-6 shadow-sm ring-1 ring-slate-200 sm:p-8">
          <h2 className="text-lg font-semibold text-slate-900">Шинэ нууц үг тохируулах</h2>
          <p className="mt-2 text-sm text-slate-600">
            Шинэ нууц үгээ оруулна уу. Тохируулсны дараа бүх төхөөрөмж дээрх сесс хаагдана.
          </p>

          <form onSubmit={handleSubmit} className="mt-6 space-y-4" noValidate>
            {formError && (
              <Alert variant="error">
                {formError}{' '}
                <Link to="/forgot-password" className="font-medium underline">
                  Дахин холбоос авах
                </Link>
              </Alert>
            )}

            <div className="relative">
              <Input
                label="Шинэ нууц үг"
                type={showPassword ? 'text' : 'password'}
                autoComplete="new-password"
                required
                value={newPassword}
                onChange={(event) => setNewPassword(event.target.value)}
                error={fieldErrors.newPassword}
                hint={PASSWORD_HINT}
                disabled={submitting}
              />
              <button
                type="button"
                onClick={() => setShowPassword((value) => !value)}
                className="absolute right-3 top-9 text-xs font-medium text-slate-500 hover:text-slate-700"
                tabIndex={-1}
              >
                {showPassword ? 'Нуух' : 'Харах'}
              </button>
            </div>

            <Input
              label="Шинэ нууц үг давтах"
              type={showPassword ? 'text' : 'password'}
              autoComplete="new-password"
              required
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              error={fieldErrors.confirmPassword}
              disabled={submitting}
            />

            <Button type="submit" loading={submitting} className="w-full">
              Нууц үг шинэчлэх
            </Button>
          </form>

          <div className="mt-6 border-t border-slate-200 pt-4 text-center">
            <Link
              to="/login"
              className="text-sm font-medium text-blue-600 hover:text-blue-700 hover:underline"
            >
              Нэвтрэх хуудас руу буцах
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
