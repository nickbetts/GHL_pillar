/** Email login codes for the client proposal gate: 6 digits, short-lived, hashed at rest. */

import crypto from 'crypto';
import { scopedHmac } from '../api/session.js';

export const CODE_TTL_MINUTES = 10;
export const CODE_MAX_ATTEMPTS = 5;
export const CODE_RESEND_SECONDS = 30;
export const CODES_PER_HOUR = 6;

export const generateCode = () => String(crypto.randomInt(0, 1000000)).padStart(6, '0');

export const cleanCode = (input) => String(input ?? '').replace(/\D/g, '').slice(0, 6);

// Bound to the proposal so a code for one link can never open another.
export const hashCode = (proposalId, code) => scopedHmac('proposal-code', `${proposalId}:${code}`);

export function codeMatches(proposalId, code, storedHash) {
  const a = Buffer.from(hashCode(proposalId, code), 'hex');
  const b = Buffer.from(String(storedHash || ''), 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function maskEmail(email) {
  const [user = '', domain = ''] = String(email || '').split('@');
  if (!domain) return '';
  return `${user.slice(0, 1)}${'•'.repeat(Math.max(user.length - 1, 2))}@${domain}`;
}

export const looksLikeEmail = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v || '')) && String(v).length <= 254;
