/**
 * Input validation, shared between the task form and the API.
 *
 * Keeping one implementation means the client can show inline errors and the
 * server can reject bad writes using identical rules, so a validation gap can
 * never let malformed data reach the spreadsheet.
 */

import type { MasterCategory, MasterItem, Task } from '@/types/dashboard';
import { isValidDateString } from './dates';
import { MASTER_CATEGORIES, PRIORITIES, TASK_STATUSES } from './sheets/schema';

export class ValidationError extends Error {
  readonly problems: string[];

  constructor(problems: string[]) {
    super(problems.join('; '));
    this.name = 'ValidationError';
    this.problems = problems;
  }
}

/** Field-keyed messages, for rendering next to the offending input. */
export type FieldErrors = Partial<Record<string, string>>;

export const LIMITS = {
  taskName: 200,
  taskBrief: 5000,
  remarks: 5000,
  name: 120,
  description: 500,
  comment: 2000,
  rejectionReason: 1000,
} as const;

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

/**
 * Validates the user-editable parts of a task. Server-managed fields
 * (dates, flags, timestamps) are not checked here because the automation rules
 * own them.
 */
export function validateTaskInput(input: Partial<Task>): FieldErrors {
  const errors: FieldErrors = {};

  if (!isNonEmptyString(input.taskName)) {
    errors.taskName = 'Task name is required.';
  } else if (input.taskName.trim().length > LIMITS.taskName) {
    errors.taskName = `Keep the task name under ${LIMITS.taskName} characters.`;
  }

  if (!isNonEmptyString(input.project)) {
    errors.project = 'Choose a project.';
  }

  if (!isNonEmptyString(input.department)) {
    errors.department = 'Choose a department.';
  }

  if (!isNonEmptyString(input.internalPoc)) {
    errors.internalPoc = 'Assign an internal POC.';
  }

  if (!isNonEmptyString(input.deadline)) {
    errors.deadline = 'Set a deadline.';
  } else if (!isValidDateString(input.deadline)) {
    errors.deadline = 'Deadline must be a real date (YYYY-MM-DD).';
  }

  if (input.priority !== undefined && !PRIORITIES.includes(input.priority)) {
    errors.priority = 'Choose a valid priority.';
  }

  if (
    input.taskProgress !== undefined &&
    !TASK_STATUSES.includes(input.taskProgress)
  ) {
    errors.taskProgress = 'Choose a valid status.';
  }

  if (
    input.taskBrief !== undefined &&
    input.taskBrief.length > LIMITS.taskBrief
  ) {
    errors.taskBrief = `Keep the brief under ${LIMITS.taskBrief} characters.`;
  }

  if (input.remarks !== undefined && input.remarks.length > LIMITS.remarks) {
    errors.remarks = `Keep remarks under ${LIMITS.remarks} characters.`;
  }

  const budgetError = validateMoney(input.budget, 'Budget');
  if (budgetError) errors.budget = budgetError;

  const spendError = validateMoney(input.actualSpend, 'Actual spend');
  if (spendError) errors.actualSpend = spendError;

  // Optional dates, when present, must be real dates.
  for (const field of [
    'executionStartDate',
    'actualFinishedDate',
    'approvalDate',
  ] as const) {
    const value = input[field];
    if (value && !isValidDateString(value)) {
      errors[field] = 'Must be a real date (YYYY-MM-DD).';
    }
  }

  return errors;
}

function validateMoney(value: unknown, label: string): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return `${label} must be a number.`;
  }
  if (value < 0) return `${label} cannot be negative.`;
  if (value > 1e12) return `${label} is implausibly large.`;
  return undefined;
}

export function validateMasterItemInput(
  input: Partial<MasterItem>
): FieldErrors {
  const errors: FieldErrors = {};

  if (!isNonEmptyString(input.name)) {
    errors.name = 'Name is required.';
  } else if (input.name.trim().length > LIMITS.name) {
    errors.name = `Keep the name under ${LIMITS.name} characters.`;
  }

  if (
    input.category !== undefined &&
    !MASTER_CATEGORIES.includes(input.category as MasterCategory)
  ) {
    errors.category = 'Unknown category.';
  }

  if (
    input.status !== undefined &&
    input.status !== 'Active' &&
    input.status !== 'Inactive'
  ) {
    errors.status = 'Status must be Active or Inactive.';
  }

  if (
    input.description !== undefined &&
    input.description.length > LIMITS.description
  ) {
    errors.description = `Keep the description under ${LIMITS.description} characters.`;
  }

  return errors;
}

export function hasErrors(errors: FieldErrors): boolean {
  return Object.keys(errors).length > 0;
}

/** Throws {@link ValidationError} if any field failed. */
export function assertValid(errors: FieldErrors): void {
  const problems = Object.entries(errors).map(
    ([field, message]) => `${field}: ${message}`
  );
  if (problems.length > 0) throw new ValidationError(problems);
}

/**
 * Rejects a duplicate master-data name within its category.
 * Comparison is case-insensitive and whitespace-normalised, because "Meta Ads"
 * and "meta ads " are the same thing to a user and would otherwise create two
 * dropdown entries that look identical.
 */
export function findDuplicateName(
  existing: MasterItem[],
  category: MasterCategory,
  name: string,
  excludeId?: string
): MasterItem | undefined {
  const normalise = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');
  const target = normalise(name);
  return existing.find(
    (item) =>
      item.category === category &&
      item.id !== excludeId &&
      !item.deletedAt &&
      normalise(item.name) === target
  );
}
