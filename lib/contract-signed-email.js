/** "A client just signed" email for the team and finance. Stream branded, table-based so it renders in any mail client. */

import { proposalCosts, paymentSchedule } from './proposalCosts.js';

const DEFAULT_TEAM = ['nick.betts@i3media.net', 'azeem@i3media.net'];
const DEFAULT_FINANCE = 'finance@i3media.net';
const BLUE = '#4463FF';
const INK = '#0B0B0F';
const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

const looksLikeEmail = (v) => /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/.test(String(v || '').trim());
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = (n) => {
  const v = Number(n) || 0;
  return `£${v.toLocaleString('en-GB', Number.isInteger(v) ? {} : { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};
const whenText = (iso) => new Date(iso || Date.now()).toLocaleString('en-GB', {
  timeZone: 'Europe/London', day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit',
});
const splitList = (v) => String(v || '').split(/[,;\s]+/).filter(Boolean);

/** Nick, Az, the deal's rep and finance, de-duplicated. Env vars override the defaults. */
export function contractSignedRecipients(repEmail, env = process.env) {
  const team = env.CONTRACT_SIGNED_TEAM_EMAILS ? splitList(env.CONTRACT_SIGNED_TEAM_EMAILS) : DEFAULT_TEAM;
  const finance = env.CONTRACT_SIGNED_FINANCE_EMAIL ? splitList(env.CONTRACT_SIGNED_FINANCE_EMAIL) : [DEFAULT_FINANCE];
  const seen = new Set();
  return [...team, repEmail, ...finance]
    .map((e) => String(e || '').trim().toLowerCase())
    .filter((e) => looksLikeEmail(e) && !seen.has(e) && seen.add(e));
}

function safeOrigin(origin) {
  try {
    const u = new URL(origin);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.origin : 'https://click.i3media.net';
  } catch { return 'https://click.i3media.net'; }
}

export function buildContractSignedEmail({ proposal, repName, signerName, signedAt, origin }) {
  const base = safeOrigin(origin);
  const costs = proposalCosts(proposal);
  const pay = paymentSchedule(costs);
  const company = proposal.client_company || proposal.client_name || 'A client';
  const signer = signerName || proposal.client_name || 'The client';
  const rep = repName || proposal.owner_name || 'Unassigned';
  const repFirst = String(rep).trim().split(/\s+/)[0] || 'The rep';
  const signedOn = whenText(signedAt);
  const ref = `PROP-${proposal.id}`;
  const stageText = proposal.skip_onboarding ? 'Complete. No onboarding form on this deal.' : 'Waiting on the client\u2019s onboarding form.';
  const open = `${base}/proposal-hub`;
  const headline = [costs.oneOff ? `${money(costs.oneOff)} one-off` : '', costs.monthly ? `${money(costs.monthly)}/mo` : '', costs.annual ? `${money(costs.annual)}/yr` : ''].filter(Boolean).join(' + ');
  const subject = `Contract signed: ${company}${headline ? ` \u00b7 ${headline}` : ''}`;

  const tile = (label, value, sub) => `<td width="33%" valign="top" style="padding:0 5px"><div style="background:#F6F6F3;border-radius:14px;padding:14px 16px"><div style="font-size:11px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:#6D6D78">${esc(label)}</div><div style="margin-top:6px;font-size:23px;line-height:1.15;font-weight:700;letter-spacing:-.02em;color:${INK}">${esc(value)}</div><div style="margin-top:3px;font-size:12px;color:#6D6D78">${esc(sub)}</div></div></td>`;
  const tiles = [
    tile('One-off', costs.oneOff ? money(costs.oneOff) : '\u2014', costs.oneOff ? 'ex. VAT' : 'No build cost'),
    tile('Monthly', costs.monthly ? `${money(costs.monthly)}/mo` : '\u2014', costs.monthly ? 'ex. VAT' : 'No retainer'),
    costs.annual ? tile('Annual', `${money(costs.annual)}/yr`, 'ex. VAT') : tile('Status', 'Signed', 'Contract complete'),
  ].join('');

  const detail = (label, value) => `<tr><td style="padding:11px 0;border-bottom:1px solid #E7E7E2;font-size:13px;color:#6D6D78;width:120px" valign="top">${esc(label)}</td><td style="padding:11px 0;border-bottom:1px solid #E7E7E2;font-size:14px;color:${INK};font-weight:500" valign="top">${value}</td></tr>`;
  const sub = (s) => `<div style="margin-top:2px;font-size:12px;font-weight:400;color:#6D6D78">${esc(s)}</div>`;
  const details = [
    detail('Client', `${esc(company)}${sub([proposal.client_name, proposal.client_email].filter(Boolean).join(' \u00b7 '))}`),
    detail('Proposal', `${esc(proposal.title)}${sub(ref)}`),
    detail('Sales rep', esc(rep)),
    detail('Signed by', `${esc(signer)}${sub(signedOn)}`),
    detail('Onboarding', esc(stageText)),
  ].join('');

  const costRows = costs.items.length ? costs.items.map((it) => `<tr><td style="padding:11px 0;border-bottom:1px solid #E7E7E2;font-size:14px;color:${INK}" valign="top">${esc(it.name)}${it.included ? '<span style="display:inline-block;margin-left:8px;padding:2px 8px;border-radius:999px;background:#EEF1FF;color:#3149E8;font-size:10.5px;font-weight:700;letter-spacing:.04em;text-transform:uppercase">Included</span>' : ''}</td><td align="right" style="padding:11px 0;border-bottom:1px solid #E7E7E2;font-size:14px;font-weight:600;color:${INK};white-space:nowrap" valign="top">${esc(it.price || '\u2014')}</td></tr>`).join('')
    : `<tr><td colspan="2" style="padding:12px 0;font-size:14px;color:#B45309">No pricing was found on this proposal. Check it in Stream before invoicing.</td></tr>`;

  const payBox = pay.oneOff > 0
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
        <td width="50%" valign="top" style="padding-right:5px"><div style="background:#1B1D29;border-radius:12px;padding:14px 16px"><div style="font-size:12px;color:#B8C2FF;font-weight:600">${pay.terms.upfrontPct}% upfront</div><div style="margin-top:4px;font-size:22px;font-weight:700;color:#ffffff;letter-spacing:-.02em">${esc(money(pay.upfront))}</div><div style="margin-top:2px;font-size:12px;color:#9A9AA5">Invoice now</div></div></td>
        <td width="50%" valign="top" style="padding-left:5px"><div style="background:#1B1D29;border-radius:12px;padding:14px 16px"><div style="font-size:12px;color:#B8C2FF;font-weight:600">${pay.terms.finalPct}% on sign-off</div><div style="margin-top:4px;font-size:22px;font-weight:700;color:#ffffff;letter-spacing:-.02em">${esc(money(pay.final))}</div><div style="margin-top:2px;font-size:12px;color:#9A9AA5">When the work is signed off</div></div></td>
      </tr></table>`
    : '<div style="font-size:14px;line-height:1.6;color:#D6D9E8">There is no one-off cost on this deal, so nothing to split. Recurring fees follow the contract.</div>';

  const html = `<div style="background:#F6F6F3;padding:32px 16px;font-family:${FONT};-webkit-font-smoothing:antialiased">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent">${esc(company)} signed${headline ? `: ${esc(headline)}` : ''}. ${esc(pay.terms.label)}.</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;margin:0 auto"><tr><td style="background:#ffffff;border:1px solid #E7E7E2;border-radius:20px;overflow:hidden">
  <div style="height:6px;background:${BLUE}"></div>
  <div style="padding:26px 32px 0"><img src="${esc(base)}/brand/stream-logo-email.png" width="130" height="29" alt="Stream" style="display:block;border:0;height:29px;width:130px" /></div>
  <div style="padding:24px 32px 6px">
    <span style="display:inline-block;background:#EEF1FF;color:#3149E8;font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;padding:5px 11px;border-radius:999px">Contract signed</span>
    <h1 style="margin:14px 0 8px;font-size:28px;line-height:1.2;letter-spacing:-.025em;color:${INK};font-weight:700">${esc(company)} just signed.</h1>
    <p style="margin:0;font-size:15px;line-height:1.65;color:#3A3A44">${esc(signer)} signed the contract for <b style="color:${INK}">${esc(proposal.title)}</b> on ${esc(signedOn)}. ${esc(repFirst)} owns this deal.</p>
  </div>
  <div style="padding:20px 27px 4px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>${tiles}</tr></table></div>
  <div style="padding:14px 32px 0"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-family:${FONT}">${details}</table></div>
  <div style="padding:26px 32px 0">
    <div style="font-size:12px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:#6D6D78;margin-bottom:2px">What they signed up to</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-family:${FONT}">${costRows}</table>
    <div style="margin-top:10px;font-size:12px;color:#6D6D78">All prices exclude VAT.</div>
  </div>
  <div style="padding:22px 32px 0"><div style="background:${INK};border-radius:16px;padding:20px 20px 18px">
    <div style="font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#8FA1FF">Payment terms</div>
    <div style="margin:6px 0 14px;font-size:21px;line-height:1.25;font-weight:700;letter-spacing:-.02em;color:#ffffff">${esc(pay.terms.label)}</div>
    ${payBox}
    ${costs.monthly || costs.annual ? '<div style="margin-top:12px;font-size:12px;line-height:1.55;color:#9A9AA5">The split applies to the one-off cost. Recurring fees are billed as set out in the contract.</div>' : ''}
  </div></div>
  <div style="padding:24px 32px 30px"><a href="${esc(open)}" style="display:inline-block;background:${BLUE};color:#ffffff;padding:13px 26px;border-radius:999px;font-size:14px;font-weight:600;text-decoration:none">Open in Stream &rarr;</a>
    <p style="margin:18px 0 0;font-size:12.5px;line-height:1.6;color:#6D6D78">Finance: please raise the upfront invoice.</p>
  </div>
</td></tr></table>
<p style="max-width:600px;margin:14px auto 0;font-size:11px;color:#9A9AA5;text-align:center">Sent by Stream for i3MEDIA Ltd \u00b7 Peterborough</p>
</div>`;

  const textLines = [
    `Contract signed: ${company}`,
    '',
    `${signer} signed the contract for ${proposal.title} on ${signedOn}.`,
    `Sales rep: ${rep}`,
    `Client: ${[proposal.client_name, proposal.client_email].filter(Boolean).join(', ')}`,
    `Reference: ${ref}`,
    `Onboarding: ${stageText}`,
    '',
    'What they signed up to (prices exclude VAT):',
    ...(costs.items.length ? costs.items.map((it) => `- ${it.name}${it.included ? ' (included)' : ''}: ${it.price || '-'}`) : ['- No pricing found on this proposal. Check it in Stream before invoicing.']),
    '',
    costs.oneOff ? `One-off total: ${money(costs.oneOff)}` : 'One-off total: none',
    costs.monthly ? `Monthly total: ${money(costs.monthly)}/mo` : '',
    costs.annual ? `Annual total: ${money(costs.annual)}/yr` : '',
    '',
    `Payment terms: ${pay.terms.label}`,
    pay.oneOff > 0 ? `- ${pay.terms.upfrontPct}% upfront: ${money(pay.upfront)} (invoice now)\n- ${pay.terms.finalPct}% on sign-off: ${money(pay.final)}` : '- No one-off cost to split.',
    '',
    `Open in Stream: ${open}`,
  ].filter((l, i, a) => l !== '' || a[i - 1] !== '');
  return { subject, html, text: textLines.join('\n') };
}
