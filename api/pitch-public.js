/**
 * Public side of Pitch Sites (no sign-in; the slug is the secret).
 *   GET  /p/:slug                          -> ?slug=&view=shell   the viewer page (with link-preview tags)
 *   GET  ?slug=&view=data | frame&page= | before | slots
 *   POST { action: track | book | signup, slug, ... }
 */
import { getSql, initQueueTable, initTimeOffTable, initAuthTables } from './db.js';
import { resolveIdentity } from './session.js';
import { londonDateKey, londonMidnight } from './business-time.js';
import { sendViaMailgun } from './email-send.js';
import { createOpportunityMeeting } from './apollo-sales-queue.js';
import { addLeadNote, ensurePitchTables, loadAsset, loadSiteBySlug, logPitchEvent } from '../lib/pitch-db.js';
import { renderPage } from '../lib/pitch-render.js';
import { loadPitchConfig } from '../lib/pitch-config.js';
import { shellHtml } from '../lib/pitch-shell.js';
import { buildCard, feed } from '../lib/teams.js';
import { feedOpportunityStage } from '../lib/teams-feed.js';

const SLOT_MINUTES = 30;
const BUFFER_MINUTES = 15;
const WORK_START = 9;
const WORK_END = 17;
const ID_RE = /^[a-z0-9-]{8,64}$/i;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const isExpired = (site) => !!site.expires_at && new Date(site.expires_at) < new Date();
const firstName = (n) => String(n || '').trim().split(/\s+/)[0] || '';
const val = (body, k, max = 300) => (body?.[k] == null ? '' : String(body[k]).trim().slice(0, max));

function staffBase(req) {
  const host = req.headers?.['x-forwarded-host'] || req.headers?.host || '';
  const proto = req.headers?.['x-forwarded-proto'] || (/^localhost|^127\./.test(host) ? 'http' : 'https');
  return host ? `${proto}://${host}` : (process.env.APP_URL || 'https://ghl-pillar.vercel.app');
}

async function repProfile(sql, site) {
  if (!site.owner_id) return { name: site.owner_name || 'i3MEDIA', firstName: firstName(site.owner_name) || 'us' };
  const r = (await sql`SELECT name, email, sender_title, avatar, avatar_color FROM app_users WHERE ghl_owner_id = ${site.owner_id} AND active = TRUE ORDER BY id LIMIT 1`)[0];
  const name = r?.name || site.owner_name || 'i3MEDIA';
  return {
    name, firstName: firstName(name), title: r?.sender_title || 'Digital Consultant', email: r?.email || null,
    avatar: r?.avatar || null, avatarColor: r?.avatar_color || null, phone: site.share?.repPhone || null,
  };
}

// ── Availability (London time) ──────────────────────────────────────────────
async function busyBlocks(sql, ownerId, from, to) {
  const [meetings, blocks] = await Promise.all([
    sql`SELECT scheduled_for AS start, scheduled_for + interval '30 minutes' AS "end" FROM opportunity_meetings WHERE primary_owner_id = ${ownerId} AND status = 'scheduled' AND scheduled_for > ${new Date(from.getTime() - 3600000).toISOString()}::timestamptz AND scheduled_for < ${to.toISOString()}::timestamptz`,
    sql`SELECT starts_at AS start, ends_at AS "end" FROM manual_activity_blocks WHERE owner_id = ${ownerId} AND starts_at < ${to.toISOString()}::timestamptz AND ends_at > ${from.toISOString()}::timestamptz`.catch(() => []),
  ]);
  return [...meetings, ...blocks].map((b) => ({ start: new Date(new Date(b.start).getTime() - BUFFER_MINUTES * 60000), end: new Date(new Date(b.end).getTime() + BUFFER_MINUTES * 60000) }));
}

