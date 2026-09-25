import JSZip from 'jszip';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';

import { docxFilename } from '../inspection-report/inspection-report.controller';
import { renderInspectionReportDocx } from './inspection-report.docx';
import type { BrandingImage } from './pdf-template';
import type { ReportBranding } from './report-branding';

/**
 * The Word export, asserted by opening the file it produces.
 *
 * A .docx is a zip of XML parts, so each case unpacks the real bytes and reads the body
 * and the document properties — the same thing Word does, short of drawing it.
 */

const CONTRACTOR = '"Монхорус Электрик" ХХК';
const CUSTOMER = 'Central Tower ХХК';

const BRANDING: ReportBranding = {
  logo: null,
  customerLogo: null,
  companyName: CONTRACTOR,
  inspectionCompany: 'Үзлэг Сервис ХХК',
};

function fixture(overrides: Partial<Record<string, unknown>> = {}): Parameters<
  typeof renderInspectionReportDocx
>[0] {
  return {
    id: 'i1',
    plannedWorkId: 'w1',
    status: 'FINALISED',
    version: 1,
    workNumber: 'PW-202608-0007',
    workTitle: 'Цахилгааны сарын үзлэг',
    customerName: CUSTOMER,
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
            status: 'DONE',
            statusLabel: 'Дууссан',
            skipped: false,
            score: 38,
            riskLevel: 'CRITICAL',
            note: 'Газардуулга холбогдоогүй.',
            totalQuantity: 2,
            completedQuantity: 1.5,
            unit: 'ш',
            attachments: [],
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
        condition: 'Нөхцөл муу.',
        advice: 'Яаралтай холбох.',
      },
    ],
    overallLevel: 'OUT_OF_SERVICE',
    overallLabel: 'Ашиглах боломжгүй',
    issueSummary: 'Нэг зөрчил илэрсэн.',
    conclusion: 'Эхний мөр.\nХоёр дахь мөр.',
    recommendation: 'Зөвлөмж өгөв.',
    replacementPanels: ['А агуулахын самбар'],
    replacementConnections: ['ЕС-1 холболт'],
    isAutoDraft: false,
    createdByName: 'Б.Мөнхтуяа',
    createdByPosition: 'Техникч',
    createdAt: '2026-08-11T10:00:00.000Z',
    approvedByName: null,
    approvedByPosition: null,
    ...overrides,
  } as never;
}

async function photo(width: number, height: number): Promise<BrandingImage> {
  const data = await sharp({
    create: { width, height, channels: 3, background: { r: 200, g: 80, b: 40 } },
  })
    .jpeg()
    .toBuffer();
  return { dataUrl: `data:image/jpeg;base64,${data.toString('base64')}`, width, height };
}

async function open(docx: Buffer) {
  const zip = await JSZip.loadAsync(docx);
  const part = async (name: string): Promise<string> =>
    (await zip.file(name)?.async('string')) ?? '';
  const body = await part('word/document.xml');
  return {
    zip,
    body,
    core: await part('docProps/core.xml'),
    /** The text of every paragraph, in order, as a reader sees it. */
    paragraphs: [...body.matchAll(/<w:p[ >][\s\S]*?<\/w:p>/g)].map((match) =>
      [...match[0].matchAll(/<w:t(?: [^>]*)?>([^<]*)<\/w:t>/g)].map((t) => t[1]).join(''),
    ),
  };
}

