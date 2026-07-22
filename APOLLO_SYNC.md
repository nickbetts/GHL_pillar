# Apollo → GHL Deal Sync Integration

Automatically sync qualified deals from Apollo.io into your i3MEDIA GHL CRM. Deals become contacts + opportunities with automatic lead scoring and tagging.

## 🚀 Quick Start

### 1. Get Your Pipeline ID from GHL

```bash
# SSH into your Vercel server or run locally:
node -e "
import { get } from './client.js';
const data = await get('/opportunities/pipelines', { locationId: process.env.GHL_LOCATION_ID });
console.log(data.pipelines.find(p => p.name === 'i3 Sales Pipeline'));
"
```

Copy the pipeline `id` and add to `.env`:

```
GHL_PIPELINE_ID=<your_pipeline_id>
```

### 2. Generate Cron Secret

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Add to `.env`:

```
CRON_SECRET=<your_generated_secret>
```

### 3. Deploy to Vercel

```bash
git add -A
git commit -m "Add Apollo deal sync integration"
git push origin main
vercel deploy --prod
```

### 4. Configure Vercel Environment Variables

In [Vercel Dashboard](https://vercel.com):
- Go to Project Settings → Environment Variables
- Add `APOLLO_API_KEY`, `GHL_TOKEN`, `GHL_LOCATION_ID`, `GHL_PIPELINE_ID`, `CRON_SECRET`

## 🔄 How It Works

```
Apollo Deals (updated in last 7 days)
    ↓
[Every 4 hours via Vercel cron]
    ↓
Fetch deals with status: open, qualified, negotiating, won
    ↓
For each deal:
  1. Check if contact email exists in GHL
  2. Create or update contact with Apollo company/person data
  3. Create opportunity in i3 Sales Pipeline
  4. Auto-tag based on:
     - Company size (Enterprise / Mid-Market / SMB)
     - Industry (SaaS / FinTech / Ecommerce / Healthcare)
     - Deal status (high-intent / negotiating / won)
  5. Populate fields:
     - Expected Contract Value → deal value
     - Industry Vertical → Apollo industry
     - Assigned Account Manager → (blank, assign manually)
```

## 📊 What Gets Synced

### Contact Fields (from Apollo)
- `firstName`, `lastName`, `email`, `phone`
- `title` → GHL title field
- `companyName` → Company name
- `Company Size Band` ← Apollo employee count
- `Industry Vertical` ← Apollo industry
- `Estimated Annual Revenue` ← Apollo revenue

### Opportunity Fields (from Apollo deal)
- `name` → Deal name / Company name
- `stage` → Mapped from Apollo deal status
- `monetaryValue` → Apollo deal value
- `Strategic Goal` → Deal description
- `tags` → Auto-generated based on company/deal attributes

### Auto-Generated Tags
- **Status**: `high-intent`, `negotiating`, `won`
- **Budget**: `enterprise-budget`, `mid-market`, `smb-budget`
- **Industry**: `saas`, `fintech`, `ecommerce`, `healthcare`
- **Source**: `warm-referral` (all Apollo deals)

## 🧪 Test the Sync

### Run Manually (Dev)
```bash
node -e "
import { syncApolloDeals } from './api/sync-apollo-deals.js';
const result = await syncApolloDeals();
console.log(JSON.stringify(result, null, 2));
"
```

### Test Vercel Cron Endpoint
```bash
curl -H "Authorization: Bearer $CRON_SECRET" \
  https://your-domain.vercel.app/api/cron-sync-apollo
```

## 📈 Monitoring

### View Sync Logs
In Vercel Dashboard → Deployments → Function Logs, search for "Apollo → GHL".

### Check Results
Every sync logs:
- Total deals processed
- Contacts created/updated
- Opportunities created
- Errors (if any)

## 🔧 Customization

### Change Sync Frequency
Edit `vercel.json` cron schedule:
```json
"schedule": "0 */2 * * *"  // Every 2 hours
```

Cron syntax: `minute hour day month day_of_week`

### Change Status Filter
Edit `APOLLO_SYNC_CUTOFF_DAYS` in `api/sync-apollo-deals.js`:
```javascript
const APOLLO_SYNC_CUTOFF_DAYS = 7; // Sync deals updated in last 7 days
```

### Map Additional Fields
Add to `enrichContactData()` or `enrichOpportunityData()` functions in `api/apollo-client.js`.

## ⚠️ Known Limitations

1. **Email-based deduplication** — GHL API doesn't provide fast bulk contact lookup, so we deduplicate by email. In production, consider storing Apollo deal ID in a custom field for 100% accuracy.

2. **Deal updates** — Currently creates new opportunities for each Apollo deal. Updates are limited. To improve: store Apollo deal ID in a custom field and check for existing opportunities.

3. **No bidirectional sync** — Changes in GHL won't sync back to Apollo. One-way sync only.

## 📚 Files Created

- `api/apollo-client.js` — Apollo API wrapper
- `api/sync-apollo-deals.js` — Sync orchestrator
- `api/cron-sync-apollo.js` — Vercel cron endpoint
- `vercel.json` — Updated with cron config

## 🆘 Troubleshooting

### "Unauthorized" error
- Check `CRON_SECRET` is set in Vercel environment
- Verify `Authorization` header format: `Bearer <token>`

### "Cannot POST /opportunities"
- Verify `GHL_PIPELINE_ID` is correct
- Check GHL token is valid

### Deals not syncing
- Check Apollo API key in `.env`
- Verify deal status is in sync filter (open, qualified, negotiating, won)
- Check Vercel Function logs for detailed errors

---

**Next Steps**: 
- [ ] Set `GHL_PIPELINE_ID` in `.env`
- [ ] Generate and set `CRON_SECRET`
- [ ] Deploy to Vercel
- [ ] Add env vars to Vercel dashboard
- [ ] Test with `curl` command
- [ ] Monitor first sync in Vercel logs
