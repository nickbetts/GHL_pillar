/**
 * Contract engine: structured contracts with automatic numbering, cross-references,
 * conditional clauses and a plain-English summary. Pure functions, no I/O.
 *
 * Doc shape:
 *   { sections: [{ id, title, numbered, when?, plain?, source?, nodes: [Node] }] }
 *   Node: { id, kind: 'clause' | 'text' | 'def' | 'callout' | 'summary', text, def?, title?,
 *           plain?, when?, requires?, source?, children?: [Node] }
 *   `when`: { service } | { all|any: [..] } | { not } | { var, op, value } | { selected }
 *   Text may contain {{merge_fields}} and {{ref:nodeId}} (resolves to a clause number).
 */

import { mergeTokens } from './proposalBlocks.js';

export const newId = () => `${Math.random().toString(36).slice(2, 7)}${Date.now().toString(36).slice(-3)}`;

const REF = /\{\{\s*ref:([A-Za-z0-9_-]+)\s*\}\}/g;
const CHUNK = 6000;

// ── Conditions ──────────────────────────────────────────────────────────────
export function evalWhen(when, ctx) {
  if (!when || typeof when !== 'object' || !Object.keys(when).length) return true;
  if (Array.isArray(when.all)) return when.all.every((w) => evalWhen(w, ctx));
  if (Array.isArray(when.any)) return when.any.some((w) => evalWhen(w, ctx));
  if (when.not) return !evalWhen(when.not, ctx);
  if (when.service) return [].concat(when.service).some((s) => ctx.services.has(s));
  if (when.var) {
    const v = String(ctx.variables?.[when.var] ?? '').trim();
    const want = String(when.value ?? '').trim();
    switch (when.op || 'eq') {
      case 'eq': return v.toLowerCase() === want.toLowerCase();
      case 'neq': return v.toLowerCase() !== want.toLowerCase();
      case 'set': return v !== '';
      case 'unset': return v === '';
      case 'gt': return Number(v) > Number(want);
      case 'lt': return Number(v) < Number(want);
      default: return true;
    }
  }
  if (when.selected) return String(ctx.selection || '').toLowerCase().includes(String(when.selected).toLowerCase());
  return true;
}

function makeCtx({ services, variables, selection }) {
  return { services: new Set(services || []), variables: variables || {}, selection: selection || '' };
}

function filterNodes(nodes, ctx) {
  return (nodes || []).filter((n) => evalWhen(n.when, ctx)).map((n) => ({ ...n, children: filterNodes(n.children, ctx) }));
}

// ── Rendering ───────────────────────────────────────────────────────────────
export function renderContractDoc(doc, { services, variables, selection, tokens } = {}) {
  const ctx = makeCtx({ services, variables, selection });
  const sections = (doc?.sections || [])
    .filter((s) => evalWhen(s.when, ctx))
    .map((s) => ({ ...s, nodes: filterNodes(s.nodes, ctx) }))
    .filter((s) => s.nodes.length || !s.numbered);

  // Pass 1: numbering.
  const numbers = {};
  const included = [];
  let secNo = 0;
  sections.forEach((s) => {
    included.push(s.id);
    if (s.numbered) { secNo += 1; numbers[s.id] = String(secNo); }
    let clauseNo = 0;
    const walk = (nodes, prefix) => {
      let n = 0;
      nodes.forEach((node) => {
        included.push(node.id);
        if (node.kind === 'clause' && prefix) {
          n += 1;
          node.number = `${prefix}.${n}`;
          numbers[node.id] = node.number;
          walk(node.children || [], node.number);
        } else if (node.kind === 'clause') {
          walk(node.children || [], '');
        }
      });
    };
    if (s.numbered) {
      s.nodes.forEach((node) => {
        included.push(node.id);
        if (node.kind === 'clause') {
          clauseNo += 1;
          node.number = `${secNo}.${clauseNo}`;
          numbers[node.id] = node.number;
          walk(node.children || [], node.number);
        }
      });
    } else {
      walk(s.nodes, '');
    }
  });

  const unresolvedRefs = [];
  const resolve = (text) => mergeTokens(String(text || '').replace(REF, (m, id) => {
    if (numbers[id]) return numbers[id];
    unresolvedRefs.push(id);
    return '[?]';
  }), tokens || {});

  // Pass 2: output.
  const blocks = [];
  const plains = [];
  let summaryAt = -1;
  const summaryNode = [];
  sections.forEach((s) => {
    if (s.plain) plains.push(resolve(s.plain));
    blocks.push({ type: 'heading', text: s.numbered ? `${numbers[s.id]}. ${resolve(s.title)}` : resolve(s.title) });
    let paras = [];
    const flush = () => {
      let buf = '';
      paras.forEach((p) => {
        if (buf && (buf.length + p.length) > CHUNK) { blocks.push({ type: 'text', text: buf }); buf = ''; }
        buf += (buf ? '\n\n' : '') + p;
      });
      if (buf) blocks.push({ type: 'text', text: buf });
      paras = [];
    };
    const emit = (nodes) => {
      nodes.forEach((n) => {
        if (n.plain) plains.push(resolve(n.plain));
        if (n.kind === 'clause') {
          const body = resolve(n.text);
          paras.push(n.number ? `${n.number} ${body}` : body);
          emit(n.children || []);
        } else if (n.kind === 'def') {
          paras.push(`"${resolve(n.def)}": ${resolve(n.text)}`);
        } else if (n.kind === 'callout') {
          flush();
          blocks.push({ type: 'callout', text: `${resolve(n.title)} | ${resolve(n.text)}` });
        } else if (n.kind === 'summary') {
          flush();
          summaryAt = blocks.length;
          summaryNode.push(n);
          blocks.push({ type: 'callout', text: '' });
        } else {
          paras.push(resolve(n.text));
        }
      });
    };
    emit(s.nodes);
    flush();
  });
  if (summaryAt >= 0) {
    const n = summaryNode[0];
    const body = [...plains, n.text ? resolve(n.text) : ''].filter(Boolean).join('\n\n');
    if (plains.length || n.text) blocks[summaryAt] = { type: 'callout', text: `${resolve(n.title) || 'In plain English'} | ${body}` };
    else blocks.splice(summaryAt, 1);
  }
  return { blocks, numbers, included, unresolvedRefs: [...new Set(unresolvedRefs)] };
}

