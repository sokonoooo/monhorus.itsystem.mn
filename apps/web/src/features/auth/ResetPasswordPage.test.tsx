import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ApiError } from '../../lib/api-client';
import { authService } from '../../services/auth.service';
import { tokenStorage } from '../../lib/token-storage';
import { ResetPasswordPage } from './ResetPasswordPage';

const TOKEN = 'a-token-from-the-emailed-link';
const NEW_PASSWORD = 'BrandNewPassword2026x';

/** Stands in for the login screen and prints whatever notice it was handed. */
function LoginStub() {
  const location = useLocation();
  const state = location.state as { notice?: string } | null;
  return (
    <div>
      <p>Нэвтрэх хуудас</p>
      {state?.notice && <p>{state.notice}</p>}
    </div>
  );
}

function renderPage(token = TOKEN) {
  return render(
    <MemoryRouter initialEntries={[`/reset-password/${token}`]}>
      <Routes>
        <Route path="/reset-password/:token" element={<ResetPasswordPage />} />
        <Route path="/login" element={<LoginStub />} />
        <Route path="/forgot-password" element={<p>Сэргээх хуудас</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

async function fillBoth(user: ReturnType<typeof userEvent.setup>, password: string) {
  await user.type(screen.getByLabelText(/^Шинэ нууц үг(?! давтах)/), password);
  await user.type(screen.getByLabelText(/Шинэ нууц үг давтах/), password);
}

afterEach(() => {
  tokenStorage.clear();
  vi.restoreAllMocks();
});

describe('ResetPasswordPage', () => {
  /** The token comes from the URL and is never typed or shown. */
  it('sends the token from the link together with the new password', async () => {
    const reset = vi.spyOn(authService, 'resetPassword').mockResolvedValue(undefined);
    const user = userEvent.setup();

    renderPage();
    await fillBoth(user, NEW_PASSWORD);
    await user.click(screen.getByRole('button', { name: 'Нууц үг шинэчлэх' }));

    await waitFor(() =>
      expect(reset).toHaveBeenCalledWith({ token: TOKEN, newPassword: NEW_PASSWORD }),
    );
  });

  it('never puts the token on screen', async () => {
    renderPage();

    expect(screen.queryByDisplayValue(TOKEN)).not.toBeInTheDocument();
    expect(screen.queryByText(TOKEN)).not.toBeInTheDocument();
  });

  it('sends the reader to the login screen with a success notice', async () => {
    vi.spyOn(authService, 'resetPassword').mockResolvedValue(undefined);
    const user = userEvent.setup();

    renderPage();
    await fillBoth(user, NEW_PASSWORD);
    await user.click(screen.getByRole('button', { name: 'Нууц үг шинэчлэх' }));

    expect(await screen.findByText('Нэвтрэх хуудас')).toBeInTheDocument();
    expect(
      screen.getByText('Нууц үг шинэчлэгдлээ. Шинэ нууц үгээрээ нэвтэрнэ үү.'),
    ).toBeInTheDocument();
  });

  /** A typo in the confirmation must cost nothing — no request, no spent token. */
  it('catches a mismatched confirmation before sending anything', async () => {
    const reset = vi.spyOn(authService, 'resetPassword').mockResolvedValue(undefined);
    const user = userEvent.setup();

    renderPage();
    await user.type(screen.getByLabelText(/^Шинэ нууц үг(?! давтах)/), NEW_PASSWORD);
    await user.type(screen.getByLabelText(/Шинэ нууц үг давтах/), 'SomethingElse2026x');
    await user.click(screen.getByRole('button', { name: 'Нууц үг шинэчлэх' }));

    expect(await screen.findByText('Нууц үг таарахгүй байна.')).toBeInTheDocument();
    expect(reset).not.toHaveBeenCalled();
  });

  /**
   * An expired or already-used link is only discovered on submit, and the way out is a
   * fresh link rather than retrying the dead one.
   */
  it('explains a dead link and offers a new one', async () => {
    vi.spyOn(authService, 'resetPassword').mockRejectedValue(
      new ApiError(
        'Нууц үг сэргээх холбоос хүчингүй эсвэл хугацаа нь дууссан байна. Дахин хүсэлт илгээнэ үү.',
        'RESET_TOKEN_INVALID',
        400,
      ),
    );
    const user = userEvent.setup();

    renderPage();
    await fillBoth(user, NEW_PASSWORD);
    await user.click(screen.getByRole('button', { name: 'Нууц үг шинэчлэх' }));

    expect(await screen.findByText(/хүчингүй эсвэл хугацаа нь дууссан/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Дахин холбоос авах' })).toHaveAttribute(
      'href',
      '/forgot-password',
    );
  });

  it('surfaces a field error the server reports on the password', async () => {
    vi.spyOn(authService, 'resetPassword').mockRejectedValue(
      new ApiError('Оруулсан утга буруу байна.', 'VALIDATION_ERROR', 400, [
        { field: 'newPassword', message: 'Нууц үг дор хаяж 10 тэмдэгт байна.' },
      ]),
    );
    const user = userEvent.setup();

    renderPage();
    await fillBoth(user, NEW_PASSWORD);
    await user.click(screen.getByRole('button', { name: 'Нууц үг шинэчлэх' }));

    expect(await screen.findByText('Нууц үг дор хаяж 10 тэмдэгт байна.')).toBeInTheDocument();
  });

  it('stays on the form after a failure so the reader can correct it', async () => {
    vi.spyOn(authService, 'resetPassword').mockRejectedValue(
      new ApiError('Алдаа гарлаа.', 'VALIDATION_ERROR', 400),
    );
    const user = userEvent.setup();

    renderPage();
    await fillBoth(user, NEW_PASSWORD);
    await user.click(screen.getByRole('button', { name: 'Нууц үг шинэчлэх' }));

    await screen.findByText('Алдаа гарлаа.');
    expect(screen.getByRole('button', { name: 'Нууц үг шинэчлэх' })).toBeInTheDocument();
    expect(screen.queryByText('Нэвтрэх хуудас')).not.toBeInTheDocument();
  });
});
