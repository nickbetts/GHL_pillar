# Pillar CRM Automation — Vercel Serverless Deployment

This is a complete GHL CRM automation suite running on **Vercel serverless functions**. Real-time webhooks trigger 9 automation features without any server maintenance.

## What's Included

✅ **Real-time lead scoring** (12-rule engine)  
✅ **Smart auto-tagging** (8 rules)  
✅ **Opportunity auto-creator** (when lead hits high-intent)  
✅ **Inbound message handler** (tracks replies, updates status)  
✅ **Auto-assignment** (role-based routing to sales team)  
✅ **Contact deduplication** (detect + merge duplicates)  
✅ **Apollo B2B enrichment** (auto-lookup company data)  
✅ **Reporting** (daily/weekly/monthly metrics)  
✅ **GHL webhook integration** (instant triggers)  

## Quick Start

### 1. Fork to GitHub

```bash
# Create a new GitHub repo called "pillar-crm-automation"
git remote add github https://github.com/your-org/pillar-crm-automation.git
git push github main
```

### 2. Deploy to Vercel

**Option A: Via Vercel Dashboard**
1. Go to [vercel.com](https://vercel.com)
2. Click "New Project"
3. Import your GitHub repo
4. Add environment variables (see `.env.example`)
5. Deploy!

**Option B: Via CLI**
```bash
npm install -g vercel
vercel login
vercel --prod
```

### 3. Get Your Vercel URL

```
https://your-project-name.vercel.app
```

### 4. Register Webhook in GHL

1. GHL → Settings → Integrations → Webhooks
2. Add webhook URL: `https://your-project-name.vercel.app/api/webhooks`
3. Subscribe to events:
   - ✅ Contact Created
   - ✅ Contact Updated
   - ✅ Opportunity Created
   - ✅ Opportunity Updated
   - ✅ Inbound Message

### 5. Set Environment Variables in Vercel

Go to Vercel Dashboard → Settings → Environment Variables

Add all variables from `.env.example`:
- `GHL_TOKEN` — Your GHL API token
- `GHL_LOCATION_ID` — Your location ID
- `GHL_PIPELINE_ID` — Your sales pipeline ID
- `GHL_DEFAULT_OWNER` — Default sales owner email
- `APOLLO_API_KEY` — (optional) For B2B enrichment
- Others as needed

## How It Works

### Contact Created or Updated

```
1. GHL sends webhook → /api/webhooks
2. Lead Scoring Engine calculates ICP Score based on 12 rules
3. Smart Tagging Engine applies 8 auto-tagging rules
4. If tagged 'high-intent' → Opportunity Auto-Creator triggers
5. New opportunity created in "Lead" stage
6. Auto-Assignment routes it to team member based on persona
7. Contact fields updated in real-time ✨
```

### Opportunity Created

```
1. GHL sends webhook → /api/webhooks
2. Auto-Assignment detects stage = "Lead"
3. Routes based on contact persona:
   - Fundraising Director → fundraising-specialist@
   - Ops Manager → ops-specialist@
   - Enterprise (£1m+) → enterprise-team@
4. Opportunity assigned ✨
```

### Inbound Message Received

```
1. Contact replies via SMS/email
2. GHL sends InboundMessage webhook
3. Message handler parses intent:
   - If contains "book/schedule/demo" → tag "demo-scheduled"
   - If contains "STOP" → tag "opted-out-sms"
4. Exits nurture sequence automatically ✨
```

## API Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/webhooks` | POST | Main webhook receiver (use in GHL) |
| `/api/reports?type=daily` | POST | Generate daily report |
| `/api/reports?type=weekly` | POST | Generate weekly report |
| `/api/dedup` | POST | Find duplicate contacts |
| `/api/dedup?action=merge` | POST | Merge two contacts |
| `/api/apollo` | POST | Enrich contact via Apollo |

## Testing Locally

```bash
# Install Vercel CLI
npm install -g vercel

# Start local dev server
vercel dev

# In another terminal, test webhook
curl -X POST http://localhost:3000/api/webhooks \
  -H "Content-Type: application/json" \
  -d '{
    "type": "ContactCreate",
    "data": {
      "id": "test-contact-123",
      "firstName": "Test",
      "lastName": "Contact",
      "email": "test@example.com",
      "companyName": "Test Corp",
      "customFields": {
        "Annual Income Band": "£1m+",
        "Governance Role": "Fundraising Director"
      }
    }
  }'
```

## Monitoring & Logs

### Vercel Dashboard
1. Go to your project in Vercel
2. Deployment → Logs
3. See real-time webhook execution

### Local Logs
```bash
vercel logs --tail
```

## Troubleshooting

### Webhook not firing
- ✓ Verify webhook URL is registered in GHL
- ✓ Check Vercel logs for errors
- ✓ Confirm GHL_TOKEN is valid (Settings → Integrations → API)

### Lead scoring not updating
- ✓ Check contact has required fields populated
- ✓ Verify webhook triggered (check GHL webhook logs)
- ✓ Ensure ICP Score field exists on contact

### Opportunities not auto-creating
- ✓ Confirm pipeline ID is set in `GHL_PIPELINE_ID`
- ✓ Check if opportunity already exists (prevents duplicates)
- ✓ Verify GHL_DEFAULT_OWNER email is valid

## File Structure

```
├── api/
│   ├── webhooks.js      ← Main webhook receiver
│   ├── reports.js       ← Daily/weekly reporting
│   ├── dedup.js         ← Deduplication
│   └── apollo.js        ← Apollo enrichment
│
├── lib/
│   ├── ghlClient.js     ← Shared GHL API client
│   ├── leadScoring.js   ← 12-rule scoring engine
│   └── smartTagging.js  ← 8 auto-tagging rules
│
├── .env.example         ← Environment variables template
├── package.json         ← Dependencies
└── vercel.json          ← Vercel config
```

## Scaling

Vercel automatically scales based on traffic:
- Free tier: Up to 1,000 webhook events/day
- Pro tier: Unlimited + custom domains

For high-volume (10k+/day), contact Vercel support for enterprise plan.

## Security

1. **Webhook Signing** (recommended)
   - GHL signs all webhooks with X-GHL-Signature header
   - Implement signature verification in production

2. **Environment Variables**
   - Never commit `.env` to git
   - Use Vercel's encrypted secrets

3. **API Rate Limiting**
   - GHL API: 100 requests/min
   - Apollo API: Based on subscription
   - Implement retry logic with exponential backoff

## Next Steps

1. ✅ Deploy to Vercel
2. ✅ Register webhook in GHL
3. ✅ Add environment variables
4. ✅ Test with a contact creation
5. ✅ Verify lead scoring updates ICP Score
6. ✅ Confirm smart tags appear
7. ✅ Check opportunities auto-create
8. ✅ Go live! 🚀

## Support

- GHL API docs: https://marketplace.gohighlevel.com/docs/
- Vercel docs: https://vercel.com/docs
- Apollo docs: https://dev.apolloio.com/

---

**Built with ❤️ for Pillar CRM**