export async function availability(sql, ownerId, { days = 14, now = new Date() } = {}) {
  await initTimeOffTable();
  const from = now;
  const to = new Date(now.getTime() + days * 86400000);
  const [busy, timeOff] = await Promise.all([
    busyBlocks(sql, ownerId, from, to),
    sql`SELECT start_date, end_date, day_part FROM rep_time_off WHERE owner_id = ${ownerId} AND canceled_at IS NULL AND end_date >= ${londonDateKey(from)} AND start_date <= ${londonDateKey(to)}`,
  ]);
  const earliest = new Date(now.getTime() + 2 * 3600000);
  const out = [];
  for (let i = 0; i < days; i += 1) {
    const key = londonDateKey(new Date(now.getTime() + i * 86400000));
    if (out.some((d) => d.date === key)) continue;
    const weekday = new Date(`${key}T12:00:00Z`).getUTCDay();
    if (weekday === 0 || weekday === 6) continue;
    const leave = timeOff.find((t) => String(t.start_date).slice(0, 10) <= key && String(t.end_date).slice(0, 10) >= key);
    if (leave && String(leave.day_part).toLowerCase() === 'full') continue;
    const dayStart = londonMidnight(key);
    const slots = [];
    for (let m = WORK_START * 60; m + SLOT_MINUTES <= WORK_END * 60; m += SLOT_MINUTES) {
      if (leave && ((leave.day_part === 'am' && m < 13 * 60) || (leave.day_part === 'pm' && m >= 13 * 60))) continue;
      const start = new Date(dayStart.getTime() + m * 60000);
      const end = new Date(start.getTime() + SLOT_MINUTES * 60000);
      if (start < earliest) continue;
      if (!busy.some((b) => start < b.end && end > b.start)) slots.push(start.toISOString());
    }
    if (slots.length) out.push({ date: key, slots });
  }
  return out;
}

// ── Notifications ───────────────────────────────────────────────────────────
async function emailRep(sql, site, subject, lines) {
  try {
    await initAuthTables();
    const r = site.owner_id ? (await sql`SELECT email, name FROM app_users WHERE ghl_owner_id = ${site.owner_id} AND active = TRUE ORDER BY id LIMIT 1`)[0] : null;
    if (!r?.email || !process.env.MAILGUN_DOMAIN) return;
    const text = lines.filter(Boolean).join('\n');
    const from = `Stream <no-reply@${process.env.MAILGUN_DOMAIN}>`;
    await sendViaMailgun({ from, to: r.email, subject, text, html: `<div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.6;color:#111827">${text.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c])).replace(/\n/g, '<br>')}</div>`, transactional: true });
  } catch { /* notifications are best-effort */ }
}

async function notifyOpen(sql, req, site, { firstEver, visits }) {
  const studio = `${staffBase(req)}/pitch-sites?id=${site.id}`;
  await feed(sql, buildCard({
    title: `👀 ${site.client_name} is looking at their pitch site`,
    text: firstEver ? 'First time they\u2019ve opened it. Great moment for a call.' : `Visit number ${visits}.`,
    facts: [['Rep', site.owner_name], ['Site', site.source_url]], url: studio, urlLabel: 'Open in Pitch Sites', tone: 'good',
  }));
  await addLeadNote(sql, site, `👀 ${site.client_name} opened their pitch site${firstEver ? ' for the first time' : ` (visit ${visits})`}.`);
  if (firstEver) {
    await emailRep(sql, site, `👀 ${site.client_name} just opened their pitch site`, [
      `${site.client_name} has just opened the pitch site you sent them.`, '', 'Now is a great time to give them a call.', '', `See their activity: ${studio}`,
    ]);
  }
}

