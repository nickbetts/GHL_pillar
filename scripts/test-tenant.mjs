import test from 'node:test';
import assert from 'node:assert/strict';
import { tenantFromHost, hostFromReq, validTenantSlug, isReservedSlug, OWNER_SLUG } from '../lib/tenant.js';
import { generateTempPassword } from '../lib/tenant-db.js';
import { createSessionToken, resolveIdentity } from '../api/session.js';

const req = (host, token) => ({ headers: { host, ...(token ? { cookie: `sq_session=${token}` } : {}) } });
const user = { id: 7, email: 'a@b.co', name: 'A', role: 'admin' };

test('hosts map to workspaces', () => {
  assert.deepEqual(tenantFromHost('i3media.streamcrm.co.uk'), { kind: 'tenant', slug: 'i3media' });
  assert.deepEqual(tenantFromHost('acme.streamcrm.co.uk'), { kind: 'tenant', slug: 'acme' });
  assert.equal(tenantFromHost('app.streamcrm.co.uk').kind, 'app');
  assert.equal(tenantFromHost('streamcrm.co.uk').kind, 'site');
  assert.equal(tenantFromHost('www.streamcrm.co.uk').kind, 'site');
  assert.equal(tenantFromHost('a.b.streamcrm.co.uk').kind, 'unknown');
  assert.equal(tenantFromHost('www2.streamcrm.co.uk:443').slug, 'www2');
  assert.deepEqual(tenantFromHost('ghl-pillar.vercel.app'), { kind: 'default', slug: OWNER_SLUG });
  assert.deepEqual(tenantFromHost('localhost:3000'), { kind: 'default', slug: OWNER_SLUG });
  assert.equal(tenantFromHost('evilstreamcrm.co.uk').kind, 'default');
});

test('forwarded host wins and ports are stripped', () => {
  assert.equal(hostFromReq({ headers: { host: 'x.vercel.app', 'x-forwarded-host': 'Acme.streamcrm.co.uk:443' } }), 'acme.streamcrm.co.uk');
  assert.equal(hostFromReq({}), '');
});

test('workspace names are validated', () => {
  for (const ok of ['acme', 'north-wind', 'a1b']) assert.ok(validTenantSlug(ok), ok);
  for (const bad of ['a', '1acme', '-acme', 'acme-', 'a--b', 'Acme', 'ac me', 'x'.repeat(40), '']) assert.ok(!validTenantSlug(bad), bad);
  assert.ok(isReservedSlug('app') && isReservedSlug('www') && !isReservedSlug('acme'));
});

test('sessions only work on the workspace they were issued for', () => {
  const owner = createSessionToken(user);
  assert.equal(resolveIdentity(req('i3media.streamcrm.co.uk', owner))?.tenant, OWNER_SLUG);
  assert.equal(resolveIdentity(req('ghl-pillar.vercel.app', owner))?.tenant, OWNER_SLUG);
  assert.equal(resolveIdentity(req('acme.streamcrm.co.uk', owner), { allowTenant: true }), null);
  assert.equal(resolveIdentity(req('app.streamcrm.co.uk', owner)), null);

  const acme = createSessionToken(user, 'acme');
  assert.equal(resolveIdentity(req('acme.streamcrm.co.uk', acme), { allowTenant: true })?.tenant, 'acme');
  assert.equal(resolveIdentity(req('i3media.streamcrm.co.uk', acme)), null);
  assert.equal(resolveIdentity(req('ghl-pillar.vercel.app', acme), { allowTenant: true }), null);
  assert.equal(resolveIdentity(req('other.streamcrm.co.uk', acme), { allowTenant: true }), null);
});

test('other workspaces never get an identity for data endpoints', () => {
  const acme = createSessionToken(user, 'acme');
  assert.equal(resolveIdentity(req('acme.streamcrm.co.uk', acme)), null);
});

test('temporary passwords are long and unambiguous', () => {
  const p = generateTempPassword();
  assert.equal(p.length, 14);
  assert.ok(!/[0Ol1I]/.test(p));
  assert.notEqual(p, generateTempPassword());
});
