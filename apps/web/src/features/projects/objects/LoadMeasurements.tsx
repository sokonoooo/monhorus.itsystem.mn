import {
  LOAD_MEASUREMENT_KIND_LABELS,
  formatLoadMeasurement,
  type LoadMeasurementDto,
} from '@monhorus/shared';
import type { ReactElement } from 'react';

/**
 * Stored load readings, read-only.
 *
 * THE EDITOR THAT USED TO LIVE HERE IS GONE. "Бусад хэмжилт (А, В)" was removed from the
 * assessment form — in this app and in the employee app together, so the two do not drift —
 * because the per-type attributes a technician now answers there are what that form is for.
 * "Хэмжсэн ачаалал (kW)" is untouched: it is the authoritative summable figure the floor
 * totals add up, and it was never part of the section that went.
 *
 * WHAT WAS RECORDED IS STILL SHOWN, which is why this file remains. `ILoadMeasurement`,
 * `ObjectAssessmentDto.measurements` and the API that accepts them are all untouched: the
 * assessment collection is append-only by policy, the readings on entries already stored are
 * real observations somebody took on site, and a form no longer offering a field is not a
 * reason to stop displaying that field's history. Nothing was migrated and nothing deleted.
 *
 * A client may still POST `measurements`; the API still accepts them, and they render here.
 */
export function LoadMeasurementList({
  measurements,
}: {
  measurements: readonly LoadMeasurementDto[];
}): ReactElement | null {
  // Nothing at all rather than an empty heading: most assessments carry only a kW figure, and
  // every assessment recorded before readings existed carries none.
  if (measurements.length === 0) return null;

  return (
    <ul className="flex flex-wrap gap-1.5">
      {measurements.map((reading, index) => (
        <li
          key={`${reading.kind}-${reading.phase ?? ''}-${index}`}
          className="rounded-md bg-slate-50 px-2 py-1 text-xs text-slate-700 ring-1 ring-inset ring-slate-200"
        >
          <span className="text-slate-500">{LOAD_MEASUREMENT_KIND_LABELS[reading.kind]}</span>{' '}
          <span className="font-medium text-slate-900">{formatLoadMeasurement(reading)}</span>
        </li>
      ))}
    </ul>
  );
}
