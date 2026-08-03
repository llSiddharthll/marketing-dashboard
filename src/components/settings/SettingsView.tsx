'use client';

/**
 * Settings — Google Sheets connection.
 *
 * Deliberately different from the previous version, which:
 *  - asked the user to paste an Apps Script URL into the browser and stored it
 *    in localStorage (so every teammate had their own connection),
 *  - offered a "Use Pre-configured Demo Endpoint" button that pointed at a URL
 *    that never existed,
 *  - and ran a diagnostic that reported success from its own catch block.
 *
 * Credentials now live on the server only. This screen reports the real state,
 * shows exactly which stage of the connection failed, and offers the one action
 * that can fix a structural problem: initialise the spreadsheet.
 */

import React, { useState } from 'react';
import { useData } from '@/context/DataContext';
import {
  Settings,
  Database,
  RefreshCw,
  ShieldCheck,
  AlertCircle,
  CheckCircle2,
  ExternalLink,
  Download,
  Radio,
  FileSpreadsheet,
  Table,
  Wrench,
  XCircle,
  Clock,
} from 'lucide-react';
import { SHEET_DEFINITIONS } from '@/lib/sheets/schema';
import { UserManagement } from './UserManagement';

export const SettingsView: React.FC = () => {
  const {
    syncStatus,
    healthChecks,
    checkConnection,
    runSetup,
    refresh,
    retryPendingWrites,
    discardPendingWrites,
    currentUserRole,
    tasks,
    masterItems,
    activityLogs,
  } = useData();

  const canManageSettings = currentUserRole === 'Admin';
  const [showSchema, setShowSchema] = useState(false);
  const [checking, setChecking] = useState(false);
  const [confirmSeed, setConfirmSeed] = useState(false);

  const handleCheck = async () => {
    setChecking(true);
    await checkConnection();
    setChecking(false);
  };

  const exportJsonBackup = () => {
    const payload = {
      exportedAt: new Date().toISOString(),
      spreadsheetId: syncStatus.spreadsheetId,
      tasks,
      masterItems,
      activityLogs,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `marketing_dashboard_backup_${new Date()
      .toISOString()
      .slice(0, 10)}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    // Release the blob; the previous implementation leaked every export.
    URL.revokeObjectURL(url);
  };

  const stateStyles: Record<
    typeof syncStatus.state,
    { label: string; className: string; icon: React.ElementType }
  > = {
    connected: {
      label: 'Connected',
      className:
        'bg-emerald-50 text-emerald-800 border-emerald-300 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-900',
      icon: Radio,
    },
    checking: {
      label: 'Checking',
      className:
        'bg-slate-100 text-slate-600 border-slate-200 dark:bg-slate-800 dark:text-slate-400 dark:border-slate-700',
      icon: Clock,
    },
    unconfigured: {
      label: 'Not configured',
      className:
        'bg-amber-50 text-amber-800 border-amber-300 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-900',
      icon: AlertCircle,
    },
    error: {
      label: 'Connection problem',
      className:
        'bg-rose-50 text-rose-800 border-rose-300 dark:bg-rose-950/40 dark:text-rose-300 dark:border-rose-900',
      icon: XCircle,
    },
  };

  const currentState = stateStyles[syncStatus.state];
  const StateIcon = currentState.icon;

  const spreadsheetUrl = syncStatus.spreadsheetId
    ? `https://docs.google.com/spreadsheets/d/${syncStatus.spreadsheetId}/edit`
    : null;

  return (
    <div className="space-y-6 pb-8">
      {/* Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white dark:bg-slate-900 p-6 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs">
        <div className="flex items-center gap-3">
          <div className="p-2.5 bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-200 rounded-xl border border-slate-200 dark:border-slate-700">
            <Settings className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-xl font-extrabold text-slate-900 dark:text-white tracking-tight">
              Google Sheets Connection
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              The spreadsheet is the master database. The dashboard reads and
              writes it through the server.
            </p>
          </div>
        </div>

        {spreadsheetUrl && (
          <a
            href={spreadsheetUrl}
            target="_blank"
            rel="noreferrer"
            className="px-3.5 py-2 bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-700 text-xs font-bold rounded-xl border border-slate-200 dark:border-slate-700 flex items-center gap-1.5 transition-colors shrink-0"
          >
            <ExternalLink className="w-3.5 h-3.5" /> Open the spreadsheet
          </a>
        )}
      </div>

      {/* Live status */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 shadow-xs space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-slate-100 dark:border-slate-800">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-slate-100 dark:bg-slate-800 rounded-lg text-slate-800 dark:text-slate-200">
              <Database className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-extrabold text-base text-slate-900 dark:text-white tracking-tight">
                Connection status
              </h3>
              <p className="text-xs text-slate-500">
                {syncStatus.lastSyncedAt
                  ? `Last read from the sheet at ${new Date(
                      syncStatus.lastSyncedAt
                    ).toLocaleString()}`
                  : 'No successful read yet in this session'}
              </p>
            </div>
          </div>

          <span
            className={`px-3 py-1 rounded-md text-xs font-bold border flex items-center gap-1.5 ${currentState.className}`}
          >
            <StateIcon
              className={`w-3.5 h-3.5 ${
                syncStatus.state === 'connected' ? 'animate-pulse' : ''
              }`}
            />
            {currentState.label}
          </span>
        </div>

        {/* Server-side config notice: credentials are not editable from here */}
        <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 text-xs text-slate-700 dark:text-slate-300 flex items-start gap-2">
          <ShieldCheck className="w-4 h-4 text-slate-500 shrink-0 mt-0.5" />
          <span>
            Credentials are held on the server, not in your browser, so everyone
            on the team sees the same data. To change which spreadsheet is used,
            update the environment variables{' '}
            <code className="font-mono text-[11px] px-1 py-0.5 rounded bg-slate-200 dark:bg-slate-700">
              GOOGLE_SHEETS_SPREADSHEET_ID
            </code>
            ,{' '}
            <code className="font-mono text-[11px] px-1 py-0.5 rounded bg-slate-200 dark:bg-slate-700">
              GOOGLE_SERVICE_ACCOUNT_EMAIL
            </code>{' '}
            and{' '}
            <code className="font-mono text-[11px] px-1 py-0.5 rounded bg-slate-200 dark:bg-slate-700">
              GOOGLE_PRIVATE_KEY
            </code>
            , then redeploy. Setup steps are in the project README.
          </span>
        </div>

        {/* Diagnostic results, per stage */}
        {healthChecks.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs font-bold text-slate-700 dark:text-slate-300">
              Diagnostic
            </p>
            {healthChecks.map((check) => (
              <div
                key={check.name}
                className={`p-3 rounded-xl border text-xs flex items-start gap-2 ${
                  check.ok
                    ? 'bg-emerald-50/60 border-emerald-200 dark:bg-emerald-950/20 dark:border-emerald-900/60'
                    : 'bg-rose-50/60 border-rose-200 dark:bg-rose-950/20 dark:border-rose-900/60'
                }`}
              >
                {check.ok ? (
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
                ) : (
                  <XCircle className="w-4 h-4 text-rose-600 dark:text-rose-400 shrink-0 mt-0.5" />
                )}
                <div className="space-y-0.5 min-w-0">
                  <p className="font-bold text-slate-900 dark:text-white">
                    {check.name}
                  </p>
                  <p className="text-slate-600 dark:text-slate-400 wrap-break-word">
                    {check.detail}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* What the operator must fix */}
        {syncStatus.setupRequired && syncStatus.setupRequired.length > 0 && (
          <div className="p-4 rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-300 dark:border-amber-900 text-xs space-y-2">
            <p className="font-bold text-amber-900 dark:text-amber-200 flex items-center gap-1.5">
              <Wrench className="w-4 h-4" /> Action needed
            </p>
            <ul className="list-disc list-inside space-y-1 text-amber-900 dark:text-amber-200">
              {syncStatus.setupRequired.map((item) => (
                <li key={item} className="wrap-break-word">
                  {item}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Actions */}
        <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
          <button
            type="button"
            onClick={() => void handleCheck()}
            disabled={checking}
            className="px-4 py-2.5 bg-slate-900 dark:bg-white text-white dark:text-slate-950 font-bold text-xs rounded-xl flex items-center gap-2 shadow-xs transition-all hover:opacity-90 disabled:opacity-60"
          >
            <RefreshCw className={`w-4 h-4 ${checking ? 'animate-spin' : ''}`} />
            {checking ? 'Running diagnostic…' : 'Run diagnostic'}
          </button>

          <button
            type="button"
            onClick={() => void refresh()}
            disabled={syncStatus.busy}
            className="px-4 py-2.5 bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-700 font-bold text-xs rounded-xl border border-slate-200 dark:border-slate-700 flex items-center gap-2 transition-colors disabled:opacity-60"
          >
            <Download className="w-4 h-4" /> Reload from sheet
          </button>

          {canManageSettings && (
            <button
              type="button"
              onClick={() => void runSetup(false)}
              disabled={syncStatus.busy}
              className="px-4 py-2.5 bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-700 font-bold text-xs rounded-xl border border-slate-200 dark:border-slate-700 flex items-center gap-2 transition-colors disabled:opacity-60"
            >
              <Wrench className="w-4 h-4" /> Initialise spreadsheet
            </button>
          )}
        </div>

        {canManageSettings && (
          <p className="text-[11px] text-slate-500 leading-relaxed">
            <strong>Initialise spreadsheet</strong> creates any missing tabs and
            repairs header rows. It only ever writes row 1 and never touches
            existing data, so it is safe to run on a live sheet.
          </p>
        )}
      </div>

      {/* Pending writes */}
      {syncStatus.pendingWrites > 0 && (
        <div className="bg-white dark:bg-slate-900 border border-amber-300 dark:border-amber-900 rounded-2xl p-6 shadow-xs space-y-3">
          <h3 className="font-extrabold text-base text-slate-900 dark:text-white tracking-tight">
            {syncStatus.pendingWrites} change(s) waiting to save
          </h3>
          <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
            These are queued locally and retried automatically with backoff. They
            survive a page reload. If the connection is fixed they will save on
            their own.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={retryPendingWrites}
              className="px-4 py-2 bg-slate-900 dark:bg-white text-white dark:text-slate-950 font-bold text-xs rounded-xl"
            >
              Retry now
            </button>
            <button
              onClick={discardPendingWrites}
              className="px-4 py-2 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 font-bold text-xs rounded-xl border border-slate-200 dark:border-slate-700"
            >
              Discard and reload from sheet
            </button>
          </div>
        </div>
      )}

      {/* People and access — Admin only */}
      {canManageSettings && <UserManagement />}

      {/* Backup + schema */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 shadow-xs space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <FileSpreadsheet className="w-5 h-5 text-slate-700 dark:text-slate-300" />
            <h3 className="font-extrabold text-base text-slate-900 dark:text-white tracking-tight">
              Backup and schema
            </h3>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => setShowSchema(!showSchema)}
              className="px-3.5 py-2 bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-200 font-bold text-xs rounded-xl border border-slate-200 dark:border-slate-700 flex items-center gap-1.5 transition-colors"
            >
              <Table className="w-3.5 h-3.5" />
              {showSchema ? 'Hide schema' : 'Show schema'}
            </button>
            <button
              onClick={exportJsonBackup}
              className="px-3.5 py-2 bg-slate-900 dark:bg-white text-white dark:text-slate-950 font-bold text-xs rounded-xl flex items-center gap-1.5 transition-all shadow-xs"
            >
              <Download className="w-3.5 h-3.5" /> Export JSON backup
            </button>
          </div>
        </div>

        {showSchema && (
          <div className="space-y-3">
            <p className="text-xs text-slate-500">
              These are the tabs and columns the dashboard reads and writes. You
              may add your own extra columns to the right of the last one without
              affecting the app.
            </p>
            {SHEET_DEFINITIONS.map((def) => (
              <div
                key={def.name}
                className="p-3 bg-slate-50 dark:bg-slate-800/60 rounded-xl border border-slate-200 dark:border-slate-700 space-y-2"
              >
                <div className="flex items-center justify-between text-xs">
                  <span className="font-bold text-slate-900 dark:text-white">
                    {def.name}
                  </span>
                  <span className="text-[11px] font-mono text-slate-500">
                    {def.columns.length} column
                    {def.columns.length === 1 ? '' : 's'}
                    {def.readOnly ? ' · not written by the app' : ''}
                  </span>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {def.columns.map((col) => (
                    <span
                      key={col}
                      className="px-2 py-0.5 rounded-md text-[10px] font-mono font-bold bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300"
                    >
                      {col}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Seed demo data — only offered when the sheet is genuinely empty */}
      {canManageSettings &&
        syncStatus.state === 'connected' &&
        tasks.length === 0 &&
        masterItems.length === 0 && (
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 shadow-xs space-y-3">
            <h3 className="font-extrabold text-base text-slate-900 dark:text-white tracking-tight">
              The spreadsheet is empty
            </h3>
            <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
              You can load a small set of sample projects, team members and tasks
              to see how the dashboard behaves. This writes real rows to the
              spreadsheet and only runs while the sheet is empty.
            </p>

            {!confirmSeed ? (
              <button
                onClick={() => setConfirmSeed(true)}
                className="px-4 py-2 bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-200 font-bold text-xs rounded-xl border border-slate-200 dark:border-slate-700"
              >
                Load sample data
              </button>
            ) : (
              <div className="flex flex-wrap items-center gap-2">
                <button
                  onClick={() => {
                    setConfirmSeed(false);
                    void runSetup(true);
                  }}
                  className="px-4 py-2 bg-slate-900 dark:bg-white text-white dark:text-slate-950 font-bold text-xs rounded-xl"
                >
                  Yes, write sample rows
                </button>
                <button
                  onClick={() => setConfirmSeed(false)}
                  className="px-4 py-2 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 font-bold text-xs rounded-xl border border-slate-200 dark:border-slate-700"
                >
                  Cancel
                </button>
              </div>
            )}
          </div>
        )}

      {/* Current dataset summary */}
      <div className="p-6 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-xs text-xs">
        <span className="font-extrabold text-slate-900 dark:text-white block text-sm mb-1">
          Loaded dataset
        </span>
        <span className="text-slate-500 font-medium">
          {tasks.length} task(s), {masterItems.length} master record(s) and{' '}
          {activityLogs.length} audit entr
          {activityLogs.length === 1 ? 'y' : 'ies'} currently loaded from the
          spreadsheet.
        </span>
      </div>
    </div>
  );
};