// ── Leads ───────────────────────────────────────────────────────────────────
async function resolveLead(sql, site, { name, email, phone, company }) {
  if (site.lead_id) {
    const lead = (await sql`SELECT * FROM queue_leads WHERE id = ${site.lead_id} LIMIT 1`)[0];
    if (lead) return { lead, created: false };
  }
  // Only reuse a live lead that already belongs to this site's rep; never touch other reps' leads from a public form.
  const existing = (await sql`SELECT * FROM queue_leads WHERE lower(email) = ${email} LIMIT 1`)[0];
  if (existing && !existing.archived_at && existing.owner_id && existing.owner_id === site.owner_id) return { lead: existing, created: false };
  const [first, ...rest] = name.split(/\s+/);
  const insert = (withEmail) => sql`
    INSERT INTO queue_leads (first_name, last_name, name, email, phone, company_name, company_website, priority, status, source, owner, owner_id, call_notes, last_touch_at)
    VALUES (${first || name}, ${rest.join(' ') || null}, ${name}, ${withEmail ? email : null}, ${phone || null}, ${company || site.client_name}, ${site.source_url}, 'hot', 'to_call_back', 'Pitch Site', ${site.owner_name}, ${site.owner_id}, ${`Pitch site contact: ${name} <${email}>`}, now())
    ON CONFLICT (email) DO NOTHING
    RETURNING *`;
  // The email column is unique; if it's already on someone else's (or an archived) lead, keep the address in the notes instead.
  const rows = existing ? await insert(false) : (await insert(true)).length ? await sql`SELECT * FROM queue_leads WHERE lower(email) = ${email} LIMIT 1` : await insert(false);
  return { lead: rows[0], created: true };
}

async function rateLimited(sql, siteId) {
  const r = (await sql`SELECT COUNT(*)::int AS n FROM pitch_site_events WHERE site_id = ${siteId} AND kind IN ('booked', 'signup') AND created_at > now() - interval '1 hour'`)[0];
  return r.n >= 6;
}

