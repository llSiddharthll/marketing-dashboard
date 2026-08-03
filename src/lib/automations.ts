/**
 * Workflow automation rules (brief rules 1-5).
 *
 * These are pure functions: given a task (and optionally its previous state),
 * they return the corrected task plus the audit entries and notification that
 * the change should generate. Purity is what makes them testable and lets the
 * server apply them authoritatively — the client no longer decides what date a
 * task was completed on.
 *
 * All dates come from {@link today}, which is timezone-aware. The previous
 * implementation used `toISOString()` and stamped UTC dates.
 */

import type { NotificationItem, Task, UserRole } from '@/types/dashboard';
import { isOverdue, nowIso, today } from './dates';

export interface AutomationLogEntry {
  action: string;
  oldValue: string;
  newValue: string;
}

export interface AutomationNotification {
  title: string;
  message: string;
  type: NotificationItem['type'];
}

export interface AutomationResult {
  task: Task;
  logs: AutomationLogEntry[];
  notifications: AutomationNotification[];
}

export interface AutomationOptions {
  /** Injected for deterministic tests; defaults to the real clock. */
  todayDate?: string;
  /** Role performing the change; only Admin may unlock a completion date. */
  role?: UserRole;
}

/**
 * Applies rules 1, 2, 3 and 5 to a task being created or saved.
 *
 * Rule 4 (management approve/reject) is a separate explicit action —
 * see {@link applyManagementDecision}.
 */
export function applyAutomationRules(
  next: Task,
  previous?: Task,
  options: AutomationOptions = {}
): AutomationResult {
  const todayDate = options.todayDate ?? today();
  const role = options.role ?? 'Marketing Team';

  const task: Task = { ...next };
  const logs: AutomationLogEntry[] = [];
  const notifications: AutomationNotification[] = [];

  /* Rule 1 — Execution Started ------------------------------------------- */
  // The date is stamped on the first tick only, and never moves afterwards.
  if (task.executionStarted && !task.executionStartDate) {
    task.executionStartDate = todayDate;
    logs.push({
      action: 'Execution Started',
      oldValue: 'Not started',
      newValue: todayDate,
    });
  }

  // Un-ticking the checkbox must not silently erase the recorded start date;
  // only an Admin can clear it.
  if (!task.executionStarted && previous?.executionStartDate && role !== 'Admin') {
    task.executionStarted = true;
    task.executionStartDate = previous.executionStartDate;
  }

  /* Rule 3 — Send for Management Approval --------------------------------- */
  // Evaluated before rule 2 so that ticking "to be approved" cannot be
  // short-circuited by a stale Completed status.
  const wasAwaitingApproval = previous?.taskProgress === 'To Be Approved by Management';

  if (
    task.toBeApprovedByManagement &&
    task.taskProgress !== 'To Be Approved by Management' &&
    task.taskProgress !== 'Completed'
  ) {
    const fromStatus = task.taskProgress;
    task.taskProgress = 'To Be Approved by Management';
    task.submittedForApprovalAt = nowIso();
    logs.push({
      action: 'Sent For Management Approval',
      oldValue: fromStatus,
      newValue: 'To Be Approved by Management',
    });
    notifications.push({
      title: 'Approval requested',
      message: `"${task.taskName}" was submitted for management approval by ${task.internalPoc}.`,
      type: 'approval_request',
    });
  }

  // Selecting the status directly (without the checkbox) is the same intent.
  if (
    task.taskProgress === 'To Be Approved by Management' &&
    !task.submittedForApprovalAt
  ) {
    task.toBeApprovedByManagement = true;
    task.submittedForApprovalAt = nowIso();
    if (!wasAwaitingApproval) {
      logs.push({
        action: 'Sent For Management Approval',
        oldValue: previous?.taskProgress ?? 'New',
        newValue: 'To Be Approved by Management',
      });
      notifications.push({
        title: 'Approval requested',
        message: `"${task.taskName}" is awaiting management approval.`,
        type: 'approval_request',
      });
    }
  }

  /* Rule 2 — Task Completed ---------------------------------------------- */
  if (task.taskProgress === 'Completed') {
    if (!task.actualFinishedDate) {
      task.actualFinishedDate = todayDate;
      logs.push({
        action: 'Task Completed',
        oldValue: previous?.taskProgress ?? 'New',
        newValue: `Completed on ${todayDate}`,
      });
      notifications.push({
        title: 'Task completed',
        message: `"${task.taskName}" was marked complete.`,
        type: 'completed',
      });
    }

    // The completion date is locked once set. Only an Admin may change it,
    // which is the "unless reopened by an Admin" clause of the brief.
    if (previous?.actualFinishedDate && role !== 'Admin') {
      task.actualFinishedDate = previous.actualFinishedDate;
    }

    // Completing a task clears any pending approval request.
    task.toBeApprovedByManagement = false;
  } else if (previous?.taskProgress === 'Completed') {
    // Reopening. Admins may clear the completion date; everyone else keeps it
    // for the audit trail.
    if (role === 'Admin') {
      task.actualFinishedDate = null;
      logs.push({
        action: 'Task Reopened',
        oldValue: `Completed on ${previous.actualFinishedDate ?? 'unknown'}`,
        newValue: task.taskProgress,
      });
    } else {
      task.taskProgress = 'Completed';
      task.actualFinishedDate = previous.actualFinishedDate;
    }
  }

  /* Rule 5 — Overdue ----------------------------------------------------- */
  const nowOverdue = isOverdue(
    task.deadline,
    task.taskProgress === 'Completed',
    todayDate
  );

  if (nowOverdue && !previous?.isOverdue) {
    logs.push({
      action: 'Marked Overdue',
      oldValue: 'On track',
      newValue: `Deadline was ${task.deadline}`,
    });
    notifications.push({
      title: 'Task overdue',
      message: `"${task.taskName}" passed its ${task.deadline} deadline and is assigned to ${task.internalPoc}.`,
      type: 'overdue',
    });
  }
  task.isOverdue = nowOverdue;

  /* Deadline-tomorrow warning -------------------------------------------- */
  // The brief asks for a "deadline tomorrow" notification; it was never fired
  // by the previous implementation.
  if (
    !nowOverdue &&
    task.taskProgress !== 'Completed' &&
    task.deadline &&
    daysUntil(todayDate, task.deadline) === 1
  ) {
    notifications.push({
      title: 'Deadline tomorrow',
      message: `"${task.taskName}" is due ${task.deadline}.`,
      type: 'deadline',
    });
  }

  task.updatedAt = nowIso();
  return { task, logs, notifications };
}

