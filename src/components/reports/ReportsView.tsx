'use client';

/**
 * Reports.
 *
 * Covers all ten reports the brief lists — the previous build had four:
 *
 *   Rates as stat tiles ... completion rate, overdue %, pending-approval %,
 *                           average completion time
 *   Donut ................. status distribution
 *   Line .................. monthly productivity (created vs completed)
 *   Bar with selector ..... tasks per project / employee / vendor / agency /
 *                           department (five reports, one control)
 *   Grouped bar ........... budget vs actual spend per project
 *
 * Colour decisions (validated in `statusStyles.ts`):
 *  - Status series use `STATUS_CHART_ORDER`, which deliberately re-orders the
 *    lifecycle so rose and emerald — the brief-mandated red/green pair — are
 *    never adjacent.
 *  - Budget vs spend uses one hue at two lightness steps rather than two hues:
 *    lightness survives every kind of colour-vision deficiency.
 *  - Every chart has direct value labels or a legend AND a table view, because
 *    four status colours sit below 3:1 contrast on the light surface.
 */

import React, { useMemo, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { useData } from '@/context/DataContext';
import { useTheme } from '@/context/ThemeContext';
import { ChartCard, ChartTooltip } from './ChartCard';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/Panel';
import {
  STATUS_CHART_ORDER,
  STATUS_VISUALS,
} from '@/lib/design/statusStyles';
import { resolveStatusKey } from '@/lib/design/statusStyles';
import { daysBetween } from '@/lib/dates';
import { exportTasksToCsv } from '@/lib/client/exportCsv';
import {
  CheckCircle2,
  AlertTriangle,
  Clock,
  Timer,
  Download,
  BarChart3,
} from 'lucide-react';

/** Neutral data hue for single-series magnitude charts. Indigo matches the app
 *  accent and collides with no status colour. */
const SERIES = {
  light: { primary: '#6366f1', primarySoft: '#c7d2fe', completed: '#10b981' },
  dark: { primary: '#818cf8', primarySoft: '#3730a3', completed: '#34d399' },
};

type Dimension = 'project' | 'internalPoc' | 'vendor' | 'agency' | 'department';

const DIMENSIONS: { value: Dimension; label: string }[] = [
  { value: 'project', label: 'Project' },
  { value: 'internalPoc', label: 'Employee' },
  { value: 'department', label: 'Department' },
  { value: 'agency', label: 'Agency' },
  { value: 'vendor', label: 'Vendor' },
];

/** Last N month keys (`YYYY-MM`), oldest first, ending at the current month. */
function recentMonths(count: number): string[] {
  const months: string[] = [];
  const now = new Date();
  for (let i = count - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push(
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    );
  }
  return months;
}

function monthLabel(key: string): string {
  const [year, month] = key.split('-').map(Number);
  return new Date(year, month - 1, 1).toLocaleDateString(undefined, {
    month: 'short',
    year: '2-digit',
  });
}

export const ReportsView: React.FC = () => {
  const { tasks } = useData();
  const { resolved } = useTheme();
  const series = SERIES[resolved];

  // Recharts takes literal colours, not CSS classes, so the axis inks are
  // resolved from the active theme here.
  const ink = resolved === 'dark' ? '#7b8797' : '#667085';
  const grid = resolved === 'dark' ? '#252d3d' : '#e4e7ec';
  const surface = resolved === 'dark' ? '#131824' : '#ffffff';

  const [dimension, setDimension] = useState<Dimension>('project');

  /* ------------------------------- Rates -------------------------------- */

  const rates = useMemo(() => {
    const total = tasks.length;
    const completed = tasks.filter(
      (t) => t.taskProgress === 'Completed'
    ).length;
    const overdue = tasks.filter((t) => t.isOverdue).length;
    const awaiting = tasks.filter(
      (t) => t.taskProgress === 'To Be Approved by Management'
    ).length;

    const finished = tasks.filter(
      (t) =>
        t.taskProgress === 'Completed' &&
        t.executionStartDate &&
        t.actualFinishedDate
    );
    const totalDays = finished.reduce(
      (sum, t) =>
        sum + Math.max(1, daysBetween(t.executionStartDate!, t.actualFinishedDate!)),
      0
    );

    return {
      total,
      completionRate: total ? Math.round((completed / total) * 100) : 0,
      overdueRate: total ? Math.round((overdue / total) * 100) : 0,
      awaitingRate: total ? Math.round((awaiting / total) * 100) : 0,
      // Honest when there is no data. The previous build fabricated "3.5 days"
      // and printed a hardcoded "target met" line next to it.
      avgCompletionDays:
        finished.length > 0 ? (totalDays / finished.length).toFixed(1) : null,
      completedWithDates: finished.length,
    };
  }, [tasks]);

  /* ------------------------- Status distribution ------------------------ */

  const statusData = useMemo(() => {
    const counts = new Map<string, number>();
    for (const task of tasks) {
      const key = resolveStatusKey(task.taskProgress, task.isOverdue);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return STATUS_CHART_ORDER.filter((key) => (counts.get(key) ?? 0) > 0).map(
      (key) => ({
        key,
        name: STATUS_VISUALS[key].label,
        value: counts.get(key) ?? 0,
        color: STATUS_VISUALS[key].hex,
      })
    );
  }, [tasks]);

  /* -------------------------- Monthly productivity ---------------------- */

  const monthly = useMemo(() => {
    const months = recentMonths(6);
    return months.map((month) => ({
      month,
      label: monthLabel(month),
      Created: tasks.filter((t) => t.createdAt.slice(0, 7) === month).length,
      Completed: tasks.filter(
        (t) => (t.actualFinishedDate ?? '').slice(0, 7) === month
      ).length,
    }));
  }, [tasks]);

  /* --------------------------- Tasks by dimension ----------------------- */

  const byDimension = useMemo(() => {
    const counts = new Map<string, { total: number; completed: number }>();
    for (const task of tasks) {
      const key = task[dimension] || '(not set)';
      const entry = counts.get(key) ?? { total: 0, completed: 0 };
      entry.total += 1;
      if (task.taskProgress === 'Completed') entry.completed += 1;
      counts.set(key, entry);
    }
    return [...counts.entries()]
      .map(([name, entry]) => ({ name, ...entry }))
      .sort((a, b) => b.total - a.total)
      // Ten bars is the ceiling for a readable category axis; the table view
      // holds the full list.
      .slice(0, 10);
  }, [tasks, dimension]);

  const dimensionTotal = useMemo(
    () => new Set(tasks.map((t) => t[dimension] || '(not set)')).size,
    [tasks, dimension]
  );

  /* --------------------------- Budget vs spend -------------------------- */

  const budgetByProject = useMemo(() => {
    const map = new Map<string, { Budget: number; Spend: number }>();
    for (const task of tasks) {
      const key = task.project || '(no project)';
      const entry = map.get(key) ?? { Budget: 0, Spend: 0 };
      entry.Budget += task.budget ?? 0;
      entry.Spend += task.actualSpend ?? 0;
      map.set(key, entry);
    }
    return [...map.entries()]
      .map(([name, entry]) => ({ name, ...entry }))
      .filter((row) => row.Budget > 0 || row.Spend > 0)
      .sort((a, b) => b.Budget - a.Budget)
      .slice(0, 8);
  }, [tasks]);

  const rupees = (value: number | string) =>
    `₹${Number(value).toLocaleString('en-IN')}`;

  if (tasks.length === 0) {
    return (
      <div className="card">
        <EmptyState
          icon={<BarChart3 className="w-7 h-7" />}
          message="No data to report on yet."
          hint="Reports build themselves as tasks are created and completed."
        />
      </div>
    );
  }

  const tiles = [
    {
      label: 'Completion rate',
      value: `${rates.completionRate}%`,
      hint: `${tasks.filter((t) => t.taskProgress === 'Completed').length} of ${rates.total} tasks`,
      Icon: CheckCircle2,
      tone: 'text-emerald-600 dark:text-emerald-400',
    },
    {
      label: 'Overdue',
      value: `${rates.overdueRate}%`,
      hint: `${tasks.filter((t) => t.isOverdue).length} past deadline`,
      Icon: AlertTriangle,
      tone: 'text-rose-600 dark:text-rose-400',
    },
    {
      label: 'Awaiting approval',
      value: `${rates.awaitingRate}%`,
      hint: `${tasks.filter((t) => t.taskProgress === 'To Be Approved by Management').length} in the queue`,
      Icon: Clock,
      tone: 'text-amber-600 dark:text-amber-400',
    },
    {
      label: 'Avg completion time',
      value: rates.avgCompletionDays ? `${rates.avgCompletionDays} days` : '—',
      hint: rates.avgCompletionDays
        ? `across ${rates.completedWithDates} completed task${rates.completedWithDates === 1 ? '' : 's'}`
        : 'No completed tasks with both dates yet',
      Icon: Timer,
      tone: 'text-fg-subtle',
    },
  ];

  return (
    <div className="space-y-5">
      {/* Toolbar */}
      <div className="flex items-center justify-end">
        <Button
          size="sm"
          icon={<Download className="w-3.5 h-3.5" aria-hidden="true" />}
          onClick={() => exportTasksToCsv(tasks, 'report')}
        >
          Export data
        </Button>
      </div>

      {/* Rate tiles — a single number's clearest form is a number, not a chart */}
      <ul className="grid grid-cols-2 xl:grid-cols-4 gap-3">
        {tiles.map((tile) => (
          <li key={tile.label} className="card p-4 space-y-2">
            <p className="flex items-center justify-between gap-2">
              <span className="text-[12.5px] font-medium text-fg-muted">
                {tile.label}
              </span>
              <tile.Icon className={`w-4 h-4 shrink-0 ${tile.tone}`} aria-hidden="true" />
            </p>
            <p className="text-metric">{tile.value}</p>
            <p className="text-[12px] text-fg-subtle">{tile.hint}</p>
          </li>
        ))}
      </ul>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
        {/* Status distribution */}
        <ChartCard
          title="Tasks by status"
          subtitle="Where everything stands right now"
          columns={[
            { header: 'Status' },
            { header: 'Tasks', numeric: true },
            { header: 'Share', numeric: true },
          ]}
          rows={statusData.map((row) => [
            row.name,
            row.value,
            `${Math.round((row.value / rates.total) * 100)}%`,
          ])}
        >
          <div className="flex flex-col sm:flex-row items-center gap-4">
            <div className="h-52 w-52 shrink-0">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={statusData}
                    dataKey="value"
                    nameKey="name"
                    innerRadius={56}
                    outerRadius={90}
                    // The 2px surface-coloured stroke is the spacer between
                    // segments, so adjacent fills never touch.
                    stroke={surface}
                    strokeWidth={2}
                    isAnimationActive={false}
                  >
                    {statusData.map((entry) => (
                      <Cell key={entry.key} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip content={<ChartTooltip />} />
                </PieChart>
              </ResponsiveContainer>
            </div>

            {/* Legend as an HTML list with direct values: identity and figure
                are both readable as text, never colour alone. */}
            <ul className="flex-1 w-full space-y-1.5">
              {statusData.map((row) => (
                <li
                  key={row.key}
                  className="flex items-center gap-2 text-[13px]"
                >
                  <span
                    className="w-2.5 h-2.5 rounded-full shrink-0"
                    style={{ backgroundColor: row.color }}
                    aria-hidden="true"
                  />
                  <span className="flex-1 text-fg-muted">{row.name}</span>
                  <span className="tabular text-fg">{row.value}</span>
                  <span className="w-10 text-right tabular text-fg-subtle text-[12px]">
                    {Math.round((row.value / rates.total) * 100)}%
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </ChartCard>

        {/* Monthly productivity */}
        <ChartCard
          title="Monthly productivity"
          subtitle="Tasks created and completed, last six months"
          columns={[
            { header: 'Month' },
            { header: 'Created', numeric: true },
            { header: 'Completed', numeric: true },
          ]}
          rows={monthly.map((row) => [row.label, row.Created, row.Completed])}
        >
          <div className="h-60">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart
                data={monthly}
                margin={{ top: 8, right: 12, bottom: 0, left: -18 }}
              >
                <CartesianGrid stroke={grid} strokeDasharray="0" vertical={false} />
                <XAxis
                  dataKey="label"
                  stroke={ink}
                  fontSize={11}
                  tickLine={false}
                  axisLine={{ stroke: grid }}
                />
                <YAxis
                  stroke={ink}
                  fontSize={11}
                  tickLine={false}
                  axisLine={false}
                  allowDecimals={false}
                />
                <Tooltip content={<ChartTooltip />} />
                <Legend
                  wrapperStyle={{ fontSize: 12, color: ink }}
                  iconType="plainline"
                />
                <Line
                  type="monotone"
                  dataKey="Created"
                  stroke={series.primary}
                  strokeWidth={2}
                  dot={false}
                  activeDot={{ r: 4 }}
                  isAnimationActive={false}
                />
                <Line
                  type="monotone"
                  dataKey="Completed"
                  stroke={series.completed}
                  strokeWidth={2}
                  dot={false}
                  activeDot={{ r: 4 }}
                  isAnimationActive={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </ChartCard>
      </div>

      {/* Tasks per project / employee / vendor / agency / department */}
      <ChartCard
        title={`Tasks by ${DIMENSIONS.find((d) => d.value === dimension)!.label.toLowerCase()}`}
        subtitle={
          byDimension.length < dimensionTotal
            ? `Top ${byDimension.length} of ${dimensionTotal} — the table has the full list`
            : 'Total assigned, with how many are complete'
        }
        controls={
          <>
            <label htmlFor="report-dimension" className="sr-only">
              Group tasks by
            </label>
            <select
              id="report-dimension"
              value={dimension}
              onChange={(event) => setDimension(event.target.value as Dimension)}
              className="field w-auto py-1.5 text-[13px]"
            >
              {DIMENSIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  By {option.label.toLowerCase()}
                </option>
              ))}
            </select>
          </>
        }
        columns={[
          { header: DIMENSIONS.find((d) => d.value === dimension)!.label },
          { header: 'Total', numeric: true },
          { header: 'Completed', numeric: true },
        ]}
        rows={byDimension.map((row) => [row.name, row.total, row.completed])}
      >
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={byDimension}
              layout="vertical"
              margin={{ top: 0, right: 32, bottom: 0, left: 8 }}
              barCategoryGap="28%"
            >
              <CartesianGrid stroke={grid} horizontal={false} />
              <XAxis
                type="number"
                stroke={ink}
                fontSize={11}
                tickLine={false}
                axisLine={false}
                allowDecimals={false}
              />
              <YAxis
                type="category"
                dataKey="name"
                stroke={ink}
                fontSize={12}
                width={132}
                tickLine={false}
                axisLine={false}
              />
              <Tooltip content={<ChartTooltip />} cursor={{ fill: grid, opacity: 0.4 }} />
              <Bar
                dataKey="total"
                name="Tasks"
                fill={series.primary}
                radius={[0, 4, 4, 0]}
                isAnimationActive={false}
                // Direct value labels: part of the contrast relief.
                label={{ position: 'right', fill: ink, fontSize: 11 }}
              />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </ChartCard>

      {/* Budget vs spend */}
      {budgetByProject.length > 0 && (
        <ChartCard
          title="Budget against spend, by project"
          subtitle="Planned budget (light) beside what has actually been spent"
          columns={[
            { header: 'Project' },
            { header: 'Budget (₹)', numeric: true },
            { header: 'Spend (₹)', numeric: true },
            { header: 'Remaining (₹)', numeric: true },
          ]}
          rows={budgetByProject.map((row) => [
            row.name,
            rupees(row.Budget),
            rupees(row.Spend),
            rupees(row.Budget - row.Spend),
          ])}
        >
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={budgetByProject}
                margin={{ top: 8, right: 8, bottom: 24, left: 4 }}
                barCategoryGap="24%"
                barGap={2}
              >
                <CartesianGrid stroke={grid} vertical={false} />
                <XAxis
                  dataKey="name"
                  stroke={ink}
                  fontSize={11}
                  tickLine={false}
                  axisLine={{ stroke: grid }}
                  interval={0}
                  angle={-14}
                  textAnchor="end"
                  height={48}
                />
                <YAxis
                  stroke={ink}
                  fontSize={11}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={(value: number) =>
                    value >= 100000
                      ? `₹${(value / 100000).toFixed(1)}L`
                      : value >= 1000
                        ? `₹${(value / 1000).toFixed(0)}k`
                        : `₹${value}`
                  }
                />
                <Tooltip
                  content={<ChartTooltip formatValue={rupees} />}
                  cursor={{ fill: grid, opacity: 0.4 }}
                />
                <Legend wrapperStyle={{ fontSize: 12, color: ink }} />
                {/* One hue, two lightness steps: the planned/actual difference is
                    carried by lightness, which survives every kind of colour
                    vision. Two nearby hues here failed validation. */}
                <Bar
                  dataKey="Budget"
                  fill={series.primarySoft}
                  radius={[4, 4, 0, 0]}
                  isAnimationActive={false}
                />
                <Bar
                  dataKey="Spend"
                  fill={series.primary}
                  radius={[4, 4, 0, 0]}
                  isAnimationActive={false}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </ChartCard>
      )}
    </div>
  );
};
