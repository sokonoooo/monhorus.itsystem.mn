import { useId, type ReactElement, type ReactNode } from 'react';

/**
 * Hand-rolled SVG charts.
 *
 * No charting dependency: the repository builds everything else by hand (fetch hooks,
 * form state, tables), the bundle is already over the size warning, and a chart library
 * would still need wrapping to get Cyrillic labels and the existing palette right.
 *
 * Every chart is an `img` to assistive technology with a text summary as its accessible
 * name, because the shapes themselves convey nothing to a screen reader. Each also
 * renders a readable legend or axis, so no figure is only available as geometry.
 */

export interface ChartDatum {
  key: string;
  label: string;
  value: number;
  /** Tailwind-independent CSS colour, so the same value can fill an SVG and a legend dot. */
  colour: string;
}

/** Shared palette. Risk bands keep the colours section 10 assigns them. */
export const CHART_COLOURS = {
  green: '#16a34a',
  amber: '#f59e0b',
  orange: '#ea580c',
  red: '#dc2626',
  black: '#1c1917',
  blue: '#2563eb',
  violet: '#7c3aed',
  slate: '#94a3b8',
  teal: '#0d9488',
  pink: '#db2777',
} as const;

/** Fallback cycle for categorical data that carries no colour of its own. */
export const CATEGORICAL_COLOURS: readonly string[] = [
  CHART_COLOURS.blue,
  CHART_COLOURS.teal,
  CHART_COLOURS.violet,
  CHART_COLOURS.amber,
  CHART_COLOURS.pink,
  CHART_COLOURS.orange,
  CHART_COLOURS.green,
  CHART_COLOURS.slate,
];

// -- Shared card treatment -----------------------------------------------------

/**
 * The frame every dashboard widget sits in.
 *
 * It lives beside the charts rather than in the dashboard feature because the charts need
 * it too, and the page previously grew three near-identical frames that drifted apart. One
 * surface for a widget, one inset tile for a number inside it: two levels, no more.
 *
 * `h-full` matters on a column grid — neighbours in a row stretch to the tallest, and a
 * card that does not fill its cell leaves a visible step in the row.
 */
export function WidgetCard({
  title,
  hint,
  aside,
  flush = false,
  children,
}: {
  title: string;
  hint?: string;
  /** Rendered opposite the title, for a legend or a headline figure. */
  aside?: ReactNode;
  /** Drops the body padding for content that manages its own, such as a divided list. */
  flush?: boolean;
  children: ReactNode;
}): ReactElement {
  return (
    <section className="flex h-full flex-col overflow-hidden rounded-xl bg-white shadow-sm ring-1 ring-slate-200">
      <header className="flex items-start justify-between gap-3 px-4 pb-2.5 pt-3.5">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
          {hint && <p className="mt-0.5 text-xs leading-snug text-slate-500">{hint}</p>}
        </div>
        {aside && <div className="shrink-0">{aside}</div>}
      </header>
      <div className={`flex min-h-0 flex-1 flex-col ${flush ? '' : 'px-4 pb-4'}`}>{children}</div>
    </section>
  );
}

/**
 * A single number inside a widget.
 *
 * Inset and grey rather than another white card: a white tile on a white card reads as a
 * second surface and the page stops looking like one system.
 */
export function StatTile({
  label,
  value,
  tone = 'default',
}: {
  label: string;
  value: number | string;
  tone?: 'default' | 'warning' | 'danger' | 'positive';
}): ReactElement {
  const toneClass =
    tone === 'danger'
      ? 'text-red-700'
      : tone === 'warning'
        ? 'text-amber-700'
        : tone === 'positive'
          ? 'text-green-700'
          : 'text-slate-900';

  // Currency strings run to a dozen characters and would wrap in a narrow column at the
  // size a bare count is set in, so the type scales with what is actually being shown.
  const valueClass = typeof value === 'string' ? 'text-lg' : 'text-2xl';

  return (
    <div className="rounded-lg bg-slate-50 px-3 py-2 ring-1 ring-inset ring-slate-200 transition-colors group-hover/tile:bg-slate-100">
      <p className="truncate text-xs font-medium text-slate-500">{label}</p>
      <p className={`mt-0.5 font-semibold tabular-nums ${valueClass} ${toneClass}`}>{value}</p>
    </div>
  );
}

function EmptyChart({ message }: { message: string }): ReactElement {
  return (
    <div className="flex h-40 flex-1 items-center justify-center rounded-lg bg-slate-50 text-xs text-slate-500">
      {message}
    </div>
  );
}

