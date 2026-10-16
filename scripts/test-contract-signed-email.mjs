import test from 'node:test';
import assert from 'node:assert/strict';
import { proposalCosts, paymentSchedule } from '../lib/proposalCosts.js';
import { buildContractSignedEmail, contractSignedRecipients, contractSignedFrom } from '../lib/contract-signed-email.js';

const websiteBlocks = [
  { type: 'heading', text: 'Intro' },
  { type: 'options', selectable: true, required: true, data: { a: { name: 'Website Refresh', price: '£8,000' }, b: { name: 'Brand Uplift', price: '£12,000' } } },
  { type: 'investment', text: 'Your investment in Option 1 | £8,000 | + VAT' },
  { type: 'investment', text: 'Your investment in Option 2 | £12,000 | + VAT' },
  { type: 'addons', text: '!Hosting, security & warranty | £250 / month | Included with every build.\nSEO pack | £500 | Extra.' },
  { type: 'options', selectable: true, required: false, data: { a: { name: 'Support retainer: 3 hours / month', price: '£360 / mo' }, b: { name: 'Support retainer: 5 hours / month', price: '£550 / mo' } } },
];
const signed = {
  id: 42, title: 'Northwind: Website', client_company: 'Northwind Engineering Ltd', client_name: 'Alex Morgan', client_email: 'alex@northwind.example',
  owner_name: 'Zain', skip_onboarding: false, blocks: websiteBlocks,
  selection: { options: { 1: 'b', 5: 'a' }, addons: { 4: [1] } },
};

test('costs follow the chosen option, included add-ons and optional extras', () => {
  const c = proposalCosts(signed);
  assert.deepEqual(c.items.map((i) => i.name), ['Brand Uplift', 'Hosting, security & warranty', 'SEO pack', 'Support retainer: 3 hours / month']);
  assert.equal(c.oneOff, 12500);
  assert.equal(c.monthly, 610);
  assert.equal(c.annual, 0);
  assert.equal(c.items[1].included, true);
});

test('investment blocks are not double counted when the client chose an option', () => {
  assert.equal(proposalCosts(signed).oneOff, 12500);
});

test('fixed-price proposals use their investment blocks', () => {
  const c = proposalCosts({ blocks: [
    { type: 'investment', text: 'Website design and build | £6,000 | + VAT. One-off, fixed price.' },
    { type: 'investment', text: 'Monthly retainer | £250 / month | + VAT. 6-month contract.' },
    { type: 'investment', text: 'Year two onwards | £2,990 a year | + VAT.' },
  ] });
  assert.equal(c.oneOff, 6000);
  assert.equal(c.monthly, 250);
  assert.equal(c.annual, 2990);
});

test('falls back to the deal values when a proposal has no priced blocks', () => {
  const c = proposalCosts({ blocks: [], one_off_value: 1500, mrr_value: 99 });
  assert.equal(c.source, 'deal');
  assert.equal(c.oneOff, 1500);
  assert.equal(c.monthly, 99);
});

test('payment terms split the one-off cost 50/50 to the penny', () => {
  const p = paymentSchedule({ oneOff: 12500 });
  assert.equal(p.upfront, 6250);
  assert.equal(p.final, 6250);
  const odd = paymentSchedule({ oneOff: 1000.01 });
  assert.equal(Math.round((odd.upfront + odd.final) * 100), 100001);
});

test('recipients are Nick, Az, the rep and finance, de-duplicated and validated', () => {
  const to = contractSignedRecipients('Zain@i3media.net', {});
  assert.deepEqual(to, ['nick.betts@i3media.net', 'azeem@i3media.net', 'zain@i3media.net', 'finance@i3media.net']);
  assert.deepEqual(contractSignedRecipients('NICK.betts@i3media.net', {}), ['nick.betts@i3media.net', 'azeem@i3media.net', 'finance@i3media.net']);
  assert.deepEqual(contractSignedRecipients('not-an-email', {}), ['nick.betts@i3media.net', 'azeem@i3media.net', 'finance@i3media.net']);
  assert.deepEqual(contractSignedRecipients('', { CONTRACT_SIGNED_TEAM_EMAILS: 'a@x.com, b@x.com', CONTRACT_SIGNED_FINANCE_EMAIL: 'fin@x.com' }), ['a@x.com', 'b@x.com', 'fin@x.com']);
});

test('the email shows costs, payment terms and who signed', () => {
  const { subject, html, text } = buildContractSignedEmail({ proposal: signed, repName: 'Zain', signerName: 'Alex Morgan', signedAt: '2026-10-16T10:42:00Z', origin: 'https://stream.example.com' });
  assert.equal(subject, 'Contract signed: Northwind Engineering Ltd \u00b7 £12,500 one-off + £610/mo');
  for (const bit of ['Northwind Engineering Ltd just signed', 'Brand Uplift', '£12,500', '£610/mo', '50% upfront, 50% on sign-off', '£6,250', 'stream-logo-email.png', 'https://stream.example.com/proposal-hub', 'Zain']) {
    assert.ok(html.includes(bit), `html is missing ${bit}`);
  }
  assert.ok(text.includes('50% upfront: £6,250 (invoice now)'));
  assert.ok(text.includes('50% on sign-off: £6,250'));
});

test('a deal with no one-off cost says so instead of showing a split', () => {
  const { html, text } = buildContractSignedEmail({ proposal: { id: 1, title: 'Retainer', client_company: 'Acme', blocks: [{ type: 'investment', text: 'Monthly retainer | £500 / month' }] }, signerName: 'Sam', signedAt: new Date().toISOString(), origin: 'https://s.example' });
  assert.ok(html.includes('no one-off cost on this deal'));
  assert.ok(text.includes('No one-off cost to split.'));
});

test('client-supplied text is escaped in the email', () => {
  const { html } = buildContractSignedEmail({
    proposal: { ...signed, client_company: '<script>alert(1)</script>', title: 'Bad "title" <b>' },
    repName: '<img src=x onerror=1>', signerName: '"><svg/onload=1>', signedAt: new Date().toISOString(), origin: 'javascript:alert(1)',
  });
  assert.ok(!html.includes('<script>'));
  assert.ok(!html.includes('<svg'));
  assert.ok(!html.includes('<img src=x'));
  assert.ok(!html.includes('javascript:'));
});

test('the email is sent from contracts@i3media.net unless overridden', () => {
  assert.equal(contractSignedFrom({}), 'Stream <contracts@i3media.net>');
  assert.equal(contractSignedFrom({ CONTRACT_SIGNED_FROM_EMAIL: 'deals@i3media.net' }), 'Stream <deals@i3media.net>');
  assert.equal(contractSignedFrom({ CONTRACT_SIGNED_FROM_EMAIL: 'not valid' }), 'Stream <contracts@i3media.net>');
});
