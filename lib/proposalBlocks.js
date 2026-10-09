/** Shared proposal block helpers (used by api/proposals.js and api/proposal-public.js). */

export const BLOCK_TYPES = ['heading', 'text', 'bullets', 'divider', 'options', 'timeline', 'comparison', 'investment', 'callout', 'addons'];

export function money(value) {
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) return '—';
  return `£${num.toLocaleString('en-GB', { maximumFractionDigits: 0 })}`;
}

const longDate = (value) => new Date(value).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });

export function tokenContext(proposal) {
  return {
    client_name: proposal.client_name || 'there',
    client_company: proposal.client_company || 'your company',
    client_email: proposal.client_email || '',
    rep_name: proposal.owner_name || 'Your i3MEDIA contact',
    deal_type: proposal.deal_type || '—',
    mrr: proposal.mrr_value != null ? money(proposal.mrr_value) : '—',
    one_off: proposal.one_off_value != null ? money(proposal.one_off_value) : '—',
    date: longDate(new Date()),
    expiry_date: proposal.expires_at ? longDate(proposal.expires_at) : '—',
  };
}

export function mergeTokens(text, ctx) {
  return String(text || '').replace(/\{\{\s*([a-z_]+)\s*\}\}/gi, (match, key) => (
    ctx[key.toLowerCase()] !== undefined ? ctx[key.toLowerCase()] : match
  ));
}

function cleanSide(input, ctx) {
  const side = input && typeof input === 'object' ? input : {};
  const clean = (value, max) => {
    const text = String(value ?? '').slice(0, max);
    return ctx ? mergeTokens(text, ctx) : text;
  };
  return {
    label: clean(side.label, 120),
    name: clean(side.name, 200),
    price: clean(side.price, 120),
    desc: clean(side.desc, 2000),
  };
}

export function sanitizeBlocks(input, ctx = null) {
  if (!Array.isArray(input)) return [];
  return input.slice(0, 120).map((block) => {
    const type = BLOCK_TYPES.includes(block?.type) ? block.type : 'text';
    let text = String(block?.text || '').slice(0, 8000);
    if (ctx) text = mergeTokens(text, ctx);
    const out = { type, text };
    if (type === 'options') {
      out.data = { a: cleanSide(block?.data?.a, ctx), b: cleanSide(block?.data?.b, ctx) };
      out.recommended = ['a', 'b'].includes(block?.recommended) ? block.recommended : null;
      out.selectable = block?.selectable === true;
      out.required = block?.required !== false;
    }
    return out;
  });
}
