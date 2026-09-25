import { type InspectionReportDto, type RiskBand } from '@monhorus/shared';

import {
  formatDate,
  formatLongDate,
  formatQuantity,
  formatScore,
  formatYear,
  joinParts,
} from './report-pdf.format';
import { riskBandLabelOf } from '../settings/risk-band.label';
import { signatureLeader } from './pdf-template';
import type { ReportBranding } from './report-branding';

/**
 * What the consolidated inspection report says, independent of how it is drawn.
 *
 * The PDF and the Word export both read from here, so the two files cannot drift apart:
 * a label, a row or a fallback changed in one place changes in both. Everything below is
 * plain strings and numbers — the renderers own the layout, this owns the words.
 */

/**
 * The title the source document carries, verbatim.
 *
 * This report IS the one «Үзлэгийн тайлан.docx» was written for, so it takes the
 * template's own heading rather than a paraphrase of it.
 */
export const TITLE = 'ЦАХИЛГААНЫ ҮЗЛЭГИЙН ТАЙЛАН';

/** The bold heading the template puts at the top of its first body page. */
export const BODY_HEADING = 'Цахилгааны үзлэгийн тайлан';

type Row = readonly (string | number)[];

/** A floor's section: its heading and the rows of its sub-task table. */
export interface FloorSection {
  heading: string;
  rows: Row[];
}

/** One sub-task's photographic block, before the pictures are attached. */
export interface DocumentedTask {
  taskId: string;
  workName: string;
  location: string;
  note: string | null;
}

export const TASK_HEADERS = ['Ажлын нэр', 'Гүйцэтгэл', 'Төлөв', 'Үнэлгээ', 'Тайлбар'];
export const ISSUE_HEADERS = ['№', 'Ажлын нэр', 'Байршил', 'Түвшин', 'Нөхцөл', 'Зөвлөмж'];
export const SUMMARY_HEADERS = ['№', 'Үзүүлэлт', 'Утга'];

/**
 * The report's own contractor still wins where it has one — it was resolved when the
 * report was written and is a fact about that inspection — and the configured company
 * is what stands in when it does not.
 */
export function contractorOf(report: InspectionReportDto, branding: ReportBranding): string {
  return report.contractorName ?? branding.companyName;
}

/** The template's own three cover fields, in its order and with its labels. */
export function coverFields(
  report: InspectionReportDto,
  branding: ReportBranding,
): Array<[string, string]> {
  return [
    ['Объект:', joinParts([report.buildingName, report.locationLabel])],
    // Who performed the inspection, which is its own setting: an operator may issue a
    // report under one name and have the work carried out under another.
    ['Үзлэг хийсэн:', branding.inspectionCompany],
    ['Огноо:', formatLongDate(report.inspectionEnd ?? report.createdAt)],
  ];
}

/** The city and year printed at the foot of the cover. */
export function coverFooter(report: InspectionReportDto): [string, string] {
  return ['Улаанбаатар', formatYear(report.inspectionEnd ?? report.createdAt)];
}

/**
 * The template's own organisation table, with its exact three labels, plus the fields
 * this report holds that the blank template left for a pen.
 */
export function organisationRows(
  report: InspectionReportDto,
  contractor: string,
): Array<[string, string]> {
  return [
    ['Төслийн нэр / Project name', report.projectName ?? ''],
    ['Ерөнхий гүйцэтгэгчийн нэр / Company name', contractor],
    ['Ил ба далд ажлын актны нэр / ', report.actName ?? 'Цахилгааны үзлэг'],
    ['Захиалагч / Customer', report.customerName ?? ''],
    ['Байршил / Location', joinParts([report.buildingName, report.locationLabel])],
    ['Ажлын дугаар / Work number', report.workNumber],
    [
      'Үзлэгийн хугацаа / Period',
      [formatDate(report.inspectionStart), formatDate(report.inspectionEnd)]
        .filter((part) => part !== '')
        .join(' — '),
    ],
    [
      'Хариуцсан / Responsible',
      joinParts([
        report.responsibleEmployeeNames.join(', ') || null,
        report.responsibleTeamNames.join(', ') || null,
      ]),
    ],
    ['Үзлэгээр шалгасан / Scope', report.inspectedScope ?? ''],
  ];
}

/**
 * Requirement 8's body: the sub-tasks, grouped by the floor they were done on. A floor
 * with no tasks has no section, as an empty table would say nothing.
 */
