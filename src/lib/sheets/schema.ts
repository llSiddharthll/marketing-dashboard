/**
 * Canonical Google Sheets schema.
 *
 * This file is the single source of truth for how dashboard entities map onto
 * spreadsheet columns. Both the server (read/write) and the setup/bootstrap
 * routine derive from these definitions, so a column can never drift between
 * the reader and the writer.
 *
 * Rules:
 *  - Column order here IS the column order in the sheet. Append new columns at
 *    the end; never reorder or remove (that would silently shift live data).
 *  - Every row-backed sheet has `id` in column A. It is the upsert key.
 *  - `_rowNumber` is transport metadata, never persisted as a column.
 */

import type {
  ActivityLog,
  AppUser,
  MasterItem,
  Task,
  Priority,
  TaskStatus,
  MasterCategory,
  UserRole,
} from '@/types/dashboard';

/** Tab names, exactly as they appear in the spreadsheet. */
export const SHEET_NAMES = {
  TASKS: 'Tasks',
  PROJECTS: 'Projects',
  VENDORS: 'Vendors',
  AGENCIES: 'Agencies',
  DEPARTMENTS: 'Departments',
  TEAM_MEMBERS: 'Team Members',
  ACTIVITY_LOG: 'Activity Log',
  SETTINGS: 'Settings',
  REPORTS: 'Reports',
  DASHBOARD: 'Dashboard',
  USERS: 'Users',
} as const;

export type SheetName = (typeof SHEET_NAMES)[keyof typeof SHEET_NAMES];

/** Master-data categories and the tab each one lives in. */
export const MASTER_SHEET_BY_CATEGORY: Record<MasterCategory, SheetName> = {
  Projects: SHEET_NAMES.PROJECTS,
  Vendors: SHEET_NAMES.VENDORS,
  Agencies: SHEET_NAMES.AGENCIES,
  Departments: SHEET_NAMES.DEPARTMENTS,
  'Team Members': SHEET_NAMES.TEAM_MEMBERS,
};

export const MASTER_CATEGORIES = Object.keys(
  MASTER_SHEET_BY_CATEGORY
) as MasterCategory[];

/* -------------------------------------------------------------------------- */
/* Cell coercion helpers                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Sheets returns numbers, booleans and strings depending on how a cell was
 * entered. Every reader coerces defensively so a human typing "yes" or leaving
 * a cell blank can't crash a parse.
 */
function readString(cell: unknown): string {
  if (cell === null || cell === undefined) return '';
  return String(cell).trim();
}

function readOptionalString(cell: unknown): string | null {
  const value = readString(cell);
  return value === '' ? null : value;
}

function readBoolean(cell: unknown): boolean {
  if (typeof cell === 'boolean') return cell;
  const value = readString(cell).toLowerCase();
  return value === 'true' || value === 'yes' || value === '1' || value === 'y';
}

function readNumber(cell: unknown): number {
  if (typeof cell === 'number') return Number.isFinite(cell) ? cell : 0;
  // Tolerate values a person may have typed: "1,200", "₹1200", "1200.50"
  const cleaned = readString(cell).replace(/[^0-9.-]/g, '');
  const parsed = Number.parseFloat(cleaned);
  return Number.isFinite(parsed) ? parsed : 0;
}

/** Writes a boolean as TRUE/FALSE so it renders as a real checkbox-style value. */
function writeBoolean(value: boolean): string {
  return value ? 'TRUE' : 'FALSE';
}

/** Constrains a free-text cell to a known union, falling back to a default. */
function readEnum<T extends string>(
  cell: unknown,
  allowed: readonly T[],
  fallback: T
): T {
  const value = readString(cell);
  const match = allowed.find((a) => a.toLowerCase() === value.toLowerCase());
  return match ?? fallback;
}

export const PRIORITIES: readonly Priority[] = [
  'Urgent',
  'High',
  'Medium',
  'Low',
];

export const TASK_STATUSES: readonly TaskStatus[] = [
  'Not Started',
  'In Progress',
  'Waiting',
  'On Hold',
  'To Be Approved by Management',
  'Completed',
];

export const USER_ROLES: readonly UserRole[] = [
  'Admin',
  'Marketing Team',
  'Management',
  'Viewer',
];

/* -------------------------------------------------------------------------- */
/* Tasks                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Task columns in sheet order.
 *
 * Note vs. the previous 21-column schema: `Budget` and `Actual Spend` are now
 * persisted (they were UI-only before and were lost on every sync), and
 * `Submitted For Approval At`, `Subtasks` and `Comments` were added so the
 * approval queue and task detail survive a round trip.
 */
export const TASK_COLUMNS = [
  'ID',
  'Project',
  'Task Name',
  'Task Brief',
  'Department',
  'Internal POC',
  'Agency',
  'Vendor',
  'Priority',
  'Task Progress',
  'Deadline',
  'Execution Started',
  'Execution Start Date',
  'Actual Finished Date',
  'To Be Approved By Management',
  'Submitted For Approval At',
  'Approval Date',
  'Rejection Reason',
  'Remarks',
  'Budget',
  'Actual Spend',
  'Subtasks',
  'Comments',
  'Is Overdue',
  'Created At',
  'Updated At',
  // Tombstone. Deletes set this instead of removing the row, which keeps every
  // row index stable for the lifetime of the sheet. Stable indices are what
  // make single-row updates safe without a distributed lock: physically
  // deleting a row would shift every row below it and could send a concurrent
  // update to the wrong record. It also preserves the audit trail.
  'Deleted At',
] as const;

