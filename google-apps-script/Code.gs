/**
 * Google Apps Script Backend & Sheet Setup for Marketing Task Management Dashboard
 *
 * Instructions for setup:
 * 1. Open your Google Sheet -> Extensions -> Apps Script
 * 2. Paste this complete code into Code.gs and save.
 * 3. Run the `setupSpreadsheetTemplate()` function once inside Apps Script to automatically
 *    create all required tabs and blank header rows!
 * 4. (Optional Web App sync) Click Deploy -> New Deployment -> Select type: Web app
 *    - Execute as: Me
 *    - Who has access: Anyone
 * 5. Share the Google Sheet with your GCP Service Account email as an Editor.
 */

const SHEETS = {
  TASKS: 'Tasks',
  PROJECTS: 'Projects',
  VENDORS: 'Vendors',
  AGENCIES: 'Agencies',
  DEPARTMENTS: 'Departments',
  TEAM_MEMBERS: 'Team Members',
  ACTIVITY_LOG: 'Activity Log',
  USERS: 'Users',
  SETTINGS: 'Settings',
  REPORTS: 'Reports',
  DASHBOARD: 'Dashboard'
};

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

/**
 * Run this function once from the Apps Script editor menu to create/format all tabs with headers.
 */
function setupSpreadsheetTemplate() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  
  ensureSheetWithHeaders(ss, SHEETS.TASKS, TASK_COLUMNS);
  ensureSheetWithHeaders(ss, SHEETS.PROJECTS, MASTER_COLUMNS);
  ensureSheetWithHeaders(ss, SHEETS.VENDORS, MASTER_COLUMNS);
  ensureSheetWithHeaders(ss, SHEETS.AGENCIES, MASTER_COLUMNS);
  ensureSheetWithHeaders(ss, SHEETS.DEPARTMENTS, MASTER_COLUMNS);
  ensureSheetWithHeaders(ss, SHEETS.TEAM_MEMBERS, MASTER_COLUMNS);
  ensureSheetWithHeaders(ss, SHEETS.ACTIVITY_LOG, ACTIVITY_LOG_COLUMNS);
  ensureSheetWithHeaders(ss, SHEETS.USERS, USER_COLUMNS);
  ensureSheetWithHeaders(ss, SHEETS.SETTINGS, SETTINGS_COLUMNS);
  ensureSheetWithHeaders(ss, SHEETS.REPORTS, REPORTS_COLUMNS);
  ensureSheetWithHeaders(ss, SHEETS.DASHBOARD, DASHBOARD_COLUMNS);
  
  SpreadsheetApp.getUi().alert('Spreadsheet Template Initialized Successfully! All 11 tabs are configured.');
}

function ensureSheetWithHeaders(ss, name, headers) {
  let sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
  }
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(headers);
  }
  sheet.getRange(1, 1, 1, headers.length)
    .setFontWeight('bold')
    .setBackground('#F1F5F9')
    .setFontColor('#0F172A');
  sheet.setFrozenRows(1);
  return sheet;
}

function doGet(e) {
  try {
    const action = (e && e.parameter && e.parameter.action) || 'getAll';
    if (action === 'getAll') {
      return createJsonResponse({
        status: 'success',
        data: readAllDataFromSpreadsheet()
      });
    }
    return createJsonResponse({ status: 'error', message: 'Unknown action' });
  } catch (err) {
    return createJsonResponse({ status: 'error', message: err.toString() });
  }
}

function doPost(e) {
  try {
    const postData = JSON.parse(e.postData.contents);
    if (postData.action === 'syncData' && postData.data) {
      writeAllDataToSpreadsheet(postData.data);
      return createJsonResponse({ status: 'success', message: 'Synced to Google Sheets successfully!' });
    }
    return createJsonResponse({ status: 'error', message: 'Invalid post action' });
  } catch (err) {
    return createJsonResponse({ status: 'error', message: err.toString() });
  }
}

function createJsonResponse(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function readAllDataFromSpreadsheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const tasksSheet = ensureSheetWithHeaders(ss, SHEETS.TASKS, TASK_COLUMNS);
  const tasksRows = tasksSheet.getDataRange().getValues();
  const tasks = [];
  
  if (tasksRows.length > 1) {
    for (let i = 1; i < tasksRows.length; i++) {
      const r = tasksRows[i];
      if (!r[0]) continue;
      tasks.push({
        id: String(r[0]),
        project: String(r[1] || ''),
        taskName: String(r[2] || ''),
        taskBrief: String(r[3] || ''),
        department: String(r[4] || ''),
        internalPoc: String(r[5] || ''),
        agency: String(r[6] || ''),
        vendor: String(r[7] || ''),
        priority: String(r[8] || 'Medium'),
        taskProgress: String(r[9] || 'Not Started'),
        deadline: String(r[10] || ''),
        executionStarted: Boolean(r[11]),
        executionStartDate: r[12] ? String(r[12]) : null,
        actualFinishedDate: r[13] ? String(r[13]) : null,
        toBeApprovedByManagement: Boolean(r[14]),
        submittedForApprovalAt: r[15] ? String(r[15]) : null,
        approvalDate: r[16] ? String(r[16]) : null,
        rejectionReason: r[17] ? String(r[17]) : null,
        remarks: String(r[18] || ''),
        budget: Number(r[19]) || 0,
        actualSpend: Number(r[20]) || 0,
        subtasks: r[21] ? JSON.parse(r[21]) : [],
        comments: r[22] ? JSON.parse(r[22]) : [],
        isOverdue: Boolean(r[23]),
        createdAt: String(r[24] || ''),
        updatedAt: String(r[25] || ''),
        deletedAt: r[26] ? String(r[26]) : null
      });
    }
  }

  return { tasks };
}

function writeAllDataToSpreadsheet(data) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  if (data.tasks) {
    const sheet = ensureSheetWithHeaders(ss, SHEETS.TASKS, TASK_COLUMNS);
    sheet.clearContents();
    sheet.appendRow(TASK_COLUMNS);
    data.tasks.forEach(t => {
      sheet.appendRow([
        t.id, t.project, t.taskName, t.taskBrief, t.department, t.internalPoc,
        t.agency, t.vendor, t.priority, t.taskProgress, t.deadline, t.executionStarted,
        t.executionStartDate || '', t.actualFinishedDate || '', t.toBeApprovedByManagement,
        t.submittedForApprovalAt || '', t.approvalDate || '', t.rejectionReason || '',
        t.remarks, t.budget || 0, t.actualSpend || 0, JSON.stringify(t.subtasks || []),
        JSON.stringify(t.comments || []), t.isOverdue, t.createdAt, t.updatedAt, t.deletedAt || ''
      ]);
    });
  }
}
