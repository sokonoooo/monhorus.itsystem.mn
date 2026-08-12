import { useState, type FormEvent, type ReactElement } from 'react';
import { Link } from 'react-router-dom';

import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { ApiError } from '../../lib/api-client';
import { authService } from '../../services/auth.service';

/**
 * Asking for a password-reset link.
 *
 * The screen never says whether the address is registered. On success it shows the same
 * confirmation for an address that exists and one that does not, because a form that
 * answers "no such user" is a tool for harvesting the user list — and a login form hardened
 * against that is undone by a recovery form that is not. The server is written the same
 * way; this page simply must not undo it by rendering something more specific.
 */
export function ForgotPasswordPage(): ReactElement {
  const [email, setEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setFormError(null);
    setFieldErrors({});
    setSubmitting(true);

    try {
      await authService.forgotPassword({ email: email.trim() });
      setSent(true);
    } catch (error) {
      if (error instanceof ApiError) {
        setFormError(error.message);
        setFieldErrors(error.fieldErrors);
      } else {
        setFormError('Гэнэтийн алдаа гарлаа. Дахин оролдоно уу.');
      }
    } finally {
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
          <h2 className="text-lg font-semibold text-slate-900">Нууц үг сэргээх</h2>

          {sent ? (
            <>
              {/*
                Worded as a condition, not a confirmation. "Хэрэв энэ имэйл бүртгэлтэй бол"
                is true for a registered address and for an unregistered one, which is the
                only way to be honest with the reader without confirming the account to
                somebody who is guessing at addresses.
              */}
              <div className="mt-6">
                <Alert variant="success" title="Хүсэлт хүлээн авлаа">
                  Хэрэв энэ имэйл бүртгэлтэй бол нууц үг сэргээх холбоос илгээгдлээ. Ирсэн
                  захидлаа шалгана уу. Холбоос 1 цагийн дараа хүчингүй болно.
                </Alert>
              </div>
              <p className="mt-4 text-xs text-slate-500">
                Захидал ирээгүй бол спам хавтсаа шалгаад, дахин оролдоно уу.
              </p>
              <div className="mt-6 border-t border-slate-200 pt-4 text-center">
                <Link
                  to="/login"
                  className="text-sm font-medium text-blue-600 hover:text-blue-700 hover:underline"
                >
                  Нэвтрэх хуудас руу буцах
                </Link>
              </div>
            </>
          ) : (
            <>
              <p className="mt-2 text-sm text-slate-600">
                Бүртгэлтэй имэйл хаягаа оруулна уу. Нууц үг сэргээх холбоосыг тэр хаяг руу
                илгээнэ.
              </p>

              <form onSubmit={handleSubmit} className="mt-6 space-y-4" noValidate>
                {formError && <Alert variant="error">{formError}</Alert>}

                <Input
                  label="Имэйл"
                  type="email"
                  autoComplete="username"
                  placeholder="name@company.mn"
                  required
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  error={fieldErrors.email}
                  disabled={submitting}
                />

                <Button type="submit" loading={submitting} className="w-full">
                  Холбоос илгээх
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
            </>
          )}
        </div>
      </div>
    </div>
  );
}
