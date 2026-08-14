import crypto from 'crypto';

const OWNER_IDS = new Map([
  ['6FX5X4kH2JFJc6u9zhSC', 'Brendon Mwatsenekenyi'],
  ['XbyxbOK1Q1raRCjjGx4O', 'Zain Safir-Sheikh'],
  ['s7OG2BM94q7uNRsHLqM7', 'Amir Ward'],
]);
const TTL_SECONDS = 60 * 60 * 24 * 30;

function secret() {
  if (!process.env.SESSION_SECRET) throw new Error('SESSION_SECRET is required');
  return process.env.SESSION_SECRET;
}
function encode(value) { return Buffer.from(value).toString('base64url'); }
function sign(value) { return crypto.createHmac('sha256', secret()).update(value).digest('base64url'); }

export function ownerName(ownerId) { return OWNER_IDS.get(ownerId) || null; }
export function validOwner(ownerId) { return OWNER_IDS.has(ownerId); }

export function createOwnerToken({ ownerId, leadId = null }) {
  if (!validOwner(ownerId)) throw new Error('Unknown rep owner');
  const payload = encode(JSON.stringify({ ownerId, leadId, exp: Math.floor(Date.now() / 1000) + TTL_SECONDS }));
  return `${payload}.${sign(payload)}`;
}

export function verifyOwnerToken(token) {
  if (!token || typeof token !== 'string') return null;
  const [payload, signature] = token.split('.');
  if (!payload || !signature || sign(payload) !== signature) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (!validOwner(data.ownerId) || Number(data.exp) < Math.floor(Date.now() / 1000)) return null;
    return { ...data, ownerName: ownerName(data.ownerId) };
  } catch { return null; }
}
