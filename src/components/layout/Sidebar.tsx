'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useData } from '@/context/DataContext';
import { MAIN_NAV, SYSTEM_NAV, type NavItem } from '@/lib/navigation';
import { useModifierLabel } from '@/lib/client/useKeyboardShortcuts';
import {
  LayoutDashboard,
  CheckSquare,
  Clock,
  Calendar,
  BarChart3,
  Database,
  Activity,
  Settings,
  Layers,
  PanelLeftClose,
  PanelLeftOpen,
  X,
} from 'lucide-react';

const ICONS: Record<NavItem['id'], React.ElementType> = {
  dashboard: LayoutDashboard,
  tasks: CheckSquare,
  approvals: Clock,
  calendar: Calendar,
  reports: BarChart3,
  'master-data': Database,
  activity: Activity,
  settings: Settings,
};

interface SidebarProps {
  /**
   * `persistent` is the desktop column; `drawer` is the mobile overlay, which is
   * always full width and shows a close button instead of a collapse toggle.
   */
  variant: 'persistent' | 'drawer';
  onNavigate?: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({ variant, onNavigate }) => {
  const { tasks, isSidebarCollapsed, toggleSidebar } = useData();
  const pathname = usePathname();
  const modifier = useModifierLabel();

  const isDrawer = variant === 'drawer';
  // Collapsing only applies to the persistent column.
  const collapsed = !isDrawer && isSidebarCollapsed;

  const overdueCount = tasks.filter((task) => task.isOverdue).length;
  const approvalCount = tasks.filter(
    (task) => task.taskProgress === 'To Be Approved by Management'
  ).length;

  const badgeFor = (id: NavItem['id']): number | undefined => {
    if (id === 'tasks') return overdueCount || undefined;
    if (id === 'approvals') return approvalCount || undefined;
    return undefined;
  };

  const renderItem = (item: NavItem) => {
    const Icon = ICONS[item.id];
    const isActive =
      item.href === '/' ? pathname === '/' : pathname.startsWith(item.href);
    const badge = badgeFor(item.id);

    return (
      <li key={item.id}>
        <Link
          href={item.href}
          onClick={onNavigate}
          aria-current={isActive ? 'page' : undefined}
          title={collapsed ? `${item.label} (${modifier}${item.shortcutDigit})` : undefined}
          className={`group relative flex items-center rounded-lg transition-colors ${
            collapsed ? 'justify-center px-0 py-2.5' : 'gap-3 px-3 py-2'
          } ${
            isActive
              ? 'bg-slate-800 text-white dark:bg-slate-800'
              : 'text-slate-400 hover:text-white hover:bg-slate-800/50'
          }`}
        >
          <Icon
            className={`w-4.5 h-4.5 shrink-0 ${
              isActive ? 'text-white' : 'text-slate-500 group-hover:text-slate-300'
            }`}
            aria-hidden="true"
          />

          {!collapsed && (
            <>
              <span className="flex-1 text-[13.5px] font-medium truncate">
                {item.label}
              </span>

              {badge !== undefined && (
                <span
                  className={`shrink-0 min-w-5 px-1.5 py-0.5 rounded text-[11px] font-semibold text-center tabular ${
                    item.id === 'tasks'
                      ? 'bg-rose-500/15 text-rose-300'
                      : 'bg-amber-500/15 text-amber-300'
                  }`}
                >
                  {badge}
                </span>
              )}

              {/* The shortcut hint appears on hover only, so it does not add
                  permanent visual noise to every row. */}
              {badge === undefined && (
                <kbd className="shrink-0 hidden lg:block text-[10px] font-mono text-slate-600 opacity-0 group-hover:opacity-100 transition-opacity">
                  {modifier}
                  {item.shortcutDigit}
                </kbd>
              )}
            </>
          )}

          {/* Collapsed rail still needs to signal an unread count. */}
          {collapsed && badge !== undefined && (
            <span
              className={`absolute top-1.5 right-2.5 w-1.5 h-1.5 rounded-full ${
                item.id === 'tasks' ? 'bg-rose-400' : 'bg-amber-400'
              }`}
              aria-hidden="true"
            />
          )}

          {collapsed && <span className="sr-only">{item.label}</span>}
        </Link>
      </li>
    );
  };

  return (
    <nav
      aria-label="Main navigation"
      className={`h-full flex flex-col bg-slate-950 border-r border-slate-800 ${
        isDrawer ? 'w-full' : collapsed ? 'w-16' : 'w-60'
      } ${!isDrawer ? 'transition-[width] duration-200 sticky top-0 h-screen' : ''}`}
    >
      {/* Brand */}
      <div
        className={`h-16 shrink-0 flex items-center border-b border-slate-800 ${
          collapsed ? 'justify-center px-2' : 'justify-between px-4'
        }`}
      >
        {collapsed ? (
          <span className="w-9 h-9 rounded-lg bg-slate-800 flex items-center justify-center">
            <Layers className="w-4 h-4 text-white" aria-hidden="true" />
          </span>
        ) : (
          <>
            <div className="flex items-center gap-2.5 min-w-0">
              <span className="w-9 h-9 rounded-lg bg-slate-800 flex items-center justify-center shrink-0">
                <Layers className="w-4 h-4 text-white" aria-hidden="true" />
              </span>
              <span className="min-w-0">
                <span className="block text-[13.5px] font-semibold text-white truncate">
                  Marketing Dashboard
                </span>
                <span className="block text-[11px] text-slate-500 truncate">
                  Marketing tasks
                </span>
              </span>
            </div>

            {isDrawer && (
              <button
                type="button"
                onClick={onNavigate}
                aria-label="Close navigation"
                className="shrink-0 p-1.5 -mr-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
              >
                <X className="w-4 h-4" aria-hidden="true" />
              </button>
            )}
          </>
        )}
      </div>

      {/* Sections */}
      <div className="flex-1 overflow-y-auto px-2 py-4 space-y-6">
        <div className="space-y-1">
          {!collapsed && (
            <p className="px-3 pb-1.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-600">
              Workspace
            </p>
          )}
          <ul className="space-y-0.5">{MAIN_NAV.map(renderItem)}</ul>
        </div>

        <div className="space-y-1">
          {!collapsed && (
            <p className="px-3 pb-1.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-600">
              Manage
            </p>
          )}
          <ul className="space-y-0.5">{SYSTEM_NAV.map(renderItem)}</ul>
        </div>
      </div>

      {/* Collapse toggle — desktop only; the drawer has its own close button. */}
      {!isDrawer && (
        <div className="shrink-0 p-2 border-t border-slate-800">
          <button
            type="button"
            onClick={toggleSidebar}
            aria-label={
              collapsed ? 'Expand navigation' : 'Collapse navigation'
            }
            className={`flex items-center gap-2.5 w-full rounded-lg px-3 py-2 text-[13px] font-medium text-slate-400 hover:text-white hover:bg-slate-800/50 transition-colors ${
              collapsed ? 'justify-center px-0' : ''
            }`}
          >
            {collapsed ? (
              <PanelLeftOpen className="w-4.5 h-4.5" aria-hidden="true" />
            ) : (
              <>
                <PanelLeftClose className="w-4.5 h-4.5" aria-hidden="true" />
                <span>Collapse</span>
              </>
            )}
          </button>
        </div>
      )}
    </nav>
  );
};