// ── Migration from flat blocks ──────────────────────────────────────────────
const NUMBERED = /^(\d+(?:\.\d+)+)\s+([\s\S]*)$/;
const DEF = /^"([^"]+)":\s*([\s\S]*)$/;

export function docFromBlocks(blocks) {
  const sections = [];
  const byOld = {};
  let cur = null;
  const open = (title, numbered, oldNo) => {
    cur = { id: newId(), title, numbered, nodes: [] };
    sections.push(cur);
    if (oldNo) byOld[oldNo] = cur.id;
    cur._stack = [];
  };
  (blocks || []).forEach((b) => {
    if (b.type === 'heading') {
      const m = String(b.text || '').match(/^(\d+)\.\s+([\s\S]*)$/);
      open(m ? m[2] : b.text, !!m, m ? m[1] : null);
      return;
    }
    if (!cur) open('', false, null);
    if (b.type === 'callout') {
      const text = String(b.text || '');
      const i = text.indexOf('|');
      cur.nodes.push({ id: newId(), kind: 'callout', title: i > -1 ? text.slice(0, i).trim() : '', text: i > -1 ? text.slice(i + 1).trim() : text });
      return;
    }
    if (b.type !== 'text' && b.type !== 'bullets') return;
    const paras = b.type === 'bullets' ? String(b.text || '').split('\n') : String(b.text || '').split(/\n{2,}/);
    paras.map((p) => p.trim()).filter(Boolean).forEach((p) => {
      const num = p.match(NUMBERED);
      const def = p.match(DEF);
      if (num && cur.numbered) {
        const depth = num[1].split('.').length - 1;
        const node = { id: newId(), kind: 'clause', text: num[2], children: [], oldNo: num[1] };
        byOld[num[1]] = node.id;
        if (depth <= 1) { cur.nodes.push(node); cur._stack = [node]; return; }
        const parent = cur._stack[depth - 2];
        (parent ? parent.children : cur.nodes).push(node);
        cur._stack[depth - 1] = node;
        cur._stack.length = depth;
      } else if (def) {
        cur.nodes.push({ id: newId(), kind: 'def', def: def[1], text: def[2] });
      } else {
        cur.nodes.push({ id: newId(), kind: 'text', text: p });
      }
    });
  });
  // Turn "clause 13.5" style references into live refs.
  const relink = (text) => String(text || '').replace(/\b(clauses?)\s+(\d+(?:\.\d+)*(?:\s*(?:,|and|to)\s*\d+(?:\.\d+)*)*)/gi,
    (m, word, nums) => `${word} ${nums.replace(/\d+(?:\.\d+)*/g, (n) => (byOld[n] ? `{{ref:${byOld[n]}}}` : n))}`);
  const visit = (nodes) => nodes.forEach((n) => {
    if (n.text) n.text = relink(n.text);
    delete n.oldNo;
    if (n.children) visit(n.children);
  });
  sections.forEach((s) => { delete s._stack; visit(s.nodes); });
  return { sections };
}

