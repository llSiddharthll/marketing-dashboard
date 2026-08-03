'use client';

import React, { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useData } from '@/context/DataContext';
import { useTheme } from '@/context/ThemeContext';
import { useModifierLabel } from '@/lib/client/useKeyboardShortcuts';
import type { UserRole } from '@/types/dashboard';
import {
  Search,
  Bell,
  Moon,
  Sun,
  RefreshCw,
  ShieldCheck,
  LogOut,
  X,
  AlertTriangle,
  CloudOff,
  Menu,
  Monitor,
} from 'lucide-react';

const ROLE_DESCRIPTIONS: Record<UserRole, string> = {
  Admin:
    'Full access: edit and archive any task, manage master data and people, configure the connection.',
  'Marketing Team':
    'Create and edit tasks, request approval, manage master data.',
  Management: 'Approve or reject tasks with feedback, and view everything.',
  Viewer: 'Read-only access across all sections.',
};

export const Header: React.FC<{ onOpenDrawer: () => void }> = ({
  onOpenDrawer,
}) => {
  const {
    globalSearch,
    setGlobalSearch,
    currentUser,
    currentUserRole,
    signOut,
    syncStatus,
    refresh,
    retryPendingWrites,
    notifications,
    markNotificationRead,
    clearAllNotifications,
  } = useData();

  const { resolved, preference, setPreference, toggle } = useTheme();
  const router = useRouter();
  const modifier = useModifierLabel();

  const [openMenu, setOpenMenu] = useState<'none' | 'notifications' | 'account'>(
    'none'
  );

  const notificationsRef = useRef<HTMLDivElement>(null);
  const accountRef = useRef<HTMLDivElement>(null);

  // One handler for both popovers: click outside or Escape dismisses.
  useEffect(() => {
    if (openMenu === 'none') return;

    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (
        !notificationsRef.current?.contains(target) &&
        !accountRef.current?.contains(target)
      ) {
        setOpenMenu('none');
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpenMenu('none');
    };

    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [openMenu]);

  const unread = notifications.filter((item) => !item.read);

  const connection = {
    connected: {
      label: 'Synced',
      tone: 'text-fg-muted hover:text-fg hover:bg-surface-sunken',
      tooltip: syncStatus.lastSyncedAt
        ? `Last read at ${new Date(syncStatus.lastSyncedAt).toLocaleTimeString()}. Click to refresh.`
        : 'Connected. Click to refresh.',
    },
    checking: {
      label: 'Checking',
      tone: 'text-fg-subtle',
      tooltip: 'Checking the connection to Google Sheets…',
    },
    unconfigured: {
      label: 'Not connected',
      tone: 'text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/40',
      tooltip: 'Google Sheets is not configured. Open Settings for the steps.',
    },
    error: {
      label: 'Sync problem',
      tone: 'text-rose-700 dark:text-rose-300 bg-rose-50 dark:bg-rose-950/40',
      tooltip: syncStatus.error ?? 'Sync failed. Open Settings to diagnose.',
    },
  }[syncStatus.state];

  const initials = (currentUser?.name ?? '?')
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join('');

  return (
    <header className="sticky top-0 z-30 h-16 shrink-0 bg-canvas/85 backdrop-blur-md border-b border-line">
      <div className="h-full px-4 sm:px-6 lg:px-8 flex items-center gap-3">
        {/* Mobile navigation trigger */}
        <button
          type="button"
          onClick={onOpenDrawer}
          aria-label="Open navigation"
          className="lg:hidden shrink-0 p-2 -ml-2 rounded-lg text-fg-muted hover:text-fg hover:bg-surface-sunken transition-colors"
        >
          <Menu className="w-5 h-5" aria-hidden="true" />
        </button>

        {/* Search */}
        <div className="flex-1 min-w-0 max-w-md">
          <label htmlFor="global-search" className="sr-only">
            Search tasks, projects, people, agencies and vendors
          </label>
          <div className="relative">
            <Search
              className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-fg-subtle pointer-events-none"
              aria-hidden="true"
            />
            <input
              id="global-search"
              data-global-search
              type="search"
              value={globalSearch}
              onChange={(event) => setGlobalSearch(event.target.value)}
              placeholder="Search tasks…"
              className="field pl-9 pr-14 py-2"
            />
            {globalSearch ? (
              <button
                type="button"
                onClick={() => setGlobalSearch('')}
                aria-label="Clear search"
                className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded text-fg-subtle hover:text-fg transition-colors"
              >
                <X className="w-3.5 h-3.5" aria-hidden="true" />
              </button>
            ) : (
              <kbd
                className="absolute right-2.5 top-1/2 -translate-y-1/2 hidden sm:block px-1.5 py-0.5 rounded border border-line text-[10px] font-mono text-fg-subtle pointer-events-none"
                aria-hidden="true"
              >
                /
              </kbd>
            )}
          </div>
        </div>

        <div className="flex items-center gap-1 ml-auto">
          {/* Pending writes. Only rendered when something is genuinely queued. */}
          {syncStatus.pendingWrites > 0 && (
            <button
              type="button"
              onClick={retryPendingWrites}
              title={`${syncStatus.pendingWrites} change(s) not yet saved. Click to retry.`}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[13px] font-medium text-amber-800 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/40 transition-colors"
            >
              <CloudOff className="w-3.5 h-3.5" aria-hidden="true" />
              <span className="tabular">{syncStatus.pendingWrites}</span>
              <span className="sr-only">changes pending, click to retry</span>
            </button>
          )}

          {/* Connection */}
          <button
            type="button"
            onClick={() => {
              if (syncStatus.state === 'connected') void refresh();
              else router.push('/settings');
            }}
            disabled={syncStatus.busy}
            title={connection.tooltip}
            className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[13px] font-medium transition-colors disabled:opacity-60 ${connection.tone}`}
          >
            {syncStatus.state === 'unconfigured' ||
            syncStatus.state === 'error' ? (
              <AlertTriangle className="w-3.5 h-3.5" aria-hidden="true" />
            ) : (
              <RefreshCw
                className={`w-3.5 h-3.5 ${
                  syncStatus.busy || syncStatus.state === 'checking'
                    ? 'animate-spin'
                    : ''
                }`}
                aria-hidden="true"
              />
            )}
            <span className="hidden md:inline">{connection.label}</span>
          </button>

          {/* Theme */}
          <button
            type="button"
            onClick={toggle}
            aria-label={`Switch to ${resolved === 'dark' ? 'light' : 'dark'} mode`}
            className="p-2 rounded-lg text-fg-muted hover:text-fg hover:bg-surface-sunken transition-colors"
          >
            {resolved === 'dark' ? (
              <Sun className="w-4.5 h-4.5" aria-hidden="true" />
            ) : (
              <Moon className="w-4.5 h-4.5" aria-hidden="true" />
            )}
          </button>

          {/* Notifications */}
          <div className="relative" ref={notificationsRef}>
            <button
              type="button"
              onClick={() =>
                setOpenMenu(openMenu === 'notifications' ? 'none' : 'notifications')
              }
              aria-label={
                unread.length > 0
                  ? `Notifications, ${unread.length} unread`
                  : 'Notifications'
              }
              aria-expanded={openMenu === 'notifications'}
              aria-haspopup="dialog"
              className="relative p-2 rounded-lg text-fg-muted hover:text-fg hover:bg-surface-sunken transition-colors"
            >
              <Bell className="w-4.5 h-4.5" aria-hidden="true" />
              {unread.length > 0 && (
                <span
                  className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-rose-500 ring-2 ring-canvas"
                  aria-hidden="true"
                />
              )}
            </button>

            {openMenu === 'notifications' && (
              <div
                role="dialog"
                aria-label="Notifications"
                className="absolute right-0 mt-2 w-[min(22rem,calc(100vw-2rem))] card shadow-xl p-2 animate-slide-up"
              >
                <div className="flex items-center justify-between px-2 py-1.5">
                  <h2 className="text-card-title">Notifications</h2>
                  {notifications.length > 0 && (
                    <button
                      type="button"
                      onClick={clearAllNotifications}
                      className="text-[13px] font-medium text-fg-muted hover:text-fg transition-colors"
                    >
                      Clear all
                    </button>
                  )}
                </div>

                <div className="max-h-80 overflow-y-auto">
                  {notifications.length === 0 ? (
                    <p className="px-2 py-8 text-center text-meta">
                      Nothing to catch up on.
                    </p>
                  ) : (
                    <ul className="divide-y divide-line">
                      {notifications.map((item) => (
                        <li key={item.id}>
                          <button
                            type="button"
                            onClick={() => {
                              markNotificationRead(item.id);
                              if (item.taskId) router.push('/tasks');
                              setOpenMenu('none');
                            }}
                            className={`w-full text-left px-2 py-2.5 rounded-lg hover:bg-surface-sunken transition-colors ${
                              item.read ? '' : 'bg-accent-soft/40'
                            }`}
                          >
                            <span className="flex items-baseline justify-between gap-2">
                              <span className="text-[13.5px] font-medium text-fg">
                                {item.title}
                              </span>
                              <span className="shrink-0 text-[11px] font-mono text-fg-subtle">
                                {new Date(item.timestamp).toLocaleTimeString([], {
                                  hour: '2-digit',
                                  minute: '2-digit',
                                })}
                              </span>
                            </span>
                            <span className="block text-[13px] text-fg-muted mt-0.5">
                              {item.message}
                            </span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Account */}
          <div className="relative" ref={accountRef}>
            <button
              type="button"
              onClick={() =>
                setOpenMenu(openMenu === 'account' ? 'none' : 'account')
              }
              aria-label="Your account"
              aria-expanded={openMenu === 'account'}
              aria-haspopup="menu"
              className="flex items-center gap-2 pl-1 pr-2 py-1 ml-1 rounded-lg hover:bg-surface-sunken transition-colors"
            >
              <span className="w-7 h-7 rounded-lg bg-accent text-accent-fg flex items-center justify-center text-[11px] font-semibold shrink-0">
                {initials || '?'}
              </span>
              <span className="hidden md:block max-w-30 truncate text-[13px] font-medium text-fg">
                {currentUser?.name ?? 'Signed out'}
              </span>
            </button>

            {openMenu === 'account' && (
              <div
                role="menu"
                className="absolute right-0 mt-2 w-[min(20rem,calc(100vw-2rem))] card shadow-xl p-2 animate-slide-up"
              >
                <div className="px-2 py-2 border-b border-line">
                  <p className="text-[13.5px] font-semibold truncate">
                    {currentUser?.name ?? 'Signed out'}
                  </p>
                  {currentUser && (
                    <p className="text-[12.5px] text-fg-subtle truncate">
                      {currentUser.email}
                    </p>
                  )}
                </div>

                <div className="px-2 py-2.5 border-b border-line space-y-1.5">
                  <p className="flex items-center gap-1.5 text-[13px] font-medium">
                    <ShieldCheck
                      className="w-3.5 h-3.5 text-fg-subtle"
                      aria-hidden="true"
                    />
                    {currentUserRole}
                  </p>
                  <p className="text-[12.5px] text-fg-subtle leading-snug">
                    {ROLE_DESCRIPTIONS[currentUserRole]}
                  </p>
                  <p className="text-[12px] text-fg-subtle leading-snug pt-0.5">
                    Only an administrator can change your role.
                  </p>
                </div>

                {/* Theme preference, including handing control back to the OS —
                    the toggle alone cannot express "follow my system". */}
                <div className="px-2 py-2 border-b border-line">
                  <p className="text-[12px] font-medium text-fg-subtle mb-1.5">
                    Appearance
                  </p>
                  <div
                    role="radiogroup"
                    aria-label="Appearance"
                    className="flex items-center gap-0.5 p-0.5 bg-surface-sunken rounded-lg"
                  >
                    {(
                      [
                        { value: 'light', label: 'Light', Icon: Sun },
                        { value: 'dark', label: 'Dark', Icon: Moon },
                        { value: 'system', label: 'System', Icon: Monitor },
                      ] as const
                    ).map(({ value, label, Icon }) => (
                      <button
                        key={value}
                        role="radio"
                        aria-checked={preference === value}
                        onClick={() => setPreference(value)}
                        className={`flex-1 flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-md text-[12.5px] font-medium transition-colors ${
                          preference === value
                            ? 'bg-surface text-fg shadow-sm'
                            : 'text-fg-subtle hover:text-fg'
                        }`}
                      >
                        <Icon className="w-3.5 h-3.5" aria-hidden="true" />
                        {label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="px-2 py-1.5 border-b border-line">
                  <p className="text-[12px] text-fg-subtle">
                    Press{' '}
                    <kbd className="px-1 py-0.5 rounded border border-line font-mono text-[11px]">
                      {modifier}1
                    </kbd>
                    –
                    <kbd className="px-1 py-0.5 rounded border border-line font-mono text-[11px]">
                      {modifier}8
                    </kbd>{' '}
                    to switch sections, or{' '}
                    <kbd className="px-1 py-0.5 rounded border border-line font-mono text-[11px]">
                      /
                    </kbd>{' '}
                    to search.
                  </p>
                </div>

                <button
                  role="menuitem"
                  onClick={() => {
                    setOpenMenu('none');
                    void signOut();
                  }}
                  className="w-full mt-1 flex items-center gap-2 px-2 py-2 rounded-lg text-[13px] font-medium text-fg-muted hover:text-fg hover:bg-surface-sunken transition-colors"
                >
                  <LogOut className="w-3.5 h-3.5" aria-hidden="true" />
                  Sign out
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </header>
  );
};
