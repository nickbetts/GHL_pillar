/**
 * Reporting API Endpoint
 * Generates daily/weekly/monthly reports
 * Endpoint: /api/reports.js
 * Call via: curl -X POST https://your-domain.vercel.app/api/reports?type=daily
 */

const { listContacts, listOpportunities, ghlFetch } = require('../lib/ghlClient');

async function generateDailyReport() {
  const now = new Date();
  const today = now.toISOString().split('T')[0];

  const contacts = await listContacts({ 
    limit: 1000,
    sort: '-createdAt',
  });

  const opportunities = await listOpportunities({
    limit: 1000,
    sort: '-createdAt',
  });

  const newLeadsToday = contacts.data?.filter(c => {
    const created = new Date(c.createdAt).toISOString().split('T')[0];
    return created === today;
  }).length || 0;

  const highIntentLeads = contacts.data?.filter(c => 
    c.tags?.includes('high-intent')
  ).length || 0;

  const demoScheduledToday = opportunities.data?.filter(o => {
    const updated = new Date(o.updatedAt).toISOString().split('T')[0];
    return updated === today && o.stage === 'Demo Scheduled';
  }).length || 0;

  const report = {
    type: 'daily',
    date: today,
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
  const now = new Date();
  const weekStart = new Date(now.setDate(now.getDate() - now.getDay()));
  const weekStartStr = weekStart.toISOString().split('T')[0];

  const contacts = await listContacts({ limit: 5000 });
  const opportunities = await listOpportunities({ limit: 5000 });

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
