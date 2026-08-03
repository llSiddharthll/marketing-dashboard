import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const outDir = path.join(rootDir, 'google-sheets-templates');

if (!fs.existsSync(outDir)) {
  fs.mkdirSync(outDir, { recursive: true });
}

function toCsvRow(arr) {
  return arr.map(val => {
    if (val === null || val === undefined) return '';
    const str = String(val);
    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
      return '"' + str.replace(/"/g, '""') + '"';
    }
    return str;
  }).join(',');
}

const TASK_COLUMNS = [
  'ID', 'Project', 'Task Name', 'Task Brief', 'Department', 'Internal POC',
  'Agency', 'Vendor', 'Priority', 'Task Progress', 'Deadline', 'Execution Started',
  'Execution Start Date', 'Actual Finished Date', 'To Be Approved By Management',
  'Submitted For Approval At', 'Approval Date', 'Rejection Reason', 'Remarks',
  'Budget', 'Actual Spend', 'Subtasks', 'Comments', 'Is Overdue', 'Created At',
  'Updated At', 'Deleted At'
];

const MASTER_COLUMNS = [
  'ID', 'Name', 'Status', 'Description', 'Created At', 'Updated At', 'Deleted At'
];

const ACTIVITY_LOG_COLUMNS = [
  'ID', 'User', 'Role', 'Date', 'Time', 'Action', 'Target', 'Old Value', 'New Value'
];

const USER_COLUMNS = [
  'Email', 'Name', 'Role', 'Status', 'Last Login At', 'Created At', 'Updated At', 'Deleted At'
];

const SETTINGS_COLUMNS = ['Key', 'Value', 'Description'];
const REPORTS_COLUMNS = ['Metric', 'Value', 'Generated At'];
const DASHBOARD_COLUMNS = ['KPI', 'Value', 'Generated At'];

const sheets = [
  { name: 'Tasks', columns: TASK_COLUMNS },
  { name: 'Projects', columns: MASTER_COLUMNS },
  { name: 'Vendors', columns: MASTER_COLUMNS },
  { name: 'Agencies', columns: MASTER_COLUMNS },
  { name: 'Departments', columns: MASTER_COLUMNS },
  { name: 'Team Members', columns: MASTER_COLUMNS },
  { name: 'Activity Log', columns: ACTIVITY_LOG_COLUMNS },
  { name: 'Users', columns: USER_COLUMNS },
  { name: 'Settings', columns: SETTINGS_COLUMNS },
  { name: 'Reports', columns: REPORTS_COLUMNS },
  { name: 'Dashboard', columns: DASHBOARD_COLUMNS }
];

sheets.forEach(sheet => {
  const content = toCsvRow(sheet.columns) + '\n';
  fs.writeFileSync(path.join(outDir, `${sheet.name.replace(/ /g, '_')}.csv`), content);
});

console.log('All 11 CSV template headers generated in google-sheets-templates/');
