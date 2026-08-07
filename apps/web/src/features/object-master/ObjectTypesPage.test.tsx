import {
  MAX_OBJECT_TYPE_ICON_BYTES,
  OBJECT_TYPE_ICON_MIME,
  PERMISSIONS,
  type ObjectTypeDto,
  type PaginatedData,
} from '@monhorus/shared';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import * as fileUrl from '../../lib/file-url';
import { objectTypeService } from '../../services/object-master.service';
import { renderWithAuth } from '../../test/render';
import planIconsSource from '../projects/plan-icons.tsx?raw';
import { ObjectTypesPage } from './ObjectTypesPage';
import objectTypesPageSource from './ObjectTypesPage.tsx?raw';

function makeType(overrides: Partial<ObjectTypeDto> = {}): ObjectTypeDto {
  return {
    id: 't1',
    code: 'PANEL',
    name: 'Самбар',
    description: null,
    category: 'EQUIPMENT',
    showOnPlan: false,
    insidePanel: false,
    generatesConclusion: true,
    icon: 'OTHER',
    iconFileId: null,
    iconUrl: null,
    isActive: true,
    objectCount: 0,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function makePage(items: ObjectTypeDto[]): PaginatedData<ObjectTypeDto> {
  return { items, page: 1, limit: 50, total: items.length, totalPages: 1 };
}

describe('ObjectTypesPage', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('enables delete only for a type no object is using', async () => {
    vi.spyOn(objectTypeService, 'list').mockResolvedValue(
      makePage([
        makeType({ id: 't1', name: 'Ашиглагдаагүй', code: 'FREE', objectCount: 0 }),
        makeType({ id: 't2', name: 'Ашиглагдаж буй', code: 'USED', objectCount: 3 }),
      ]),
    );
    const user = userEvent.setup();

    renderWithAuth(<ObjectTypesPage />, {
      permissions: [PERMISSIONS.OBJECT_MASTER_VIEW, PERMISSIONS.OBJECT_TYPE_MANAGE],
    });

    await screen.findByText('Ашиглагдаагүй');
    const rows = within(screen.getByRole('table')).getAllByRole('row');

    await user.click(within(rows[1]!).getByRole('button', { name: 'Үйлдэл' }));
    expect(screen.getByRole('menuitem', { name: 'Засах' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Устгах' })).toBeEnabled();

    // A type already carrying objects still shows the action, disabled with its reason.
    await user.click(within(rows[2]!).getByRole('button', { name: 'Үйлдэл' }));
    expect(screen.getByRole('menuitem', { name: 'Засах' })).toBeInTheDocument();
    const blocked = screen.getByRole('menuitem', { name: 'Устгах' });
    expect(blocked).toBeDisabled();
    expect(blocked).toHaveAttribute(
      'title',
      'Энэ төрлийг 3 тоноглол ашиглаж байгаа тул устгах боломжгүй.',
    );
  });

  it('deletes a type that no object uses', async () => {
    vi.spyOn(objectTypeService, 'list').mockResolvedValue(
      makePage([makeType({ id: 't1', name: 'Ашиглагдаагүй', code: 'FREE', objectCount: 0 })]),
    );
    const remove = vi.spyOn(objectTypeService, 'remove').mockResolvedValue(undefined);
    const user = userEvent.setup();

    renderWithAuth(<ObjectTypesPage />, {
      permissions: [PERMISSIONS.OBJECT_MASTER_VIEW, PERMISSIONS.OBJECT_TYPE_MANAGE],
    });

    await screen.findByText('Ашиглагдаагүй');
    await user.click(within(screen.getByRole('table')).getByRole('button', { name: 'Үйлдэл' }));
    await user.click(screen.getByRole('menuitem', { name: 'Устгах' }));
    await user.click(screen.getByRole('button', { name: 'Устгах' }));

    expect(remove).toHaveBeenCalledWith('t1');
  });

  it('drops the usage and status columns from the table', async () => {
    vi.spyOn(objectTypeService, 'list').mockResolvedValue(makePage([makeType()]));

    renderWithAuth(<ObjectTypesPage />, { permissions: [PERMISSIONS.OBJECT_MASTER_VIEW] });

    await screen.findByText('Самбар');
    const headers = within(screen.getByRole('table')).getAllByRole('columnheader');
    const labels = headers.map((header) => header.textContent);
    expect(labels).not.toContain('Ашиглалт');
    expect(labels).not.toContain('Төлөв');
  });

  it('leaves the action cell empty without object_type.manage', async () => {
    vi.spyOn(objectTypeService, 'list').mockResolvedValue(makePage([makeType()]));

    renderWithAuth(<ObjectTypesPage />, { permissions: [PERMISSIONS.OBJECT_MASTER_VIEW] });

    await screen.findByText('Самбар');
    expect(screen.queryByRole('button', { name: 'Шинэ төрөл' })).not.toBeInTheDocument();
    // Nothing is on offer, so there is no menu button to open in the first place.
    const table = screen.getByRole('table');
    expect(within(table).queryByRole('button', { name: 'Үйлдэл' })).not.toBeInTheDocument();
  });
});

/**
 * A type may carry an uploaded SVG on top of its built-in glyph.
 *
 * The upload is two-phase — the file is sent first and the id it returns is what the type
 * is saved with — so these tests are about three things: what the form refuses to send,
 * what it shows for what it is about to send, and exactly which field reaches a PATCH.
 */
describe('ObjectTypesPage custom icon', () => {
  const ICON_FILE_ID = '507f1f77bcf86cd799439199';
  const ICON_PATH = `/api/v1/files/${ICON_FILE_ID}`;

  function svgFile(name = 'icon.svg'): File {
    return new File(
      ['<svg xmlns="http://www.w3.org/2000/svg"><circle data-uploaded-mark="1" r="4" /></svg>'],
      name,
      {
        type: OBJECT_TYPE_ICON_MIME,
      },
    );
  }

  function uploadResponse(id = ICON_FILE_ID) {
    return {
      id,
      name: 'icon.svg',
      downloadUrl: `/api/v1/files/${id}`,
      mimeType: OBJECT_TYPE_ICON_MIME,
      sizeBytes: 512,
      uploadedByName: 'Ерөнхий админ',
      uploadedAt: '2026-08-01T00:00:00.000Z',
    };
  }

  function iconInput(): HTMLInputElement {
    return screen.getByLabelText('Тусгай айкон (SVG)') as HTMLInputElement;
  }

  async function openDrawer(user: ReturnType<typeof userEvent.setup>): Promise<void> {
    // The action appears once the session's permissions have resolved, not on first paint.
    await user.click(await screen.findByRole('button', { name: 'Шинэ төрөл' }));
    await screen.findByRole('dialog');
  }

  async function openEditor(
    user: ReturnType<typeof userEvent.setup>,
    typeName: string,
  ): Promise<void> {
    await screen.findByText(typeName);
    await user.click(within(screen.getByRole('table')).getByRole('button', { name: 'Үйлдэл' }));
    await user.click(screen.getByRole('menuitem', { name: 'Засах' }));
    await screen.findByRole('dialog');
  }

  beforeEach(() => {
    vi.spyOn(fileUrl, 'authorisedFileUrl').mockResolvedValue('blob:icon');
  });

  /**
   * The client check is a courtesy, and the point of this test is the second assertion:
   * a file the form can already see is wrong never becomes a request. The server refuses
   * the same thing independently — that is the actual gate and it is not what is tested
   * here, because this page cannot test it.
   */
  it('refuses a file that is not an SVG without calling the endpoint', async () => {
    vi.spyOn(objectTypeService, 'list').mockResolvedValue(makePage([makeType()]));
    const upload = vi.spyOn(objectTypeService, 'uploadIcon');
    // The accept attribute already keeps this file out of a real picker; the check under
    // test is the one in the page, so the browser-level filter is stood down.
    const user = userEvent.setup({ applyAccept: false });

    renderWithAuth(<ObjectTypesPage />, {
      permissions: [PERMISSIONS.OBJECT_MASTER_VIEW, PERMISSIONS.OBJECT_TYPE_MANAGE],
    });
    await openDrawer(user);

    await user.upload(iconInput(), new File(['fake'], 'icon.png', { type: 'image/png' }));

    expect(await screen.findByText('Зөвхөн SVG өргөтгөлтэй файл байршуулна уу.')).toBeVisible();
    expect(upload).not.toHaveBeenCalled();
  });

  it('refuses a file over the shared size limit without calling the endpoint', async () => {
    vi.spyOn(objectTypeService, 'list').mockResolvedValue(makePage([makeType()]));
    const upload = vi.spyOn(objectTypeService, 'uploadIcon');
    const user = userEvent.setup();

    renderWithAuth(<ObjectTypesPage />, {
      permissions: [PERMISSIONS.OBJECT_MASTER_VIEW, PERMISSIONS.OBJECT_TYPE_MANAGE],
    });
    await openDrawer(user);

    const oversize = new File(
      [new Uint8Array(MAX_OBJECT_TYPE_ICON_BYTES + 1)],
      'huge.svg',
      { type: OBJECT_TYPE_ICON_MIME },
    );
    expect(oversize.size).toBeGreaterThan(MAX_OBJECT_TYPE_ICON_BYTES);

    await user.upload(iconInput(), oversize);

    expect(await screen.findByText(/хэтрэхгүй байх ёстой/)).toBeVisible();
    expect(upload).not.toHaveBeenCalled();
  });

  /**
   * The preview is an `<img>`, and the markup of the chosen file never enters this page.
   *
   * An SVG is a document: inlined here its script would run with this application's origin
   * and this user's session. The file being previewed is one the server has not sanitised
   * yet, which is precisely why the preview may not be the place that relaxes.
   */
  it('previews the chosen file as an image and never inlines its markup', async () => {
    vi.spyOn(objectTypeService, 'list').mockResolvedValue(makePage([makeType()]));
    vi.spyOn(objectTypeService, 'uploadIcon').mockResolvedValue(uploadResponse());
    const user = userEvent.setup();

    renderWithAuth(<ObjectTypesPage />, {
      permissions: [PERMISSIONS.OBJECT_MASTER_VIEW, PERMISSIONS.OBJECT_TYPE_MANAGE],
    });
    await openDrawer(user);

    await user.upload(iconInput(), svgFile());

    const preview = await screen.findByAltText('Сонгосон айкон');
    expect(preview.tagName).toBe('IMG');
    expect(preview.getAttribute('src')).toBeTruthy();
    // The file's own drawing never entered the document: the mark inside it is nowhere.
    expect(document.querySelector('[data-uploaded-mark]')).toBeNull();
  });

  /**
   * Pinned in the source, because this is an invariant no rendered output can prove: an
   * inlining path added later would pass every assertion above while reintroducing the
   * exact hole they exist to close.
   */
  it('has no markup-inlining path in the pages that draw an uploaded icon', () => {
    for (const source of [objectTypesPageSource, planIconsSource]) {
      expect(source).not.toMatch(/dangerouslySetInnerHTML/);
      expect(source).not.toMatch(/innerHTML/);
    }
  });

  it('creates a type with the uploaded file as its iconFileId', async () => {
    vi.spyOn(objectTypeService, 'list').mockResolvedValue(makePage([makeType()]));
    vi.spyOn(objectTypeService, 'uploadIcon').mockResolvedValue(uploadResponse());
    const create = vi.spyOn(objectTypeService, 'create').mockResolvedValue(makeType());
    const user = userEvent.setup();

    renderWithAuth(<ObjectTypesPage />, {
      permissions: [PERMISSIONS.OBJECT_MASTER_VIEW, PERMISSIONS.OBJECT_TYPE_MANAGE],
    });
    await openDrawer(user);

    await user.type(screen.getByLabelText(/^Код/), 'CAM');
    await user.type(screen.getByLabelText(/^Нэр/), 'Камер');
    await user.upload(iconInput(), svgFile());
    await screen.findByAltText('Сонгосон айкон');
    await user.click(screen.getByRole('button', { name: 'Хадгалах' }));

    await waitFor(() => expect(create).toHaveBeenCalled());
    expect(create.mock.calls[0]![0]).toMatchObject({
      code: 'CAM',
      name: 'Камер',
      // The enum stays: it is the fallback, not something the upload replaced.
      icon: 'OTHER',
      iconFileId: ICON_FILE_ID,
    });
  });

  /**
   * The three-valued PATCH, and the case that matters most: an edit that never went near
   * the icon must not mention it. `iconFileId` absent means "leave it alone" — sending the
   * state unconditionally would restate an icon on every rename, and clear one whenever
   * the form had not managed to load it.
   */
  it('omits iconFileId entirely when the icon was not touched', async () => {
    vi.spyOn(objectTypeService, 'list').mockResolvedValue(
      makePage([makeType({ name: 'Камер', iconFileId: ICON_FILE_ID, iconUrl: ICON_PATH })]),
    );
    const update = vi.spyOn(objectTypeService, 'update').mockResolvedValue(makeType());
    const user = userEvent.setup();

    renderWithAuth(<ObjectTypesPage />, {
      permissions: [PERMISSIONS.OBJECT_MASTER_VIEW, PERMISSIONS.OBJECT_TYPE_MANAGE],
    });
    await openEditor(user, 'Камер');

    await user.clear(screen.getByLabelText(/^Нэр/));
    await user.type(screen.getByLabelText(/^Нэр/), 'Камер 2');
    await user.click(screen.getByRole('button', { name: 'Хадгалах' }));

    await waitFor(() => expect(update).toHaveBeenCalled());
    const payload = update.mock.calls[0]![1] as Record<string, unknown>;
    expect(payload.name).toBe('Камер 2');
    expect(Object.keys(payload)).not.toContain('iconFileId');
  });

  it('sends iconFileId: null when the icon is removed', async () => {
    vi.spyOn(objectTypeService, 'list').mockResolvedValue(
      makePage([makeType({ name: 'Камер', iconFileId: ICON_FILE_ID, iconUrl: ICON_PATH })]),
    );
    const update = vi.spyOn(objectTypeService, 'update').mockResolvedValue(makeType());
    const user = userEvent.setup();

    renderWithAuth(<ObjectTypesPage />, {
      permissions: [PERMISSIONS.OBJECT_MASTER_VIEW, PERMISSIONS.OBJECT_TYPE_MANAGE],
    });
    await openEditor(user, 'Камер');

    // The type's saved icon is shown before it can be taken away.
    expect(await screen.findByAltText('Сонгосон айкон')).toHaveAttribute('src', 'blob:icon');

    await user.click(screen.getByRole('button', { name: 'Айкон устгах' }));
    expect(screen.queryByAltText('Сонгосон айкон')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Хадгалах' }));

    await waitFor(() => expect(update).toHaveBeenCalled());
    const payload = update.mock.calls[0]![1] as Record<string, unknown>;
    expect(payload.iconFileId).toBeNull();
  });

  /** A type that never had a custom icon neither fetches one nor offers to remove one. */
  it('leaves a type with no custom icon exactly as it was', async () => {
    vi.spyOn(objectTypeService, 'list').mockResolvedValue(makePage([makeType({ name: 'Камер' })]));
    const update = vi.spyOn(objectTypeService, 'update').mockResolvedValue(makeType());
    const user = userEvent.setup();

    renderWithAuth(<ObjectTypesPage />, {
      permissions: [PERMISSIONS.OBJECT_MASTER_VIEW, PERMISSIONS.OBJECT_TYPE_MANAGE],
    });
    await openEditor(user, 'Камер');

    expect(screen.queryByAltText('Сонгосон айкон')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Айкон устгах' })).not.toBeInTheDocument();
    expect(fileUrl.authorisedFileUrl).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Хадгалах' }));

    await waitFor(() => expect(update).toHaveBeenCalled());
    expect(Object.keys(update.mock.calls[0]![1] as Record<string, unknown>)).not.toContain(
      'iconFileId',
    );
  });
});
