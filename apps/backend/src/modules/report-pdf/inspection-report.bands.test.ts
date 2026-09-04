import { RISK_LEVEL_LABELS, type RiskBand } from '@monhorus/shared';
import { describe, expect, it } from 'vitest';

import { inspectionReportDocument } from './inspection-report.pdf';
import type { ReportBranding } from './report-branding';

/**
 * The printed report must speak ONE vocabulary.
 *
 * The conclusion block resolved the administrator's band wording while the sub-task and
 * зөрчил tables under it printed the compiled ladder, so an installation that renamed a
 * band — or configured one of the spares — got a header saying one thing and the tables on
 * the same page saying «Түвшин 6».
 *
 * These assert the document definition rather than the rendered bytes. The rendered PDF
 * embeds subset fonts and compresses its streams, so Cyrillic text is not greppable in the
 * output; `report-pdf.test.ts` already proves the same document renders. What is under test
 * here is which WORDS reach the table, and the definition is where that is decidable.
 */

const CONTRACTOR = '"Монхорус Электрик" ХХК';

const BRANDING: ReportBranding = {
  logo: null,
  // No customer letterhead: this file is about the band names in the tables, and a logo
  // either side of them changes nothing about which vocabulary they print.
  customerLogo: null,
  companyName: CONTRACTOR,
  inspectionCompany: CONTRACTOR,
};

/** A ladder in which the operator has renamed the two bands the fixture uses. */
const RENAMED_BANDS: RiskBand[] = [
  {
    level: 'CRITICAL',
    min: 20,
    max: 39,
    labelMn: 'Онцгой анхаарах',
    colour: 'red',
    requiresConclusion: true,
    requiresRecommendation: true,
    decommissions: false,
    notifies: true,
  },
  {
    level: 'OUT_OF_SERVICE',
    min: 0,
    max: 19,
    labelMn: 'Ашиглалтаас хасах',
    colour: 'black',
    requiresConclusion: true,
    requiresRecommendation: true,
    decommissions: true,
    notifies: true,
  },
];

function fixture(): Parameters<typeof inspectionReportDocument>[0] {
  return {
    id: 'i1',
    plannedWorkId: 'w1',
    status: 'FINALISED',
    version: 1,
    workNumber: 'PW-202608-0007',
    workTitle: 'Цахилгааны сарын үзлэг',
    customerName: 'Central Tower ХХК',
    projectName: 'Урьдчилан сэргийлэх үйлчилгээ',
    buildingName: 'Төв байр',
    locationLabel: 'Сүхбаатар дүүрэг',
    inspectionStart: '2026-08-01T02:00:00.000Z',
    inspectionEnd: '2026-08-11T09:30:00.000Z',
    responsibleEmployeeNames: ['Д.Ганболд'],
    responsibleTeamNames: [],
    contractorName: CONTRACTOR,
    actName: 'Цахилгааны үзлэг',
    inspectedScope: 'Цахилгаан самбарын ерөнхий үзлэг',
    groups: [
      {
        floorId: 'f1',
        floorName: '1-р давхар',
        tasks: [
          {
            taskId: 't1',
            title: 'Ерөнхий оруулгын самбар',
            floorName: '1-р давхар',
            status: 'DONE',
            statusLabel: 'Дууссан',
            skipped: false,
            score: 38,
            riskLevel: 'CRITICAL',
            note: 'Газардуулга холбогдоогүй.',
            recommendation: null,
            totalQuantity: 1,
            completedQuantity: 1,
            unit: 'ш',
            attachments: [],
            completedAt: '2026-08-02T02:00:00.000Z',
            assignedEmployeeName: 'Д.Ганболд',
          },
        ],
      },
    ],
    issues: [
      {
        taskId: 't1',
        title: 'Ерөнхий оруулгын самбар',
        locationLabel: '1-р давхар',
        riskLevel: 'OUT_OF_SERVICE',
        score: 20,
        condition: 'Газардуулга холбогдоогүй.',
        advice: 'Яаралтай холбох.',
      },
    ],
    overallLevel: 'OUT_OF_SERVICE',
    /*
     * The verdict line, already resolved by `inspection-report.service.ts` through
     * `overallSafetyLabelOf` before the DTO reaches this renderer. It is deliberately NOT
     * one of the shipped band names here: that is what lets the assertions below tell the
     * tables' vocabulary apart from the header's, which is the whole point of the bug.
     */
    overallLabel: 'Ашиглалтаас хасах шаардлагатай',
    issueSummary: 'Нэг зөрчил илэрсэн.',
    conclusion: 'Дүгнэлт.',
    recommendation: 'Зөвлөмж.',
    replacementPanels: [],
    replacementConnections: [],
    isAutoDraft: false,
    createdByName: 'Б.Мөнхтуяа',
    createdByPosition: 'Зургийн техникч',
    createdAt: '2026-08-11T10:00:00.000Z',
    submittedByName: null,
    submittedAt: null,
    approvedByName: null,
    approvedByPosition: null,
    approvedAt: null,
    returnedByName: null,
    returnedAt: null,
    returnReason: null,
    finalisedByName: null,
    finalisedAt: null,
    updatedAt: '2026-08-11T10:00:00.000Z',
  } as never;
}

/**
 * Every string in the document definition, joined into one blob.
 *
 * Joined rather than compared element by element because a table cell composes its parts —
 * the sub-task score and its band arrive as `'38 · Ноцтой эрсдэлтэй'` — so the band name is
 * a substring of a cell, never a cell of its own.
 */
function allText(node: unknown, into: string[] = []): string {
  collect(node, into);
  return into.join('\u0000');
}

function collect(node: unknown, into: string[]): void {
  if (typeof node === 'string') {
    into.push(node);
  } else if (Array.isArray(node)) {
    for (const child of node) collect(child, into);
  } else if (node !== null && typeof node === 'object') {
    for (const value of Object.values(node as Record<string, unknown>)) collect(value, into);
  }
}

describe('inspection report PDF band names', () => {
  it('prints the administrator wording in the sub-task and зөрчил tables', () => {
    const text = allText(inspectionReportDocument(fixture(), BRANDING, new Map(), RENAMED_BANDS));

    // The renamed bands reach both tables.
    expect(text).toContain('Онцгой анхаарах');
    expect(text).toContain('Ашиглалтаас хасах');

    // And the compiled ladder reaches the document nowhere, which is the actual defect:
    // the header used to carry the operator's wording while these tables carried the
    // shipped one.
    expect(text).not.toContain(RISK_LEVEL_LABELS.CRITICAL);
    expect(text).not.toContain(RISK_LEVEL_LABELS.OUT_OF_SERVICE);
  });

  it('keeps the shipped ladder when nothing is configured', () => {
    const text = allText(inspectionReportDocument(fixture(), BRANDING));

    // An installation that never opened the settings screen renders exactly as before.
    expect(text).toContain(RISK_LEVEL_LABELS.CRITICAL);
    expect(text).toContain(RISK_LEVEL_LABELS.OUT_OF_SERVICE);
  });

  it('falls back per band, so one renamed band does not blank the others', () => {
    const onlyOne: RiskBand[] = [
      { ...(RENAMED_BANDS[0] as RiskBand) },
      { ...(RENAMED_BANDS[1] as RiskBand), labelMn: '   ' },
    ];
    const text = allText(inspectionReportDocument(fixture(), BRANDING, new Map(), onlyOne));

    expect(text).toContain('Онцгой анхаарах');
    // A band configured to whitespace has had no wording decision made about it.
    expect(text).toContain(RISK_LEVEL_LABELS.OUT_OF_SERVICE);
  });
});
