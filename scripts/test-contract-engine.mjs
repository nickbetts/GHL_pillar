import test from 'node:test';
import assert from 'node:assert/strict';
import { WEBSITE_RETAINER_TERMS } from '../lib/proposalWebsiteRetainer.js';
import { CONTRACT_TERMS_BLOCKS } from '../lib/proposalDefaults.js';
import {
  docFromBlocks, renderContractDoc, validateDoc, previewMatrix, diffDocs, sanitizeDoc, evalWhen, newId,
} from '../lib/contractEngine.js';

const lines = (blocks) => blocks.flatMap((b) => {
  if (b.type === 'heading') return [`H:${b.text}`];
  if (b.type === 'callout') return [`C:${b.text}`];
  return String(b.text).split(/\n{2,}/).map((p) => `T:${p.trim()}`);
});

test('migrating flat terms and rendering them back is lossless', () => {
  for (const blocks of [WEBSITE_RETAINER_TERMS, CONTRACT_TERMS_BLOCKS]) {
    const doc = docFromBlocks(blocks);
    const out = renderContractDoc(doc, {});
    assert.deepEqual(lines(out.blocks), lines(blocks));
    assert.deepEqual(out.unresolvedRefs, []);
  }
});

test('cross-references become live references', () => {
  const doc = docFromBlocks(WEBSITE_RETAINER_TERMS);
  const text = JSON.stringify(doc);
  assert.ok(/\{\{ref:/.test(text), 'expected clause references to be converted');
});

const mini = () => sanitizeDoc({
  sections: [
    { id: 's1', title: 'Scope', numbered: true, nodes: [
      { id: 'a', kind: 'clause', text: 'Always here, see clause {{ref:c}}.' },
      { id: 'b', kind: 'clause', text: 'Hosting only.', when: { service: ['hosting'] }, plain: 'We host it.' },
      { id: 'c', kind: 'clause', text: 'Last clause.', children: [{ id: 'c1', kind: 'clause', text: 'Child one.' }, { id: 'c2', kind: 'clause', text: 'Child two.', when: { service: ['dns'] } }] },
    ] },
    { id: 's2', title: 'Summary', numbered: false, nodes: [{ id: 'sum', kind: 'summary', title: 'In plain English', text: 'Full terms below.' }] },
  ],
});

test('conditional clauses renumber and references follow', () => {
  const withHosting = renderContractDoc(mini(), { services: ['hosting'] });
  const without = renderContractDoc(mini(), { services: [] });
  assert.match(withHosting.blocks[1].text, /1\.1 Always here, see clause 1\.3\./);
  assert.match(withHosting.blocks[1].text, /1\.2 Hosting only\./);
  assert.match(without.blocks[1].text, /1\.1 Always here, see clause 1\.2\./);
  assert.doesNotMatch(without.blocks[1].text, /Hosting only/);
  assert.match(withHosting.blocks[1].text, /1\.3\.1 Child one\./);
  assert.doesNotMatch(withHosting.blocks[1].text, /Child two/);
});

test('plain-English summary only lists included clauses', () => {
  const a = renderContractDoc(mini(), { services: ['hosting'] });
  const b = renderContractDoc(mini(), { services: [] });
  assert.match(a.blocks.at(-1).text, /We host it\./);
  assert.doesNotMatch(b.blocks.at(-1).text, /We host it\./);
  assert.match(b.blocks.at(-1).text, /Full terms below\./);
});

test('merge fields and variables resolve', () => {
  const doc = sanitizeDoc({ sections: [{ id: 's', title: 'T', nodes: [{ id: 'n', kind: 'clause', text: 'For {{client_company}} on {{registrar}}.' }] }] });
  const out = renderContractDoc(doc, { tokens: { client_company: 'Acme Ltd', registrar: 'Namecheap' } });
  assert.match(out.blocks[1].text, /For Acme Ltd on Namecheap\./);
});

test('condition operators', () => {
  const ctx = { services: new Set(['a']), variables: { hours: '8' }, selection: 'Growth (£2,500)' };
  assert.equal(evalWhen({ service: ['a', 'b'] }, ctx), true);
  assert.equal(evalWhen({ not: { service: 'a' } }, ctx), false);
  assert.equal(evalWhen({ var: 'hours', op: 'gt', value: '5' }, ctx), true);
  assert.equal(evalWhen({ all: [{ service: 'a' }, { selected: 'growth' }] }, ctx), true);
  assert.equal(evalWhen({ any: [{ service: 'z' }, { var: 'hours', op: 'eq', value: '9' }] }, ctx), false);
});

test('health check finds broken references, unknown services and unknown fields', () => {
  const doc = sanitizeDoc({ sections: [{ id: 's', title: 'T', nodes: [
    { id: 'n', kind: 'clause', text: 'See {{ref:gone}} and {{mystery}}.', when: { service: ['nope'] } },
  ] }] });
  const issues = validateDoc(doc, { serviceKeys: ['hosting'], variableKeys: [] });
  assert.ok(issues.some((i) => /no longer exists/.test(i.message)));
  assert.ok(issues.some((i) => /Unknown merge field/.test(i.message)));
  assert.ok(issues.some((i) => /unknown service/.test(i.message)));
});

test('preview matrix flags references that vanish with a service', () => {
  const doc = sanitizeDoc({ sections: [{ id: 's', title: 'T', nodes: [
    { id: 'a', kind: 'clause', text: 'Refers to {{ref:b}}.' },
    { id: 'b', kind: 'clause', text: 'Optional.', when: { service: ['x'] } },
  ] }] });
  const rows = previewMatrix(doc, { serviceKeys: ['x'] });
  assert.equal(rows.length, 2);
  assert.equal(rows.find((r) => r.services.length === 0).problems.length, 1);
  assert.equal(rows.find((r) => r.services.length === 1).problems.length, 0);
});

test('diff reports added, removed and changed clauses', () => {
  const a = mini();
  const b = structuredClone(a);
  b.sections[0].nodes[0].text = 'Changed.';
  b.sections[0].nodes.push({ id: newId(), kind: 'clause', text: 'New.', children: [] });
  b.sections[0].nodes = b.sections[0].nodes.filter((n) => n.id !== 'b');
  const d = diffDocs(a, b);
  assert.equal(d.added.length, 1);
  assert.equal(d.removed.length, 1);
  assert.equal(d.changed.length, 1);
});