// -- Donut ---------------------------------------------------------------------

/** Polar to cartesian on a unit circle scaled to `radius`, starting at twelve o'clock. */
function pointOnCircle(cx: number, cy: number, radius: number, fraction: number): [number, number] {
  const angle = fraction * 2 * Math.PI - Math.PI / 2;
  return [cx + radius * Math.cos(angle), cy + radius * Math.sin(angle)];
}

/**
 * Donut chart.
 *
 * A donut rather than a filled pie: the hole carries the total, which is the number
 * people actually read off this shape, and arc lengths stay easier to compare than
 * wedge areas.
 */
export function DonutChart({
  title,
  hint,
  data,
  centreLabel,
  emptyMessage = 'Мэдээлэл алга',
}: {
  title: string;
  hint?: string;
  data: readonly ChartDatum[];
  centreLabel?: string;
  emptyMessage?: string;
}): ReactElement {
  const total = data.reduce((sum, entry) => sum + entry.value, 0);

  if (total === 0) {
    return (
      <WidgetCard title={title} hint={hint}>
        <EmptyChart message={emptyMessage} />
      </WidgetCard>
    );
  }

  // Sized to leave room for the legend beside it in a one-third-width column; below that
  // the legend wraps under the ring rather than squeezing the labels.
  const size = 148;
  const centre = size / 2;
  const outer = 64;
  const inner = 42;

  let cursor = 0;
  const arcs = data
    .filter((entry) => entry.value > 0)
    .map((entry) => {
      const fraction = entry.value / total;
      const start = cursor;
      const end = cursor + fraction;
      cursor = end;

      // A single slice covering the whole circle cannot be drawn as one arc, because the
      // start and end points coincide; it is rendered as a ring instead.
      if (fraction >= 0.999) {
        return { ...entry, fraction, path: null as string | null };
      }

      const [outerStartX, outerStartY] = pointOnCircle(centre, centre, outer, start);
      const [outerEndX, outerEndY] = pointOnCircle(centre, centre, outer, end);
      const [innerEndX, innerEndY] = pointOnCircle(centre, centre, inner, end);
      const [innerStartX, innerStartY] = pointOnCircle(centre, centre, inner, start);
      const largeArc = fraction > 0.5 ? 1 : 0;

      return {
        ...entry,
        fraction,
        path: [
          `M ${outerStartX} ${outerStartY}`,
          `A ${outer} ${outer} 0 ${largeArc} 1 ${outerEndX} ${outerEndY}`,
          `L ${innerEndX} ${innerEndY}`,
          `A ${inner} ${inner} 0 ${largeArc} 0 ${innerStartX} ${innerStartY}`,
          'Z',
        ].join(' '),
      };
    });

  const summary = arcs
    .map((arc) => `${arc.label} ${arc.value} (${Math.round(arc.fraction * 100)}%)`)
    .join(', ');

  return (
    <WidgetCard title={title} hint={hint}>
      <div className="flex flex-1 flex-wrap items-center justify-center gap-x-4 gap-y-3">
        <svg
          width={size}
          height={size}
          viewBox={`0 0 ${size} ${size}`}
          role="img"
          aria-label={`${title}: ${summary}`}
          className="shrink-0"
        >
          {arcs.map((arc) =>
            arc.path === null ? (
              <circle
                key={arc.key}
                cx={centre}
                cy={centre}
                r={(outer + inner) / 2}
                fill="none"
                stroke={arc.colour}
                strokeWidth={outer - inner}
              />
            ) : (
              <path key={arc.key} d={arc.path} fill={arc.colour} />
            ),
          )}
          <text
            x={centre}
            y={centre - 2}
            textAnchor="middle"
            className="fill-slate-900 text-xl font-semibold"
            style={{ fontSize: 22 }}
          >
            {total.toLocaleString('mn-MN')}
          </text>
          {centreLabel && (
            <text
              x={centre}
              y={centre + 16}
              textAnchor="middle"
              className="fill-slate-500"
              style={{ fontSize: 10 }}
            >
              {centreLabel}
            </text>
          )}
        </svg>

        <ul className="min-w-[9rem] flex-1 space-y-1.5">
          {arcs.map((arc) => (
            <li key={arc.key} className="flex items-center gap-2 text-xs">
              <span
                className="h-2.5 w-2.5 shrink-0 rounded-full"
                style={{ backgroundColor: arc.colour }}
                aria-hidden="true"
              />
              <span className="min-w-0 flex-1 truncate text-slate-700">{arc.label}</span>
              <span className="tabular-nums font-medium text-slate-900">{arc.value}</span>
              <span className="w-10 text-right tabular-nums text-slate-400">
                {Math.round(arc.fraction * 100)}%
              </span>
            </li>
          ))}
        </ul>
      </div>
    </WidgetCard>
  );
}

