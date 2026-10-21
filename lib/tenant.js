/** Tenant routing: which workspace a request belongs to, decided by its host name. */

export const OWNER_SLUG = 'i3media';
export const BASE_DOMAIN = (process.env.TENANT_BASE_DOMAIN || 'streamcrm.co.uk').toLowerCase();
export const APP_SUBDOMAIN = 'app';

const RESERVED = new Set([
  'app', 'www', 'api', 'admin', 'mail', 'email', 'smtp', 'imap', 'ftp', 'cdn', 'static', 'assets', 'status', 'help', 'support',
  'docs', 'blog', 'login', 'signup', 'auth', 'billing', 'dashboard', 'dev', 'staging', 'test', 'demo', 'stream', 'streamcrm',
]);

export const validTenantSlug = (slug) => /^[a-z][a-z0-9-]{1,30}[a-z0-9]$/.test(String(slug || '')) && !String(slug).includes('--');
export const isReservedSlug = (slug) => RESERVED.has(String(slug || '').toLowerCase());

/** The host the browser used, without any port. */
export function hostFromReq(req) {
  const raw = req?.headers?.['x-forwarded-host'] || req?.headers?.host || '';
  return String(raw).split(',')[0].trim().toLowerCase().replace(/:\d+$/, '');
}

/**
 * kind: 'app' (front door), 'tenant' (a company's workspace), 'site' (marketing),
 * 'unknown' (not a valid workspace name) or 'default' (any other host, e.g. the Vercel URL = i3MEDIA).
 */
export function tenantFromHost(host) {
  const h = String(host || '').toLowerCase().replace(/:\d+$/, '');
  if (h === BASE_DOMAIN || h === `www.${BASE_DOMAIN}`) return { kind: 'site', slug: null };
  if (!h.endsWith(`.${BASE_DOMAIN}`)) return { kind: 'default', slug: OWNER_SLUG };
  const sub = h.slice(0, -(BASE_DOMAIN.length + 1));
  if (sub === APP_SUBDOMAIN) return { kind: 'app', slug: null };
  if (!validTenantSlug(sub) || isReservedSlug(sub)) return { kind: 'unknown', slug: null };
  return { kind: 'tenant', slug: sub };
}

/** The workspace slug for a request, or null when the host is not a workspace. */
export const requestTenantSlug = (req) => tenantFromHost(hostFromReq(req)).slug;

export const tenantUrl = (slug) => `https://${slug}.${BASE_DOMAIN}`;