describe('inspection report Word export', () => {
  it('produces a real .docx titled after the customer', async () => {
    const docx = await renderInspectionReportDocx(fixture(), BRANDING);
    expect(docx.subarray(0, 2).toString('latin1')).toBe('PK');

    const { body, core, paragraphs } = await open(docx);
    expect(core).toContain(`<dc:title>${CUSTOMER}</dc:title>`);
    // The first thing in the document is the customer's name, in Word's own Title style.
    expect(paragraphs[0]).toBe(CUSTOMER);
    expect(body.indexOf('w:val="Title"')).toBeLessThan(body.indexOf(CUSTOMER));
  });

  it('carries everything the PDF prints, in Cyrillic as written', async () => {
    const { paragraphs } = await open(await renderInspectionReportDocx(fixture(), BRANDING));
    const text = paragraphs.join('\n');

    for (const expected of [
      'ЦАХИЛГААНЫ ҮЗЛЭГИЙН ТАЙЛАН',
      'Объект: Төв байр · Сүхбаатар дүүрэг',
      'Үзлэг хийсэн: Үзлэг Сервис ХХК',
      'Огноо: 2026 оны 8 сарын 11',
      '2026 он',
      'Цахилгааны үзлэгийн тайлан',
      'Ерөнхий гүйцэтгэгчийн нэр / Company name',
      'PW-202608-0007',
      '2026.08.01 — 2026.08.11',
      'Байршил: 1-р давхар',
      '1.5/2 ш',
      'Илэрсэн зөрчил',
      'Яаралтай холбох.',
      'Ашиглах боломжгүй',
      'Нэг зөрчил илэрсэн.',
      'Эхний мөр.',
      'Хоёр дахь мөр.',
      'Зөвлөмж өгөв.',
      'А агуулахын самбар',
      'ЕС-1 холболт',
      'Тайлан гүйцэтгэсэн:',
      '................................./Б.Мөнхтуяа, Техникч/',
    ]) {
      expect(text, expected).toContain(expected);
    }
  });

  it('falls back to the report title when the work has no customer', async () => {
    const { core, paragraphs } = await open(
      await renderInspectionReportDocx(fixture({ customerName: null }), BRANDING),
    );
    expect(core).toContain('<dc:title>ЦАХИЛГААНЫ ҮЗЛЭГИЙН ТАЙЛАН</dc:title>');
    expect(paragraphs[0]).toBe('ЦАХИЛГААНЫ ҮЗЛЭГИЙН ТАЙЛАН');
  });

  it('embeds the letterheads and the task photographs', async () => {
    const logo = await photo(400, 100);
    const pictures = [await photo(800, 600), await photo(600, 800), await photo(800, 600)];
    const { zip, paragraphs } = await open(
      await renderInspectionReportDocx(
        fixture(),
        { ...BRANDING, logo, customerLogo: logo },
        new Map([['t1', pictures]]),
      ),
    );

    const media = Object.keys(zip.files).filter((name) => name.startsWith('word/media/'));
    expect(media.length).toBeGreaterThanOrEqual(4);
    expect(paragraphs.join('\n')).toContain('Гүйцэтгэлийн зураг');
    expect(paragraphs.join('\n')).toContain('Тайлбар: Газардуулга холбогдоогүй.');
  });

  it('still renders when every optional field is empty', async () => {
    const docx = await renderInspectionReportDocx(
      fixture({
        customerName: null,
        projectName: null,
        buildingName: null,
        locationLabel: null,
        inspectionStart: null,
        inspectionEnd: null,
        contractorName: null,
        actName: null,
        inspectedScope: null,
        groups: [],
        issues: [],
        overallLabel: null,
        issueSummary: null,
        conclusion: null,
        recommendation: null,
        replacementPanels: [],
        replacementConnections: [],
        createdByName: null,
        createdByPosition: null,
      }),
      { logo: null, customerLogo: null, companyName: '', inspectionCompany: '' },
    );
    expect(docx.subarray(0, 2).toString('latin1')).toBe('PK');
  });
});

describe('Word export filename', () => {
  it('names the file after the customer and the inspection day', () => {
    expect(docxFilename(fixture())).toBe(
      'Үзлэгийн_нэгдсэн_тайлан_Central_Tower_ХХК_2026-08-11',
    );
  });

  it('drops characters a file system refuses', () => {
    expect(docxFilename(fixture({ customerName: ' "Сод/Монгол" ХХК ' }))).toBe(
      'Үзлэгийн_нэгдсэн_тайлан_СодМонгол_ХХК_2026-08-11',
    );
  });

  it('leaves the customer out when there is none', () => {
    expect(docxFilename(fixture({ customerName: null }))).toBe(
      'Үзлэгийн_нэгдсэн_тайлан_2026-08-11',
    );
  });
});
