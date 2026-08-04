import { getSql } from './db.js';
import { resolveIdentity, hasMinRole } from './session.js';

async function ensureOpportunityColumns(sql) {
  await sql`ALTER TABLE queue_leads ADD COLUMN IF NOT EXISTS opportunity_stage TEXT`;
  await sql`ALTER TABLE queue_leads ADD COLUMN IF NOT EXISTS mrr_value NUMERIC(12,2)`;
  await sql`ALTER TABLE queue_leads ADD COLUMN IF NOT EXISTS one_off_value NUMERIC(12,2)`;
  await sql`ALTER TABLE queue_leads ADD COLUMN IF NOT EXISTS deal_type TEXT`;
  await sql`ALTER TABLE queue_leads ADD COLUMN IF NOT EXISTS next_step_summary TEXT`;
  await sql`ALTER TABLE queue_leads ADD COLUMN IF NOT EXISTS loss_reason TEXT`;
  await sql`ALTER TABLE queue_leads ADD COLUMN IF NOT EXISTS qualified_at TIMESTAMPTZ`;
  await sql`ALTER TABLE queue_leads ADD COLUMN IF NOT EXISTS meeting_attended_at TIMESTAMPTZ`;
  await sql`ALTER TABLE queue_leads ADD COLUMN IF NOT EXISTS scoping_at TIMESTAMPTZ`;
  await sql`ALTER TABLE queue_leads ADD COLUMN IF NOT EXISTS proposal_at TIMESTAMPTZ`;
  await sql`ALTER TABLE queue_leads ADD COLUMN IF NOT EXISTS won_at TIMESTAMPTZ`;
  await sql`ALTER TABLE queue_leads ADD COLUMN IF NOT EXISTS lost_at TIMESTAMPTZ`;
  await sql`ALTER TABLE queue_leads ADD COLUMN IF NOT EXISTS proposal_sent_at TIMESTAMPTZ`;
  await sql`ALTER TABLE queue_leads ADD COLUMN IF NOT EXISTS decision_deadline_at TIMESTAMPTZ`;
}

