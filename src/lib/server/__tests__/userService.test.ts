/**
 * Access-control tests.
 *
 * The `Users` tab decides who gets in and what they may do, so these cover the
 * ways that decision could go wrong: an unlisted address slipping through, a
 * suspended account still working, the bootstrap allowlist staying open as a back
 * door, and an Admin locking the whole workspace out of user management.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SheetRepository } from '../repository';
import { createHealthyTransport, type FakeSheetsTransport } from './fakeTransport';
import {
  changeUserRole,
  findActiveUser,
  inviteUser,
  invalidateUserCache,
  listUsers,
  removeUser,
  resolveSignIn,
  setUserStatus,
} from '../userService';
import { assertCan, ForbiddenError, type Actor } from '../apiHelpers';
import { resetServerConfigCache } from '../env';
import { ValidationError } from '@/lib/validation';
import { nowIso } from '@/lib/dates';
import type { AppUser, UserRole } from '@/types/dashboard';

function configure(overrides: Record<string, string | undefined> = {}): void {
  process.env.SESSION_SECRET = 'a-test-secret-that-is-long-enough-to-pass';
  process.env.APP_URL = 'https://dashboard.example.com';
  process.env.INITIAL_ADMIN_EMAILS = 'boss@example.com';
  delete process.env.ALLOWED_EMAIL_DOMAIN;

  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  resetServerConfigCache();
}

function makeUser(overrides: Partial<AppUser> = {}): AppUser {
  const stamp = nowIso();
  return {
    email: 'aarav@example.com',
    name: 'Aarav Sharma',
    role: 'Marketing Team',
    status: 'Active',
    lastLoginAt: null,
    createdAt: stamp,
    updatedAt: stamp,
    deletedAt: null,
    ...overrides,
  };
}

const VERIFIED = { emailVerified: true };

describe('userService', () => {
  let transport: FakeSheetsTransport;
  let repo: SheetRepository;

  beforeEach(() => {
    configure();
    invalidateUserCache();
    transport = createHealthyTransport();
    repo = new SheetRepository(transport);
  });

  afterEach(() => {
    invalidateUserCache();
    resetServerConfigCache();
  });

  describe('resolveSignIn — first-run bootstrap', () => {
    it('lets a listed initial admin claim the first account', async () => {
      const outcome = await resolveSignIn(repo, {
        email: 'boss@example.com',
        name: 'The Boss',
        ...VERIFIED,
      });

      expect(outcome.allowed).toBe(true);
      if (!outcome.allowed) return;
      expect(outcome.user.role).toBe('Admin');
      expect(outcome.bootstrapped).toBe(true);

      // Persisted, so the next sign-in is an ordinary lookup.
      expect(await listUsers(repo)).toHaveLength(1);
    });

    it('refuses an unlisted address when the sheet is empty', async () => {
      const outcome = await resolveSignIn(repo, {
        email: 'random@example.com',
        name: 'Random',
        ...VERIFIED,
      });

      expect(outcome.allowed).toBe(false);
      if (outcome.allowed) return;
      expect(outcome.reason).toContain('INITIAL_ADMIN_EMAILS');
      expect(await listUsers(repo)).toHaveLength(0);
    });

    it('closes the bootstrap back door once a user exists', async () => {
      // Someone is already set up.
      await repo.createUser(makeUser({ email: 'existing@example.com' }));
      invalidateUserCache();

      // The env var still lists boss@, but bootstrap must no longer apply —
      // otherwise a stale variable would be a permanent way in.
      const outcome = await resolveSignIn(repo, {
        email: 'boss@example.com',
        name: 'The Boss',
        ...VERIFIED,
      });

      expect(outcome.allowed).toBe(false);
      if (outcome.allowed) return;
      expect(outcome.reason).toContain('not authorised');
    });
  });

  describe('resolveSignIn — existing users', () => {
    it('admits an active listed user with their stored role', async () => {
      await repo.createUser(makeUser({ role: 'Management' }));
      invalidateUserCache();

      const outcome = await resolveSignIn(repo, {
        email: 'aarav@example.com',
        name: 'Aarav Sharma',
        ...VERIFIED,
      });

      expect(outcome.allowed).toBe(true);
      if (!outcome.allowed) return;
      expect(outcome.user.role).toBe('Management');
      expect(outcome.bootstrapped).toBe(false);
    });

    it('refuses a suspended user', async () => {
      await repo.createUser(makeUser({ status: 'Suspended' }));
      invalidateUserCache();

      const outcome = await resolveSignIn(repo, {
        email: 'aarav@example.com',
        name: 'Aarav',
        ...VERIFIED,
      });

      expect(outcome.allowed).toBe(false);
      if (outcome.allowed) return;
      expect(outcome.reason).toContain('suspended');
    });

    it('refuses an unverified Google email', async () => {
      await repo.createUser(makeUser());
      invalidateUserCache();

      const outcome = await resolveSignIn(repo, {
        email: 'aarav@example.com',
        name: 'Aarav',
        emailVerified: false,
      });

      expect(outcome.allowed).toBe(false);
      if (outcome.allowed) return;
      expect(outcome.reason).toContain('unverified');
    });

    it('matches the address case-insensitively', async () => {
      await repo.createUser(makeUser({ email: 'aarav@example.com' }));
      invalidateUserCache();

      const outcome = await resolveSignIn(repo, {
        email: 'AARAV@Example.com',
        name: 'Aarav',
        ...VERIFIED,
      });
      expect(outcome.allowed).toBe(true);
    });

    it('records the sign-in time', async () => {
      await repo.createUser(makeUser());
      invalidateUserCache();

      await resolveSignIn(repo, {
        email: 'aarav@example.com',
        name: 'Aarav',
        ...VERIFIED,
      });

      const [stored] = await listUsers(repo);
      expect(stored.lastLoginAt).toBeTruthy();
    });

    it('keeps the display name in step with Google', async () => {
      await repo.createUser(makeUser({ name: 'Old Name' }));
      invalidateUserCache();

      await resolveSignIn(repo, {
        email: 'aarav@example.com',
        name: 'New Name',
        ...VERIFIED,
      });

      const [stored] = await listUsers(repo);
      expect(stored.name).toBe('New Name');
    });
  });

  describe('resolveSignIn — domain restriction', () => {
    it('refuses an address outside the allowed domain', async () => {
      configure({ ALLOWED_EMAIL_DOMAIN: 'company.com' });
      await repo.createUser(
        makeUser({ email: 'outsider@gmail.com', role: 'Admin' })
      );
      invalidateUserCache();

      const outcome = await resolveSignIn(repo, {
        email: 'outsider@gmail.com',
        name: 'Outsider',
        ...VERIFIED,
      });

      // Even though they are on the list, the domain rule wins.
      expect(outcome.allowed).toBe(false);
      if (outcome.allowed) return;
      expect(outcome.reason).toContain('company.com');
    });

    it('admits an address inside the allowed domain', async () => {
      configure({ ALLOWED_EMAIL_DOMAIN: 'company.com' });
      await repo.createUser(makeUser({ email: 'sid@company.com' }));
      invalidateUserCache();

      const outcome = await resolveSignIn(repo, {
        email: 'sid@company.com',
        name: 'Sid',
        ...VERIFIED,
      });
      expect(outcome.allowed).toBe(true);
    });

    it('is not fooled by a lookalike domain suffix', async () => {
      configure({ ALLOWED_EMAIL_DOMAIN: 'company.com' });
      const outcome = await resolveSignIn(repo, {
        email: 'attacker@notcompany.com',
        name: 'Attacker',
        ...VERIFIED,
      });
      expect(outcome.allowed).toBe(false);
    });
  });

  describe('findActiveUser', () => {
    it('returns the current role for an active user', async () => {
      await repo.createUser(makeUser({ role: 'Admin' }));
      invalidateUserCache();

      const user = await findActiveUser(repo, 'aarav@example.com');
      expect(user?.role).toBe('Admin');
    });

    it('returns null for a suspended user, revoking access', async () => {
      await repo.createUser(makeUser({ status: 'Suspended' }));
      invalidateUserCache();

      expect(await findActiveUser(repo, 'aarav@example.com')).toBeNull();
    });

    it('returns null for an unknown or removed user', async () => {
      expect(await findActiveUser(repo, 'nobody@example.com')).toBeNull();

      await repo.createUser(makeUser());
      invalidateUserCache();
      await repo.deleteUser('aarav@example.com');
      invalidateUserCache();

      expect(await findActiveUser(repo, 'aarav@example.com')).toBeNull();
    });

    it('serves repeat lookups from cache to avoid a read per request', async () => {
      await repo.createUser(makeUser());
      invalidateUserCache();

      await findActiveUser(repo, 'aarav@example.com');
      transport.resetCallCounts();
      await findActiveUser(repo, 'aarav@example.com');
      await findActiveUser(repo, 'aarav@example.com');

      expect(transport.calls.batchGet).toBe(0);
    });

    it('reflects a change once the cache is invalidated', async () => {
      await repo.createUser(makeUser({ role: 'Viewer' }));
      invalidateUserCache();
      expect((await findActiveUser(repo, 'aarav@example.com'))?.role).toBe(
        'Viewer'
      );

      await changeUserRole(
        repo,
        'aarav@example.com',
        'Admin',
        'boss@example.com'
      );
      expect((await findActiveUser(repo, 'aarav@example.com'))?.role).toBe(
        'Admin'
      );
    });
  });

  describe('inviteUser', () => {
    it('adds an active user with the given role', async () => {
      const user = await inviteUser(repo, {
        email: 'New.Person@Example.com',
        name: 'New Person',
        role: 'Management',
      });

      expect(user.email).toBe('new.person@example.com');
      expect(user.role).toBe('Management');
      expect(user.status).toBe('Active');
      expect(user.lastLoginAt).toBeNull();
    });

    it('defaults the display name to the email', async () => {
      const user = await inviteUser(repo, {
        email: 'noname@example.com',
        role: 'Viewer',
      });
      expect(user.name).toBe('noname@example.com');
    });

    it('rejects a malformed email', async () => {
      await expect(
        inviteUser(repo, { email: 'not-an-email', role: 'Viewer' })
      ).rejects.toBeInstanceOf(ValidationError);
    });

    it('rejects an unknown role', async () => {
      await expect(
        inviteUser(repo, { email: 'a@example.com', role: 'Superuser' })
      ).rejects.toBeInstanceOf(ValidationError);
    });

    it('rejects a duplicate, case-insensitively', async () => {
      await inviteUser(repo, { email: 'dup@example.com', role: 'Viewer' });
      await expect(
        inviteUser(repo, { email: 'DUP@example.com', role: 'Admin' })
      ).rejects.toBeInstanceOf(ValidationError);
    });

    it('rejects an address outside the allowed domain', async () => {
      configure({ ALLOWED_EMAIL_DOMAIN: 'company.com' });
      await expect(
        inviteUser(repo, { email: 'outsider@gmail.com', role: 'Viewer' })
      ).rejects.toBeInstanceOf(ValidationError);
    });
  });

  describe('last-admin protection', () => {
    beforeEach(async () => {
      await repo.createUser(
        makeUser({ email: 'admin@example.com', role: 'Admin' })
      );
      await repo.createUser(
        makeUser({ email: 'member@example.com', role: 'Marketing Team' })
      );
      invalidateUserCache();
    });

    it('refuses to demote the only Admin', async () => {
      await expect(
        changeUserRole(
          repo,
          'admin@example.com',
          'Viewer',
          'admin@example.com'
        )
      ).rejects.toBeInstanceOf(ValidationError);

      // Still an Admin, so the workspace is not locked out.
      expect((await findActiveUser(repo, 'admin@example.com'))?.role).toBe(
        'Admin'
      );
    });

    it('allows the demotion once a second Admin exists', async () => {
      await changeUserRole(
        repo,
        'member@example.com',
        'Admin',
        'admin@example.com'
      );

      const updated = await changeUserRole(
        repo,
        'admin@example.com',
        'Viewer',
        'admin@example.com'
      );
      expect(updated.role).toBe('Viewer');
    });

    it('refuses to suspend the only Admin', async () => {
      await expect(
        setUserStatus(
          repo,
          'admin@example.com',
          'Suspended',
          'member@example.com'
        )
      ).rejects.toBeInstanceOf(ValidationError);
    });

    it('refuses to remove the only Admin', async () => {
      await expect(
        removeUser(repo, 'admin@example.com', 'member@example.com')
      ).rejects.toBeInstanceOf(ValidationError);
    });

    it('does not count a suspended Admin as cover', async () => {
      // Promote and immediately suspend the second Admin.
      await changeUserRole(
        repo,
        'member@example.com',
        'Admin',
        'admin@example.com'
      );
      await setUserStatus(
        repo,
        'member@example.com',
        'Suspended',
        'admin@example.com'
      );

      // Only one *active* Admin remains, so the demotion must still be refused.
      await expect(
        changeUserRole(
          repo,
          'admin@example.com',
          'Viewer',
          'admin@example.com'
        )
      ).rejects.toBeInstanceOf(ValidationError);
    });
  });

  describe('self-protection', () => {
    beforeEach(async () => {
      await repo.createUser(
        makeUser({ email: 'admin@example.com', role: 'Admin' })
      );
      await repo.createUser(
        makeUser({ email: 'other@example.com', role: 'Admin' })
      );
      invalidateUserCache();
    });

    it('refuses self-suspension', async () => {
      await expect(
        setUserStatus(
          repo,
          'admin@example.com',
          'Suspended',
          'admin@example.com'
        )
      ).rejects.toBeInstanceOf(ValidationError);
    });

    it('refuses self-removal', async () => {
      await expect(
        removeUser(repo, 'admin@example.com', 'admin@example.com')
      ).rejects.toBeInstanceOf(ValidationError);
    });

    it('allows suspending someone else', async () => {
      const updated = await setUserStatus(
        repo,
        'other@example.com',
        'Suspended',
        'admin@example.com'
      );
      expect(updated.status).toBe('Suspended');
    });
  });

  describe('removeUser', () => {
    it('revokes access but keeps the row for audit purposes', async () => {
      await repo.createUser(
        makeUser({ email: 'admin@example.com', role: 'Admin' })
      );
      await repo.createUser(makeUser({ email: 'leaver@example.com' }));
      invalidateUserCache();

      await removeUser(repo, 'leaver@example.com', 'admin@example.com');

      expect(await findActiveUser(repo, 'leaver@example.com')).toBeNull();
      // Tombstoned, not physically deleted.
      expect(transport.getDataRows('Users')).toHaveLength(2);
    });
  });
});

/* -------------------------------------------------------------------------- */
/* Permission matrix                                                          */
/* -------------------------------------------------------------------------- */