// -- Bars ----------------------------------------------------------------------

/**
 * Horizontal bar chart.
 *
 * Horizontal rather than vertical because the labels are Mongolian words, not short
 * codes, and rotated vertical axis labels are unreadable.
 */
export function BarChart({
  title,
  hint,
  data,
  emptyMessage = 'Мэдээлэл алга',
  valueSuffix = '',
}: {
  title: string;
  hint?: string;
  data: readonly ChartDatum[];
  emptyMessage?: string;
  valueSuffix?: string;
}): ReactElement {
  const max = data.reduce((highest, entry) => Math.max(highest, entry.value), 0);

  if (data.length === 0 || max === 0) {
    return (
      <WidgetCard title={title} hint={hint}>
        <EmptyChart message={emptyMessage} />
      </WidgetCard>
    );
  }

  const summary = data.map((entry) => `${entry.label} ${entry.value}`).join(', ');

  return (
    <WidgetCard title={title} hint={hint}>
      <ul className="space-y-2" role="img" aria-label={`${title}: ${summary}`}>
        {data.map((entry) => (
          <li key={entry.key}>
            <div className="mb-1 flex items-baseline justify-between gap-2 text-xs">
              <span className="min-w-0 truncate text-slate-700">{entry.label}</span>
              <span className="shrink-0 tabular-nums font-medium text-slate-900">
                {entry.value.toLocaleString('mn-MN')}
                {valueSuffix}
              </span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
              <div
                className="h-full rounded-full"
                style={{
                  // Scaled against the largest bar, so the tallest always fills the track
                  // and small differences stay visible.
                  width: `${Math.max(2, (entry.value / max) * 100)}%`,
                  backgroundColor: entry.colour,
                }}
              />
            </div>
          </li>
        ))}
      </ul>
    </WidgetCard>
  );
}

/** Two series side by side per row, for example active versus completed today. */
export interface GroupedBarRow {
  key: string;
  label: string;
  primary: number;
  secondary: number;
}

export function GroupedBarChart({
  title,
  hint,
  rows,
  primaryLabel,
  secondaryLabel,
  emptyMessage = 'Мэдээлэл алга',
}: {
  title: string;
  hint?: string;
  rows: readonly GroupedBarRow[];
  primaryLabel: string;
  secondaryLabel: string;
  emptyMessage?: string;
}): ReactElement {
  const max = rows.reduce(
    (highest, row) => Math.max(highest, row.primary, row.secondary),
    0,
  );

  if (rows.length === 0 || max === 0) {
    return (
      <WidgetCard title={title} hint={hint}>
        <EmptyChart message={emptyMessage} />
      </WidgetCard>
    );
  }

  const summary = rows
    .map((row) => `${row.label}: ${primaryLabel} ${row.primary}, ${secondaryLabel} ${row.secondary}`)
    .join('; ');

  return (
    <WidgetCard title={title} hint={hint}>
      <div className="mb-3 flex flex-wrap gap-3 text-xs">
        <span className="flex items-center gap-1.5">
          <span
            className="h-2.5 w-2.5 rounded-sm"
            style={{ backgroundColor: CHART_COLOURS.blue }}
            aria-hidden="true"
          />
          <span className="text-slate-600">{primaryLabel}</span>
        </span>
        <span className="flex items-center gap-1.5">
          <span
            className="h-2.5 w-2.5 rounded-sm"
            style={{ backgroundColor: CHART_COLOURS.green }}
            aria-hidden="true"
          />
          <span className="text-slate-600">{secondaryLabel}</span>
        </span>
      </div>
      <ul className="space-y-2.5" role="img" aria-label={`${title}: ${summary}`}>
        {rows.map((row) => (
          <li key={row.key}>
            <div className="mb-1 flex items-baseline justify-between gap-2 text-xs">
              <span className="min-w-0 truncate text-slate-700">{row.label}</span>
              <span className="shrink-0 tabular-nums text-slate-500">
                {row.primary} / {row.secondary}
              </span>
            </div>
            <div className="space-y-1">
              <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
                <div
                  className="h-full rounded-full"
                  style={{
                    width: `${Math.max(2, (row.primary / max) * 100)}%`,
                    backgroundColor: CHART_COLOURS.blue,
                  }}
                />
              </div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
                <div
                  className="h-full rounded-full"
                  style={{
                    width: `${Math.max(2, (row.secondary / max) * 100)}%`,
                    backgroundColor: CHART_COLOURS.green,
                  }}
                />
              </div>
            </div>
          </li>
        ))}
      </ul>
    </WidgetCard>
  );
}

