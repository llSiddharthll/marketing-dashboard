/**
 * Task write operations, with the automation rules applied server-side.
 *
 * The server owns the rules so that dates, status transitions and audit entries
 * are identical regardless of which client made the request — and so a client
 * cannot claim a task was completed on a date of its choosing.
 */

import type { ActivityLog, Task } from '@/types/dashboard';
import {
  applyAutomationRules,
  applyManagementDecision,
  type AutomationLogEntry,
  type AutomationNotification,
} from '@/lib/automations';
import { newActivityLogId, newTaskId } from '@/lib/ids';
import { nowIso, nowTimeString, today } from '@/lib/dates';
import { assertValid, validateTaskInput } from '@/lib/validation';
import type { Actor } from './apiHelpers';
import { NotFoundError, SheetRepository } from './repository';

export interface TaskWriteResult {
  task: Task;
  notifications: AutomationNotification[];
}

/** Turns automation log entries into audit rows attributed to the actor. */
function toActivityLogs(
  entries: AutomationLogEntry[],
  actor: Actor,
  target: string
): ActivityLog[] {
  const date = today();
  const time = nowTimeString();
  return entries.map((entry) => ({
    id: newActivityLogId(),
    user: actor.name,
    role: actor.role,
    date,
    time,
    action: entry.action,
    target,
    oldValue: entry.oldValue,
    newValue: entry.newValue,
  }));
}

/**
 * The fields a client is allowed to set. Everything else is derived by the
 * automation rules, so a client cannot forge an approval date or a tombstone.
 */
function pickClientEditableFields(input: Record<string, unknown>): Partial<Task> {
  const allowed: (keyof Task)[] = [
    'project',
    'taskName',
    'taskBrief',
    'department',
    'internalPoc',
    'agency',
    'vendor',
    'priority',
    'taskProgress',
    'deadline',
    'executionStarted',
    'toBeApprovedByManagement',
    'remarks',
    'budget',
    'actualSpend',
    'boqLink',
    'reportLink',
    'approver',
    'subtasks',
    'comments',
    'attachments',
  ];

  const result: Record<string, unknown> = {};
  for (const key of allowed) {
    if (key in input) result[key] = input[key];
  }
  return result as Partial<Task>;
}

/** Normalises strings and numbers coming off the wire. */
function coerceTaskFields(input: Partial<Task>): Partial<Task> {
  const out: Partial<Task> = { ...input };
  const trimIfString = (v: unknown) => (typeof v === 'string' ? v.trim() : v);

  for (const key of [
    'project',
    'taskName',
    'taskBrief',
    'department',
    'internalPoc',
    'agency',
    'vendor',
    'deadline',
    'remarks',
    'boqLink',
    'reportLink',
    'approver',
  ] as const) {
    if (key in out) {
      (out as Record<string, unknown>)[key] = trimIfString(out[key]);
    }
  }

  // Money arrives as either a number or a string depending on the form control,
  // so read through an untyped view before coercing. An empty field means zero,
  // not NaN.
  const loose = out as Record<string, unknown>;
  for (const key of ['budget', 'actualSpend'] as const) {
    if (key in out) {
      const raw = loose[key];
      if (raw === '' || raw === null || raw === undefined) {
        out[key] = 0;
      } else {
        const parsed = Number(raw);
        // Leave an unparseable value in place so validation reports it rather
        // than silently turning it into 0.
        out[key] = Number.isNaN(parsed) ? (raw as number) : parsed;
      }
    }
  }

  for (const key of ['executionStarted', 'toBeApprovedByManagement'] as const) {
    if (key in out) out[key] = Boolean(out[key]);
  }

  return out;
}

