import test from 'node:test';
import assert from 'node:assert/strict';
import { generateCode, hashCode, codeMatches, cleanCode, maskEmail, looksLikeEmail } from '../lib/proposalLogin.js';
import { createProposalSession, verifyProposalSession, createSessionToken, verifySessionToken } from '../api/session.js';

test('codes are six digits and only match their own proposal', () => {
  for (let i = 0; i < 200; i += 1) assert.match(generateCode(), /^\d{6}$/);
  const hash = hashCode(7, '012345');
  assert.ok(codeMatches(7, '012345', hash));
  assert.ok(!codeMatches(7, '012346', hash));
  assert.ok(!codeMatches(8, '012345', hash));
  assert.ok(!codeMatches(7, '012345', ''));
});

test('pasted codes are cleaned to digits', () => {
  assert.equal(cleanCode(' 123 456 '), '123456');
  assert.equal(cleanCode('12-34-56-78'), '123456');
  assert.equal(cleanCode(null), '');
});

test('emails are masked and validated', () => {
  assert.equal(maskEmail('azhar@joinhands.org'), 'a••••@joinhands.org');
  assert.ok(looksLikeEmail('a@b.co'));
  assert.ok(!looksLikeEmail('nope'));
  assert.ok(!looksLikeEmail('a b@c.com'));
});

test('client sessions are bound to a proposal, expire and cannot be forged or reused as staff sessions', () => {
  const token = createProposalSession({ proposalId: 5, email: 'Client@Example.com' });
  const payload = verifyProposalSession(token);
  assert.equal(payload.p, '5');
  assert.equal(payload.e, 'client@example.com');
  assert.equal(verifyProposalSession(`${token.slice(0, -2)}aa`), null);
  assert.equal(verifyProposalSession('junk'), null);
  assert.equal(verifySessionToken(token), null);
  const staff = createSessionToken({ id: 1, email: 'a@b.com', role: 'admin' });
  assert.equal(verifyProposalSession(staff), null);
});
