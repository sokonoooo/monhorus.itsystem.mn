import { PERMISSIONS } from '@monhorus/shared';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { objectMasterService, objectTypeService } from '../../../services/object-master.service';
import { projectService } from '../../../services/project.service';
import {
  makeFloor,
  makeObjectDetail,
  makeObjectType,
  makePage,
} from '../../../test/fixtures';
import { renderWithAuth } from '../../../test/render';
import { ObjectFormPage } from './ObjectFormPage';

const FLOOR_ID = '507f1f77bcf86cd799439121';
const TYPE_ID = '507f1f77bcf86cd799439151';

function renderCreate() {
  return renderWithAuth(<ObjectFormPage />, {
    permissions: [PERMISSIONS.OBJECT_MASTER_VIEW, PERMISSIONS.OBJECT_MASTER_MANAGE],
    route: `/floors/${FLOOR_ID}/objects/new`,
    path: '/floors/:floorId/objects/new',
  });
}

describe('ObjectFormPage', () => {
  beforeEach(() => {
    vi.spyOn(projectService, 'getFloor').mockResolvedValue(makeFloor());
    vi.spyOn(objectTypeService, 'list').mockResolvedValue(makePage([makeObjectType()]));
    vi.spyOn(objectMasterService, 'list').mockResolvedValue(makePage([]));
  });

  /** The free-text note is a stored column, so it has to be reachable on create. */
  it('sends the note along with the description', async () => {
    const create = vi.spyOn(objectMasterService, 'create').mockResolvedValue(makeObjectDetail());
    const user = userEvent.setup();

    renderCreate();

    await user.selectOptions(await screen.findByLabelText(/^Тоноглолын төрөл/), TYPE_ID);
    await user.type(screen.getByLabelText(/^Код/), 'EQ-11');
    await user.type(screen.getByLabelText(/^Нэр\*/), 'Салхивчийн мотор');
    await user.type(screen.getByLabelText('Тайлбар'), 'Дээвэр дээр байрлана');
    await user.type(screen.getByLabelText('Тэмдэглэл'), 'Түлхүүр нь харуулын постонд');

    await user.click(screen.getByRole('button', { name: 'Хадгалах' }));

    await waitFor(() => {
      expect(create).toHaveBeenCalledWith(
        expect.objectContaining({
          code: 'EQ-11',
          name: 'Салхивчийн мотор',
          description: 'Дээвэр дээр байрлана',
          notes: 'Түлхүүр нь харуулын постонд',
        }),
      );
    });
  });

  it('leaves the note null when it was not filled in', async () => {
    const create = vi.spyOn(objectMasterService, 'create').mockResolvedValue(makeObjectDetail());
    const user = userEvent.setup();

    renderCreate();

    await user.selectOptions(await screen.findByLabelText(/^Тоноглолын төрөл/), TYPE_ID);
    await user.type(screen.getByLabelText(/^Код/), 'EQ-12');
    await user.type(screen.getByLabelText(/^Нэр\*/), 'Агаар сэлгэгч');

    await user.click(screen.getByRole('button', { name: 'Хадгалах' }));

    await waitFor(() => {
      expect(create).toHaveBeenCalledWith(expect.objectContaining({ notes: null }));
    });
  });
});
