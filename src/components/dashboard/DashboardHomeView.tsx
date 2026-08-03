'use client';

import React, { useMemo } from 'react';
import Link from 'next/link';
import { useData } from '@/context/DataContext';
import { TodayTasks } from './TodayTasks';
import { UpcomingDeadlines } from './UpcomingDeadlines';
import { TeamWorkload } from './TeamWorkload';
import { RecentActivity } from './RecentActivity';
import { RecentlyCompleted } from './RecentlyCompleted';
import { Button } from '@/components/ui/Button';
import { TaskDrawer } from '@/components/tasks/TaskDrawer';
import { today } from '@/lib/dates';
import {
  CheckSquare,
  Clock,
  PlayCircle,
  AlertTriangle,
  Plus,
  CircleDot,
  CheckCircle2,
  ArrowRight,
} from 'lucide-react';

/**
 * Dashboard home.
 *
 * Now shows all six KPI cards the brief asks for. The previous version showed
 * four, two of which were renamed ("Total Deliverables", "In Execution"), so
 * "Pending tasks" and "Completed" were missing entirely.
 */
export const DashboardHomeView: React.FC = () => {
  const { tasks, currentUserRole } = useData();
  const [isCreating, setIsCreating] = React.useState(false);

  const canCreate =
    currentUserRole === 'Admin' || currentUserRole === 'Marketing Team';

  // Memoised: this recomputes on every keystroke of the global search otherwise.
  const kpis = useMemo(() => {
    const notStarted = tasks.filter(
      (task) => task.taskProgress === 'Not Started'
    ).length;
    const inProgress = tasks.filter(
      (task) => task.taskProgress === 'In Progress'
    ).length;
    const awaitingApproval = tasks.filter(
      (task) => task.taskProgress === 'To Be Approved by Management'
    ).length;
    const completed = tasks.filter(
      (task) => task.taskProgress === 'Completed'
    ).length;
    const overdue = tasks.filter((task) => task.isOverdue).length;

    return [
      {
        label: 'Total tasks',
        value: tasks.length,
        hint: 'Everything on the board',
        Icon: CheckSquare,
        href: '/tasks',
        tone: 'neutral' as const,
      },
      {
        label: 'Not started',
        value: notStarted,
        hint: 'Waiting to be picked up',
        Icon: CircleDot,
        href: '/tasks?status=Not+Started',
        tone: 'neutral' as const,
      },
      {
        label: 'In progress',
        value: inProgress,
        hint: 'Being worked on now',
        Icon: PlayCircle,
        href: '/tasks?status=In+Progress',
        tone: 'info' as const,
      },
      {
        label: 'Awaiting approval',
        value: awaitingApproval,
        hint: 'Needs management sign-off',
        Icon: Clock,
        href: '/approvals',
        tone: 'warn' as const,
      },
      {
        label: 'Completed',
        value: completed,
        hint: 'Signed off and done',
        Icon: CheckCircle2,
        href: '/tasks?status=Completed',
        tone: 'good' as const,
      },
      {
        label: 'Overdue',
        value: overdue,
        hint: 'Past the deadline',
        Icon: AlertTriangle,
        href: '/tasks?overdue=1',
        tone: 'bad' as const,
      },
    ];
  }, [tasks]);

  const overdueCount = kpis[5].value;
  const approvalCount = kpis[3].value;
  const dueToday = useMemo(
    () => tasks.filter((task) => task.deadline === today()).length,
    [tasks]
  );

  const TONES = {
    neutral: 'text-fg-subtle',
    info: 'text-blue-600 dark:text-blue-400',
    warn: 'text-amber-600 dark:text-amber-400',
    good: 'text-emerald-600 dark:text-emerald-400',
    bad: 'text-rose-600 dark:text-rose-400',
  };

  return (
    <div className="space-y-6">
      {/* A short, factual summary line replaces the previous hero banner, which
          claimed "Real-time synchronisation active" regardless of whether
          anything was actually connected. */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-body text-fg-muted">
          {tasks.length === 0
            ? 'No tasks yet.'
            : [
                dueToday > 0 && `${dueToday} due today`,
                approvalCount > 0 && `${approvalCount} awaiting approval`,
                overdueCount > 0 && `${overdueCount} overdue`,
              ]
                .filter(Boolean)
                .join(' · ') || 'Nothing needs attention today.'}
        </p>

        <div className="flex items-center gap-2">
          {approvalCount > 0 && (
            <Link href="/approvals">
              <Button variant="secondary" size="sm">
                Review approvals
              </Button>
            </Link>
          )}
          {canCreate && (
            <Button
              variant="primary"
              size="sm"
              icon={<Plus className="w-4 h-4" aria-hidden="true" />}
              onClick={() => setIsCreating(true)}
            >
              New task
            </Button>
          )}
        </div>
      </div>

      {/* Six KPIs. Each links to the filtered list it represents, so the number
          is a way in rather than just a statistic. */}
      <ul className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3">
        {kpis.map((kpi) => (
          <li key={kpi.label}>
            <Link
              href={kpi.href}
              className="card p-4 h-full flex flex-col justify-between gap-3 hover:border-line-strong transition-colors group"
            >
              <div className="flex items-start justify-between gap-2">
                <span className="text-[12.5px] font-medium text-fg-muted leading-snug">
                  {kpi.label}
                </span>
                <kpi.Icon
                  className={`w-4 h-4 shrink-0 ${TONES[kpi.tone]}`}
                  aria-hidden="true"
                />
              </div>
              <div>
                <span className="block text-metric">{kpi.value}</span>
                <span className="block text-[12px] text-fg-subtle mt-0.5 truncate">
                  {kpi.hint}
                </span>
              </div>
            </Link>
          </li>
        ))}
      </ul>

      {/* Panels */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
        <TodayTasks />
        <UpcomingDeadlines />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
        <RecentlyCompleted />
        <TeamWorkload />
      </div>

      <RecentActivity />

      <div className="flex justify-center pt-2">
        <Link
          href="/reports"
          className="inline-flex items-center gap-1.5 text-[13px] font-medium text-fg-muted hover:text-fg transition-colors"
        >
          See the full reports
          <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />
        </Link>
      </div>

      <TaskDrawer
        isOpen={isCreating}
        onClose={() => setIsCreating(false)}
        taskToEdit={null}
      />
    </div>
  );
};
