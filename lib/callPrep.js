/** AI call prep: a short brief per lead, grounded in the lead's own data and the Offerings page. */

import { OFFERINGS_BRIEF } from './offerings-brief.js';

const MODELS = () => [String(process.env.ANTHROPIC_MODEL || '').trim(), 'claude-sonnet-5', 'claude-sonnet-4-6', 'claude-3-7-sonnet-latest'].filter((v, i, a) => v && a.indexOf(v) === i);

const clip = (v, n) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n);

export function leadFacts(lead, { notes = [], calls = [] } = {}) {
  return {
    name: clip(lead.name, 80),
    title: clip(lead.title, 80),
    company: clip(lead.company_name, 100),
    website: clip(lead.company_website, 100),
    industry: clip(lead.company_industry, 80),
    sector: clip([lead.sector, lead.sub_sector].filter(Boolean).join(' / '), 100),
    employees: lead.company_employees || null,
    revenue: clip(lead.company_revenue, 30),
    source: clip(lead.source, 40),
    status: clip(lead.status, 30),
    lastDisposition: clip(lead.disposition, 80),
    nextStep: clip(lead.next_step_summary, 200),
    previousCalls: calls.slice(0, 5).map((c) => clip(c, 60)),
    notes: notes.slice(0, 5).map((n) => clip(n, 300)),
  };
}

const SYSTEM = [
  'You prepare UK B2B sales reps for a cold or warm phone call for i3MEDIA.',
  'Use ONLY the lead facts and the offerings brief provided. If something is unknown, say so; never invent facts about the lead, results, prices or client names.',
  'UK English. Plain, friendly and concise. No emojis. Do not use em dashes. Write i3MEDIA exactly like that.',
  'Reply with a single JSON object and nothing else, with exactly these keys:',
  '{"headline": string (one line on who they are and why they might care, max 140 chars),',
  '"opener": string (what the rep says in the first 10 seconds, 1 or 2 sentences, uses the first name if known),',
  '"fit": {"package": "Get Found" | "Get Leads" | "Dominate" | "Website" | "CRM" | "Unsure", "why": string (one sentence)},',
  '"questions": [3 short discovery questions],',
  '"objections": [{"they": string, "reply": string}] (max 2, replies drawn from the offerings brief),',
  '"nextStep": string (the single best next step for this call, one sentence),',
  '"watchOuts": [string] (max 2, e.g. what was said last time, or missing info)}',
].join('\n');

/** Deterministic brief used when no AI key is set or the AI call fails. */
export function templateBrief(facts) {
  const given = String(facts.name || '').split(/\s+/)[0];
  const first = given && !given.includes('*') ? given : 'there';
  const known = [facts.title, facts.company].filter(Boolean).join(' at ');
  return {
    headline: known ? `${known}${facts.sector ? `, ${facts.sector}` : ''}` : (facts.company || 'No company details recorded'),
    opener: `Hi ${first}, it's calling from i3MEDIA. Most businesses we help have one of two problems: they can't be found online, or they're not getting enough enquiries. Which one sounds like you?`,
    fit: { package: 'Get Leads', why: 'The package we steer most businesses to; confirm with the one question before pitching.' },
    questions: [
      'If you could fix one thing about your marketing tomorrow, what would it be?',
      'Where do most of your enquiries come from today?',
      'What is a new customer worth to you?',
    ],
    objections: [{ they: "That's more than we wanted to spend.", reply: 'Get Found at £795 a month gets the website and search right first, and everything carries into Get Leads when you are ready.' }],
    nextStep: facts.nextStep || 'Book a short meeting to show what the first 30 days would look like.',
    watchOuts: [facts.lastDisposition ? `Last outcome: ${facts.lastDisposition}.` : '', facts.notes[0] ? `Latest note: ${facts.notes[0]}` : ''].filter(Boolean).slice(0, 2),
  };
}

function parseBrief(text) {
  const start = text.indexOf('{'); const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  let raw;
  try { raw = JSON.parse(text.slice(start, end + 1)); } catch { return null; }
  const str = (v, n) => clip(v, n);
  const list = (v, n, m) => (Array.isArray(v) ? v.map((x) => str(x, m)).filter(Boolean).slice(0, n) : []);
  const packages = ['Get Found', 'Get Leads', 'Dominate', 'Website', 'CRM', 'Unsure'];
  const brief = {
    headline: str(raw.headline, 160),
    opener: str(raw.opener, 400),
    fit: { package: packages.includes(raw?.fit?.package) ? raw.fit.package : 'Unsure', why: str(raw?.fit?.why, 240) },
    questions: list(raw.questions, 3, 200),
    objections: (Array.isArray(raw.objections) ? raw.objections : []).slice(0, 2).map((o) => ({ they: str(o?.they, 160), reply: str(o?.reply, 320) })).filter((o) => o.they && o.reply),
    nextStep: str(raw.nextStep, 240),
    watchOuts: list(raw.watchOuts, 2, 220),
  };
  return brief.opener && brief.questions.length ? brief : null;
}

export async function generateCallPrep(facts) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { brief: templateBrief(facts), source: 'template' };
  const baseUrl = (process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com').replace(/\/$/, '');
  const user = `OFFERINGS BRIEF\n${OFFERINGS_BRIEF}\n\nLEAD FACTS (JSON)\n${JSON.stringify(facts)}\n\nPrepare the rep for the call. JSON only.`;
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
        const brief = parseBrief(text);
        return brief ? { brief, source: 'ai', model } : { brief: templateBrief(facts), source: 'template' };
      }
      if (!String(payload?.error?.message || '').toLowerCase().includes('model')) break;
    } catch { break; }
  }
  return { brief: templateBrief(facts), source: 'template' };
}
