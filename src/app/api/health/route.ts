/**
 * GET /api/health — honest connection diagnostic.
 *
 * Replaces a client-side check that returned "Connection Payload Verified!"
 * from its own catch block, so a wrong URL, a missing share permission or a
 * network failure all displayed as success. This endpoint actually contacts
 * Google and reports precisely which stage failed.
 *
 * Always responds 200 with a `state` field: the diagnostic itself succeeded even
 * when the thing it diagnosed is broken. The client renders `state` and
 * `checks` directly.
 */

import {
  ConfigError,
  getMissingAuthVars,
  getServerConfig,
  isAuthConfigured,
  isConfigured,
} from '@/lib/server/env';
import { getAmbientServiceAccountEmail } from '@/lib/server/googleAuth';
import { SheetRepository } from '@/lib/server/repository';
import { getSessionFromRequest } from '@/lib/server/session';
import { getTimezone } from '@/lib/dates';
import type { ConnectionState } from '@/types/dashboard';
import type { NextRequest } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface HealthCheck {
  name: string;
  ok: boolean;
  detail: string;
}

interface HealthResponse {
  state: ConnectionState;
  checks: HealthCheck[];
  timezone: string;
  spreadsheetId?: string;
  serviceAccount?: string;
  setupRequired?: string[];
  error?: string;
  counts?: { tasks: number; masterItems: number; activityLogs: number };
  revision?: string;
}

function respond(body: HealthResponse): Response {
  return Response.json(body, { status: 200 });
}

export async function GET(request: NextRequest) {
  const timezone = getTimezone();
  const checks: HealthCheck[] = [];

  /* Stage 0 — access control ---------------------------------------------
   *
   * The diagnostic reports the spreadsheet id, the service-account address and
   * row counts, so it must not be public. But it also has to be reachable
   * *before* anyone can sign in, otherwise a fresh deployment could never be
   * diagnosed. The resolution: once authentication is configured, require a
   * signed-in user; while it is not yet configured, allow it so the operator can
   * complete setup.
   */
  if (isAuthConfigured()) {
    const session = getSessionFromRequest(request);
    if (!session.valid) {
      return Response.json(
        {
          state: 'error',
          checks: [
            {
              name: 'Access',
              ok: false,
              detail: 'Sign in to view the connection diagnostic.',
            },
          ],
          timezone,
        },
        { status: 401 }
      );
    }
  } else {
    checks.push({
      name: 'Authentication',
      ok: false,
      detail:
        `Sign-in is not configured, so the dashboard is currently open to anyone who can reach it. ` +
        `Missing: ${getMissingAuthVars().join(', ')}.`,
    });
  }

  /* Stage 1 — are the credentials present and well-formed? --------------- */
  if (!isConfigured()) {
    let missing: string[] = [];
    try {
      getServerConfig();
    } catch (err) {
      if (err instanceof ConfigError) missing = err.missing;
    }

    checks.push({
      name: 'Server credentials',
      ok: false,
      detail:
        `Missing or invalid: ${missing.join(', ')}. ` +
        `Set these in .env.local for local development, or in the Vercel project ` +
        `environment variables when deployed.`,
    });

    return respond({
      state: 'unconfigured',
      checks,
      timezone,
      setupRequired: missing,
    });
  }

  const config = getServerConfig();

  // In metadata mode there is no configured email to report — ask the runtime
  // which service account it actually attached, so the diagnostic can still
  // name it. A failure here is not fatal to the check: it just means the name
  // is unknown until the real auth call below either confirms or explains why.
  const serviceAccount =
    config.authMode === 'key'
      ? config.clientEmail
      : await getAmbientServiceAccountEmail();

  checks.push({
    name: 'Server credentials',
    ok: true,
    detail:
      config.authMode === 'key'
        ? `Service account ${serviceAccount} is configured via GOOGLE_PRIVATE_KEY.`
        : serviceAccount
          ? `Using the service account attached to this environment: ${serviceAccount}.`
          : `No GOOGLE_PRIVATE_KEY is set, so this relies on a service account attached ` +
            `to the compute environment (Cloud Run, GCE, GKE) — none was found. If this ` +
            `is not running on GCP infrastructure, set GOOGLE_PRIVATE_KEY and ` +
            `GOOGLE_SERVICE_ACCOUNT_EMAIL instead.`,
  });

  const repo = new SheetRepository();

  /* Stage 2 — can we authenticate and see the spreadsheet structure? ----- */
  // validateSchema() exercises the whole path: sign a JWT, exchange it for an
  // access token, then call the Sheets API against this spreadsheet id.
  let problems: string[];
  try {
    problems = await repo.validateSchema();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    checks.push({
      name: 'Spreadsheet access',
      ok: false,
      detail: message,
    });
    return respond({
      state: 'error',
      checks,
      timezone,
      spreadsheetId: config.spreadsheetId,
      serviceAccount: serviceAccount ?? undefined,
      error: message,
    });
  }

  checks.push({
    name: 'Spreadsheet access',
    ok: true,
    detail: `Authenticated and reached spreadsheet ${config.spreadsheetId}.`,
  });

  if (problems.length > 0) {
    checks.push({
      name: 'Spreadsheet structure',
      ok: false,
      detail: problems.join(' | '),
    });
    return respond({
      state: 'error',
      checks,
      timezone,
      spreadsheetId: config.spreadsheetId,
      serviceAccount: serviceAccount ?? undefined,
      setupRequired: problems,
    });
  }

  checks.push({
    name: 'Spreadsheet structure',
    ok: true,
    detail: 'Every required tab and column is present.',
  });

  /* Stage 3 — can we actually read data? --------------------------------- */
  try {
    const snapshot = await repo.readSnapshot();
    checks.push({
      name: 'Data read',
      ok: true,
      detail:
        `Read ${snapshot.tasks.length} task(s), ` +
        `${snapshot.masterItems.length} master record(s), ` +
        `${snapshot.activityLogs.length} log row(s).`,
    });

    return respond({
      state: 'connected',
      checks,
      timezone,
      spreadsheetId: config.spreadsheetId,
      serviceAccount: serviceAccount ?? undefined,
      counts: {
        tasks: snapshot.tasks.length,
        masterItems: snapshot.masterItems.length,
        activityLogs: snapshot.activityLogs.length,
      },
      revision: snapshot.revision,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    checks.push({ name: 'Data read', ok: false, detail: message });
    return respond({
      state: 'error',
      checks,
      timezone,
      spreadsheetId: config.spreadsheetId,
      serviceAccount: serviceAccount ?? undefined,
      error: message,
    });
  }
}
