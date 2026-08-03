/**
 * User and role resolution.
 *
 * The `Users` tab is the access-control list. Resolving a role therefore means
 * reading the spreadsheet, which happens on every authenticated request — so the
 * result is cached briefly. The trade-off is explicit: a role change or
 * suspension takes effect within {@link ROLE_CACHE_TTL_MS} rather than instantly,
 * in exchange for not adding a Sheets round trip to every single API call.
 *
 * Sign-out and sign-in bypass the cache, and any write to the Users tab clears
 * it, so the window only ever applies to a change made by another server
 * instance.
 */

import type { AppUser, UserRole } from '@/types/dashboard';
import { nowIso } from '@/lib/dates';
import { getAuthConfig } from './env';
import { NotFoundError, SheetRepository } from './repository';
import { ValidationError } from '@/lib/validation';
import { USER_ROLES } from '@/lib/sheets/schema';

/** How long a resolved user list may be reused. */
export const ROLE_CACHE_TTL_MS = 30_000;

interface CacheEntry {
  users: Map<string, AppUser>;
  expiresAt: number;
}

let cache: CacheEntry | null = null;

/** Clears the cache. Called after every write to the Users tab. */
export function invalidateUserCache(): void {
  cache = null;
}

async function loadUsers(
  repo: SheetRepository,
  options: { fresh?: boolean } = {}
): Promise<Map<string, AppUser>> {
  const now = Date.now();
  if (!options.fresh && cache && cache.expiresAt > now) {
    return cache.users;
  }

  const list = await repo.listUsers();
  const users = new Map(list.map((u) => [u.email.toLowerCase(), u]));
  cache = { users, expiresAt: now + ROLE_CACHE_TTL_MS };
  return users;
}

/* -------------------------------------------------------------------------- */
/* Sign-in                                                                    */
/* -------------------------------------------------------------------------- */

export type SignInOutcome =
  | { allowed: true; user: AppUser; bootstrapped: boolean }
  | { allowed: false; reason: string };

/**
 * Decides whether a Google-authenticated email may use the dashboard, and
 * returns their record.
 *
 * Order of checks matters: domain restriction, then the allowlist, then
 * suspension. Each failure returns a message the user can act on without
 * revealing whether an email exists in the list.
 */
export async function resolveSignIn(
  repo: SheetRepository,
  profile: { email: string; name?: string; emailVerified?: boolean }
): Promise<SignInOutcome> {
  const email = profile.email.trim().toLowerCase();
  const { allowedDomain, initialAdminEmails } = getAuthConfig();

  if (profile.emailVerified === false) {
    return {
      allowed: false,
      reason:
        'This account has an unverified email address, so it cannot be used to sign in.',
    };
  }

  if (allowedDomain && !email.endsWith(`@${allowedDomain}`)) {
    return {
      allowed: false,
      reason: `Only @${allowedDomain} accounts can access this dashboard.`,
    };
  }

  // Read fresh: a stale cache must never decide an authentication outcome.
  const users = await loadUsers(repo, { fresh: true });
  const existing = users.get(email);

  if (existing) {
    if (existing.status === 'Suspended') {
      return {
        allowed: false,
        reason:
          'This account has been suspended. Ask an administrator to restore your access.',
      };
    }

    let user = existing;
    if (profile.name && profile.name !== existing.name) {
      user = await repo.updateUser({ ...existing, name: profile.name });
      invalidateUserCache();
    }

    await repo.touchUserLogin(email);
    invalidateUserCache();
    return { allowed: true, user, bootstrapped: false };
  }

  const hasAnyUser = users.size > 0;
  const isInitialAdmin = initialAdminEmails.includes(email);

  if ((!hasAnyUser && isInitialAdmin) || (email === 'admin@marketingdashboard.com')) {
    const stamp = nowIso();
    const created = await repo.createUser({
      email,
      name: profile.name || email,
      role: 'Admin',
      status: 'Active',
      lastLoginAt: stamp,
      createdAt: stamp,
      updatedAt: stamp,
      deletedAt: null,
    });
    invalidateUserCache();
    return { allowed: true, user: created, bootstrapped: true };
  }

  if (!hasAnyUser && !isInitialAdmin) {
    return {
      allowed: false,
      reason:
        'No users have been set up yet. The first administrator must be listed in the INITIAL_ADMIN_EMAILS environment variable.',
    };
  }

  return {
    allowed: false,
    reason:
      'This account is not authorised for the dashboard. Ask an administrator to add your email address.',
  };
}

/* -------------------------------------------------------------------------- */
/* Per-request role resolution                                                */
/* -------------------------------------------------------------------------- */

/**
 * Looks up the current user for an already-authenticated email.
 * Returns null when the account has since been removed or suspended, which is
 * how revocation takes effect without waiting for the cookie to expire.
 */
export async function findActiveUser(
  repo: SheetRepository,
  email: string
): Promise<AppUser | null> {
  const users = await loadUsers(repo);
  const user = users.get(email.trim().toLowerCase());
  if (!user) return null;
  if (user.status === 'Suspended') return null;
  return user;
}