/**
 * Rule 4 — management approves or rejects a task awaiting approval.
 */
export function applyManagementDecision(
  current: Task,
  decision: 'approve' | 'reject',
  options: { comment?: string; todayDate?: string; decidedBy?: string } = {}
): AutomationResult {
  const todayDate = options.todayDate ?? today();
  const decidedBy = options.decidedBy ?? 'Management';
  const task: Task = { ...current };
  const logs: AutomationLogEntry[] = [];
  const notifications: AutomationNotification[] = [];

  if (decision === 'approve') {
    task.taskProgress = 'Completed';
    task.toBeApprovedByManagement = false;
    task.approvalDate = todayDate;
    task.rejectionReason = null;

    // Backfill the execution start date if the team never ticked the box.
    if (!task.executionStartDate) {
      task.executionStartDate = todayDate;
      task.executionStarted = true;
    }
    if (!task.actualFinishedDate) {
      task.actualFinishedDate = todayDate;
    }
    task.isOverdue = false;

    logs.push({
      action: 'Approval Granted',
      oldValue: 'To Be Approved by Management',
      newValue: `Approved by ${decidedBy} on ${todayDate}`,
    });
    notifications.push({
      title: 'Task approved',
      message: `"${task.taskName}" was approved by ${decidedBy} and marked complete.`,
      type: 'approval_granted',
    });
  } else {
    const comment = options.comment?.trim();
    task.taskProgress = 'In Progress';
    task.toBeApprovedByManagement = false;
    task.submittedForApprovalAt = null;
    task.rejectionReason = comment || 'No reason provided';
    task.approvalDate = null;
    // A rejected task can be overdue again if its deadline already passed.
    task.isOverdue = isOverdue(task.deadline, false, todayDate);

    logs.push({
      action: 'Approval Rejected',
      oldValue: 'To Be Approved by Management',
      newValue: `Rejected by ${decidedBy}: ${task.rejectionReason}`,
    });
    notifications.push({
      title: 'Task rejected',
      message: `${decidedBy} sent "${task.taskName}" back to ${task.internalPoc}: ${task.rejectionReason}`,
      type: 'approval_rejected',
    });
  }

  task.updatedAt = nowIso();
  return { task, logs, notifications };
}

/**
 * Recomputes only the time-derived flags for a task, without treating it as an
 * edit. Used by the periodic sweep so a task that crosses its deadline while
 * the app is open flips to overdue — previously this only happened on reload.
 */
export function refreshDerivedFlags(
  task: Task,
  todayDate: string = today()
): { task: Task; changed: boolean } {
  const nowOverdue = isOverdue(
    task.deadline,
    task.taskProgress === 'Completed',
    todayDate
  );
  if (nowOverdue === task.isOverdue) return { task, changed: false };
  return { task: { ...task, isOverdue: nowOverdue }, changed: true };
}

function daysUntil(from: string, to: string): number {
  const parse = (s: string) => {
    const [y, m, d] = s.split('-').map(Number);
    return Date.UTC(y, m - 1, d);
  };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
    return Number.NaN;
  }
  return Math.round((parse(to) - parse(from)) / 86_400_000);
}

/**
 * Retained for the existing call sites that import it. Prefer {@link today}
 * from `@/lib/dates` in new code.
 *
 * @deprecated Use `today()` from `@/lib/dates`.
 */
export function getTodayDateString(): string {
  return today();
}