export default async function handler(req, res) {
  const sql = getSql();
  try {
    await ensurePitchTables(sql);
    const isPost = req.method === 'POST';
    const body = isPost ? (req.body || {}) : {};
    const slug = String((isPost ? body.slug : req.query?.slug) || '').toLowerCase();
    if (!/^[a-z0-9-]{6,60}$/.test(slug)) return res.status(404).json({ success: false, error: 'Not found' });
    const site = await loadSiteBySlug(sql, slug);
    const staff = !!resolveIdentity(req);
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');

    if (!isPost) {
      const view = String(req.query?.view || 'data');
      if (view === 'shell') {
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.setHeader('Cache-Control', 'no-store');
        res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
        res.setHeader('X-Frame-Options', 'SAMEORIGIN');
        return res.status(site ? 200 : 404).send(shellHtml({ slug, clientName: site?.client_name || '', found: !!site }));
      }
      if (!site) return res.status(404).json({ success: false, error: 'This preview link doesn\u2019t exist' });
      const config = await loadPitchConfig(sql);
      if (view === 'data') {
        const rep = await repProfile(sql, site);
        res.setHeader('Cache-Control', 'no-store');
        return res.status(200).json({
          success: true, staff,
          client: site.client_name, sourceUrl: site.source_url,
          brand: { logo: site.brand?.logo?.url ? site.brand.logo : null, colors: site.brand?.colors || [], palette: site.design?.palette || null, fonts: site.design?.fonts || null },
          rep,
          ready: !!site.design && site.status !== 'building',
          pages: [{ key: 'home', title: 'Home' }, ...(site.pages?.secondary?.sections?.length ? [{ key: 'secondary', title: site.pages.secondary.navLabel || site.pages.secondary.title }] : [])],
          expiresAt: site.expires_at, expired: isExpired(site), unlocked: !!site.unlocked_at,
          hasBefore: !!site.audit?.hasBefore, gaps: site.brief?.gaps || [],
          scores: site.audit?.mobile ? { performance: site.audit.mobile.performance, seo: site.audit.mobile.seo, accessibility: site.audit.mobile.accessibility, lcp: site.audit.mobile.lcp } : null,
          gate: { ...config.gate, sub: config.gate.sub.replace(/\{rep\}/g, rep.firstName) },
        });
      }
      if (isExpired(site) && !staff) return res.status(410).json({ success: false, error: 'This preview has expired' });
      if (view === 'frame') {
        if (!site.design) return res.status(409).json({ success: false, error: 'Not ready yet' });
        const page = req.query?.page === 'secondary' ? 'secondary' : 'home';
        const rep = (site.owner_name || '').split(' ')[0];
        const html = renderPage({ site, page, mode: 'client', gated: !site.unlocked_at, gate: config.gate, repName: rep });
        res.setHeader('Cache-Control', 'no-store');
        return res.status(200).json({ success: true, html, unlocked: !!site.unlocked_at });
      }
      if (view === 'before') {
        const asset = await loadAsset(sql, site.id, 'before');
        if (!asset) return res.status(404).end();
        res.setHeader('Content-Type', asset.mime);
        res.setHeader('Cache-Control', 'private, max-age=3600');
        return res.status(200).send(asset.data);
      }
      if (view === 'slots') {
        if (!site.owner_id) return res.status(200).json({ success: true, days: [] });
        await initQueueTable();
        return res.status(200).json({ success: true, days: await availability(sql, site.owner_id) });
      }
      return res.status(400).json({ success: false, error: 'Unknown view' });
    }

    if (!site) return res.status(404).json({ success: false, error: 'Not found' });
    const action = String(body.action || '');

    if (action === 'track') {
      if (staff) return res.status(200).json({ success: true, staff: true });
      const visitor = String(body.visitor || '');
      const visit = String(body.visit || '');
      if (!ID_RE.test(visitor) || !ID_RE.test(visit)) return res.status(400).json({ success: false });
      const kind = String(body.kind || '');
      const page = body.page === 'secondary' ? 'secondary' : 'home';
      const value = Math.max(0, Math.min(100, Number(body.value) || 0));
      if (kind === 'open') {
        const device = String(body.device || '').slice(0, 20);
        const referrer = String(body.referrer || '').slice(0, 200);
        const inserted = await sql`
          INSERT INTO pitch_site_visits (site_id, visitor, visit_key, device, referrer) VALUES (${site.id}, ${visitor}, ${`${site.id}:${visit}`}, ${device}, ${referrer})
          ON CONFLICT (visit_key) DO NOTHING RETURNING id`;
        if (inserted[0]) {
          const recent = (await sql`SELECT COUNT(*)::int AS n FROM pitch_site_visits WHERE site_id = ${site.id} AND visitor = ${visitor} AND started_at > now() - interval '2 hours' AND visit_key <> ${`${site.id}:${visit}`}`)[0].n;
          const upd = (await sql`UPDATE pitch_sites SET view_count = view_count + 1, first_viewed_at = COALESCE(first_viewed_at, now()), last_viewed_at = now() WHERE id = ${site.id} RETURNING view_count, first_viewed_at`)[0];
          await logPitchEvent(sql, { siteId: site.id, kind: 'open', visitor, meta: { device } });
          if (!recent) await notifyOpen(sql, req, site, { firstEver: !site.first_viewed_at, visits: upd.view_count });
        }
        return res.status(200).json({ success: true });
      }
      if (kind === 'heartbeat') {
        await sql`UPDATE pitch_site_visits SET seconds = seconds + ${Math.min(30, Math.round(value))}, last_seen_at = now() WHERE visit_key = ${`${site.id}:${visit}`}`;
        await sql`UPDATE pitch_sites SET last_viewed_at = now() WHERE id = ${site.id}`;
        return res.status(200).json({ success: true });
      }
      if (kind === 'depth') {
        await sql`
          UPDATE pitch_site_visits SET max_depth = GREATEST(max_depth, ${Math.round(value)}),
            pages = jsonb_set(pages, ${[page]}::text[], to_jsonb(GREATEST(COALESCE((pages->>${page})::int, 0), ${Math.round(value)})), true), last_seen_at = now()
          WHERE visit_key = ${`${site.id}:${visit}`}`;
        return res.status(200).json({ success: true });
      }
      if (['gate', 'cta', 'nav', 'before_after'].includes(kind)) {
        const detail = String(body.detail || '').slice(0, 40);
        const dup = kind === 'gate' && (await sql`SELECT 1 FROM pitch_site_events WHERE site_id = ${site.id} AND kind = 'gate' AND visitor = ${visitor} AND meta->>'visit' = ${visit} LIMIT 1`).length;
        if (!dup) await logPitchEvent(sql, { siteId: site.id, kind, visitor, meta: { page, visit, detail } });
        return res.status(200).json({ success: true });
      }
      return res.status(400).json({ success: false });
    }

    if (action === 'book' || action === 'signup') {
      if (isExpired(site)) return res.status(410).json({ success: false, error: 'This preview has expired' });
      if (val(body, 'website')) return res.status(200).json({ success: true });
      const name = val(body, 'name', 120);
      const email = val(body, 'email', 200).toLowerCase();
      const phone = val(body, 'phone', 40);
      const company = val(body, 'company', 160) || site.client_name;
      const notes = val(body, 'notes', 1500);
      if (!name || !EMAIL_RE.test(email)) return res.status(400).json({ success: false, error: 'Please add your name and a valid email address' });
      if (action === 'signup' && !phone) return res.status(400).json({ success: false, error: 'Please add a phone number so we can get you set up' });
      if (await rateLimited(sql, site.id)) return res.status(429).json({ success: false, error: 'Please give us a moment and try again' });
      await initQueueTable();
      const studio = `${staffBase(req)}/pitch-sites?id=${site.id}`;

      if (action === 'book') {
        if (!site.owner_id) return res.status(400).json({ success: false, error: 'Online booking isn\u2019t available for this preview' });
        const slot = new Date(val(body, 'slot', 40));
        if (Number.isNaN(slot.getTime())) return res.status(400).json({ success: false, error: 'Choose a time' });
        try {
          const days = await availability(sql, site.owner_id, { days: 21 });
          if (!days.some((d) => d.slots.includes(slot.toISOString()))) return res.status(409).json({ success: false, error: 'That time has just gone. Please pick another.' });
          // Atomic claim so two people can't take the same slot at once. A stale claim with no live meeting can be reused.
          const claimed = await sql`
            INSERT INTO pitch_slot_claims (owner_id, slot) VALUES (${site.owner_id}, ${slot.toISOString()}::timestamptz)
            ON CONFLICT (owner_id, slot) DO UPDATE SET claimed_at = now()
            WHERE pitch_slot_claims.claimed_at < now() - interval '2 minutes'
              AND NOT EXISTS (SELECT 1 FROM opportunity_meetings WHERE primary_owner_id = ${site.owner_id} AND status = 'scheduled' AND scheduled_for = ${slot.toISOString()}::timestamptz)
            RETURNING owner_id`;
          if (!claimed.length) return res.status(409).json({ success: false, error: 'That time has just gone. Please pick another.' });
          const { lead, created } = await resolveLead(sql, site, { name, email, phone, company });
          const stage = String(lead.opportunity_stage || 'qualified');
          await sql`
            UPDATE queue_leads SET
              status = CASE WHEN status = 'won' THEN status ELSE 'qualified' END, qualified_at = COALESCE(qualified_at, now()), priority = 'hot',
              opportunity_stage = CASE WHEN ${['qualified', 'meeting_booked', 'meeting_no_show', 'meeting_attended'].includes(stage)} THEN 'meeting_booked' ELSE opportunity_stage END,
              phone = COALESCE(phone, ${phone || null}), last_touch_at = now(), updated_at = now()
            WHERE id = ${lead.id}`;
          const note = [`Booked from their pitch site by ${name} (${email}${phone ? `, ${phone}` : ''}).`, notes ? `They said: ${notes}` : ''].filter(Boolean).join('\n');
          const meeting = await createOpportunityMeeting(sql, {
            lead: { ...lead, status: lead.status === 'won' ? 'won' : 'qualified' }, scheduledFor: slot.toISOString(), meetingType: 'discovery', bookingChannel: 'pitch-site', notes: note,
            primaryOwnerId: site.owner_id, primaryOwnerName: site.owner_name, actorEmail: email, actorRole: 'client',
          });
          await sql`UPDATE pitch_sites SET unlocked_at = COALESCE(unlocked_at, now()), lead_id = COALESCE(lead_id, ${lead.id}), updated_at = now() WHERE id = ${site.id}`;
          const fresh = { ...site, lead_id: site.lead_id || lead.id };
          await logPitchEvent(sql, { siteId: site.id, kind: 'booked', visitor: val(body, 'visitor', 64) || null, meta: { name, email, phone, slot: slot.toISOString(), meetingId: meeting?.id || null, newLead: created } });
          await addLeadNote(sql, fresh, `📅 ${name} booked a walkthrough from their pitch site for ${slot.toLocaleString('en-GB', { timeZone: 'Europe/London', weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}.`);
          await feedOpportunityStage(sql, { lead: { name: lead.name || name, company_name: lead.company_name || company, owner: site.owner_name }, fromStage: stage, stage: 'meeting_booked', meetingAt: slot.toISOString() }).catch(() => {});
          await emailRep(sql, site, `📅 ${site.client_name} booked a walkthrough from their pitch site`, [
            `${name} from ${company} booked a 30-minute walkthrough.`, `When: ${slot.toLocaleString('en-GB', { timeZone: 'Europe/London', dateStyle: 'full', timeStyle: 'short' })}`,
            `Email: ${email}`, phone ? `Phone: ${phone}` : '', notes ? `Notes: ${notes}` : '', '', `It's in your calendar in Stream. Pitch site: ${studio}`,
          ]);
          return res.status(200).json({ success: true, scheduledFor: slot.toISOString(), rep: site.owner_name });
        } catch (error) {
          if (error?.code === '23505') return res.status(409).json({ success: false, error: 'That time has just gone. Please pick another.' });
          throw error;
        }
      }

      // Sign-up: capture details and hand to the rep (no payment taken here).
      const { lead, created } = await resolveLead(sql, site, { name, email, phone, company });
      const qualifiedAlready = ['qualified', 'won'].includes(String(lead.status));
      await sql`
        UPDATE queue_leads SET priority = 'hot',
          status = CASE WHEN ${qualifiedAlready} THEN status ELSE 'to_call_back' END,
          callback_at = CASE WHEN ${qualifiedAlready} THEN callback_at ELSE now() END,
          disposition = CASE WHEN ${qualifiedAlready} THEN disposition ELSE 'Pitch site sign-up' END,
          phone = COALESCE(phone, ${phone || null}), last_touch_at = now(), updated_at = now()
        WHERE id = ${lead.id}`;
      await sql`UPDATE pitch_sites SET unlocked_at = COALESCE(unlocked_at, now()), lead_id = COALESCE(lead_id, ${lead.id}), updated_at = now() WHERE id = ${site.id}`;
      const fresh = { ...site, lead_id: site.lead_id || lead.id };
      await logPitchEvent(sql, { siteId: site.id, kind: 'signup', visitor: val(body, 'visitor', 64) || null, meta: { name, email, phone, company, notes, newLead: created } });
      await addLeadNote(sql, fresh, `🚀 SIGN-UP REQUEST from their pitch site: ${name} (${email}, ${phone}) wants to start the £149/month website plan.${notes ? `\nThey said: ${notes}` : ''}`);
      await feed(sql, buildCard({
        title: `🚀 ${site.client_name} wants to sign up!`, text: `${name} asked to start the £149/month plan from their pitch site.`,
        facts: [['Rep', site.owner_name], ['Name', name], ['Email', email], ['Phone', phone]], url: studio, urlLabel: 'Open in Pitch Sites', tone: 'good',
      }));
      await emailRep(sql, site, `🚀 ${site.client_name} wants to sign up (£149/month)`, [
        `${name} from ${company} asked to get started from their pitch site.`, `Email: ${email}`, `Phone: ${phone}`, notes ? `Notes: ${notes}` : '', '',
        'Call them back as soon as you can to confirm and send the proposal.', `Pitch site: ${studio}`,
      ]);
      return res.status(200).json({ success: true, rep: site.owner_name });
    }

    return res.status(400).json({ success: false, error: 'Unknown action' });
  } catch (error) {
    return res.status(500).json({ success: false, error: 'Something went wrong. Please try again.', detail: process.env.VERCEL ? undefined : error.message });
  }
}

