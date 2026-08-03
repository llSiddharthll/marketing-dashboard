/**
 * Navigation model.
 *
 * Single source of truth for the sections, their routes, labels and keyboard
 * shortcuts. The sidebar, the shortcut handler and the page titles all read from
 * here, so a rename cannot leave one of them behind.
 *
 * Labels follow the brief's own nav wording. The previous build had invented
 * names — "Task Management Engine", "Master Data Engine", "Activity Audit
 * Stream" — which read as a product demo rather than a tool, against a brief
 * that asks for something any employee can use without training.
 */

export type NavId =
  | 'dashboard'
  | 'tasks'
  | 'approvals'
  | 'calendar'
  | 'reports'
  | 'master-data'
  | 'activity'
  | 'settings';

export interface NavItem {
  id: NavId;
  /** Sidebar label. */
  label: string;
  /** Page heading; usually the same, occasionally more explicit. */
  title: string;
  /** One line under the page heading. */
  description: string;
  href: string;
  /** Digit pressed with the platform modifier. */
  shortcutDigit: number;
  group: 'main' | 'system';
}

export const NAV_ITEMS: NavItem[] = [
  {
    id: 'dashboard',
    label: 'Dashboard',
    title: 'Dashboard',
    description: 'Today at a glance across every project.',
    href: '/',
    shortcutDigit: 1,
    group: 'main',
  },
  {
    id: 'tasks',
    label: 'Tasks',
    title: 'Tasks',
    description: 'Everything the team is working on.',
    href: '/tasks',
    shortcutDigit: 2,
    group: 'main',
  },
  {
    id: 'approvals',
    label: 'Pending approvals',
    title: 'Pending approvals',
    description: 'Work submitted for management sign-off.',
    href: '/approvals',
    shortcutDigit: 3,
    group: 'main',
  },
  {
    id: 'calendar',
    label: 'Calendar',
    title: 'Calendar',
    description: 'Deadlines by month.',
    href: '/calendar',
    shortcutDigit: 4,
    group: 'main',
  },
  {
    id: 'reports',
    label: 'Reports',
    title: 'Reports',
    description: 'Output, budget and completion trends.',
    href: '/reports',
    shortcutDigit: 5,
    group: 'main',
  },
  {
    id: 'master-data',
    label: 'Master data',
    title: 'Master data',
    description:
      'The shared lists behind every dropdown: projects, departments, people, agencies and vendors.',
    href: '/master-data',
    shortcutDigit: 6,
    group: 'system',
  },
  {
    id: 'activity',
    label: 'Activity log',
    title: 'Activity log',
    description: 'Who changed what, and when.',
    href: '/activity',
    shortcutDigit: 7,
    group: 'system',
  },
  {
    id: 'settings',
    label: 'Settings',
    title: 'Settings',
    description: 'Google Sheets connection, people and access.',
    href: '/settings',
    shortcutDigit: 8,
    group: 'system',
  },
];

export const MAIN_NAV = NAV_ITEMS.filter((item) => item.group === 'main');
export const SYSTEM_NAV = NAV_ITEMS.filter((item) => item.group === 'system');

/** Resolves the active item from a pathname. */
export function navItemFromPath(pathname: string): NavItem {
  // Exact match on the root, prefix match elsewhere, so a future detail route
  // like /tasks/TSK-1 still highlights Tasks.
  if (pathname === '/') return NAV_ITEMS[0];
  const match = NAV_ITEMS.find(
    (item) => item.href !== '/' && pathname.startsWith(item.href)
  );
  return match ?? NAV_ITEMS[0];
}
