/**
 * Reporting API Endpoint
 * Generates daily/weekly/monthly reports
 * Endpoint: /api/reports.js
 * Call via: curl -X POST https://your-domain.vercel.app/api/reports?type=daily
 */

import { listAllContacts, listAllOpportunities } from '../lib/ghlClient.js';
import { resolveIdentity, hasMinRole } from './session.js';
import { BUSINESS_TIME_ZONE, londonDateKey, londonDayRange, londonMidnight } from './business-time.js';

function inRange(value, range) {
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) && timestamp >= range.start.getTime() && timestamp < range.endExclusive.getTime();
}

async function generateDailyReport() {
  const today = londonDateKey();
  const range = londonDayRange(today);

  const contacts = await listAllContacts();

  const opportunities = await listAllOpportunities();

  const newLeadsToday = contacts.data?.filter(c => {
    return inRange(c.createdAt, range);
  }).length || 0;

  const highIntentLeads = contacts.data?.filter(c => 
    c.tags?.includes('high-intent')
  ).length || 0;

  const demoScheduledToday = opportunities.data?.filter(o => {
    return inRange(o.updatedAt, range) && o.stage === 'Demo Scheduled';
  }).length || 0;

  const report = {
    type: 'daily',
    date: today,
    timeZone: BUSINESS_TIME_ZONE,
    sourcePages: { contacts: contacts.pages, opportunities: opportunities.pages },
    metrics: {
      'New Leads Today': newLeadsToday,
      'High-Intent Leads (Total)': highIntentLeads,
      'Demos Booked Today': demoScheduledToday,
      'Total Pipeline Opps': opportunities.data?.length || 0,
      'Generated At': new Date().toISOString(),
    },
  };

  console.log('[Daily Report]', JSON.stringify(report, null, 2));
  return report;
}

async function generateWeeklyReport() {
  const today = londonDateKey();
  const localNoon = new Date(`${today}T12:00:00Z`);
  const mondayOffset = -((localNoon.getUTCDay() + 6) % 7);
  const weekStart = londonMidnight(today, mondayOffset);
  const weekStartStr = londonDateKey(weekStart);

  const contacts = await listAllContacts();
  const opportunities = await listAllOpportunities();

  const contactsBySource = {};
  const contactsByPersona = {};
  const oppsNotStageWon = opportunities.data?.filter(o => o.stage !== 'Won') || [];

  contacts.data?.forEach(c => {
    const source = c['UTM Source'] || 'Direct';
    const persona = c['Governance Role'] || 'Unknown';
    contactsBySource[source] = (contactsBySource[source] || 0) + 1;
    contactsByPersona[persona] = (contactsByPersona[persona] || 0) + 1;
  });

  const report = {
    type: 'weekly',
    week_start: weekStartStr,
    timeZone: BUSINESS_TIME_ZONE,
    sourcePages: { contacts: contacts.pages, opportunities: opportunities.pages },
    metrics: {
      'Total Contacts': contacts.data?.length || 0,
      'Total Opportunities': opportunities.data?.length || 0,
      'Pipeline Value': oppsNotStageWon.reduce((sum, o) => sum + (o.monetaryValue || 0), 0),
      'Contacts by Source': contactsBySource,
      'Contacts by Persona': contactsByPersona,
      'Demo Attendees This Week': opportunities.data?.filter(o => 
        o.stage === 'Demo Complete'
      ).length || 0,
    },
  };

  console.log('[Weekly Report]', JSON.stringify(report, null, 2));
  return report;
}

async function sendReportEmail(report, recipients) {
  // TODO: Integrate with email service (SendGrid, Gmail API, etc.)
  console.log(`[Email Report] Would send to: ${recipients.join(', ')}`);
  console.log(`[Email Report] Content:`, report);
  // await sendEmailViaService(recipients, report);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const identity = resolveIdentity(req);
  if (!identity) {
    return res.status(401).json({ error: 'Not signed in' });
  }
  if (!hasMinRole(identity, 'manager')) {
    return res.status(403).json({ error: 'Manager access required' });
  }

  const { type = 'daily' } = req.query;

  try {
    let report;
    if (type === 'daily') {
      report = await generateDailyReport();
    } else if (type === 'weekly') {
      report = await generateWeeklyReport();
    } else {
      return res.status(400).json({ error: 'Invalid report type' });
    }

    // Optionally send via email
    if (req.query.email) {
      await sendReportEmail(report, req.query.email.split(','));
    }

    res.status(200).json(report);
  } catch (error) {
    console.error('[Report Error]:', error);
    res.status(500).json({ error: error.message });
  }
}