describe('assertCan', () => {
  const actorWith = (role: UserRole): Actor => ({
    email: 'someone@example.com',
    name: 'Someone',
    role,
  });

  const cases: {
    permission: Parameters<typeof assertCan>[1];
    allowed: UserRole[];
  }[] = [
    { permission: 'write-task', allowed: ['Admin', 'Marketing Team'] },
    { permission: 'approve', allowed: ['Admin', 'Management'] },
    { permission: 'manage-master', allowed: ['Admin', 'Marketing Team'] },
    { permission: 'delete-task', allowed: ['Admin'] },
    { permission: 'manage-users', allowed: ['Admin'] },
  ];

  const allRoles: UserRole[] = [
    'Admin',
    'Marketing Team',
    'Management',
    'Viewer',
  ];

  for (const { permission, allowed } of cases) {
    for (const role of allRoles) {
      const shouldPass = allowed.includes(role);

      it(`${shouldPass ? 'allows' : 'refuses'} ${role} to ${permission}`, () => {
        const call = () => assertCan(actorWith(role), permission);
        if (shouldPass) expect(call).not.toThrow();
        else expect(call).toThrow(ForbiddenError);
      });
    }
  }

  it('never lets a Viewer change anything', () => {
    const viewer = actorWith('Viewer');
    for (const { permission } of cases) {
      expect(() => assertCan(viewer, permission)).toThrow(ForbiddenError);
    }
  });

  it('names the allowed roles in the error, so the UI can explain', () => {
    try {
      assertCan(actorWith('Viewer'), 'approve');
      expect.unreachable('should have thrown');
    } catch (err) {
      expect((err as Error).message).toContain('Admin');
      expect((err as Error).message).toContain('Management');
    }
  });
});
