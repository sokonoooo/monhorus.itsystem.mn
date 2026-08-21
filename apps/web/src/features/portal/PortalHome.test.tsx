import { PERMISSIONS, type PortalSummaryDto } from '@monhorus/shared';
import { screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { invalidateRequestStages } from '../../hooks/use-request-stages';
import { invalidateRiskBands } from '../../hooks/use-risk-bands';
import { portalService } from '../../services/portal.service';
import {
  makeBuilding,
  makeFloor,
  makePage,
  makeRiskSummary,
  makeServiceRequest,
} from '../../test/fixtures';
import { renderWithAuth } from '../../test/render';
import { PortalHomePage } from './PortalHomePage';

/**
 * THE PORTAL HOME SCREEN.
 *
 * Three things here are worth pinning and the pretty ones are not among them.
 *
 * THE SILHOUETTE CAP MUST ANNOUNCE ITSELF. The screen draws six buildings because each one
 * costs a floors request, and a drawing that quietly stops at six reads as the whole
 * estate. The customer whose seventh building is the one on fire has to be told it was not
 * drawn, so the notice is asserted rather than the layout.
 *
 * THE STAGE RING FOLDS BY THE OPERATOR'S LADDER. The server publishes raw statuses and the
 * screen groups them, so NEW and UNASSIGNED arrive as two rows and have to leave as one
 * slice named the way the administrator named it. A ring drawn straight off the statuses
 * would show two slices sharing a colour and a customer counting them would double-count.
 *
 * UNASSESSED IS NOT HEALTHY. It has its own tile and it is kept out of the band totals, on
 * the same principle as everywhere else in this product: "not looked at" and "fine" are
 * different answers and one must never render as the other.
 */

const PORTAL_PERMISSIONS = [
  PERMISSIONS.PORTAL_SERVICE_REQUEST_VIEW,
  PERMISSIONS.PORTAL_BUILDING_VIEW,
] as const;

const CUSTOMER_IDENTITY = {
  customerId: '507f1f77bcf86cd799439011',
  customerName: 'Central Tower ХХК',
  fullName: 'Д. Болор',
  phone: '99112233',
};

function makeSummary(overrides: Partial<PortalSummaryDto> = {}): PortalSummaryDto {
  return {
    months: ['2026-03', '2026-04', '2026-05', '2026-06', '2026-07', '2026-08'],
    requestsByStatus: [
      { status: 'NEW', count: 3 },
      { status: 'UNASSIGNED', count: 2 },
      { status: 'COMPLETED', count: 8 },
    ],
    riskByMonth: [],
    ...overrides,
  };
}

function render() {
  return renderWithAuth(<PortalHomePage />, {
    permissions: PORTAL_PERMISSIONS,
    role: 'customer',
    user: CUSTOMER_IDENTITY,
    route: '/portal',
    path: '/portal',
  });
}

beforeEach(() => {
  vi.restoreAllMocks();
  // The vocabulary hooks cache at module scope and the cache outlives a file, so a suite
  // that ran a re-cut ladder first would leave this one reading somebody else's bands —
  // and "which band is the healthy one" is exactly what the tile assertions turn on.
  invalidateRiskBands();
  invalidateRequestStages();
  vi.spyOn(portalService, 'listRequests').mockResolvedValue(
    makePage([makeServiceRequest({ status: 'NEW' })]),
  );
  vi.spyOn(portalService, 'listBuildings').mockResolvedValue(makePage([]));
  vi.spyOn(portalService, 'listFloors').mockResolvedValue(makePage([]));
  vi.spyOn(portalService, 'summary').mockResolvedValue(makeSummary());
  vi.spyOn(portalService, 'pendingSurveys').mockResolvedValue([]);
});

describe('PortalHomePage - the building drawing', () => {
  function buildings(count: number) {
    return Array.from({ length: count }, (_, index) =>
      makeBuilding({
        id: `507f1f77bcf86cd7994391${String(11 + index).padStart(2, '0')}`,
        name: `Барилга ${index + 1}`,
      }),
    );
  }

  it('draws a silhouette for each building it can afford to', async () => {
    vi.spyOn(portalService, 'listBuildings').mockResolvedValue(makePage(buildings(3)));
    vi.spyOn(portalService, 'listFloors').mockResolvedValue(
      makePage([makeFloor({ floorNumber: 1 }), makeFloor({ id: 'f2', floorNumber: 2 })]),
    );

    render();

    expect(await screen.findByText('Барилга 1')).toBeInTheDocument();
    expect(screen.getByText('Барилга 3')).toBeInTheDocument();
    await waitFor(() => {
      expect(portalService.listFloors).toHaveBeenCalledTimes(3);
    });
  });

  /** The assertion this file exists for. */
  it('says how many buildings it did not draw', async () => {
    vi.spyOn(portalService, 'listBuildings').mockResolvedValue(makePage(buildings(9), 100));

    render();

    expect(await screen.findByText(/Өөр 3 барилга зурагдаагүй байна/)).toBeInTheDocument();
    // Six drawn, not nine — and six floor requests, not nine.
    await waitFor(() => {
      expect(portalService.listFloors).toHaveBeenCalledTimes(6);
    });
    expect(screen.queryByText('Барилга 7')).not.toBeInTheDocument();
  });

  it('says nothing about a cap when every building is drawn', async () => {
    vi.spyOn(portalService, 'listBuildings').mockResolvedValue(makePage(buildings(2)));

    render();

    await screen.findByText('Барилга 1');
    expect(screen.queryByText(/зурагдаагүй байна/)).not.toBeInTheDocument();
  });
});

describe('PortalHomePage - equipment standing', () => {
  it('separates assessed bands from equipment nobody has looked at', async () => {
    vi.spyOn(portalService, 'listBuildings').mockResolvedValue(
      makePage([
        makeBuilding({
          riskSummary: makeRiskSummary({
            counts: [
              { level: 'NORMAL', count: 12 },
              { level: 'CRITICAL', count: 3 },
            ],
            unassessedCount: 40,
          }),
        }),
      ]),
    );

    render();

    // The LABEL renders before the buildings resolve — the number is a skeleton until they
    // do — so this waits for the figure rather than for the tile, which is the difference
    // between a test that passes and one that passes for the right reason.
    const tileFor = async (label: string, value: string): Promise<void> => {
      const tile = (await screen.findByText(label)).closest('div')!.parentElement!;
      expect(await within(tile).findByText(value)).toBeInTheDocument();
    };

    // Three, not forty-three: unassessed is not a band and must not inflate the number a
    // customer is asked to act on.
    await tileFor('Анхаарах тоноглол', '3');
    await tileFor('Үнэлгээ хийгээгүй', '40');
  });
});

describe('PortalHomePage - the request ring', () => {
  it('folds statuses into the stages the operator configured', async () => {
    render();

    // NEW and UNASSIGNED are one stage, so the ring shows their sum under one name rather
    // than two slices that happen to share a colour.
    const row = (await screen.findByText('Нээлттэй')).closest('li');
    expect(row).not.toBeNull();
    // Scoped to the legend row rather than the page: several panels here print small
    // integers, and a test that passes on the wrong element proves nothing.
    expect(within(row!).getByText('5')).toBeInTheDocument();
    expect(screen.getByText('Дууссан')).toBeInTheDocument();
  });

  it('omits a stage nobody is in', async () => {
    vi.spyOn(portalService, 'summary').mockResolvedValue(
      makeSummary({ requestsByStatus: [{ status: 'NEW', count: 2 }] }),
    );

    render();

    expect(await screen.findByText('Нээлттэй')).toBeInTheDocument();
    expect(screen.queryByText('Дууссан')).not.toBeInTheDocument();
  });

  it('leaves the page standing when the summary cannot load', async () => {
    vi.spyOn(portalService, 'summary').mockRejectedValue(new Error('boom'));

    render();

    // The request list is this screen's job; a chart that failed leaves a gap, not an error.
    expect(await screen.findByText('Сүүлийн хүсэлтүүд')).toBeInTheDocument();
  });
});
