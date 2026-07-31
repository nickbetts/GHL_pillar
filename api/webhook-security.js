import crypto from 'crypto';

function headerValue(req, names) {
  for (const name of names) {
    const value = req.headers?.[name.toLowerCase()];
    if (Array.isArray(value) && value[0]) return String(value[0]);
    if (value) return String(value);
  }
  return '';
}

function constantTimeEqual(provided, expected) {
  const left = Buffer.from(String(provided || ''), 'utf8');
  const right = Buffer.from(String(expected || ''), 'utf8');
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

export function verifyWebhookSecret(req, { envName, headers }) {
  const expected = process.env[envName];
  if (!expected) return { ok: false, status: 503, error: 'Webhook not configured' };

  let provided = headerValue(req, headers);
  if (/^Bearer\s+/i.test(provided)) provided = provided.replace(/^Bearer\s+/i, '');
  if (!constantTimeEqual(provided, expected)) {
    return { ok: false, status: 401, error: 'Unauthorized' };
  }
  return { ok: true };
}

export function verifyBodySize(req, maxBytes = 256 * 1024) {
  const declared = Number.parseInt(req.headers?.['content-length'] || '0', 10);
  const bytes = Number.isFinite(declared) && declared > 0
    ? declared
    : Buffer.byteLength(JSON.stringify(req.body || {}), 'utf8');
  return bytes <= maxBytes
    ? { ok: true }
    : { ok: false, status: 413, error: 'Request body too large' };
}
