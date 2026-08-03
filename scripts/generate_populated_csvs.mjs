import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const outDir = path.join(rootDir, 'google-sheets-templates', 'populated');

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

// Headers
const TASK_COLUMNS = [
  'ID', 'Project', 'Task Name', 'Task Brief', 'Department', 'Internal POC',
  'Agency', 'Vendor', 'Priority', 'Task Progress', 'Deadline', 'Execution Started',
  'Execution Start Date', 'Actual Finished Date', 'To Be Approved By Management',
  'Submitted For Approval At', 'Approval Date', 'Rejection Reason', 'Remarks',
  'Budget', 'Actual Spend', 'Subtasks', 'Comments', 'Is Overdue', 'Created At',
  'Updated At', 'Deleted At'
];

const MASTER_COLUMNS = ['ID', 'Name', 'Status', 'Description', 'Created At', 'Updated At', 'Deleted At'];
const ACTIVITY_LOG_COLUMNS = ['ID', 'User', 'Role', 'Date', 'Time', 'Action', 'Target', 'Old Value', 'New Value'];
const USER_COLUMNS = ['Email', 'Name', 'Role', 'Status', 'Last Login At', 'Created At', 'Updated At', 'Deleted At'];
const SETTINGS_COLUMNS = ['Key', 'Value', 'Description'];
const REPORTS_COLUMNS = ['Metric', 'Value', 'Generated At'];
const DASHBOARD_COLUMNS = ['KPI', 'Value', 'Generated At'];