/**
 * Subtasks and comments are lists, and a spreadsheet cell is flat. We store
 * them as JSON so the dashboard keeps full fidelity; a human reading the sheet
 * still sees legible content, and a malformed edit degrades to an empty list
 * rather than throwing.
 */
function readJsonList<T>(cell: unknown): T[] {
  const raw = readString(cell);
  if (raw === '') return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

function writeJsonList(value: unknown[] | undefined): string {
  if (!value || value.length === 0) return '';
  return JSON.stringify(value);
}

export function taskFromRow(row: unknown[]): Task {
  return {
    id: readString(row[0]),
    project: readString(row[1]),
    taskName: readString(row[2]),
    taskBrief: readString(row[3]),
    department: readString(row[4]),
    internalPoc: readString(row[5]),
    agency: readString(row[6]),
    vendor: readString(row[7]),
    priority: readEnum(row[8], PRIORITIES, 'Medium'),
    taskProgress: readEnum(row[9], TASK_STATUSES, 'Not Started'),
    deadline: readString(row[10]),
    executionStarted: readBoolean(row[11]),
    executionStartDate: readOptionalString(row[12]),
    actualFinishedDate: readOptionalString(row[13]),
    toBeApprovedByManagement: readBoolean(row[14]),
    submittedForApprovalAt: readOptionalString(row[15]),
    approvalDate: readOptionalString(row[16]),
    rejectionReason: readOptionalString(row[17]),
    remarks: readString(row[18]),
    budget: readNumber(row[19]),
    actualSpend: readNumber(row[20]),
    subtasks: readJsonList(row[21]),
    comments: readJsonList(row[22]),
    isOverdue: readBoolean(row[23]),
    createdAt: readString(row[24]),
    updatedAt: readString(row[25]),
    deletedAt: readOptionalString(row[26]),
  };
}

export function taskToRow(task: Task): (string | number)[] {
  return [
    task.id,
    task.project,
    task.taskName,
    task.taskBrief,
    task.department,
    task.internalPoc,
    task.agency,
    task.vendor,
    task.priority,
    task.taskProgress,
    task.deadline,
    writeBoolean(task.executionStarted),
    task.executionStartDate ?? '',
    task.actualFinishedDate ?? '',
    writeBoolean(task.toBeApprovedByManagement),
    task.submittedForApprovalAt ?? '',
    task.approvalDate ?? '',
    task.rejectionReason ?? '',
    task.remarks,
    task.budget ?? 0,
    task.actualSpend ?? 0,
    writeJsonList(task.subtasks),
    writeJsonList(task.comments),
    writeBoolean(task.isOverdue),
    task.createdAt,
    task.updatedAt,
    task.deletedAt ?? '',
  ];
}

/** Column index (0-based) of `Updated At`, used for write-verification reads. */
export const TASK_UPDATED_AT_INDEX = TASK_COLUMNS.indexOf('Updated At');

/* -------------------------------------------------------------------------- */
/* Master data                                                                 */
/* -------------------------------------------------------------------------- */

export const MASTER_COLUMNS = [
  'ID',
  'Name',
  'Status',
  'Description',
  'Created At',
  'Updated At',
  // See the note on the Tasks `Deleted At` column.
  'Deleted At',
] as const;

export function masterItemFromRow(
  row: unknown[],
  category: MasterCategory
): MasterItem {
  return {
    id: readString(row[0]),
    name: readString(row[1]),
    category,
    status: readEnum(row[2], ['Active', 'Inactive'] as const, 'Active'),
    description: readString(row[3]),
    createdAt: readString(row[4]),
    updatedAt: readString(row[5]) || readString(row[4]),
    deletedAt: readOptionalString(row[6]),
  };
}

export function masterItemToRow(item: MasterItem): (string | number)[] {
  return [
    item.id,
    item.name,
    item.status,
    item.description ?? '',
    item.createdAt,
    item.updatedAt ?? item.createdAt,
    item.deletedAt ?? '',
  ];
}

/** Column index (0-based) of `Updated At`, used for write-verification reads. */
export const MASTER_UPDATED_AT_INDEX = MASTER_COLUMNS.indexOf('Updated At');

/* -------------------------------------------------------------------------- */
/* Activity log                                                                */
/* -------------------------------------------------------------------------- */

export const ACTIVITY_LOG_COLUMNS = [
  'ID',
  'User',
  'Role',
  'Date',
  'Time',
  'Action',
  'Target',
  'Old Value',
  'New Value',
] as const;

export function activityLogFromRow(row: unknown[]): ActivityLog {
  return {
    id: readString(row[0]),
    user: readString(row[1]),
    role: readEnum(row[2], USER_ROLES, 'Viewer'),
    date: readString(row[3]),
    time: readString(row[4]),
    action: readString(row[5]),
    target: readString(row[6]),
    oldValue: readString(row[7]),
    newValue: readString(row[8]),
  };
}

export function activityLogToRow(log: ActivityLog): (string | number)[] {
  return [
    log.id,
    log.user,
    log.role,
    log.date,
    log.time,
    log.action,
    log.target,
    log.oldValue,
    log.newValue,
  ];
}

/* -------------------------------------------------------------------------- */
/* Settings                                                                    */
/* -------------------------------------------------------------------------- */

export const SETTINGS_COLUMNS = ['Key', 'Value', 'Description'] as const;

/* -------------------------------------------------------------------------- */
/* Users                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * The access-control list, keyed by Google account email.
 *
 * This tab is the authority on who may sign in and what role they hold. Keeping
 * it in the spreadsheet means an Admin can manage access in the same place as
 * the rest of the master data, and the role can never be asserted by the client.
 *
 * Email is the identity key, so it sits in column A like every other id.
 */
export const USER_COLUMNS = [
  'Email',
  'Name',
  'Role',
  'Status',
  'Last Login At',
  'Created At',
  'Updated At',
  'Deleted At',
] as const;

export function appUserFromRow(row: unknown[]): AppUser {
  return {
    email: readString(row[0]).toLowerCase(),
    name: readString(row[1]),
    role: readEnum(row[2], USER_ROLES, 'Viewer'),
    status: readEnum(row[3], ['Active', 'Suspended'] as const, 'Active'),
    lastLoginAt: readOptionalString(row[4]),
    createdAt: readString(row[5]),
    updatedAt: readString(row[6]),
    deletedAt: readOptionalString(row[7]),
  };
}

export function appUserToRow(user: AppUser): (string | number)[] {
  return [
    user.email.toLowerCase(),
    user.name,
    user.role,
    user.status,
    user.lastLoginAt ?? '',
    user.createdAt,
    user.updatedAt,
    user.deletedAt ?? '',
  ];
}

/** Column index (0-based) of `Updated At`, used for write-verification reads. */
export const USER_UPDATED_AT_INDEX = USER_COLUMNS.indexOf('Updated At');

/* -------------------------------------------------------------------------- */
/* Sheet registry — drives bootstrap and validation                            */
/* -------------------------------------------------------------------------- */

export interface SheetDefinition {
  name: SheetName;
  columns: readonly string[];
  /** Informational tabs are created with headers but never written by the app. */
  readOnly?: boolean;
}

export const SHEET_DEFINITIONS: SheetDefinition[] = [
  { name: SHEET_NAMES.TASKS, columns: TASK_COLUMNS },
  { name: SHEET_NAMES.PROJECTS, columns: MASTER_COLUMNS },
  { name: SHEET_NAMES.VENDORS, columns: MASTER_COLUMNS },
  { name: SHEET_NAMES.AGENCIES, columns: MASTER_COLUMNS },
  { name: SHEET_NAMES.DEPARTMENTS, columns: MASTER_COLUMNS },
  { name: SHEET_NAMES.TEAM_MEMBERS, columns: MASTER_COLUMNS },
  { name: SHEET_NAMES.ACTIVITY_LOG, columns: ACTIVITY_LOG_COLUMNS },
  { name: SHEET_NAMES.USERS, columns: USER_COLUMNS },
  { name: SHEET_NAMES.SETTINGS, columns: SETTINGS_COLUMNS },
  {
    name: SHEET_NAMES.REPORTS,
    columns: ['Metric', 'Value', 'Generated At'],
    readOnly: true,
  },
  {
    name: SHEET_NAMES.DASHBOARD,
    columns: ['KPI', 'Value', 'Generated At'],
    readOnly: true,
  },
];

export function getSheetDefinition(name: SheetName): SheetDefinition {
  const def = SHEET_DEFINITIONS.find((d) => d.name === name);
  if (!def) throw new Error(`Unknown sheet: ${name}`);
  return def;
}

/**
 * Converts a 0-based column index to an A1 letter reference.
 * Handles multi-letter columns (26 -> AA) since Tasks already exceeds 26.
 */
export function columnLetter(index: number): string {
  let result = '';
  let n = index;
  while (n >= 0) {
    result = String.fromCharCode((n % 26) + 65) + result;
    n = Math.floor(n / 26) - 1;
  }
  return result;
}

/** A1 range covering one full data row, e.g. "Tasks!A5:Z5". */
export function rowRange(
  sheetName: SheetName,
  rowNumber: number,
  columnCount: number
): string {
  return `'${sheetName}'!A${rowNumber}:${columnLetter(columnCount - 1)}${rowNumber}`;
}

/** A1 range covering every data row (header excluded), e.g. "Tasks!A2:Z". */
export function dataRange(sheetName: SheetName, columnCount: number): string {
  return `'${sheetName}'!A2:${columnLetter(columnCount - 1)}`;
}

/** A1 range covering the header row. */
export function headerRange(
  sheetName: SheetName,
  columnCount: number
): string {
  return `'${sheetName}'!A1:${columnLetter(columnCount - 1)}1`;
}
