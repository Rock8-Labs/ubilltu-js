import { describe, expect, it } from 'vitest';
import {
  UbilltuClient,
  UbilltuAuthError,
  familySeatsAvailable,
  type InviteCode,
} from '../src/index.js';

/** Fake fetch that routes by path; auto-answers login. */
function makeFetch(routes: (path: string, method: string) => unknown): typeof fetch {
  return (async (input: any, init: any = {}) => {
    const url = new URL(String(input));
    if (url.pathname === '/api/v1/auth/login') {
      return new Response(JSON.stringify({ access_token: 't' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    const body = routes(url.pathname, init.method ?? 'GET');
    return new Response(JSON.stringify(body ?? {}), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as unknown as typeof fetch;
}

async function loggedIn(fetch: typeof fetch) {
  const c = new UbilltuClient({ storefrontSlug: 'demo', fetch });
  await c.login('a@b.com', 'pw');
  return c;
}

describe('Tier-2 family domain', () => {
  it('getFamily parses view + members and computes seats', async () => {
    const c = await loggedIn(
      makeFetch((p) =>
        p === '/api/v1/me/family'
          ? {
              family: {
                family_subscription_id: 'fam1',
                plan_name: 'Premium Family',
                is_owner: true,
                owner_name: 'Jarod',
                owner_email: 'j@x.com',
                total_seats: 5,
                active_members: 2,
                members: [
                  { member_id: 'm1', member_email: 'j@x.com', is_owner: true, is_self: true },
                  { member_id: 'm2', member_email: 'k@x.com', is_owner: false, is_self: false },
                ],
              },
            }
          : {},
      ),
    );
    const fam = await c.getFamily();
    expect(fam).not.toBeNull();
    expect(fam!.familySubscriptionId).toBe('fam1');
    expect(fam!.isOwner).toBe(true);
    expect(fam!.members).toHaveLength(2);
    expect(fam!.members[0].isSelf).toBe(true);
    expect(familySeatsAvailable(fam!)).toBe(3);
  });

  it('getFamily returns null when not in a family', async () => {
    const c = await loggedIn(makeFetch(() => ({ family: null })));
    expect(await c.getFamily()).toBeNull();
  });

  it('createFamilyInvite unwraps data and posts expiry', async () => {
    let seenPath = '';
    const fetch = makeFetch((p) => {
      seenPath = p;
      return {
        success: true,
        data: { code: 'ABC123', status: 'ACTIVE', current_uses: 0 },
      };
    });
    const c = await loggedIn(fetch);
    const inv: InviteCode = await c.createFamilyInvite(48);
    expect(inv.code).toBe('ABC123');
    expect(inv.status).toBe('ACTIVE');
    expect(seenPath).toBe('/api/v1/me/family/invite');
  });

  it('listFamilyInvites unwraps data list', async () => {
    const c = await loggedIn(
      makeFetch((p) =>
        p === '/api/v1/me/family/invites'
          ? {
              success: true,
              data: [
                { code: 'AAA', status: 'ACTIVE', current_uses: 0 },
                { code: 'BBB', status: 'REVOKED', current_uses: 1 },
              ],
              total: 2,
            }
          : {},
      ),
    );
    const codes = await c.listFamilyInvites();
    expect(codes.map((x) => x.code)).toEqual(['AAA', 'BBB']);
  });

  it('validateInvite works WITHOUT auth and returns the preview', async () => {
    // No login — public endpoint. Also assert no Authorization header.
    let sawAuth = true;
    const fetch = (async (input: any, init: any = {}) => {
      const url = new URL(String(input));
      const headers = new Headers(init.headers ?? {});
      sawAuth = headers.has('authorization');
      expect(url.pathname).toBe('/api/v1/invite/ABC123/validate');
      return new Response(
        JSON.stringify({
          success: true,
          preview: {
            family_subscription_id: 'fam1',
            plan_name: 'Premium Family',
            owner_name: 'Jarod',
            seats_available: 3,
          },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }) as unknown as typeof fetch;

    const c = new UbilltuClient({ storefrontSlug: 'demo', fetch });
    const preview = await c.validateInvite('ABC123');
    expect(sawAuth).toBe(false);
    expect(preview.ownerName).toBe('Jarod');
    expect(preview.seatsAvailable).toBe(3);
  });

  it('family calls require auth before login', async () => {
    const c = new UbilltuClient({ storefrontSlug: 'demo', fetch: makeFetch(() => ({})) });
    await expect(c.getFamily()).rejects.toBeInstanceOf(UbilltuAuthError);
    await expect(c.leaveFamily()).rejects.toBeInstanceOf(UbilltuAuthError);
  });
});
