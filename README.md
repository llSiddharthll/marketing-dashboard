# Marketing Task Management Dashboard

A client-ready, high-performance task management dashboard for marketing teams, using Google Sheets as the single source of truth. Built with Next.js 16, React 19, TypeScript, and Tailwind CSS.

The spreadsheet acts as the master database. The dashboard reads and writes through server-side API routes using a Google Service Account, ensuring real-time data sync, optimistic concurrency, and zero client-side credential exposure.

---

## Quick Start

```bash
npm install
cp .env.example .env.local     # configure Google Sheets ID & credentials below
npm run dev                    # open http://localhost:3000
```

---

## 1. Google Sheets Setup

### A. Blank Google Sheet Template Structure

Create a new Google Sheet (e.g. named `Marketing Task Dashboard`). The application uses **11 tabs**. Make sure all 11 tabs are present and the column order matches exactly:

#### Tab 1: `Tasks` (27 Columns)
```
A: ID | B: Project | C: Task Name | D: Task Brief | E: Department | F: Internal POC | G: Agency | H: Vendor | I: Priority | J: Task Progress | K: Deadline | L: Execution Started | M: Execution Start Date | N: Actual Finished Date | O: To Be Approved By Management | P: Submitted For Approval At | Q: Approval Date | R: Rejection Reason | S: Remarks | T: Budget | U: Actual Spend | V: Subtasks | W: Comments | X: Is Overdue | Y: Created At | Z: Updated At | AA: Deleted At
```

#### Tab 2: `Projects` (7 Columns)
```
A: ID | B: Name | C: Status | D: Description | E: Created At | F: Updated At | G: Deleted At
```

#### Tab 3: `Vendors` (7 Columns)
```
A: ID | B: Name | C: Status | D: Description | E: Created At | F: Updated At | G: Deleted At
```

#### Tab 4: `Agencies` (7 Columns)
```
A: ID | B: Name | C: Status | D: Description | E: Created At | F: Updated At | G: Deleted At
```

#### Tab 5: `Departments` (7 Columns)
```
A: ID | B: Name | C: Status | D: Description | E: Created At | F: Updated At | G: Deleted At
```

#### Tab 6: `Team Members` (7 Columns)
```
A: ID | B: Name | C: Status | D: Description | E: Created At | F: Updated At | G: Deleted At
```

#### Tab 7: `Activity Log` (9 Columns)
```
A: ID | B: User | C: Role | D: Date | E: Time | F: Action | G: Target | H: Old Value | I: New Value
```

#### Tab 8: `Users` (8 Columns)
```
A: Email | B: Name | C: Role | D: Status | E: Last Login At | F: Created At | G: Updated At | H: Deleted At
```

#### Tab 9: `Settings` (3 Columns)
```
A: Key | B: Value | C: Description
```

#### Tab 10: `Reports` (3 Columns)
```
A: Metric | B: Value | C: Generated At
```

#### Tab 11: `Dashboard` (3 Columns)
```
A: KPI | B: Value | C: Generated At
```

---

### B. Automated Google Apps Script (`Code.gs`)

1. Open your Google Sheet → **Extensions** → **Apps Script**.
2. Replace all content in `Code.gs` with the following:

```javascript
/**
 * Google Apps Script Backend & Sheet Setup for Marketing Task Management Dashboard
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
```

3. Save the script (`Ctrl+S` / `Cmd+S`).
4. Select `setupSpreadsheetTemplate` from the top function dropdown and click **Run**. This automatically creates and formats all 11 tabs with their proper headers.

---

## 2. Google Cloud Service Account Setup

1. Go to [Google Cloud Console](https://console.cloud.google.com/).
2. Enable the **Google Sheets API** under *APIs & Services → Library*.
3. Go to *APIs & Services → Credentials → Create Credentials → Service Account*.
4. Name it `marketing-dashboard`, click **Create**, then go to **Keys → Add Key → Create New Key (JSON)**.
5. Copy the `client_email` from the downloaded JSON file (e.g. `marketing-dashboard@your-project.iam.gserviceaccount.com`).
6. Open your Google Sheet, click **Share**, paste the service account email, and set role to **Editor**.

---

## 3. Environment Variables Configuration

Copy `.env.example` to `.env.local`:

```bash
cp .env.example .env.local
```

Fill in `.env.local`:

```env
# Google Spreadsheet ID (the segment between /d/ and /edit in your Sheet URL)
GOOGLE_SHEETS_SPREADSHEET_ID=1wgOv_kftukxOeNjMTnaO81d_8BoHOJgpUy7CfsTzi84

# Service Account Email (from downloaded JSON key)
GOOGLE_SERVICE_ACCOUNT_EMAIL=marketing-dashboard@your-project.iam.gserviceaccount.com

# Service Account Private Key (from downloaded JSON key - retain quotes and \n)
GOOGLE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBg...\n-----END PRIVATE KEY-----\n"

# Login Credentials & Security
DEMO_USER_EMAIL=admin@marketingdashboard.com
DEMO_USER_PASSWORD=password123
SESSION_SECRET=default-session-secret-min-32-chars-long-for-hmac!
APP_URL=http://localhost:3000

# Optional Domain Restriction (e.g. company.com)
ALLOWED_EMAIL_DOMAIN=

# Timezone Settings
APP_TIMEZONE=Asia/Kolkata
NEXT_PUBLIC_APP_TIMEZONE=Asia/Kolkata
```

---

## 4. How to Run Locally

```bash
# Development server
npm run dev

# Run unit test suite (235 tests)
npm test

# Production build & serve
npm run build
npm start
```

---

## 5. Deployment Options

### Deploying to Vercel
1. Push code to GitHub/GitLab repository.
2. Import project into Vercel.
3. Add Environment Variables under **Project Settings → Environment Variables**:
   - `GOOGLE_SHEETS_SPREADSHEET_ID`
   - `GOOGLE_SERVICE_ACCOUNT_EMAIL`
   - `GOOGLE_PRIVATE_KEY`
   - `SESSION_SECRET`
   - `APP_URL` (e.g. `https://your-dashboard.vercel.app`)
   - `DEMO_USER_EMAIL` / `DEMO_USER_PASSWORD`
4. Click **Deploy**.

### Deploying with Docker
Build and run using the included production Dockerfile:

```bash
docker build -t marketing-dashboard .
docker run -p 3000:3000 --env-file .env.local marketing-dashboard
```

---

## 6. Access Control & User Roles

| Role | Permissions |
| --- | --- |
| **Admin** | Full access: manage users, master data, task deletion/reopening, spreadsheet initialisation |
| **Marketing Team** | Create/edit tasks, submit for approval, manage master data |
| **Management** | Approve or reject pending tasks, view all reports & dashboards |
| **Viewer** | Read-only access across all tabs |

---

## 7. Useful CLI Commands

| Command | Action |
| --- | --- |
| `npm run dev` | Start development server at `http://localhost:3000` |
| `npm run build` | Build production Next.js application |
| `npm start` | Run production server |
| `npm test` | Run complete unit test suite (235 tests) |
| `npm run lint` | Run ESLint checks |