// ── Sanitising user-supplied docs ───────────────────────────────────────────
const KINDS = ['clause', 'text', 'def', 'callout', 'summary'];
const str = (v, n) => String(v ?? '').slice(0, n);

function cleanWhen(w, depth = 0) {
  if (!w || typeof w !== 'object' || depth > 4) return undefined;
  if (Array.isArray(w.all)) return { all: w.all.map((x) => cleanWhen(x, depth + 1)).filter(Boolean) };
  if (Array.isArray(w.any)) return { any: w.any.map((x) => cleanWhen(x, depth + 1)).filter(Boolean) };
  if (w.not) { const inner = cleanWhen(w.not, depth + 1); return inner ? { not: inner } : undefined; }
  if (w.service) return { service: [].concat(w.service).map((s) => str(s, 40)).filter(Boolean) };
  if (w.var) return { var: str(w.var, 40), op: ['eq', 'neq', 'set', 'unset', 'gt', 'lt'].includes(w.op) ? w.op : 'eq', value: str(w.value, 100) };
  if (w.selected) return { selected: str(w.selected, 100) };
  return undefined;
}

function cleanNode(n, depth = 0) {
  const kind = KINDS.includes(n?.kind) ? n.kind : 'clause';
  const out = { id: str(n?.id, 20) || newId(), kind, text: str(n?.text, 6000) };
  if (kind === 'def') out.def = str(n?.def, 120);
  if (kind === 'callout' || kind === 'summary') out.title = str(n?.title, 160);
  if (n?.plain) out.plain = str(n.plain, 600);
  const when = cleanWhen(n?.when);
  if (when) out.when = when;
  if (Array.isArray(n?.requires) && n.requires.length) out.requires = n.requires.map((x) => str(x, 20)).slice(0, 10);
  if (n?.source && n.source.clauseId) out.source = { clauseId: Number(n.source.clauseId), version: Number(n.source.version) || 1 };
  out.children = kind === 'clause' && depth < 4 && Array.isArray(n?.children) ? n.children.slice(0, 200).map((c) => cleanNode(c, depth + 1)) : [];
  return out;
}

export function sanitizeDoc(input) {
  const sections = (Array.isArray(input?.sections) ? input.sections : []).slice(0, 120).map((s) => {
    const out = { id: str(s?.id, 20) || newId(), title: str(s?.title, 200), numbered: s?.numbered !== false, nodes: (Array.isArray(s?.nodes) ? s.nodes : []).slice(0, 300).map((n) => cleanNode(n)) };
    if (s?.plain) out.plain = str(s.plain, 600);
    const when = cleanWhen(s?.when);
    if (when) out.when = when;
    if (s?.source && s.source.clauseId) out.source = { clauseId: Number(s.source.clauseId), version: Number(s.source.version) || 1 };
    return out;
  });
  return { sections };
}

// ── Health checks ───────────────────────────────────────────────────────────
const BUILTIN_TOKENS = ['client_name', 'client_company', 'client_email', 'rep_name', 'deal_type', 'mrr', 'one_off', 'date', 'expiry_date', 'client_story', 'proposal_title', 'proposal_ref', 'selection_summary'];

function flatten(doc) {
  const out = [];
  (doc?.sections || []).forEach((s) => {
    out.push({ kind: 'section', id: s.id, title: s.title, text: `${s.title} ${s.plain || ''}`, when: s.when, section: s });
    const walk = (nodes) => nodes.forEach((n) => {
      out.push({ kind: n.kind, id: n.id, title: s.title, text: `${n.text || ''} ${n.title || ''} ${n.plain || ''}`, when: n.when, node: n, section: s });
      walk(n.children || []);
    });
    walk(s.nodes || []);
  });
  return out;
}

const whenKeys = (w, acc = { services: new Set(), vars: new Set() }) => {
  if (!w) return acc;
  [].concat(w.all || [], w.any || [], w.not ? [w.not] : []).forEach((x) => whenKeys(x, acc));
  if (w.service) [].concat(w.service).forEach((s) => acc.services.add(s));
  if (w.var) acc.vars.add(w.var);
  return acc;
};

