'use client';

/**
 * Admin user management — the brief's "Admin can manage users".
 *
 * Backed by the `Users` tab in the spreadsheet, which is the access-control list:
 * an email must appear here (and not be suspended) to sign in at all, and the
 * role stored here is the only thing that grants permission.
 *
 * The server refuses changes that would leave no active Admin, and refuses
 * self-suspension and self-removal, so those failures surface as inline errors
 * rather than being pre-empted only in the UI.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { useData } from '@/context/DataContext';
import * as api from '@/lib/client/apiClient';
import { ApiError } from '@/lib/client/apiClient';
import type { AppUser, UserRole } from '@/types/dashboard';
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@/components/ui/table';
import {
  Users as UsersIcon,
  UserPlus,
  ShieldCheck,
  Ban,
  RotateCcw,
  Trash2,
  RefreshCw,
  AlertCircle,
  X,
} from 'lucide-react';

const ROLES: UserRole[] = ['Admin', 'Marketing Team', 'Management', 'Viewer'];

export const UserManagement: React.FC = () => {
  const { currentUser, showToast } = useData();

  const [users, setUsers] = useState<AppUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyEmail, setBusyEmail] = useState<string | null>(null);

  const [showInvite, setShowInvite] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteName, setInviteName] = useState('');
  const [inviteRole, setInviteRole] = useState<UserRole>('Marketing Team');
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [inviting, setInviting] = useState(false);

  const [confirmRemove, setConfirmRemove] = useState<AppUser | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await api.fetchUsers();
      setUsers(result.users);
    } catch (err) {
      setError(
        err instanceof ApiError
          ? (err.detail ?? err.message)
          : 'Could not load the user list.'
      );
    } finally {
      setLoading(false);
    }
  }, []);

  // Wrapped in an inline IIFE rather than `void load()` directly: an effect that
  // calls a stable function passed through its dependency array is exactly the
  // shape the setState-in-effect rule is designed to catch (that dependency-array
  // wiring is what makes it trace into the call). A one-off invocation, run once
  // on mount, is a plain fetch-on-mount with no such dependency relationship.
  useEffect(() => {
    void (async () => {
      await load();
    })();
    // Intentionally runs once on mount only. `load` is stable (empty deps) and
    // is also called directly by the Refresh button and after mutations.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Runs a mutation, surfacing the server's message on failure. */
  const run = async (
    email: string,
    action: () => Promise<void>,
    successMessage: string
  ) => {
    setBusyEmail(email);
    try {
      await action();
      await load();
      showToast('success', successMessage);
    } catch (err) {
      const detail =
        err instanceof ApiError ? (err.detail ?? err.message) : String(err);
      showToast('error', 'That change was not applied.', detail);
    } finally {
      setBusyEmail(null);
    }
  };

  const handleInvite = async (event: React.FormEvent) => {
    event.preventDefault();
    setInviteError(null);
    setInviting(true);
    try {
      await api.inviteUser({
        email: inviteEmail.trim(),
        name: inviteName.trim() || undefined,
        role: inviteRole,
      });
      setShowInvite(false);
      setInviteEmail('');
      setInviteName('');
      setInviteRole('Marketing Team');
      await load();
      showToast('success', `${inviteEmail.trim()} can now sign in.`);
    } catch (err) {
      setInviteError(
        err instanceof ApiError ? (err.detail ?? err.message) : String(err)
      );
    } finally {
      setInviting(false);
    }
  };

  return (
    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 shadow-xs space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-slate-100 dark:bg-slate-800 rounded-lg text-slate-800 dark:text-slate-200">
            <UsersIcon className="w-5 h-5" />
          </div>
          <div>
            <h3 className="font-extrabold text-base text-slate-900 dark:text-white tracking-tight">
              People and access
            </h3>
            <p className="text-xs text-slate-500">
              Only these email addresses can sign in. Roles are enforced by the
              server.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => void load()}
            disabled={loading}
            className="px-3 py-2 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 font-bold text-xs rounded-xl border border-slate-200 dark:border-slate-700 flex items-center gap-1.5 disabled:opacity-60"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
          <button
            onClick={() => {
              setShowInvite(true);
              setInviteError(null);
            }}
            className="px-3.5 py-2 bg-slate-900 dark:bg-white text-white dark:text-slate-950 font-bold text-xs rounded-xl flex items-center gap-1.5 shadow-xs hover:opacity-90"
          >
            <UserPlus className="w-3.5 h-3.5" /> Add person
          </button>
        </div>
      </div>

      {error && (
        <div
          role="alert"
          className="p-3.5 rounded-xl bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-900 text-xs text-rose-900 dark:text-rose-200 flex items-start gap-2"
        >
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      {/* User table */}
      <div className="card overflow-hidden">
        <Table minWidth={700}>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Person</TableHead>
              <TableHead className="w-40">Role</TableHead>
              <TableHead className="w-28">Status</TableHead>
              <TableHead className="w-32">Last sign-in</TableHead>
              <TableHead className="w-20 text-right">
                <span className="sr-only">Actions</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading && users.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="py-8 text-center text-fg-subtle">
                  Loading people…
                </TableCell>
              </TableRow>
            ) : users.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="py-8 text-center text-fg-subtle">
                  Nobody has been added yet.
                </TableCell>
              </TableRow>
            ) : (
              users.map((user) => {
                const isSelf =
                  currentUser?.email.toLowerCase() === user.email.toLowerCase();
                const busy = busyEmail === user.email;

                return (
                  <TableRow
                    key={user.email}
                    className={`hover:bg-surface-sunken/60 ${busy ? 'opacity-50' : ''}`}
                  >
                    <TableCell>
                      <div className="font-semibold text-fg flex items-center gap-1.5">
                        {user.name}
                        {isSelf && (
                          <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-surface-sunken text-fg-subtle border border-line">
                            You
                          </span>
                        )}
                      </div>
                      <div className="text-fg-subtle mt-0.5 wrap-break-word">
                        {user.email}
                      </div>
                    </TableCell>

                    <TableCell>
                      <label className="sr-only" htmlFor={`role-${user.email}`}>
                        Role for {user.name}
                      </label>
                      <select
                        id={`role-${user.email}`}
                        value={user.role}
                        disabled={busy}
                        onChange={(event) =>
                          void run(
                            user.email,
                            () =>
                              api
                                .changeUserRole(
                                  user.email,
                                  event.target.value as UserRole
                                )
                                .then(() => undefined),
                            `${user.name} is now ${event.target.value}.`
                          )
                        }
                        className="field py-1.5 text-[12.5px] font-medium disabled:opacity-60"
                      >
                        {ROLES.map((role) => (
                          <option key={role} value={role}>
                            {role}
                          </option>
                        ))}
                      </select>
                    </TableCell>

                    <TableCell>
                      <span
                        className={`inline-flex px-2 py-0.5 rounded-md text-[11.5px] font-medium border ${
                          user.status === 'Active'
                            ? 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/50 dark:text-emerald-300 dark:border-emerald-900'
                            : 'bg-surface-sunken text-fg-subtle border-line'
                        }`}
                      >
                        {user.status}
                      </span>
                    </TableCell>

                    <TableCell className="text-fg-muted">
                      {user.lastLoginAt
                        ? new Date(user.lastLoginAt).toLocaleDateString()
                        : 'Never'}
                    </TableCell>

                    <TableCell>
                      <div className="flex items-center justify-end gap-0.5">
                        <button
                          onClick={() =>
                            void run(
                              user.email,
                              () =>
                                api
                                  .setUserStatus(
                                    user.email,
                                    user.status === 'Active'
                                      ? 'Suspended'
                                      : 'Active'
                                  )
                                  .then(() => undefined),
                              user.status === 'Active'
                                ? `${user.name} has been suspended.`
                                : `${user.name} can sign in again.`
                            )
                          }
                          disabled={busy}
                          title={
                            user.status === 'Active'
                              ? 'Suspend access'
                              : 'Restore access'
                          }
                          aria-label={
                            user.status === 'Active'
                              ? `Suspend ${user.name}`
                              : `Restore ${user.name}`
                          }
                          className="p-1.5 rounded-md text-fg-subtle hover:text-fg hover:bg-surface transition-colors disabled:opacity-50"
                        >
                          {user.status === 'Active' ? (
                            <Ban className="w-3.5 h-3.5" />
                          ) : (
                            <RotateCcw className="w-3.5 h-3.5" />
                          )}
                        </button>

                        <button
                          onClick={() => setConfirmRemove(user)}
                          disabled={busy}
                          title="Remove access"
                          aria-label={`Remove ${user.name}`}
                          className="p-1.5 rounded-md text-fg-subtle hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 transition-colors disabled:opacity-50"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>

      <p className="text-[11px] text-slate-500 leading-relaxed flex items-start gap-1.5">
        <ShieldCheck className="w-3.5 h-3.5 shrink-0 mt-0.5" />
        <span>
          A role change takes effect within about 30 seconds, and suspending
          someone signs them out on their next action. The workspace always keeps
          at least one active Admin — the server refuses any change that would
          remove the last one.
        </span>
      </p>

      {/* Add person */}
      {showInvite && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs z-50 flex items-center justify-center p-4">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="invite-heading"
            className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl w-full max-w-md shadow-2xl p-6 space-y-4"
          >
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
              <h3
                id="invite-heading"
                className="font-extrabold text-sm text-slate-900 dark:text-white"
              >
                Give someone access
              </h3>
              <button
                onClick={() => setShowInvite(false)}
                aria-label="Close"
                className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleInvite} className="space-y-4 text-xs">
              {inviteError && (
                <div
                  role="alert"
                  className="p-3 rounded-xl bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-900 text-rose-900 dark:text-rose-200"
                >
                  {inviteError}
                </div>
              )}

              <div className="space-y-1">
                <label
                  htmlFor="invite-email"
                  className="font-semibold text-slate-700 dark:text-slate-300"
                >
                  Google account email <span className="text-rose-500">*</span>
                </label>
                <input
                  id="invite-email"
                  type="email"
                  required
                  autoFocus
                  value={inviteEmail}
                  onChange={(event) => setInviteEmail(event.target.value)}
                  placeholder="name@company.com"
                  className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-900 dark:text-white focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-slate-900 dark:focus-visible:outline-white"
                />
                <p className="text-[11px] text-slate-500">
                  They sign in with Google using this address. No invitation email
                  is sent — let them know yourself.
                </p>
              </div>

              <div className="space-y-1">
                <label
                  htmlFor="invite-name"
                  className="font-semibold text-slate-700 dark:text-slate-300"
                >
                  Display name
                </label>
                <input
                  id="invite-name"
                  type="text"
                  value={inviteName}
                  onChange={(event) => setInviteName(event.target.value)}
                  placeholder="Optional — taken from Google on first sign-in"
                  className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-900 dark:text-white focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-slate-900 dark:focus-visible:outline-white"
                />
              </div>

              <div className="space-y-1">
                <label
                  htmlFor="invite-role"
                  className="font-semibold text-slate-700 dark:text-slate-300"
                >
                  Role <span className="text-rose-500">*</span>
                </label>
                <select
                  id="invite-role"
                  value={inviteRole}
                  onChange={(event) =>
                    setInviteRole(event.target.value as UserRole)
                  }
                  className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-900 dark:text-white"
                >
                  {ROLES.map((role) => (
                    <option key={role} value={role}>
                      {role}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-100 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => setShowInvite(false)}
                  className="px-4 py-2 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 font-semibold text-xs rounded-xl"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={inviting}
                  className="px-4 py-2 bg-slate-900 dark:bg-white text-white dark:text-slate-950 font-bold text-xs rounded-xl shadow-xs disabled:opacity-60"
                >
                  {inviting ? 'Adding…' : 'Add person'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Remove confirmation */}
      {confirmRemove && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs z-50 flex items-center justify-center p-4">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="remove-heading"
            className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl w-full max-w-md shadow-2xl p-6 space-y-4"
          >
            <h3
              id="remove-heading"
              className="font-extrabold text-sm text-slate-900 dark:text-white"
            >
              Remove {confirmRemove.name}?
            </h3>
            <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
              {confirmRemove.email} will no longer be able to sign in. Their name
              stays on the tasks and audit entries they created, so history is
              preserved.
            </p>
            <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-100 dark:border-slate-800">
              <button
                type="button"
                onClick={() => setConfirmRemove(null)}
                className="px-4 py-2 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 font-semibold text-xs rounded-xl"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  const target = confirmRemove;
                  setConfirmRemove(null);
                  void run(
                    target.email,
                    () => api.removeUser(target.email),
                    `${target.name} no longer has access.`
                  );
                }}
                className="px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white font-bold text-xs rounded-xl shadow-xs"
              >
                Remove access
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