// Populated Rows
const tasksData = [
  ['TSK-1001', 'Q3 Brand Awareness Campaign', 'Hero Billboard Video Commercial Production', 'Create a 30-second high-impact anamorphic 3D video commercial for Times Square and digital displays.', 'Brand & Creative', 'Ananya Gupta', 'Apex Creative Studio', 'PixelPerfect Visuals', 'Urgent', 'In Progress', '2026-08-10', 'TRUE', '2026-07-15', '', 'FALSE', '', '', '', 'Script approved by CMO. Initial 3D renders in review.', 25000, 18500, '[{"id":"st-1","title":"Scriptwriting & Storyboard Sign-off","completed":true},{"id":"st-2","title":"3D Anamorphic Model Render","completed":true},{"id":"st-3","title":"Sound Design & Voiceover Audio","completed":false},{"id":"st-4","title":"Final 4K Resolution Export","completed":false}]', '[{"id":"c-1","author":"Ananya Gupta","role":"Marketing Team","text":"Initial 3D render draft sent to CMO for feedback.","timestamp":"2026-07-28T14:20:00Z"},{"id":"c-2","author":"Management Approver","role":"Management","text":"Looks promising! Please boost contrast on product logo in frame 4.","timestamp":"2026-07-28T16:00:00Z"}]', 'FALSE', '2026-07-15T09:30:00Z', '2026-07-28T14:20:00Z', ''],
  ['TSK-1002', 'Product Launch v4.0', 'GTM Keynote Deck & Launch Video Package', 'Design executive presentation slides and produce CEO keynote opening teaser video.', 'Product Marketing', 'Priya Verma', 'Apex Creative Studio', 'OmniStream Video', 'High', 'To Be Approved by Management', '2026-08-05', 'TRUE', '2026-07-10', '', 'TRUE', '2026-07-28T09:15:00.000Z', '', '', 'Awaiting final sign-off from Management before publishing collateral.', 15000, 14200, '[{"id":"st-201","title":"Executive Outline & Speaker Notes","completed":true},{"id":"st-202","title":"Custom 4K Motion Slides","completed":true},{"id":"st-203","title":"Teaser Video Sound Sync","completed":true}]', '[{"id":"c-201","author":"Priya Verma","role":"Marketing Team","text":"Submitted package for final Management approval.","timestamp":"2026-07-29T10:15:00Z"}]', 'FALSE', '2026-07-10T11:00:00Z', '2026-07-29T10:15:00Z', ''],
  ['TSK-1003', 'SEO & Content Overhaul', 'Q3 Pillar Blog Posts & Whitepaper Design', 'Write 5 technical pillar guides and design downloadable PDF eBooks for lead generation.', 'Content & PR', 'Rohan Mehta', 'Echo PR Studio', 'PrintCraft Solutions', 'Medium', 'In Progress', '2026-08-15', 'TRUE', '2026-07-18', '', 'FALSE', '', '', '', '3 out of 5 articles drafted. PDF layout template ready.', 8000, 4500, '[{"id":"st-301","title":"Pillar Articles 1-3 Writing","completed":true},{"id":"st-302","title":"Pillar Articles 4-5 Writing","completed":false},{"id":"st-303","title":"PDF Layout Design","completed":true}]', '[]', 'FALSE', '2026-07-18T08:00:00Z', '2026-07-27T16:45:00Z', ''],
  ['TSK-1004', 'Annual Customer Conference 2026', 'Sponsor Booth Signage & Swag Production', 'Print custom fabric backdrops, acrylic signs, and eco-friendly swag boxes for attendees.', 'Event Marketing', 'Karan Patel', 'Apex Creative Studio', 'PrintCraft Solutions', 'Urgent', 'Overdue', '2026-07-25', 'TRUE', '2026-07-02', '', 'FALSE', '', '', '', 'Vendor shipment delayed by 3 days. Urgently tracking delivery.', 30000, 31500, '[{"id":"st-401","title":"Vector Artwork Final Approval","completed":true},{"id":"st-402","title":"Fabric Banner Printing","completed":true},{"id":"st-403","title":"Eco Swag Box Assembly & Shipping","completed":false}]', '[]', 'TRUE', '2026-07-02T10:00:00Z', '2026-07-26T09:00:00Z', ''],
  ['TSK-1005', 'Social Media Growth Hacking', 'July Reel & TikTok Series (20 Videos)', 'Film and edit 20 short-form educational videos highlighting product features.', 'Brand & Creative', 'Aarav Sharma', 'Apex Media Global', 'PixelPerfect Visuals', 'Medium', 'Completed', '2026-07-28', 'TRUE', '2026-07-01', '2026-07-27', 'FALSE', '', '2026-07-27', '', 'All 20 videos scheduled on Buffer. Average engagement up 40%.', 12000, 11000, '[{"id":"st-501","title":"Video Concepts & Captions","completed":true},{"id":"st-502","title":"Shooting Day 1 & 2","completed":true},{"id":"st-503","title":"Color Grading & Subtitle Editing","completed":true}]', '[]', 'FALSE', '2026-07-01T14:00:00Z', '2026-07-27T18:00:00Z', ''],
  ['TSK-1006', 'Q3 Brand Awareness Campaign', 'Meta & LinkedIn Paid Ads Setup', 'Configure ad accounts, pixel tracking, audience retargeting, and creative variations.', 'Performance Marketing', 'Priya Verma', 'Apex Media Global', 'CloudScale Hosting', 'High', 'To Be Approved by Management', '2026-08-02', 'TRUE', '2026-07-20', '', 'TRUE', '2026-07-28T09:15:00.000Z', '', '', 'Ad copy and $50k budget allocation pending Management approval.', 50000, 50000, '[]', '[]', 'FALSE', '2026-07-20T13:00:00Z', '2026-07-29T11:30:00Z', ''],
  ['TSK-1007', 'Product Launch v4.0', 'Customer Case Study Video Series', 'Interview 3 enterprise customers and edit 3-minute success story videos.', 'Product Marketing', 'Rohan Mehta', 'Echo PR Studio', 'OmniStream Video', 'Low', 'Not Started', '2026-08-25', 'FALSE', '', '', 'FALSE', '', '', '', 'Customer consent forms sent out.', 18000, 0, '[]', '[]', 'FALSE', '2026-07-22T15:00:00Z', '2026-07-22T15:00:00Z', '']
];

const projectsData = [
  ['proj-1', 'Q3 Brand Awareness Campaign', 'Active', 'National digital and out-of-home campaign', '2026-07-01', '2026-07-01', ''],
  ['proj-2', 'Product Launch v4.0', 'Active', 'GTM strategy & creative collateral', '2026-07-05', '2026-07-05', ''],
  ['proj-3', 'SEO & Content Overhaul', 'Active', 'Blog and landing page optimization', '2026-07-10', '2026-07-10', ''],
  ['proj-4', 'Annual Customer Conference 2026', 'Active', 'Event marketing & sponsor booth designs', '2026-07-12', '2026-07-12', ''],
  ['proj-5', 'Social Media Growth Hacking', 'Active', 'Short-form video and influencer partnerships', '2026-07-15', '2026-07-15', '']
];

const vendorsData = [
  ['vendor-1', 'PrintCraft Solutions', 'Active', 'Large format printing and merchandise', '2026-07-01', '2026-07-01', ''],
  ['vendor-2', 'CloudScale Hosting', 'Active', 'CDN and landing page infrastructure', '2026-07-01', '2026-07-01', ''],
  ['vendor-3', 'OmniStream Video', 'Active', 'Livestreaming equipment rental', '2026-07-01', '2026-07-01', ''],
  ['vendor-4', 'EventPro Logistics', 'Active', 'Booth shipping & booth construction', '2026-07-01', '2026-07-01', '']
];

