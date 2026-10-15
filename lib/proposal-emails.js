/** Transactional stage emails for the proposal flow. Best-effort: callers should
 *  never let a failed email block the client journey. */

import { sendViaMailgun } from '../api/email-send.js';

const COPY = {
  contract_ready: {
    subject: (t) => `Your contract is ready: ${t}`,
    heading: 'Your contract is ready to sign',
    body: (p) => `Great news. Following your acceptance of ${p.title}, your contract is ready on your proposal link.\n\nIt includes your selection (${p.selection || 'as per the proposal'}) and the small print. Signing takes about ten seconds.`,
    cta: 'Review & sign the contract',
  },
  contract_signed: {
    subject: () => 'Contract signed. One last step',
    heading: 'Contract signed. One last step.',
    body: (p) => `Thanks ${p.name}, the contract for ${p.title} is signed and your project is officially on.\n\nBefore the studio starts, there is one short onboarding form on the same link. It takes a couple of minutes and tells the team exactly what you need.`,
    cta: 'Complete the onboarding form',
  },
  contract_signed_final: {
    subject: () => 'Contract signed. You are all set',
    heading: 'Contract signed. You are all set.',
    body: (p) => `Thanks ${p.name}, the contract for ${p.title} is signed and your project is officially on.\n\nThere is nothing else you need to do right now. Your kick-off call is next, and your documents remain available on your proposal link.`,
    cta: 'View your documents',
  },
  onboarding_done: {
    subject: () => 'You are all set',
    heading: 'You are all set',
    body: (p) => `That is everything, ${p.name}. Your answers are with the studio and your kick-off call is next.\n\nYour documents remain available on your proposal link if you ever need them.`,
    cta: 'View your documents',
  },
};

function htmlFor({ heading, body, cta, link }) {
  return `<div style="font-family:Arial,sans-serif;background:#f6f3eb;padding:32px 16px">
  <div style="max-width:520px;margin:0 auto;background:#ffffff;border-radius:16px;padding:32px 30px">
    <div style="font-size:17px;font-weight:700;color:#111111">i3<span style="opacity:.45">MEDIA</span></div>
    <h1 style="font-family:Georgia,serif;font-size:26px;line-height:1.2;color:#111111;margin:18px 0 10px">${heading}</h1>
    <p style="font-size:14px;line-height:1.7;color:#374151;white-space:pre-wrap">${body}</p>
    <a href="${link}" style="display:inline-block;margin-top:18px;background:#111111;color:#ecff95;padding:13px 26px;border-radius:999px;font-size:14px;font-weight:600;text-decoration:none">${cta} →</a>
    <p style="margin-top:22px;font-size:12px;color:#6b7280">Open it with the email address this was sent to and the password you were given.</p>
  </div>
  <p style="max-width:520px;margin:14px auto 0;font-size:11px;color:#9ca3af">i3MEDIA Ltd · Peterborough</p>
</div>`;
}

const escText = (s) => String(s ?? '');

export async function sendProposalStageEmail({ type, to, toName, repName, repEmail, title, link, selection }) {
  if (!process.env.MAILGUN_API_KEY || !process.env.MAILGUN_DOMAIN) return { sent: false, reason: 'not configured' };
  const copy = COPY[type];
  if (!copy) return { sent: false, reason: 'unknown type' };
  const name = escText(toName).split(/\s+/)[0] || 'there';
  const text = `${copy.heading}\n\n${copy.body({ title, name, selection })}\n\n${link}\n\nOpen it with the email address this was sent to and the password you were given.`;
  const html = htmlFor({
    heading: copy.heading,
    body: copy.body({ title, name, selection }).replace(/</g, '&lt;'),
    cta: copy.cta,
    link,
  });
  const from = repEmail
    ? `${escText(repName)} via i3MEDIA <${repEmail}>`
    : `i3MEDIA <proposals@${process.env.MAILGUN_DOMAIN}>`;
  const data = await sendViaMailgun({ from, to, subject: copy.subject(title), text, html, replyTo: repEmail || undefined });
  return { sent: true, id: data?.id || null };
}