// -- Line ----------------------------------------------------------------------

export interface LineSeries {
  key: string;
  label: string;
  colour: string;
  values: readonly number[];
}

/**
 * Multi-series line chart over a shared category axis.
 *
 * The y-axis always starts at zero. Starting it at the data minimum makes a two-unit
 * change look like a collapse, which on a work-volume chart is actively misleading.
 *
 * `hero` is for the one chart a page is built around: taller plot, bigger axis type, and
 * every category labelled instead of every second one.
 */
/**
 * An ISO-ish key as an axis tick.
 *
 * The series this chart draws are keyed by day (`YYYY-MM-DD`) or by month (`YYYY-MM`), and
 * the two need different ticks: `08.20` reads as a date, while the same treatment on a
 * month key leaves a bare `03` that a reader cannot tell from a day number. The shape
 * decides, because the caller passing the key should not also have to pass its formatting.
 */
function axisTick(label: string): string {
  const parts = label.split('-');
  if (parts.length === 2) return `${Number(parts[1])}-р`;
  return label.slice(5).replace('-', '.');
}

export function LineChart({
  title,
  hint,
  labels,
  series,
  hero = false,
  emptyMessage = 'Мэдээлэл алга',
}: {
  title: string;
  hint?: string;
  labels: readonly string[];
  series: readonly LineSeries[];
  hero?: boolean;
  emptyMessage?: string;
}): ReactElement {
  // Gradient ids live in one global document namespace; a second chart with the same
  // series keys would otherwise repaint the first one's fills.
  const gradientPrefix = useId();

  const allValues = series.flatMap((entry) => entry.values);
  const max = Math.max(1, ...allValues);
  const hasData = allValues.some((value) => value > 0);

  const totals = series.map((entry) => ({
    ...entry,
    total: entry.values.reduce((sum, value) => sum + value, 0),
  }));

  // The legend carries each series total, so the two lines can be compared without
  // reading fourteen points off the plot.
  const legend = (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs">
      {totals.map((entry) => (
        <span key={entry.key} className="flex items-center gap-1.5">
          <span
            className="h-1 w-5 shrink-0 rounded-full"
            style={{ backgroundColor: entry.colour }}
            aria-hidden="true"
          />
          <span className="text-slate-600">{entry.label}</span>
          {hasData && (
            <span className="font-semibold tabular-nums text-slate-900">{entry.total}</span>
          )}
        </span>
      ))}
    </div>
  );

  if (labels.length === 0 || !hasData) {
    return (
      <WidgetCard title={title} hint={hint}>
        <EmptyChart message={emptyMessage} />
      </WidgetCard>
    );
  }

  const width = 640;
  const height = hero ? 260 : 180;
  const fontSize = hero ? 11 : 9;
  const padding = { top: 14, right: 14, bottom: hero ? 30 : 24, left: hero ? 34 : 32 };
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;

  const xAt = (index: number): number =>
    labels.length === 1
      ? padding.left + plotWidth / 2
      : padding.left + (index / (labels.length - 1)) * plotWidth;
  const yAt = (value: number): number => padding.top + plotHeight - (value / max) * plotHeight;

  // Four gridlines including zero, rounded so the axis reads in whole units.
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((fraction) => Math.round(max * fraction));
  const uniqueTicks = [...new Set(ticks)];

  // A tick every third day at the hero size, every fourth otherwise: enough to place a
  // point on the calendar without the dates colliding.
  const labelEvery = labels.length > (hero ? 10 : 7) ? (hero ? 3 : 4) : 1;

  const summary = totals.map((entry) => `${entry.label}: ${entry.total}`).join(', ');

  return (
    <WidgetCard title={title} hint={hint} aside={hero ? legend : undefined}>
      {!hero && <div className="mb-2">{legend}</div>}

      <div className="overflow-x-auto">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          className={`w-full min-w-[420px] ${hero ? 'h-[260px]' : 'h-[180px]'}`}
          role="img"
          aria-label={`${title}: ${summary}`}
        >
          <defs>
            {series.map((entry) => (
              <linearGradient
                key={entry.key}
                id={`${gradientPrefix}-${entry.key}`}
                x1="0"
                y1="0"
                x2="0"
                y2="1"
              >
                <stop offset="0%" stopColor={entry.colour} stopOpacity={0.18} />
                <stop offset="100%" stopColor={entry.colour} stopOpacity={0} />
              </linearGradient>
            ))}
          </defs>

          {uniqueTicks.map((tick) => (
            <g key={tick}>
              <line
                x1={padding.left}
                y1={yAt(tick)}
                x2={width - padding.right}
                y2={yAt(tick)}
                stroke={tick === 0 ? '#cbd5e1' : '#e2e8f0'}
                strokeWidth={1}
              />
              <text
                x={padding.left - 6}
                y={yAt(tick) + 3}
                textAnchor="end"
                className="fill-slate-400"
                style={{ fontSize }}
              >
                {tick}
              </text>
            </g>
          ))}

          {series.map((entry) => {
            const points = entry.values.map((value, index) => `${xAt(index)},${yAt(value)}`);

            return (
              <g key={entry.key}>
                {/* Tinted area under the line: two series read as two volumes, not two wires. */}
                <polygon
                  fill={`url(#${gradientPrefix}-${entry.key})`}
                  points={[
                    `${xAt(0)},${yAt(0)}`,
                    ...points,
                    `${xAt(entry.values.length - 1)},${yAt(0)}`,
                  ].join(' ')}
                />
                <polyline
                  fill="none"
                  stroke={entry.colour}
                  strokeWidth={hero ? 2.5 : 2}
                  strokeLinejoin="round"
                  strokeLinecap="round"
                  points={points.join(' ')}
                />
                {entry.values.map((value, index) => (
                  <circle
                    key={`${entry.key}-${index}`}
                    cx={xAt(index)}
                    cy={yAt(value)}
                    r={hero ? 3 : 2.5}
                    fill="#ffffff"
                    stroke={entry.colour}
                    strokeWidth={hero ? 2 : 1.5}
                  />
                ))}
              </g>
            );
          })}

          {labels.map((label, index) =>
            index % labelEvery === 0 ? (
              <text
                key={label}
                x={xAt(index)}
                y={height - (hero ? 10 : 8)}
                textAnchor="middle"
                className="fill-slate-500"
                style={{ fontSize }}
              >
                {axisTick(label)}
              </text>
            ) : null,
          )}
        </svg>
      </div>
    </WidgetCard>
  );
}