export async function createTask(
  repo: SheetRepository,
  body: Record<string, unknown>,
  actor: Actor
): Promise<TaskWriteResult> {
  const input = coerceTaskFields(pickClientEditableFields(body));
  assertValid(validateTaskInput(input));

  const timestamp = nowIso();
  const draft: Task = {
    id: newTaskId(),
    project: input.project ?? '',
    taskName: input.taskName ?? '',
    taskBrief: input.taskBrief ?? '',
    department: input.department ?? '',
    internalPoc: input.internalPoc ?? '',
    agency: input.agency ?? '',
    vendor: input.vendor ?? '',
    priority: input.priority ?? 'Medium',
    taskProgress: input.taskProgress ?? 'Not Started',
    deadline: input.deadline ?? '',
    executionStarted: input.executionStarted ?? false,
    executionStartDate: null,
    actualFinishedDate: null,
    toBeApprovedByManagement: input.toBeApprovedByManagement ?? false,
    submittedForApprovalAt: null,
    approvalDate: null,
    rejectionReason: null,
    remarks: input.remarks ?? '',
    budget: input.budget ?? 0,
    actualSpend: input.actualSpend ?? 0,
    boqLink: input.boqLink ?? null,
    reportLink: input.reportLink ?? null,
    approver: input.approver ?? '',
    subtasks: input.subtasks ?? [],
    comments: input.comments ?? [],
    attachments: input.attachments ?? [],
    isOverdue: false,
    createdAt: timestamp,
    updatedAt: timestamp,
    deletedAt: null,
  };

  const { task, logs, notifications } = applyAutomationRules(draft, undefined, {
    role: actor.role,
  });

  await repo.createTask(task);

  const auditEntries = toActivityLogs(
    // Always record the creation itself, alongside anything the rules did.
    [
      {
        action: 'Task Created',
        oldValue: 'None',
        newValue: task.taskName,
      },
      ...logs,
    ],
    actor,
    task.id
  );
  await repo.appendActivityLogs(auditEntries);

  return { task, notifications };
}

export async function updateTask(
  repo: SheetRepository,
  id: string,
  body: Record<string, unknown>,
  actor: Actor
): Promise<TaskWriteResult> {
  const located = await repo.getTask(id);
  if (!located || located.task.deletedAt) {
    throw new NotFoundError(`Task ${id} does not exist.`);
  }
  const previous = located.task;

  const input = coerceTaskFields(pickClientEditableFields(body));
  const merged: Task = { ...previous, ...input };
  assertValid(validateTaskInput(merged));

  const { task, logs, notifications } = applyAutomationRules(merged, previous, {
    role: actor.role,
  });

  // The client sends the version it was editing; the repository refuses the
  // write if the stored row has moved on since.
  const expectedUpdatedAt =
    typeof body.expectedUpdatedAt === 'string'
      ? body.expectedUpdatedAt
      : previous.updatedAt;

  const saved = await repo.updateTask(task, expectedUpdatedAt);

  const auditEntries = toActivityLogs(
    logs.length > 0
      ? logs
      : [
          {
            action: 'Task Updated',
            oldValue: describe(previous),
            newValue: describe(saved),
          },
        ],
    actor,
    saved.id
  );
  await repo.appendActivityLogs(auditEntries);

  return { task: saved, notifications };
}

export async function decideTask(
  repo: SheetRepository,
  id: string,
  decision: 'approve' | 'reject',
  comment: string | undefined,
  actor: Actor
): Promise<TaskWriteResult> {
  const located = await repo.getTask(id);
  if (!located || located.task.deletedAt) {
    throw new NotFoundError(`Task ${id} does not exist.`);
  }

  const { task, logs, notifications } = applyManagementDecision(
    located.task,
    decision,
    { comment, decidedBy: actor.name }
  );

  const saved = await repo.updateTask(task, located.task.updatedAt);
  await repo.appendActivityLogs(toActivityLogs(logs, actor, saved.id));

  return { task: saved, notifications };
}

export async function deleteTask(
  repo: SheetRepository,
  id: string,
  actor: Actor
): Promise<void> {
  const located = await repo.getTask(id);
  if (!located || located.task.deletedAt) {
    throw new NotFoundError(`Task ${id} does not exist.`);
  }

  await repo.deleteTask(id, located.task.updatedAt);
  await repo.appendActivityLogs(
    toActivityLogs(
      [
        {
          action: 'Task Deleted',
          oldValue: located.task.taskName,
          newValue: 'Archived',
        },
      ],
      actor,
      id
    )
  );
}

/** Short human summary used as the old/new value of a generic update entry. */
function describe(task: Task): string {
  return `${task.taskProgress} / ${task.priority} / due ${task.deadline}`;
}
