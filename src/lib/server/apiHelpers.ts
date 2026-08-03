/**
 * Shared plumbing for the route handlers: uniform error translation, JSON
 * parsing and the actor identity attached to audit entries.
 */

import type { ApiErrorBody, UserRole } from '@/types/dashboard';
import {
  ConfigError,
  getMissingAuthVars,
  isAuthConfigured,
} from './env';
import { GoogleAuthError } from './googleAuth';
import { SheetsApiError } from './sheetsClient';
import { ConflictError, NotFoundError, SchemaError, SheetRepository } from './repository';
import { getSessionFromRequest } from './session';
import { findActiveUser } from './userService';
import { ValidationError } from '@/lib/validation';

/** Route handlers must run on Node: the JWT signing uses `node:crypto`. */
export const runtime = 'nodejs';

export function jsonError(
  status: number,
  body: ApiErrorBody
): Response {
  return Response.json(body, { status });
}

/**
 * Maps a thrown error to the right status and a message the user can act on.
 *
 * Every branch here is a real, distinguishable operational state. Collapsing
 * them (as the previous client-side diagnostic did, by reporting success on any
 * failure) is what made a broken deployment look healthy.
 */
export function toErrorResponse(error: unknown): Response {
  if (error instanceof ConfigError) {
    return jsonError(503, {
      error: 'Google Sheets integration is not configured on the server.',
      detail: error.message,
      setupRequired: error.missing,
    });
  }

  if (error instanceof SchemaError) {
    return jsonError(503, {
      error: 'The spreadsheet is missing tabs or columns the dashboard needs.',
      detail: error.message,
      setupRequired: error.problems,
    });
  }

  if (error instanceof GoogleAuthError) {
    return jsonError(502, {
      error: 'Could not authenticate with Google.',
      detail: error.message,
    });
  }

  if (error instanceof ConflictError) {
    return jsonError(409, {
      error: error.message,
      current: error.current ?? undefined,
    });
  }

  if (error instanceof NotFoundError) {
    return jsonError(404, { error: error.message });
  }

  if (error instanceof UnauthenticatedError) {
    // 401 tells the client to send the user to the sign-in screen; 403 means
    // "signed in, but not permitted", which is a different remedy.
    return jsonError(401, { error: error.message, detail: error.reason });
  }

  if (error instanceof ForbiddenError) {
    return jsonError(403, { error: error.message });
  }

  if (error instanceof ValidationError) {
    return jsonError(422, {
      error: 'The submitted task is not valid.',
      detail: error.problems.join('; '),
    });
  }

  if (error instanceof SheetsApiError) {
    // 403/404 from Google are setup problems, not transient faults, so they are
    // surfaced as such rather than as a generic gateway error.
    const status = error.status === 403 || error.status === 404 ? 502 : 502;
    return jsonError(status, {
      error: 'Google Sheets rejected the request.',
      detail: error.message,
    });
  }

  if (error instanceof SyntaxError) {
    return jsonError(400, {
      error: 'Request body was not valid JSON.',
      detail: error.message,
    });
  }

  console.error('[api] unhandled error', error);
  return jsonError(500, {
    error: 'Unexpected server error.',
    detail: error instanceof Error ? error.message : String(error),
  });
}

/** Wraps a handler so no route ever leaks a stack trace to the client. */
export async function handle(
  fn: () => Promise<Response>
): Promise<Response> {
  try {
    return await fn();
  } catch (error) {
    return toErrorResponse(error);
  }
}

/* -------------------------------------------------------------------------- */
/* Actor identity                                                             */
/* -------------------------------------------------------------------------- */

/**
 * The verified identity behind a request.
 *
 * Produced only by {@link requireUser}, which reads a signed session cookie and
 * looks the role up in the spreadsheet. There is no way to construct one from
 * client-supplied input — the previous `x-actor-role` header is gone, and with it
 * the ability for any browser to declare itself Admin.
 */
export interface Actor {
  email: string;
  name: string;
  role: UserRole;
}

export class UnauthenticatedError extends Error {
  /** Distinguishes "never signed in" from "session no longer valid". */
  readonly reason: string;

  constructor(message: string, reason: string) {
    super(message);
    this.name = 'UnauthenticatedError';
    this.reason = reason;
  }
}

export class ForbiddenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ForbiddenError';
  }
}

/**
 * Authenticates a request and resolves the caller's current role.
 *
 * Two independent steps, both required:
 *  1. Verify the HMAC signature and expiry of the session cookie. This proves
 *     the identity was issued by this server.
 *  2. Look the email up in the `Users` tab. This is what grants the role, and it
 *     is why suspending or removing someone takes effect without waiting for
 *     their cookie to lapse.
 */
export async function requireUser(request: Request): Promise<Actor> {
  if (!isAuthConfigured()) {
    throw new ConfigError(getMissingAuthVars());
  }

  const session = getSessionFromRequest(request);
  if (!session.valid) {
    const message =
      session.reason === 'expired'
        ? 'Your session has expired. Please sign in again.'
        : session.reason === 'missing'
          ? 'You must sign in to do that.'
          : 'Your session is not valid. Please sign in again.';
    throw new UnauthenticatedError(message, session.reason);
  }

  const repo = new SheetRepository();
  const user = await findActiveUser(repo, session.identity.email);

  if (!user) {
    // The cookie is genuine but the account is gone or suspended.
    throw new UnauthenticatedError(
      'Your access to this dashboard has been removed or suspended.',
      'revoked'
    );
  }

  return { email: user.email, name: user.name, role: user.role };
}

/** Roles permitted to create and edit tasks. */
const WRITE_ROLES: UserRole[] = ['Admin', 'Marketing Team'];
/** Roles permitted to approve or reject. */
const APPROVE_ROLES: UserRole[] = ['Admin', 'Management'];
/** Roles permitted to manage master data. */
const MASTER_ROLES: UserRole[] = ['Admin', 'Marketing Team'];

export type Permission =
  | 'write-task'
  | 'approve'
  | 'manage-master'
  | 'delete-task'
  | 'manage-users';

/**
 * Enforces role permissions.
 *
 * This is now a real security boundary: the role it checks came from the
 * spreadsheet, not from the request. Every mutating route calls it.
 */
export function assertCan(actor: Actor, action: Permission): void {
  const allowed =
    action === 'approve'
      ? APPROVE_ROLES
      : action === 'manage-master'
        ? MASTER_ROLES
        : action === 'delete-task' || action === 'manage-users'
          ? (['Admin'] as UserRole[])
          : WRITE_ROLES;

  if (!allowed.includes(actor.role)) {
    throw new ForbiddenError(
      `The ${actor.role} role cannot perform this action. Allowed: ${allowed.join(', ')}.`
    );
  }
}

/** Reads and parses a JSON body, rejecting anything that is not an object. */
export async function readJsonObject(
  request: Request
): Promise<Record<string, unknown>> {
  const body = await request.json();
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new SyntaxError('Expected a JSON object.');
  }
  return body as Record<string, unknown>;
}
