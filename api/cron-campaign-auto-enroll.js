import crypto from 'crypto';
import { getSql, initAuthTables, initQueueTable, isEmailSuppressed, writeAudit } from './db.js';

const MAX_CAMPAIGNS_PER_RUN = 25;
const MAX_MATCHES_PER_CAMPAIGN = 500;

function safeText(value) {
  return String(value ?? '').trim();
}

function timingSafeEqual(a, b) {
  const left = Buffer.from(String(a || ''), 'utf8');
  const right = Buffer.from(String(b || ''), 'utf8');
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function leadFieldValue(lead, field) {
  if (field === 'queue_status') return safeText(lead.status).toLowerCase();
  if (field === 'sector') return safeText(lead.sector).toLowerCase();
  if (field === 'sub_sector') return safeText(lead.sub_sector).toLowerCase();
  return '';
}

function evaluateRule(rule, lead) {
  const actual = leadFieldValue(lead, rule.field_name);
  if (!actual) return false;
  if (rule.operator === 'equals') {
    return actual === safeText(rule.value_text).toLowerCase();
  }
  if (rule.operator === 'in') {
    const values = Array.isArray(rule.value_json) ? rule.value_json.map((item) => safeText(item).toLowerCase()) : [];
    return values.includes(actual);
  }
  return false;
}

function matchesLead(lead, rules, matchLogic) {
  if (!rules.length) return false;
  if (matchLogic === 'any') return rules.some((rule) => evaluateRule(rule, lead));
  return rules.every((rule) => evaluateRule(rule, lead));
}

export default async function handler(req, res) {
  if (req.method !== 'POST' && req.method !== 'GET') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  const auth = req.headers.authorization;
  if (!process.env.CRON_SECRET || !timingSafeEqual(auth, `Bearer ${process.env.CRON_SECRET}`)) {
    return res.status(401).json({ success: false, error: 'Unauthorized' });
  }

  try {
    const sql = getSql();
    await initQueueTable();
    await initAuthTables();

    const campaigns = await sql`
      SELECT c.id, c.name, rs.match_logic
      FROM email_campaigns c
      JOIN email_campaign_rule_sets rs ON rs.campaign_id = c.id
      WHERE c.status = 'active' AND rs.continuous_enroll = TRUE
      ORDER BY c.updated_at DESC
      LIMIT ${MAX_CAMPAIGNS_PER_RUN}
    `;

    const report = [];

    for (const campaign of campaigns) {
      const rules = await sql`
        SELECT field_name, operator, value_text, value_json
        FROM email_campaign_trigger_rules
        WHERE campaign_id = ${campaign.id} AND rule_type = 'trigger' AND active = TRUE
        ORDER BY sort_order ASC, id ASC
      `;
      if (!rules.length) {
        report.push({ campaignId: campaign.id, enrolled: 0, skipped: 0, matched: 0, reason: 'no_trigger_rules' });
        continue;
      }

      const candidates = await sql`
        SELECT id, email, status, sector, sub_sector, archived_at
        FROM queue_leads
        WHERE archived_at IS NULL
          AND COALESCE(email, '') <> ''
          AND id NOT IN (
            SELECT lead_id FROM email_campaign_enrollments WHERE campaign_id = ${campaign.id}
          )
        ORDER BY id DESC
        LIMIT ${MAX_MATCHES_PER_CAMPAIGN * 4}
      `;

      const matched = candidates.filter((lead) => matchesLead(lead, rules, campaign.match_logic || 'all'));
      let enrolled = 0;
      let skipped = 0;

      for (const lead of matched.slice(0, MAX_MATCHES_PER_CAMPAIGN)) {
        if (await isEmailSuppressed(sql, lead.email)) {
          skipped += 1;
          continue;
        }
        const rows = await sql`
          INSERT INTO email_campaign_enrollments (campaign_id, lead_id, status, enrolled_via, current_step, next_step_due)
          VALUES (${campaign.id}, ${lead.id}, 'active', 'rule', 0, now())
          ON CONFLICT (campaign_id, lead_id) DO NOTHING
          RETURNING id
        `;
        if (rows[0]) enrolled += 1;
        else skipped += 1;
      }

      await writeAudit(sql, {
        actorEmail: 'system',
        actorRole: 'system',
        event: 'campaign_rules_auto_enroll',
        target: `campaign:${campaign.id}`,
        meta: {
          matched: matched.length,
          enrolled,
          skipped,
          maxPerCampaign: MAX_MATCHES_PER_CAMPAIGN,
        },
      });

      report.push({ campaignId: campaign.id, campaignName: campaign.name, matched: matched.length, enrolled, skipped });
    }

    return res.status(200).json({ success: true, processedCampaigns: report.length, report });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
}