// -- Progress ------------------------------------------------------------------

/**
 * A single percentage, for example planned-work completion.
 *
 * A null percentage is "nothing to report" and is drawn as a dash over an empty bar: the
 * server sends null rather than zero precisely so this does not read as "everything is at
 * 0%", and rendering it as zero here would put the claim back.
 */
export function ProgressChart({
  title,
  hint,
  percent,
  caption,
}: {
  title: string;
  hint?: string;
  percent: number | null;
  caption?: string;
}): ReactElement {
  if (percent === null) {
    return (
      <WidgetCard title={title} hint={hint}>
        <div
          className="flex flex-1 flex-col justify-center"
          role="img"
          aria-label={`${title}: мэдээлэл алга`}
        >
          <div className="mb-1.5 flex items-baseline justify-between">
            <span className="text-3xl font-semibold tabular-nums text-slate-400">-</span>
            {caption && <span className="text-xs text-slate-500">{caption}</span>}
          </div>
          <div className="h-2.5 w-full overflow-hidden rounded-full bg-slate-100" />
        </div>
      </WidgetCard>
    );
  }

  const clamped = Math.max(0, Math.min(100, percent));
  const tone =
    clamped >= 75 ? CHART_COLOURS.green : clamped >= 40 ? CHART_COLOURS.amber : CHART_COLOURS.red;

  return (
    <WidgetCard title={title} hint={hint}>
      {/* Centred: one figure in a card that stretches to its neighbours would otherwise
          hang from the top of an otherwise empty tile. */}
      <div className="flex flex-1 flex-col justify-center" role="img" aria-label={`${title}: ${clamped}%`}>
        <div className="mb-1.5 flex items-baseline justify-between">
          <span className="text-3xl font-semibold tabular-nums text-slate-900">{clamped}%</span>
          {caption && <span className="text-xs text-slate-500">{caption}</span>}
        </div>
        <div className="h-2.5 w-full overflow-hidden rounded-full bg-slate-100">
          <div
            className="h-full rounded-full transition-all"
            style={{ width: `${clamped}%`, backgroundColor: tone }}
          />
        </div>
      </div>
    </WidgetCard>
  );
}