const agenciesData = [
  ['agency-1', 'Apex Creative Studio', 'Active', 'Full-service digital creative agency', '2026-07-01', '2026-07-01', ''],
  ['agency-2', 'Apex Media Global', 'Active', 'Performance media buying partner', '2026-07-01', '2026-07-01', ''],
  ['agency-3', 'Echo PR Studio', 'Active', 'Public relations and communications', '2026-07-01', '2026-07-01', ''],
  ['agency-4', 'PixelPerfect Visuals', 'Active', 'Video production & 3D motion graphics', '2026-07-01', '2026-07-01', '']
];

const departmentsData = [
  ['dept-1', 'Brand & Creative', 'Active', 'Design, video, branding assets', '2026-07-01', '2026-07-01', ''],
  ['dept-2', 'Performance Marketing', 'Active', 'PPC, Meta Ads, Paid Search', '2026-07-01', '2026-07-01', ''],
  ['dept-3', 'Product Marketing', 'Active', 'Sales enablement, positioning, collateral', '2026-07-01', '2026-07-01', ''],
  ['dept-4', 'Content & PR', 'Active', 'Blog posts, press releases, copy', '2026-07-01', '2026-07-01', ''],
  ['dept-5', 'Event Marketing', 'Active', 'Field events, webinars, conferences', '2026-07-01', '2026-07-01', '']
];

const teamMembersData = [
  ['team-1', 'Aarav Sharma', 'Active', 'Lead Creative Strategist', '2026-07-01', '2026-07-01', ''],
  ['team-2', 'Priya Verma', 'Active', 'Senior Growth Marketer', '2026-07-01', '2026-07-01', ''],
  ['team-3', 'Rohan Mehta', 'Active', 'Content Marketing Manager', '2026-07-01', '2026-07-01', ''],
  ['team-4', 'Ananya Gupta', 'Active', 'Design Director', '2026-07-01', '2026-07-01', ''],
  ['team-5', 'Karan Patel', 'Active', 'Events Coordinator', '2026-07-01', '2026-07-01', '']
];

const activityLogData = [
  ['log-1', 'Management Admin', 'Admin', '2026-07-29', '11:30:12', 'Approval Requested', 'TSK-1006', 'In Progress', 'To Be Approved by Management'],
  ['log-2', 'Priya Verma', 'Marketing Team', '2026-07-29', '10:15:44', 'Status Updated', 'TSK-1002', 'In Progress', 'To Be Approved by Management'],
  ['log-3', 'Aarav Sharma', 'Marketing Team', '2026-07-27', '18:00:00', 'Task Completed', 'TSK-1005', 'In Progress', 'Completed'],
  ['log-4', 'System Automation', 'Admin', '2026-07-26', '00:01:00', 'Overdue Triggered', 'TSK-1004', 'In Progress', 'Overdue']
];

const usersData = [
  ['admin@marketingdashboard.com', 'System Admin', 'Admin', 'Active', '2026-07-29T12:00:00Z', '2026-07-01T00:00:00Z', '2026-07-01T00:00:00Z', '']
];

const settingsData = [
  ['APP_TIMEZONE', 'Asia/Kolkata', 'Default business timezone for task deadlines and completion tracking'],
  ['APP_NAME', 'Marketing Task Dashboard', 'Workspace Display Name']
];

const reportsData = [];
const dashboardData = [];

const allData = {
  Tasks: { columns: TASK_COLUMNS, rows: tasksData },
  Projects: { columns: MASTER_COLUMNS, rows: projectsData },
  Vendors: { columns: MASTER_COLUMNS, rows: vendorsData },
  Agencies: { columns: MASTER_COLUMNS, rows: agenciesData },
  Departments: { columns: MASTER_COLUMNS, rows: departmentsData },
  'Team Members': { columns: MASTER_COLUMNS, rows: teamMembersData },
  'Activity Log': { columns: ACTIVITY_LOG_COLUMNS, rows: activityLogData },
  Users: { columns: USER_COLUMNS, rows: usersData },
  Settings: { columns: SETTINGS_COLUMNS, rows: settingsData },
  Reports: { columns: REPORTS_COLUMNS, rows: reportsData },
  Dashboard: { columns: DASHBOARD_COLUMNS, rows: dashboardData }
};

Object.entries(allData).forEach(([sheetName, config]) => {
  let content = toCsvRow(config.columns) + '\n';
  config.rows.forEach(r => {
    content += toCsvRow(r) + '\n';
  });
  fs.writeFileSync(path.join(outDir, `${sheetName.replace(/ /g, '_')}_populated.csv`), content);
});

console.log('Populated CSV templates generated in google-sheets-templates/populated/');
