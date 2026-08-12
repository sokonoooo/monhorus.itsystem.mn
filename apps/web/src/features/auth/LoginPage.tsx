import { useState, type FormEvent, type ReactElement } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';

import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { useAuth } from '../../contexts/auth-context';
import { ApiError } from '../../lib/api-client';

interface LoginLocationState {
  from?: string;
  notice?: string;
}

export function LoginPage(): ReactElement {
  const { login, isAuthenticated, initialising } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const state = location.state as LoginLocationState | null;

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  if (!initialising && isAuthenticated) {
    return <Navigate to="/dashboard" replace />;
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setSubmitting(true);
    setFormError(null);
    setFieldErrors({});

    try {
      const user = await login({ email, password });

      if (user.status === 'must_change_password') {
        navigate('/change-password', { replace: true });
        return;
      }

      navigate(state?.from ?? '/dashboard', { replace: true });
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
          <h2 className="text-lg font-semibold text-slate-900">Нэвтрэх</h2>

          <form onSubmit={handleSubmit} className="mt-6 space-y-4" noValidate>
            {state?.notice && <Alert variant="success">{state.notice}</Alert>}
            {formError && <Alert variant="error">{formError}</Alert>}

            <Input
              label="Имэйл"
              type="email"
              name="email"
              autoComplete="username"
              required
              autoFocus
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              error={fieldErrors.email}
              placeholder="name@company.mn"
              disabled={submitting}
            />

            <div className="relative">
              <Input
                label="Нууц үг"
                type={showPassword ? 'text' : 'password'}
                name="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                error={fieldErrors.password}
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

            <Button type="submit" loading={submitting} className="w-full">
              Нэвтрэх
            </Button>
          </form>

          {/*
            This paragraph used to say recovery was impossible and to call an administrator.
            It is now a link: a password can be recovered over the registered email address.
          */}
          <p className="mt-6 border-t border-slate-200 pt-4 text-center text-xs text-slate-500">
            <Link
              to="/forgot-password"
              className="font-medium text-blue-600 hover:text-blue-700 hover:underline"
            >
              Нууц үгээ мартсан уу?
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