export default async function handler(req, res) {
  const identity = resolveIdentity(req);
  if (!identity) return res.status(401).json({ success: false, error: 'Not signed in' });
  if (!hasMinRole(identity, 'admin')) {
    return res.status(403).json({ success: false, error: 'Reports are available to admins only' });
  }
  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  let sql;
  try {
    sql = getSql();
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }

  try {
    await ensureOpportunityColumns(sql);
    const ownerId = req.query?.ownerId || null;

    const rows = await sql`
      SELECT
        id,
        owner,
        owner_id,
        sector,
        opportunity_stage,
        mrr_value,
        one_off_value,
        loss_reason,
        callback_at,
        qualified_at,
        meeting_attended_at,
        scoping_at,
        proposal_at,
        won_at,
        lost_at,
        proposal_sent_at,
        decision_deadline_at
      FROM queue_leads
      WHERE archived_at IS NULL
        AND status = 'qualified'
        AND opportunity_stage IS NOT NULL
        AND (${ownerId}::text IS NULL OR owner_id = ${ownerId})
    `;

    const stageTimestamp = (row) => {
      if (row.opportunity_stage === 'qualified') return row.qualified_at;
      if (row.opportunity_stage === 'meeting_attended') return row.meeting_attended_at || row.qualified_at;
      if (row.opportunity_stage === 'scoping') return row.scoping_at;
      if (row.opportunity_stage === 'proposal') return row.proposal_at;
      if (row.opportunity_stage === 'won') return row.won_at;
      if (row.opportunity_stage === 'lost') return row.lost_at;
      return row.qualified_at;
    };
    const daysBetween = (iso) => {
      if (!iso) return null;
      const ts = new Date(iso).getTime();
      if (Number.isNaN(ts)) return null;
      return (Date.now() - ts) / 86400000;
    };

    const summary = rows.reduce((acc, row) => {
      const mrr = Number(row.mrr_value || 0);
      const oneOff = Number(row.one_off_value || 0);
      const callbackTs = row.callback_at ? new Date(row.callback_at).getTime() : NaN;
      const start = new Date();
      start.setHours(0, 0, 0, 0);
      const end = new Date();
      end.setHours(23, 59, 59, 999);
      acc.total_count += 1;
      acc.total_mrr += mrr;
      acc.total_one_off += oneOff;
      const stageAge = daysBetween(stageTimestamp(row));
      if (stageAge != null) {
        acc._ageSum += stageAge;
        acc._ageCount += 1;
      }
      if (!Number.isNaN(callbackTs)) {
        if (callbackTs < start.getTime()) acc.overdue += 1;
        else if (callbackTs <= end.getTime()) acc.due_today += 1;
      }
      return acc;
    }, { total_count: 0, total_mrr: 0, total_one_off: 0, due_today: 0, overdue: 0, _ageSum: 0, _ageCount: 0 });
    summary.avg_stage_age_days = summary._ageCount ? summary._ageSum / summary._ageCount : null;
    delete summary._ageSum;
    delete summary._ageCount;

    const groupBy = (keyFn, seedFn, reducer) => {
      const map = new Map();
      for (const row of rows) {
        const key = keyFn(row);
        if (!map.has(key)) map.set(key, seedFn(row));
        reducer(map.get(key), row);
      }
      return Array.from(map.values());
    };

    const byStage = groupBy(
      (row) => row.opportunity_stage || 'unknown',
      (row) => ({ stage: row.opportunity_stage || 'unknown', count: 0, total_mrr: 0, total_one_off: 0, _ageSum: 0, _ageCount: 0 }),
      (acc, row) => {
        acc.count += 1;
        acc.total_mrr += Number(row.mrr_value || 0);
        acc.total_one_off += Number(row.one_off_value || 0);
        const age = daysBetween(stageTimestamp(row));
        if (age != null) { acc._ageSum += age; acc._ageCount += 1; }
      }
    ).map((row) => ({
      stage: row.stage,
      count: row.count,
      total_mrr: row.total_mrr,
      total_one_off: row.total_one_off,
      avg_age_days: row._ageCount ? row._ageSum / row._ageCount : null,
    })).sort((a, b) => String(a.stage).localeCompare(String(b.stage)));

    const byOwner = groupBy(
      (row) => `${row.owner_id || ''}:${row.owner || 'Unassigned'}`,
      (row) => ({ owner: row.owner || 'Unassigned', owner_id: row.owner_id || '', count: 0, total_mrr: 0, total_one_off: 0, won_count: 0, lost_count: 0, _ageSum: 0, _ageCount: 0 }),
      (acc, row) => {
        acc.count += 1;
        acc.total_mrr += Number(row.mrr_value || 0);
        acc.total_one_off += Number(row.one_off_value || 0);
        if (row.opportunity_stage === 'won') acc.won_count += 1;
        if (row.opportunity_stage === 'lost') acc.lost_count += 1;
        const age = daysBetween(stageTimestamp(row));
        if (age != null) { acc._ageSum += age; acc._ageCount += 1; }
      }
    ).map((row) => ({
      owner: row.owner,
      owner_id: row.owner_id,
      count: row.count,
      total_mrr: row.total_mrr,
      total_one_off: row.total_one_off,
      won_count: row.won_count,
      lost_count: row.lost_count,
      win_rate: (row.won_count + row.lost_count) > 0 ? (row.won_count / (row.won_count + row.lost_count)) * 100 : 0,
      avg_age_days: row._ageCount ? row._ageSum / row._ageCount : null,
    })).sort((a, b) => b.total_mrr - a.total_mrr || b.total_one_off - a.total_one_off || a.owner.localeCompare(b.owner));

    const lossReasons = groupBy(
      (row) => row.loss_reason || 'Unknown',
      (row) => ({ reason: row.loss_reason || 'Unknown', count: 0, total_value: 0 }),
      (acc, row) => {
        if (row.opportunity_stage !== 'lost') return;
        acc.count += 1;
        acc.total_value += Number(row.mrr_value || 0) + Number(row.one_off_value || 0);
      }
    ).filter((row) => row.count > 0).sort((a, b) => b.count - a.count || b.total_value - a.total_value || a.reason.localeCompare(b.reason));

    // ── Stage-reached funnel + step conversion + win rate ────────────────
    const reached = { qualified: 0, meeting_attended: 0, scoping: 0, proposal: 0, won: 0, lost: 0 };
    for (const row of rows) {
      reached.qualified += 1;
      if (row.meeting_attended_at) reached.meeting_attended += 1;
      if (row.scoping_at) reached.scoping += 1;
      if (row.proposal_at) reached.proposal += 1;
      if (row.won_at) reached.won += 1;
      if (row.lost_at) reached.lost += 1;
    }
    const rate = (num, den) => (den > 0 ? (num / den) * 100 : 0);
    const funnel = {
      reached,
      conversion: {
        qualified_to_meeting: rate(reached.meeting_attended, reached.qualified),
        meeting_to_scoping: rate(reached.scoping, reached.meeting_attended),
        scoping_to_proposal: rate(reached.proposal, reached.scoping),
        proposal_to_won: rate(reached.won, reached.proposal),
        qualified_to_won: rate(reached.won, reached.qualified),
      },
      win_rate: rate(reached.won, reached.won + reached.lost),
    };

    // ── Velocity: average days between consecutive stage timestamps ──────
    const between = (aIso, bIso) => {
      if (!aIso || !bIso) return null;
      const a = new Date(aIso).getTime();
      const b = new Date(bIso).getTime();
      if (Number.isNaN(a) || Number.isNaN(b) || b < a) return null;
      return (b - a) / 86400000;
    };
    const avgOf = (arr) => (arr.length ? arr.reduce((s, n) => s + n, 0) / arr.length : null);
    const vel = { qm: [], ms: [], sp: [], pw: [], qw: [] };
    for (const row of rows) {
      const qm = between(row.qualified_at, row.meeting_attended_at); if (qm != null) vel.qm.push(qm);
      const ms = between(row.meeting_attended_at, row.scoping_at); if (ms != null) vel.ms.push(ms);
      const sp = between(row.scoping_at, row.proposal_at); if (sp != null) vel.sp.push(sp);
      const pw = between(row.proposal_at, row.won_at); if (pw != null) vel.pw.push(pw);
      const qw = between(row.qualified_at, row.won_at); if (qw != null) vel.qw.push(qw);
    }
    const velocity = {
      qualified_to_meeting_days: avgOf(vel.qm),
      meeting_to_scoping_days: avgOf(vel.ms),
      scoping_to_proposal_days: avgOf(vel.sp),
      proposal_to_won_days: avgOf(vel.pw),
      qualified_to_won_days: avgOf(vel.qw),
    };

    // ── Win rate by sector ───────────────────────────────────────────────
    const bySector = groupBy(
      (row) => row.sector || 'Unknown',
      (row) => ({ sector: row.sector || 'Unknown', count: 0, won_count: 0, lost_count: 0, total_value: 0 }),
      (acc, row) => {
        acc.count += 1;
        if (row.opportunity_stage === 'won') { acc.won_count += 1; acc.total_value += Number(row.mrr_value || 0) + Number(row.one_off_value || 0); }
        if (row.opportunity_stage === 'lost') acc.lost_count += 1;
      }
    ).map((row) => ({
      ...row,
      win_rate: (row.won_count + row.lost_count) > 0 ? (row.won_count / (row.won_count + row.lost_count)) * 100 : 0,
    })).sort((a, b) => b.win_rate - a.win_rate || b.count - a.count || a.sector.localeCompare(b.sector));

    // ── Aging: open (non-terminal) deals stuck in current stage ──────────
    const STUCK_DAYS = 14;
    const aging = { threshold_days: STUCK_DAYS, stuck_total: 0, by_stage: {} };
    for (const row of rows) {
      const stage = row.opportunity_stage;
      if (stage === 'won' || stage === 'lost') continue;
      const age = daysBetween(stageTimestamp(row));
      if (age != null && age > STUCK_DAYS) {
        aging.stuck_total += 1;
        aging.by_stage[stage] = (aging.by_stage[stage] || 0) + 1;
      }
    }

    return res.status(200).json({ success: true, filters: { ownerId }, summary, byStage, byOwner, lossReasons, funnel, velocity, bySector, aging });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
}
