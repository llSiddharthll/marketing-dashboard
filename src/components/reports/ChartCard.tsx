'use client';

/**
 * A titled chart container with a chart ⇄ table toggle.
 *
 * The table is not a nicety: the status palette's light-mode contrast for four
 * of its colours sits below 3:1, which the palette validation classifies as
 * "relief required". The relief is that every figure in every chart is also
 * readable as text — via this table view and via direct labels — so colour is
 * never the only way to read a number.
 */

import React, { useId, useState } from 'react';
import { BarChart3, Table as TableIcon } from 'lucide-react';

export interface ChartTableColumn {
  header: string;
  /** Right-aligned with tabular figures when true. */
  numeric?: boolean;
}

interface ChartCardProps {
  title: string;
  /** One line explaining what the reader is looking at. */
  subtitle?: string;
  columns: ChartTableColumn[];
  rows: (string | number)[][];
  children: React.ReactNode;
  /** Extra header controls, e.g. a dimension selector. */
  controls?: React.ReactNode;
  className?: string;
}

export const ChartCard: React.FC<ChartCardProps> = ({
  title,
  subtitle,
  columns,
  rows,
  children,
  controls,
  className = '',
}) => {
  const [view, setView] = useState<'chart' | 'table'>('chart');
  const headingId = useId();

  return (
    <section aria-labelledby={headingId} className={`card ${className}`}>
      <div className="flex flex-wrap items-start justify-between gap-2 px-4 py-3 border-b border-line">
        <div className="min-w-0">
          <h2 id={headingId} className="text-card-title">
            {title}
          </h2>
          {subtitle && <p className="text-meta mt-0.5">{subtitle}</p>}
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {controls}
          <div
            role="radiogroup"
            aria-label={`${title}: show as chart or table`}
            className="inline-flex items-center gap-0.5 p-0.5 bg-surface-sunken border border-line rounded-lg"
          >
            {(
              [
                { value: 'chart', label: 'Chart', Icon: BarChart3 },
                { value: 'table', label: 'Table', Icon: TableIcon },
              ] as const
            ).map(({ value, label, Icon }) => (
              <button
                key={value}
                role="radio"
                aria-checked={view === value}
                onClick={() => setView(value)}
                className={`p-1.5 rounded-md transition-colors ${
                  view === value
                    ? 'bg-surface text-fg shadow-sm'
                    : 'text-fg-subtle hover:text-fg'
                }`}
              >
                <Icon className="w-3.5 h-3.5" aria-hidden="true" />
                <span className="sr-only">{label}</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      {view === 'chart' ? (
        <div className="p-4">{children}</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <caption className="sr-only">{title}, as a table</caption>
            <thead>
              <tr className="border-b border-line bg-surface-sunken/60">
                {columns.map((column) => (
                  <th
                    key={column.header}
                    scope="col"
                    className={`px-4 py-2.5 ${column.numeric ? 'text-right' : ''}`}
                  >
                    <span className="text-label">{column.header}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.length === 0 ? (
                <tr>
                  <td
                    colSpan={columns.length}
                    className="px-4 py-8 text-center text-meta"
                  >
                    No data yet.
                  </td>
                </tr>
              ) : (
                rows.map((row, rowIndex) => (
                  <tr key={rowIndex}>
                    {row.map((value, cellIndex) => (
                      <td
                        key={cellIndex}
                        className={`px-4 py-2.5 text-[13px] ${
                          columns[cellIndex]?.numeric
                            ? 'text-right tabular text-fg-muted'
                            : 'text-fg'
                        }`}
                      >
                        {value}
                      </td>
                    ))}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
};

/** HTML tooltip for Recharts, styled with tokens so it follows the theme. */
export const ChartTooltip = ({
  active,
  payload,
  label,
  formatValue,
}: {
  active?: boolean;
  payload?: { name?: string; value?: number | string; color?: string }[];
  label?: string;
  formatValue?: (value: number | string) => string;
}) => {
  if (!active || !payload || payload.length === 0) return null;

  return (
    <div className="card px-3 py-2 shadow-lg text-[12.5px] space-y-1">
      {label && <p className="font-medium text-fg">{label}</p>}
      {payload.map((entry, index) => (
        <p key={index} className="flex items-center gap-1.5 text-fg-muted">
          <span
            className="w-2 h-2 rounded-full shrink-0"
            style={{ backgroundColor: entry.color }}
            aria-hidden="true"
          />
          {entry.name}:{' '}
          <span className="tabular text-fg">
            {formatValue ? formatValue(entry.value ?? 0) : entry.value}
          </span>
        </p>
      ))}
    </div>
  );
};
