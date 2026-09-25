import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { renderWithAuth } from '../../test/render';
import { HelpPanel } from './HelpPanel';
import type { PageHelp } from './help-content.types';

const full: PageHelp = {
  title: 'Хүсэлтийн жагсаалт',
  purpose: 'Бүртгэгдсэн бүх хүсэлтийг нэг дороос харах.',
  actions: ['Хүсэлт хайх', 'Шүүлтүүр тохируулах'],
  audience: ['Диспетчер'],
  timing: ['Өдөр бүрийн эхэнд'],
  editableFields: [{ name: 'Төлөв', note: 'Ажлын явцыг илэрхийлнэ.' }],
  readOnlyFields: [{ name: 'Дугаар', note: 'Систем автоматаар олгоно.' }],
  steps: ['Шүүлтүүр сонгох', 'Хүсэлт нээх'],
  related: [{ label: 'Dispatch самбар', to: '/service-requests/dispatch' }],
  warnings: ['Устгасан хүсэлтийг сэргээх боломжгүй.'],
};

describe('HelpPanel', () => {
  it('renders every section it was given', async () => {
    renderWithAuth(<HelpPanel open onClose={vi.fn()} help={full} />, { route: '/service-requests' });

    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveAccessibleName('Тусламж: Хүсэлтийн жагсаалт');

    for (const heading of [
      'Энэ хуудсын зорилго',
      'Юу хийдэг вэ?',
      'Хэн ашигладаг вэ?',
      'Хэзээ ашиглах вэ?',
      'Алхам алхмаар',
      'Засаж болох талбарууд',
      'Засаж болохгүй талбарууд',
      'Анхаарах зүйлс',
      'Холбоотой мэдээлэл',
    ]) {
      expect(within(dialog).getByRole('heading', { name: heading })).toBeInTheDocument();
    }

    expect(within(dialog).getByRole('link', { name: 'Dispatch самбар' })).toHaveAttribute(
      'href',
      '/service-requests/dispatch',
    );
  });

  /**
   * The point of every section being optional. A list page has no editable fields, and
   * inventing a sentence to fill the heading is how help text becomes noise people skip.
   */
  it('omits the headings for sections the page did not supply', async () => {
    const minimal: PageHelp = { title: 'Тайлан', purpose: 'Үзүүлэлтүүдийг харах.' };
    renderWithAuth(<HelpPanel open onClose={vi.fn()} help={minimal} />, { route: '/reports' });

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByRole('heading', { name: 'Энэ хуудсын зорилго' })).toBeInTheDocument();
    expect(within(dialog).queryByRole('heading', { name: 'Алхам алхмаар' })).not.toBeInTheDocument();
    expect(
      within(dialog).queryByRole('heading', { name: 'Засаж болох талбарууд' }),
    ).not.toBeInTheDocument();
  });

  it('says so plainly when a page has no help rather than showing something generic', async () => {
    renderWithAuth(<HelpPanel open onClose={vi.fn()} help={null} />, { route: '/somewhere' });

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/тусламж хараахан бэлдээгүй/i)).toBeInTheDocument();
  });

  it('renders nothing while closed', () => {
    renderWithAuth(<HelpPanel open={false} onClose={vi.fn()} help={full} />, { route: '/x' });

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  /** Otherwise the panel outlives the page it describes and reads as though it describes the new one. */
  it('closes when a related link is followed', async () => {
    const onClose = vi.fn();
    renderWithAuth(<HelpPanel open onClose={onClose} help={full} />, { route: '/service-requests' });

    await userEvent.click(await screen.findByRole('link', { name: 'Dispatch самбар' }));

    expect(onClose).toHaveBeenCalled();
  });
});
