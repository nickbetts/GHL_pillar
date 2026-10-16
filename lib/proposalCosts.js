/** What a client signed up to, worked out the same way the client-facing proposal page does it. */

export const PAYMENT_TERMS = { upfrontPct: 50, finalPct: 50, label: '50% upfront, 50% on sign-off' };

const lines = (text) => String(text || '').split('\n').map((s) => s.trim()).filter(Boolean);
const cells = (line) => line.split('|').map((s) => s.trim());
const num = (price) => Number(String(price || '').replace(/[^0-9.]/g, '')) || 0;
const kindOf = (price) => {
  const p = String(price || '');
  if (/\b(year|yr|annual|annum)\b/i.test(p)) return 'annual';
  return /mo|month/i.test(p) ? 'monthly' : 'oneoff';
};

export function proposalCosts(proposal) {
  const blocks = Array.isArray(proposal?.blocks) ? proposal.blocks : [];
  const sel = proposal?.selection && typeof proposal.selection === 'object' ? proposal.selection : {};
  const items = [];
  const add = (name, price, extra = {}) => {
    const text = String(price || '').trim();
    items.push({ name: String(name || '').trim() || 'Item', price: text, amount: num(text), kind: kindOf(text), included: false, ...extra });
  };

  blocks.forEach((b, i) => {
    if (b?.type === 'options' && b.selectable) {
      const side = sel.options?.[String(i)];
      const picked = side && b.data?.[side];
      if (picked) add(picked.name || `Option ${String(side).toUpperCase()}`, picked.price);
    } else if (b?.type === 'addons') {
      const chosen = new Set(Array.isArray(sel.addons?.[String(i)]) ? sel.addons[String(i)] : []);
      lines(b.text).forEach((line, li) => {
        const [raw = '', price = ''] = cells(line);
        const locked = raw.startsWith('!');
        if (locked || chosen.has(li)) add(raw.replace(/^!/, ''), price, { included: locked });
      });
    }
  });

  // Fixed-price proposals have no choices to make, so their investment blocks are the price.
  const hasChoices = blocks.some((b) => b?.type === 'options' && b.selectable);
  if (!items.length && !hasChoices) {
    blocks.forEach((b) => {
      if (b?.type !== 'investment') return;
      const [label = '', price = ''] = cells(String(b.text || ''));
      if (num(price)) add(label, price);
    });
  }

  let source = 'selection';
  if (!items.length) {
    source = 'deal';
    if (Number(proposal?.one_off_value) > 0) add('One-off', `£${Number(proposal.one_off_value).toLocaleString('en-GB')}`);
    if (Number(proposal?.mrr_value) > 0) add('Monthly', `£${Number(proposal.mrr_value).toLocaleString('en-GB')} / month`);
  }

  const total = (kind) => items.filter((it) => it.kind === kind).reduce((sum, it) => sum + it.amount, 0);
  return { items, oneOff: total('oneoff'), monthly: total('monthly'), annual: total('annual'), source };
}

/** Splits the one-off cost into the upfront and sign-off payments (to the penny). */
export function paymentSchedule(costs, terms = PAYMENT_TERMS) {
  const oneOff = Number(costs?.oneOff) || 0;
  const upfront = Math.round(oneOff * terms.upfrontPct) / 100;
  return { oneOff, upfront, final: Math.round((oneOff - upfront) * 100) / 100, terms };
}