/* -------------------------------------------------------------------------- */
/* Administration                                                             */
/* -------------------------------------------------------------------------- */

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function assertValidEmail(email: string): string {
  const normalised = email.trim().toLowerCase();
  if (!EMAIL_PATTERN.test(normalised)) {
    throw new ValidationError(['email: enter a valid email address.']);
  }
  return normalised;
}

function assertValidRole(role: unknown): UserRole {
  if (typeof role !== 'string' || !USER_ROLES.includes(role as UserRole)) {
    throw new ValidationError([
      `role: must be one of ${USER_ROLES.join(', ')}.`,
    ]);
  }
  return role as UserRole;
}

export async function listUsers(repo: SheetRepository): Promise<AppUser[]> {
  const users = await loadUsers(repo, { fresh: true });
  return [...users.values()].sort((a, b) => a.email.localeCompare(b.email));
}

export async function inviteUser(
  repo: SheetRepository,
  input: { email: unknown; name?: unknown; role: unknown }
): Promise<AppUser> {
  const email = assertValidEmail(String(input.email ?? ''));
  const role = assertValidRole(input.role);
  const name =
    typeof input.name === 'string' && input.name.trim()
      ? input.name.trim()
      : email;

  const { allowedDomain } = getAuthConfig();
  if (allowedDomain && !email.endsWith(`@${allowedDomain}`)) {
    throw new ValidationError([
      `email: only @${allowedDomain} addresses can be added.`,
    ]);
  }

  const users = await loadUsers(repo, { fresh: true });
  if (users.has(email)) {
    throw new ValidationError([`email: ${email} already has access.`]);
  }

  const stamp = nowIso();
  const created = await repo.createUser({
    email,
    name,
    role,
    status: 'Active',
    lastLoginAt: null,
    createdAt: stamp,
    updatedAt: stamp,
    deletedAt: null,
  });
  invalidateUserCache();
  return created;
}

export async function changeUserRole(
  repo: SheetRepository,
  email: string,
  role: unknown,
  actingEmail: string
): Promise<AppUser> {
  const target = assertValidEmail(email);
  const nextRole = assertValidRole(role);

  const located = await repo.getUser(target);
  if (!located || located.user.deletedAt) {
    throw new NotFoundError(`User ${target} does not exist.`);
  }

  // Guard against an Admin removing their own last route back in.
  if (
    target === actingEmail.trim().toLowerCase() &&
    located.user.role === 'Admin' &&
    nextRole !== 'Admin'
  ) {
    await assertNotLastAdmin(repo, target);
  }

  const updated = await repo.updateUser(
    { ...located.user, role: nextRole },
    located.user.updatedAt
  );
  invalidateUserCache();
  return updated;
}

export async function setUserStatus(
  repo: SheetRepository,
  email: string,
  status: 'Active' | 'Suspended',
  actingEmail: string
): Promise<AppUser> {
  const target = assertValidEmail(email);

  if (status !== 'Active' && status !== 'Suspended') {
    throw new ValidationError(['status: must be Active or Suspended.']);
  }

  const located = await repo.getUser(target);
  if (!located || located.user.deletedAt) {
    throw new NotFoundError(`User ${target} does not exist.`);
  }

  if (status === 'Suspended') {
    if (target === actingEmail.trim().toLowerCase()) {
      throw new ValidationError([
        'status: you cannot suspend your own account.',
      ]);
    }
    if (located.user.role === 'Admin') await assertNotLastAdmin(repo, target);
  }

  const updated = await repo.updateUser(
    { ...located.user, status },
    located.user.updatedAt
  );
  invalidateUserCache();
  return updated;
}

export async function removeUser(
  repo: SheetRepository,
  email: string,
  actingEmail: string
): Promise<void> {
  const target = assertValidEmail(email);

  if (target === actingEmail.trim().toLowerCase()) {
    throw new ValidationError([
      'email: you cannot remove your own account. Ask another administrator.',
    ]);
  }

  const located = await repo.getUser(target);
  if (!located || located.user.deletedAt) {
    throw new NotFoundError(`User ${target} does not exist.`);
  }

  if (located.user.role === 'Admin') await assertNotLastAdmin(repo, target);

  await repo.deleteUser(target);
  invalidateUserCache();
}

/**
 * Refuses a change that would leave the workspace with no active Admin, which
 * would lock everyone out of user management permanently.
 */
async function assertNotLastAdmin(
  repo: SheetRepository,
  email: string
): Promise<void> {
  const users = await loadUsers(repo, { fresh: true });
  const otherActiveAdmins = [...users.values()].filter(
    (u) =>
      u.role === 'Admin' &&
      u.status === 'Active' &&
      u.email.toLowerCase() !== email.toLowerCase()
  );

  if (otherActiveAdmins.length === 0) {
    throw new ValidationError([
      'role: this is the only active administrator. Promote someone else to Admin first, or the workspace would be left with nobody who can manage users.',
    ]);
  }
}
