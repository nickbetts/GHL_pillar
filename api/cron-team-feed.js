import crypto from 'crypto';
import { getSql } from './db.js';
import { runTeamsFeedJobs } from '../lib/teams-feed.js';
import { runWeeklyReportJob } from '../lib/weekly-report.js';

const safeEqual = (a, b) => { const l = Buffer.from(String(a || '')); const r = Buffer.from(String(b || '')); return l.length === r.length && crypto.timingSafeEqual(l, r); };

// Every 5 minutes: callback reminders, milestones, the 9am Teams digest and the Monday report.
export default async function handler(req, res) {
  if (req.method !== 'POST' && req.method !== 'GET') return res.status(405).json({ success: false, error: 'Method not allowed' });
  if (!process.env.CRON_SECRET || !safeEqual(req.headers.authorization, `Bearer ${process.env.CRON_SECRET}`)) {
    return res.status(401).json({ success: false, error: 'Unauthorized' });
  }
  try {
    const sql = getSql();
    const now = new Date();
    const teams = await runTeamsFeedJobs(sql, now);
    let weekly;
    try { weekly = await runWeeklyReportJob(sql, now); } catch (error) { weekly = `error: ${error.message}`; }
    return res.status(200).json({ success: true, teams, weekly });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
}
