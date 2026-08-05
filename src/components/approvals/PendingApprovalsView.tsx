'use client';

import React, { useMemo, useState } from 'react';
import { useData } from '@/context/DataContext';
import type { Task } from '@/types/dashboard';
import { Dialog } from '@/components/ui/Dialog';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/Panel';
import { PriorityIndicator } from '@/components/ui/StatusBadge';
import { TaskDrawer } from '@/components/tasks/TaskDrawer';
import { daysBetween, today } from '@/lib/dates';
import { LIMITS } from '@/lib/validation';
import {
  CheckCircle2,
  XCircle,
  Lock,
  MessageSquare,
  FileSpreadsheet,
} from 'lucide-react';

const formatCost = (value: number | undefined): string =>
  value ? `₹${value.toLocaleString('en-IN')}` : '—';

/**
 * The management approval queue.
 *
 * Adds the three columns the brief lists that were missing — submission date,
 * deadline and comments — now that Phase 1 records `submittedForApprovalAt`.
 *
 * Rejection requires a comment, matching the server, which refuses a rejection
 * without one so the assignee always knows what to change.
 */
export const PendingApprovalsView: React.FC = () => {
  const { tasks, approveTask, rejectTask, currentUserRole } = useData();

  const [rejecting, setRejecting] = useState<Task | null>(null);
  const [reason, setReason] = useState('');
  const [reasonError, setReasonError] = useState<string | null>(null);
  const [viewing, setViewing] = useState<Task | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const canDecide =
    currentUserRole === 'Management' || currentUserRole === 'Admin';

  const pending = useMemo(
    () =>
      tasks
        .filter((task) => task.taskProgress === 'To Be Approved by Management')
        // Longest-waiting first: the queue should be worked front to back.
        .sort((a, b) =>
          (a.submittedForApprovalAt ?? '').localeCompare(
            b.submittedForApprovalAt ?? ''
          )
        ),
    [tasks]
  );

  const handleApprove = async (task: Task) => {
    setBusyId(task.id);
    try {
      await approveTask(task.id);
    } finally {
      setBusyId(null);
    }
  };

  const handleReject = async () => {
    if (!rejecting) return;
    const trimmed = reason.trim();
    if (!trimmed) {
      setReasonError(
        'Explain what needs to change — the assignee sees this message.'
      );
      return;
    }

    setBusyId(rejecting.id);
    try {
      await rejectTask(rejecting.id, trimmed);
      setRejecting(null);
      setReason('');
      setReasonError(null);
    } finally {
      setBusyId(null);
    }
  };

  /** "Waiting 3 days" is more actionable than a raw submission timestamp. */
  const waitingLabel = (task: Task): string => {
    if (!task.submittedForApprovalAt) return 'Unknown';
    const submitted = task.submittedForApprovalAt.slice(0, 10);
    const days = daysBetween(submitted, today());
    if (days <= 0) return 'Today';
    if (days === 1) return '1 day';
    return `${days} days`;
  };

  if (pending.length === 0) {
    return (
      <div className="card">
        <EmptyState
          icon={<CheckCircle2 className="w-7 h-7" />}
          message="Nothing is waiting for approval."
          hint="Tasks submitted by the team will appear here."
        />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {!canDecide && (
        <div
          role="status"
          className="flex items-start gap-2 p-3.5 rounded-lg bg-surface-sunken border border-line text-[13px] text-fg-muted"
        >
          <Lock className="w-4 h-4 mt-0.5 shrink-0" aria-hidden="true" />
          <span>
            You are signed in as {currentUserRole}. Approving or rejecting needs
            the Management or Admin role.
          </span>
        </div>
      )}

      {/* Mobile: cards */}
      <ul className="lg:hidden space-y-3">
        {pending.map((task) => (
          <li key={task.id} className="card p-4 space-y-3">
            <button
              type="button"
              onClick={() => setViewing(task)}
              className="text-left w-full"
            >
              <span className="block text-[14px] font-medium leading-snug">
                {task.taskName}
              </span>
              <span className="block text-[12.5px] text-fg-subtle mt-0.5">
                {task.project} · {task.department}
              </span>
            </button>

            <dl className="grid grid-cols-2 gap-2 text-[12.5px]">
              <div>
                <dt className="text-fg-subtle">Assigned to</dt>
                <dd>{task.internalPoc}</dd>
              </div>
              <div>
                <dt className="text-fg-subtle">Waiting</dt>
                <dd>{waitingLabel(task)}</dd>
              </div>
              <div>
                <dt className="text-fg-subtle">Deadline</dt>
                <dd
                  className={`tabular ${task.isOverdue ? 'text-rose-600 dark:text-rose-400 font-medium' : ''}`}
                >
                  {task.deadline || '—'}
                </dd>
              </div>
              <div>
                <dt className="text-fg-subtle">Priority</dt>
                <dd>
                  <PriorityIndicator priority={task.priority} />
                </dd>
              </div>
              <div>
                <dt className="text-fg-subtle">Cost</dt>
                <dd className="tabular">{formatCost(task.budget)}</dd>
              </div>
              <div>
                <dt className="text-fg-subtle">BOQ</dt>
                <dd>
                  {task.boqLink ? (
                    <a
                      href={task.boqLink}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={(event) => event.stopPropagation()}
                      className="inline-flex items-center gap-1 text-accent hover:underline"
                    >
                      <FileSpreadsheet className="w-3.5 h-3.5" aria-hidden="true" />
                      View
                    </a>
                  ) : (
                    '—'
                  )}
                </dd>
              </div>
              <div>
                <dt className="text-fg-subtle">To</dt>
                <dd>{task.approver || '—'}</dd>
              </div>
            </dl>

            {canDecide && (
              <div className="flex items-center gap-2 pt-1">
                <Button
                  variant="primary"
                  size="sm"
                  fullWidth
                  loading={busyId === task.id}
                  onClick={() => void handleApprove(task)}
                  icon={<CheckCircle2 className="w-3.5 h-3.5" aria-hidden="true" />}
                >
                  Approve
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  fullWidth
                  onClick={() => {
                    setRejecting(task);
                    setReason('');
                    setReasonError(null);
                  }}
                  icon={<XCircle className="w-3.5 h-3.5" aria-hidden="true" />}
                >
                  Send back
                </Button>
              </div>
            )}
          </li>
        ))}
      </ul>

      {/* Desktop: table */}
      <div className="hidden lg:block card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-line bg-surface-sunken/60">
                <th scope="col" className="px-3 py-2.5 min-w-56">
                  <span className="text-label">Task</span>
                </th>
                <th scope="col" className="px-3 py-2.5 w-36">
                  <span className="text-label">Project</span>
                </th>
                <th scope="col" className="px-3 py-2.5 w-32">
                  <span className="text-label">Assigned to</span>
                </th>
                <th scope="col" className="px-3 py-2.5 w-32">
                  <span className="text-label">Agency / vendor</span>
                </th>
                <th scope="col" className="px-3 py-2.5 w-24">
                  <span className="text-label">Priority</span>
                </th>
                {/* These three were required by the brief and absent before. */}
                <th scope="col" className="px-3 py-2.5 w-24">
                  <span className="text-label">Waiting</span>
                </th>
                <th scope="col" className="px-3 py-2.5 w-28">
                  <span className="text-label">Deadline</span>
                </th>
                {/* Cost, BOQ and To route the approval decision — asked for
                    directly: what does this cost, what's the BOQ, and who
                    does it need to go to. */}
                <th scope="col" className="px-3 py-2.5 w-24">
                  <span className="text-label">Cost</span>
                </th>
                <th scope="col" className="px-3 py-2.5 w-16 text-center">
                  <span className="text-label">BOQ</span>
                </th>
                <th scope="col" className="px-3 py-2.5 w-28">
                  <span className="text-label">To</span>
                </th>
                <th scope="col" className="px-3 py-2.5 w-16 text-center">
                  <span className="text-label">Notes</span>
                </th>
                <th scope="col" className="px-3 py-2.5 w-52 text-right">
                  <span className="text-label">Decision</span>
                </th>
              </tr>
            </thead>

            <tbody className="divide-y divide-line">
              {pending.map((task) => (
                <tr key={task.id} className="hover:bg-surface-sunken/60 transition-colors">
                  <td className="px-3 py-3">
                    <button
                      type="button"
                      onClick={() => setViewing(task)}
                      className="text-left group"
                    >
                      <span className="block text-[13.5px] font-medium group-hover:text-accent transition-colors">
                        {task.taskName}
                      </span>
                      {task.taskBrief && (
                        <span className="block text-[12.5px] text-fg-subtle truncate max-w-72">
                          {task.taskBrief}
                        </span>
                      )}
                    </button>
                  </td>
                  <td className="px-3 py-3 text-[13px] text-fg-muted">
                    {task.project}
                  </td>
                  <td className="px-3 py-3 text-[13px]">{task.internalPoc}</td>
                  <td className="px-3 py-3 text-[13px] text-fg-muted">
                    {task.agency || task.vendor || '—'}
                  </td>
                  <td className="px-3 py-3">
                    <PriorityIndicator priority={task.priority} />
                  </td>
                  <td className="px-3 py-3 text-[13px] text-fg-muted tabular">
                    {waitingLabel(task)}
                  </td>
                  <td
                    className={`px-3 py-3 text-[13px] tabular ${
                      task.isOverdue
                        ? 'text-rose-600 dark:text-rose-400 font-medium'
                        : 'text-fg-muted'
                    }`}
                  >
                    {task.deadline || '—'}
                  </td>
                  <td className="px-3 py-3 text-[13px] text-fg-muted tabular">
                    {formatCost(task.budget)}
                  </td>
                  <td className="px-3 py-3 text-center">
                    {task.boqLink ? (
                      <a
                        href={task.boqLink}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(event) => event.stopPropagation()}
                        aria-label={`Open BOQ for ${task.taskName}`}
                        className="inline-flex text-fg-muted hover:text-accent transition-colors"
                      >
                        <FileSpreadsheet className="w-4 h-4" aria-hidden="true" />
                      </a>
                    ) : (
                      <span className="text-fg-subtle" aria-hidden="true">
                        —
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-3 text-[13px] text-fg-muted">
                    {task.approver || '—'}
                  </td>
                  <td className="px-3 py-3 text-center">
                    {(task.comments?.length ?? 0) > 0 ? (
                      <button
                        type="button"
                        onClick={() => setViewing(task)}
                        className="inline-flex items-center gap-1 text-[12.5px] text-fg-muted hover:text-fg transition-colors"
                        aria-label={`${task.comments!.length} comments on ${task.taskName}`}
                      >
                        <MessageSquare className="w-3.5 h-3.5" aria-hidden="true" />
                        {task.comments!.length}
                      </button>
                    ) : (
                      <span className="text-fg-subtle" aria-hidden="true">
                        —
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-3">
                    {canDecide ? (
                      <div className="flex items-center justify-end gap-2">
                        <Button
                          variant="primary"
                          size="sm"
                          loading={busyId === task.id}
                          onClick={() => void handleApprove(task)}
                          icon={
                            <CheckCircle2
                              className="w-3.5 h-3.5"
                              aria-hidden="true"
                            />
                          }
                        >
                          Approve
                        </Button>
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => {
                            setRejecting(task);
                            setReason('');
                            setReasonError(null);
                          }}
                        >
                          Send back
                        </Button>
                      </div>
                    ) : (
                      <span className="flex items-center justify-end gap-1 text-[12.5px] text-fg-subtle">
                        <Lock className="w-3 h-3" aria-hidden="true" />
                        Management only
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Rejection */}
      <Dialog
        open={rejecting !== null}
        onClose={() => {
          setRejecting(null);
          setReasonError(null);
        }}
        title="Send this task back"
        description={
          rejecting
            ? `${rejecting.taskName} — goes back to ${rejecting.internalPoc}`
            : undefined
        }
        size="md"
        disableBackdropClose
        footer={
          <div className="flex items-center justify-end gap-2">
            <Button
              variant="secondary"
              onClick={() => {
                setRejecting(null);
                setReasonError(null);
              }}
            >
              Cancel
            </Button>
            <Button
              variant="primary"
              loading={busyId === rejecting?.id}
              onClick={() => void handleReject()}
            >
              Send back
            </Button>
          </div>
        }
      >
        <div className="space-y-2">
          <label htmlFor="rejection-reason" className="field-label">
            What needs to change?
            <span className="text-rose-500 ml-0.5" aria-hidden="true">
              *
            </span>
            <span className="sr-only">(required)</span>
          </label>
          <textarea
            id="rejection-reason"
            data-autofocus
            rows={4}
            value={reason}
            maxLength={LIMITS.rejectionReason}
            onChange={(event) => {
              setReason(event.target.value);
              if (reasonError) setReasonError(null);
            }}
            aria-invalid={reasonError ? true : undefined}
            aria-describedby={reasonError ? 'rejection-error' : undefined}
            placeholder="Be specific — this is what the assignee will act on."
            className={`field resize-y ${reasonError ? 'border-rose-400 dark:border-rose-700' : ''}`}
          />
          {reasonError ? (
            <p
              id="rejection-error"
              className="text-[12.5px] text-rose-600 dark:text-rose-400"
            >
              {reasonError}
            </p>
          ) : (
            <p className="text-[12.5px] text-fg-subtle">
              The task returns to In progress and {rejecting?.internalPoc ?? 'the assignee'} is notified.
            </p>
          )}
        </div>
      </Dialog>

      <TaskDrawer
        isOpen={viewing !== null}
        onClose={() => setViewing(null)}
        taskToEdit={viewing}
      />
    </div>
  );
};