export function floorSections(
  report: InspectionReportDto,
  bands: readonly RiskBand[] | null,
): FloorSection[] {
  return report.groups
    .filter((group) => group.tasks.length > 0)
    .map((group) => ({
      heading: `Байршил: ${group.floorName}`,
      rows: group.tasks.map((task) => [
        task.title,
        `${formatQuantity(task.completedQuantity)}/${formatQuantity(task.totalQuantity)} ${task.unit}`,
        task.skipped ? `${task.statusLabel} (алгассан)` : task.statusLabel,
        [
          formatScore(task.score),
          task.riskLevel === null ? '' : riskBandLabelOf(task.riskLevel, bands),
        ]
          .filter((part) => part !== '')
          .join(' · '),
        task.note ?? '',
      ]),
    }));
}

/**
 * The tasks that get a photographic block. Only tasks that actually carry a photo
 * appear — a block with an empty picture area would be a row of borders saying nothing.
 */
export function documentedTasks(
  report: InspectionReportDto,
  hasPhotos: (taskId: string) => boolean,
): DocumentedTask[] {
  return report.groups
    .flatMap((group) => group.tasks.map((task) => ({ task, floorName: group.floorName })))
    .filter((entry) => hasPhotos(entry.task.taskId))
    .map((entry) => ({
      taskId: entry.task.taskId,
      workName: entry.task.title,
      location: joinParts([entry.floorName, report.buildingName]),
      note: entry.task.note,
    }));
}

/** "Илэрсэн зөрчил" — the findings list. */
export function issueRows(
  report: InspectionReportDto,
  bands: readonly RiskBand[] | null,
): Row[] {
  return report.issues.map((issue, index) => [
    index + 1,
    issue.title,
    issue.locationLabel ?? '',
    riskBandLabelOf(issue.riskLevel, bands),
    issue.condition ?? '',
    issue.advice ?? '',
  ]);
}

/**
 * Requirement 9: the conclusion block, in the template's summary-table shape — an index
 * column, a label, a value — which is how its final page reads.
 */
export function summaryRows(report: InspectionReportDto): Row[] {
  const rows: Row[] = [
    ['', 'Цахилгаан үзлэг хийсэн огноо:', formatLongDate(report.inspectionEnd ?? report.createdAt)],
    [1, 'Байршил:', joinParts([report.buildingName, report.locationLabel])],
    [2, 'Үзлэгээр шалгасан:', report.inspectedScope ?? ''],
    [3, 'Ерөнхий түвшин:', report.overallLabel ?? 'Үнэлгээгүй'],
  ];
  if (report.issueSummary !== null && report.issueSummary !== '') {
    rows.push([4, 'Товч дүгнэлт:', report.issueSummary]);
  }
  return rows;
}

/** The two labelled prose blocks, in print order. Empty ones are dropped by the renderer. */
export function proseBlocks(report: InspectionReportDto): Array<[string, string | null]> {
  return [
    ['Дүгнэлт:', report.conclusion],
    ['Зөвлөмж:', report.recommendation],
  ];
}

/** The "шинэчлэх шаардлагатай" lists that have anything in them. */
export function replacementLists(
  report: InspectionReportDto,
): Array<[string, readonly string[]]> {
  const lists: Array<[string, readonly string[]]> = [];
  if (report.replacementPanels.length > 0) {
    lists.push(['Шинэчлэх шаардлагатай самбарууд:', report.replacementPanels]);
  }
  if (report.replacementConnections.length > 0) {
    lists.push(['Шинэчлэх шаардлагатай холболт:', report.replacementConnections]);
  }
  return lists;
}

/** Requirement 11, and the template's own sign-off wording. */
export function signatureLines(
  report: InspectionReportDto,
  contractor: string,
): Array<{ label: string; value: string }> {
  return [
    { label: 'Тайлан гаргасан:', value: contractor },
    {
      label: 'Тайлан гүйцэтгэсэн:',
      value: signatureLeader(report.createdByName, report.createdByPosition),
    },
    {
      label: 'Хянасан:',
      value: signatureLeader(report.approvedByName, report.approvedByPosition),
    },
    { label: 'Хүлээн авсан:', value: signatureLeader(null, null) },
    { label: 'Шалгаж хянасан:', value: signatureLeader(null, null) },
  ];
}