export function validateDoc(doc, { serviceKeys = [], variableKeys = [] } = {}) {
  const issues = [];
  const add = (level, where, message) => issues.push({ level, where, message });
  const items = flatten(doc);
  const ids = new Set(items.map((i) => i.id));
  const known = new Set([...BUILTIN_TOKENS, ...variableKeys]);
  const defs = new Map();
  items.forEach((i) => {
    const label = i.kind === 'section' ? `Section "${i.title || 'Untitled'}"` : `${i.section.title || 'Untitled'}: ${String(i.node?.text || i.node?.title || i.node?.def || '').slice(0, 50)}`;
    String(i.text).replace(REF, (m, id) => { if (!ids.has(id)) add('error', label, 'Refers to a clause that no longer exists'); return m; });
    String(i.text).replace(/\{\{\s*([a-z_]+)\s*\}\}/gi, (m, key) => { if (!known.has(key.toLowerCase())) add('warning', label, `Unknown merge field {{${key}}}`); return m; });
    const w = whenKeys(i.when);
    w.services.forEach((s) => { if (serviceKeys.length && !serviceKeys.includes(s)) add('error', label, `Condition uses unknown service "${s}"`); });
    w.vars.forEach((v) => { if (!variableKeys.includes(v)) add('warning', label, `Condition uses unknown variable "${v}"`); });
    if (i.kind === 'clause' && !String(i.node.text || '').trim()) add('warning', label, 'Empty clause');
    if (i.kind === 'def') {
      const term = String(i.node.def || '').trim();
      if (!term) add('error', label, 'Definition has no term');
      if (defs.has(term.toLowerCase())) add('warning', label, `"${term}" is defined more than once`);
      defs.set(term.toLowerCase(), { term, id: i.id });
    }
    (i.node?.requires || []).forEach((r) => { if (!ids.has(r)) add('error', label, 'Requires a clause that no longer exists'); });
  });
  const corpus = items.filter((i) => i.kind !== 'def').map((i) => i.text).join('\n');
  defs.forEach(({ term }) => { if (!corpus.includes(term)) add('warning', `Definition "${term}"`, 'Defined but never used'); });
  (doc?.sections || []).forEach((s) => { if (!s.nodes?.length) add('warning', `Section "${s.title || 'Untitled'}"`, 'Section is empty'); });
  return issues;
}

// Render for every combination of the offered services and report problems that only appear in some.
export function previewMatrix(doc, { serviceKeys = [], variables = {} } = {}) {
  const keys = serviceKeys.slice(0, 8);
  const rows = [];
  for (let mask = 0; mask < (1 << keys.length); mask += 1) {
    const services = keys.filter((_, i) => mask & (1 << i));
    const { blocks, unresolvedRefs, included } = renderContractDoc(doc, { services, variables });
    const problems = [];
    unresolvedRefs.forEach(() => problems.push('A cross-reference points at a clause that is not in this version'));
    const inc = new Set(included);
    flatten(doc).forEach((i) => {
      (i.node?.requires || []).forEach((r) => { if (inc.has(i.id) && !inc.has(r)) problems.push('A clause is included without a clause it requires'); });
    });
    rows.push({ services, clauses: included.length, blocks: blocks.length, problems: [...new Set(problems)] });
  }
  return rows;
}

// ── Version diff ────────────────────────────────────────────────────────────
export function diffDocs(a, b) {
  const map = (doc) => new Map(flatten(doc).map((i) => [i.id, i]));
  const A = map(a); const B = map(b);
  const label = (i) => `${i.section.title || 'Untitled'}${i.node ? `: ${String(i.node.text || i.node.title || i.node.def || '').slice(0, 80)}` : ''}`;
  const added = []; const removed = []; const changed = [];
  B.forEach((i, id) => { if (!A.has(id)) added.push(label(i)); else if (A.get(id).text !== i.text || JSON.stringify(A.get(id).when || null) !== JSON.stringify(i.when || null)) changed.push({ label: label(i), before: A.get(id).text.trim(), after: i.text.trim() }); });
  A.forEach((i, id) => { if (!B.has(id)) removed.push(label(i)); });
  return { added, removed, changed };
}

export const countClauses = (doc) => flatten(doc).filter((i) => ['clause', 'text', 'def'].includes(i.kind)).length;
export const docText = (doc) => flatten(doc).map((i) => i.text).join('\n');
