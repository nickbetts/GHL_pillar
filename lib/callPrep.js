/**
 * AI call prep. The AI writes one playbook per sector (fit, questions, objections), saved for good;
 * each lead's brief is then composed locally from that playbook plus the lead's own details, so no AI call per lead.
 */

import { OFFERINGS_BRIEF } from './offerings-brief.js';

const MODELS = () => [String(process.env.ANTHROPIC_MODEL || '').trim(), 'claude-sonnet-5', 'claude-sonnet-4-6', 'claude-3-7-sonnet-latest'].filter((v, i, a) => v && a.indexOf(v) === i);

const clip = (v, n) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n);

export function leadFacts(lead, { notes = [], calls = [] } = {}) {
  return {
    name: clip(lead.name, 80),
    title: clip(lead.title, 80),
    company: clip(lead.company_name, 100),
    industry: clip(lead.company_industry, 80),
    sector: clip(lead.sector, 80),
    subSector: clip(lead.sub_sector, 80),
    employees: lead.company_employees || null,
    status: clip(lead.status, 30),
    lastDisposition: clip(lead.disposition, 80),
    nextStep: clip(lead.next_step_summary, 200),
    previousCalls: calls.slice(0, 5).map((c) => clip(c, 60)),
    notes: notes.slice(0, 5).map((n) => clip(n, 300)),
  };
}

/** One playbook per sector and sub-sector; leads with neither share a general one. */
export function sectorKey(facts) {
  const key = [facts.sector, facts.subSector].map((s) => String(s || '').toLowerCase().trim()).filter(Boolean).join(' / ');
  return key || 'general';
}

const SYSTEM = [
  'You write a reusable phone-call playbook for i3MEDIA reps who call UK businesses in one sector.',
  'Use ONLY the offerings brief and the sector given. Describe what businesses in this sector typically care about in general terms; never invent statistics, results, prices, client names or facts about any specific company.',
  'UK English. Plain, friendly and concise. No emojis. Do not use em dashes. Write i3MEDIA exactly like that.',
  'Reply with a single JSON object and nothing else, with exactly these keys:',
  '{"angle": string (one sentence on why online visibility or enquiries matter to this kind of business, max 160 chars),',
  '"opener": string (what the rep says in the first 10 seconds, 1 or 2 sentences, written for this sector, starting with "Hi {first_name},"),',
  '"fit": {"package": "Get Found" | "Get Leads" | "Dominate" | "Website" | "CRM" | "Unsure", "why": string (one sentence)},',
  '"questions": [3 short discovery questions suited to this sector],',
  '"objections": [{"they": string, "reply": string}] (max 2 likely objections in this sector, replies drawn from the offerings brief),',
  '"nextStep": string (the single best next step for a first call, one sentence)}',
].join('\n');

export function templatePlaybook() {
  return {
    angle: '',
    opener: "Hi {first_name}, it's calling from i3MEDIA. Most businesses we help have one of two problems: they can't be found online, or they're not getting enough enquiries. Which one sounds like you?",
    fit: { package: 'Get Leads', why: 'The package we steer most businesses to; confirm with the one question before pitching.' },
    questions: [
      'If you could fix one thing about your marketing tomorrow, what would it be?',
      'Where do most of your enquiries come from today?',
      'What is a new customer worth to you?',
    ],
    objections: [{ they: "That's more than we wanted to spend.", reply: 'Get Found at £795 a month gets the website and search right first, and everything carries into Get Leads when you are ready.' }],
    nextStep: 'Book a short meeting to show what the first 30 days would look like.',
  };
}

/** Lead-specific brief built from the sector playbook; no AI involved. */
export function composeBrief(playbook, facts) {
  const given = String(facts.name || '').split(/\s+/)[0];
  const first = given && !given.includes('*') ? given : 'there';
  const who = [facts.title, facts.company].filter(Boolean).join(' at ');
  const size = facts.employees ? `${facts.employees} staff` : '';
  const headline = [who, size].filter(Boolean).join(', ') || facts.company || 'No company details recorded';
  return {
    headline,
    angle: playbook.angle || '',
    opener: String(playbook.opener || '').replace(/\{first_name\}/g, first),
    fit: playbook.fit,
    questions: playbook.questions,
    objections: playbook.objections,
    nextStep: facts.nextStep || playbook.nextStep,
    watchOuts: [
      facts.lastDisposition ? `Last outcome: ${facts.lastDisposition}.` : '',
      facts.previousCalls.length > 1 ? `${facts.previousCalls.length} calls so far, latest: ${facts.previousCalls[0]}.` : '',
      facts.notes[0] ? `Latest note: ${facts.notes[0]}` : '',
    ].filter(Boolean).slice(0, 2),
  };
}

export const templateBrief = (facts) => composeBrief(templatePlaybook(), facts);

function parsePlaybook(text) {
  const start = text.indexOf('{'); const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  let raw;
  try { raw = JSON.parse(text.slice(start, end + 1)); } catch { return null; }
  const packages = ['Get Found', 'Get Leads', 'Dominate', 'Website', 'CRM', 'Unsure'];
  const playbook = {
    angle: clip(raw.angle, 200),
    opener: clip(raw.opener, 400),
    fit: { package: packages.includes(raw?.fit?.package) ? raw.fit.package : 'Unsure', why: clip(raw?.fit?.why, 240) },
    questions: (Array.isArray(raw.questions) ? raw.questions : []).map((q) => clip(q, 200)).filter(Boolean).slice(0, 3),
    objections: (Array.isArray(raw.objections) ? raw.objections : []).slice(0, 2).map((o) => ({ they: clip(o?.they, 160), reply: clip(o?.reply, 320) })).filter((o) => o.they && o.reply),
    nextStep: clip(raw.nextStep, 240),
  };
  return playbook.opener.includes('{first_name}') && playbook.questions.length ? playbook : null;
}

/** Returns { playbook, source: 'ai' | 'template' }. Only 'ai' results are worth saving. */
export async function generateSectorPlaybook(facts) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { playbook: templatePlaybook(), source: 'template' };
  const baseUrl = (process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com').replace(/\/$/, '');
  const sector = { sector: facts.sector || null, subSector: facts.subSector || null, industryExample: facts.industry || null };
  const user = `OFFERINGS BRIEF\n${OFFERINGS_BRIEF}\n\nSECTOR (JSON)\n${JSON.stringify(sector)}\n\nWrite the playbook. JSON only.`;
  for (const model of MODELS()) {
    try {
      const response = await fetch(`${baseUrl}/v1/messages`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model, max_tokens: 700, temperature: 0.3, system: SYSTEM, messages: [{ role: 'user', content: [{ type: 'text', text: user }] }] }),
        signal: AbortSignal.timeout(25000),
      });
      const payload = await response.json().catch(() => null);
      if (response.ok) {
        const text = Array.isArray(payload?.content) ? payload.content.filter((c) => c?.type === 'text').map((c) => c.text).join('\n') : '';
        const playbook = parsePlaybook(text);
        return playbook ? { playbook, source: 'ai', model } : { playbook: templatePlaybook(), source: 'template' };
      }
      if (!String(payload?.error?.message || '').toLowerCase().includes('model')) break;
    } catch { break; }
  }
  return { playbook: templatePlaybook(), source: 'template' };
}
