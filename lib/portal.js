/** Client project status: the team's updates plus the payment schedule, shown on the proposal link once the contract is signed. */

import { proposalCosts, paymentSchedule } from './proposalCosts.js';

export const PORTAL_STATUSES = ['done', 'active', 'upcoming'];

export function cleanPortalUpdates(input) {
  const text = (v, n) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
  return (Array.isArray(input) ? input : []).slice(0, 30).map((u) => {
    const date = /^\d{4}-\d{2}-\d{2}/.test(String(u?.date || '')) ? String(u.date).slice(0, 10) : null;
    return { title: text(u?.title, 120), note: text(u?.note, 600), status: PORTAL_STATUSES.includes(u?.status) ? u.status : 'upcoming', date };
  }).filter((u) => u.title);
}

/** Upfront / sign-off split for the client, or null when nothing is payable up front. */
export function portalPayments(proposal) {
  let costs;
  try { costs = proposalCosts(proposal); } catch { return null; }
  const schedule = paymentSchedule(costs);
  if (!(schedule.oneOff > 0) && !(costs.monthly > 0)) return null;
  return {
    oneOff: schedule.oneOff,
    upfront: schedule.upfront,
    final: schedule.final,
    monthly: costs.monthly,
    terms: schedule.terms.label,
  };
}
