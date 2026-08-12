import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ApiError } from '../../lib/api-client';
import { authService } from '../../services/auth.service';
import { tokenStorage } from '../../lib/token-storage';
import { ForgotPasswordPage } from './ForgotPasswordPage';

/**
 * Rendered without `renderWithAuth`: that helper seeds a session and stubs `me`, which is
 * the opposite of the state this screen exists for.
 */
function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/forgot-password']}>
      <Routes>
        <Route path="/forgot-password" element={<ForgotPasswordPage />} />
        <Route path="/login" element={<p>Нэвтрэх хуудас</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

afterEach(() => {
  tokenStorage.clear();
  vi.restoreAllMocks();
});

describe('ForgotPasswordPage', () => {
  it('asks the server for a link for the address given', async () => {
    const forgot = vi.spyOn(authService, 'forgotPassword').mockResolvedValue(undefined);
    const user = userEvent.setup();

    renderPage();
    await user.type(screen.getByLabelText(/Имэйл/), 'someone@test.mn');
    await user.click(screen.getByRole('button', { name: 'Холбоос илгээх' }));

    await waitFor(() => expect(forgot).toHaveBeenCalledWith({ email: 'someone@test.mn' }));
  });

  it('trims the address before sending it', async () => {
    const forgot = vi.spyOn(authService, 'forgotPassword').mockResolvedValue(undefined);
    const user = userEvent.setup();

    renderPage();
    await user.type(screen.getByLabelText(/Имэйл/), '  spaced@test.mn  ');
    await user.click(screen.getByRole('button', { name: 'Холбоос илгээх' }));

    await waitFor(() => expect(forgot).toHaveBeenCalledWith({ email: 'spaced@test.mn' }));
  });

  /**
   * The security property of this screen. The server answers the same for a registered and
   * an unregistered address, and the UI must not undo that by rendering something more
   * specific — so the confirmation is worded as a condition and never names the account.
   */
  it('confirms without revealing whether the address is registered', async () => {
    vi.spyOn(authService, 'forgotPassword').mockResolvedValue(undefined);
    const user = userEvent.setup();

    renderPage();
    await user.type(screen.getByLabelText(/Имэйл/), 'ghost@test.mn');
    await user.click(screen.getByRole('button', { name: 'Холбоос илгээх' }));

    expect(await screen.findByText(/Хэрэв энэ имэйл бүртгэлтэй бол/)).toBeInTheDocument();
    // Nothing that would confirm or deny the account.
    expect(screen.queryByText(/олдсонгүй/)).not.toBeInTheDocument();
    expect(screen.queryByText(/бүртгэлгүй/)).not.toBeInTheDocument();
  });

  it('replaces the form with the confirmation so the request is not repeated blindly', async () => {
    vi.spyOn(authService, 'forgotPassword').mockResolvedValue(undefined);
    const user = userEvent.setup();

    renderPage();
    await user.type(screen.getByLabelText(/Имэйл/), 'someone@test.mn');
    await user.click(screen.getByRole('button', { name: 'Холбоос илгээх' }));

    await screen.findByText(/Хэрэв энэ имэйл бүртгэлтэй бол/);
    expect(screen.queryByRole('button', { name: 'Холбоос илгээх' })).not.toBeInTheDocument();
  });

  it('states the failure and keeps the form when the request fails', async () => {
    vi.spyOn(authService, 'forgotPassword').mockRejectedValue(
      new ApiError('Хэт олон хүсэлт илгээлээ.', 'RATE_LIMITED', 429),
    );
    const user = userEvent.setup();

    renderPage();
    await user.type(screen.getByLabelText(/Имэйл/), 'someone@test.mn');
    await user.click(screen.getByRole('button', { name: 'Холбоос илгээх' }));

    expect(await screen.findByText('Хэт олон хүсэлт илгээлээ.')).toBeInTheDocument();
    // Still on the form, so the reader can try again.
    expect(screen.getByRole('button', { name: 'Холбоос илгээх' })).toBeInTheDocument();
    expect(screen.queryByText(/Хэрэв энэ имэйл бүртгэлтэй бол/)).not.toBeInTheDocument();
  });

  it('offers a way back to the login screen', async () => {
    renderPage();

    expect(
      screen.getByRole('link', { name: 'Нэвтрэх хуудас руу буцах' }),
    ).toHaveAttribute('href', '/login');
  });
});
