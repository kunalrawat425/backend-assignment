#!/bin/bash

# Configuration
BASE_URL="http://localhost:3000"
API_KEY="f5d96a7ebcd7fbe4f691c28c894d0a1b"
ADMIN_KEY="9a7c3b2f5d1e4c7b8e0a1f2c3d4e5f6a"

echo "=========================================================="
echo "🚀 STARTING LIVE INTERACTIVE DEMO TEST CYCLE 🚀"
echo "=========================================================="

# --------------------------------------------------------
# HAPPY PATH CASE 1: Health & Readiness Check
# --------------------------------------------------------
echo -e "\n[CASE 1] Checking System Liveness & Readiness..."
echo "Command: curl -s $BASE_URL/readyz"
curl -s "$BASE_URL/readyz"
echo ""

# --------------------------------------------------------
# EDGE CASE 1: Ingestion Trigger Unauthorized (401)
# --------------------------------------------------------
echo -e "\n[EDGE CASE 1] Trigger Ingestion with Invalid Admin Key (Expect 401)..."
echo "Command: curl -s -o /dev/null -w \"HTTP Status: %{http_code}\n\" -X POST -H \"X-Admin-Api-Key: invalid\" -H \"Idempotency-Key: edge-1-$(date +%s)\" $BASE_URL/trigger/stripe/incremental"
curl -s -w "HTTP Status: %{http_code}\n" -X POST -H "X-Admin-Api-Key: invalid" -H "Idempotency-Key: edge-1-$(date +%s)" "$BASE_URL/trigger/stripe/incremental"

# --------------------------------------------------------
# EDGE CASE 2: Metrics Validation Failure (400)
# --------------------------------------------------------
echo -e "\n[EDGE CASE 2] Request Metrics with Invalid Date Format (Expect 400)..."
echo "Command: curl -s -w \"HTTP Status: %{http_code}\n\" -H \"X-Api-Key: $API_KEY\" \"$BASE_URL/metrics/revenue/summary?startDate=15-06-2026\""
curl -s -w "HTTP Status: %{http_code}\n" -H "X-Api-Key: $API_KEY" "$BASE_URL/metrics/revenue/summary?startDate=15-06-2026"

# --------------------------------------------------------
# HAPPY PATH CASE 2: Ingestion Batch 1 (2 Stripe Charges)
# --------------------------------------------------------
echo -e "\n[CASE 2] Seeding 2 charges ($11.00 and $22.00) in Stripe (Vendor)..."
npx tsx -e "
import 'dotenv/config';
import Stripe from 'stripe';
const stripe = new Stripe(process.env.STRIPE_API_KEY || '', { apiVersion: '2024-09-30.acacia' as any });
Promise.all([
  stripe.charges.create({ amount: 1100, currency: 'usd', source: 'tok_visa', description: 'Batch 1 - Charge 1' }),
  stripe.charges.create({ amount: 2200, currency: 'usd', source: 'tok_visa', description: 'Batch 1 - Charge 2' })
]).then(([c1, c2]) => {
  console.log('  Created Stripe Charge 1:', c1.id);
  console.log('  Created Stripe Charge 2:', c2.id);
}).catch(err => console.error(err));
"

echo -e "\nTriggering Stripe incremental sync via API..."
RUN_ID_1=$(curl -s -X POST -H "X-Admin-Api-Key: $ADMIN_KEY" -H "Idempotency-Key: trigger-demo-batch-1-$(date +%s)" "$BASE_URL/trigger/stripe/incremental" | node -e "
  const fs = require('fs');
  const body = fs.readFileSync(0, 'utf8');
  console.log(JSON.parse(body).runId);
")
echo "  Ingestion triggered. runId: $RUN_ID_1"

echo "Waiting 6 seconds for background fetch..."
sleep 6

echo -e "\nRunning Ingestion Processor to normalize & save payments..."
pnpm job:process

echo -e "\nVerifying Summary Metrics after Batch 1..."
curl -s -H "X-Api-Key: $API_KEY" "$BASE_URL/metrics/revenue/summary?startDate=2026-06-15&endDate=2026-06-18"
echo ""

# --------------------------------------------------------
# HAPPY PATH CASE 3: Ingestion Batch 2 (3 Stripe Charges)
# --------------------------------------------------------
echo -e "\n[CASE 3] Seeding 3 charges ($15.00, $25.00, $35.00) in Stripe (Vendor)..."
npx tsx -e "
import 'dotenv/config';
import Stripe from 'stripe';
const stripe = new Stripe(process.env.STRIPE_API_KEY || '', { apiVersion: '2024-09-30.acacia' as any });
Promise.all([
  stripe.charges.create({ amount: 1500, currency: 'usd', source: 'tok_visa', description: 'Batch 2 - Charge 1' }),
  stripe.charges.create({ amount: 2500, currency: 'usd', source: 'tok_visa', description: 'Batch 2 - Charge 2' }),
  stripe.charges.create({ amount: 3500, currency: 'usd', source: 'tok_visa', description: 'Batch 2 - Charge 3' })
]).then(([c1, c2, c3]) => {
  console.log('  Created Stripe Charge 3:', c1.id);
  console.log('  Created Stripe Charge 4:', c2.id);
  console.log('  Created Stripe Charge 5:', c3.id);
}).catch(err => console.error(err));
"

echo -e "\nTriggering Stripe incremental sync again (should use cursor delta)..."
RUN_ID_2=$(curl -s -X POST -H "X-Admin-Api-Key: $ADMIN_KEY" -H "Idempotency-Key: trigger-demo-batch-2-$(date +%s)" "$BASE_URL/trigger/stripe/incremental" | node -e "
  const fs = require('fs');
  const body = fs.readFileSync(0, 'utf8');
  console.log(JSON.parse(body).runId);
")
echo "  Ingestion triggered. runId: $RUN_ID_2"

echo "Waiting 6 seconds for background fetch..."
sleep 6

echo -e "\nRunning Ingestion Processor to normalize & save payments..."
pnpm job:process

echo -e "\nVerifying E2E Metrics and Consistency (Task 2) after Batch 2..."
echo -e "\nSummary API:"
curl -s -H "X-Api-Key: $API_KEY" "$BASE_URL/metrics/revenue/summary?startDate=2026-06-15&endDate=2026-06-18"
echo -e "\n\nDaily Breakdown API:"
curl -s -H "X-Api-Key: $API_KEY" "$BASE_URL/metrics/revenue/daily?startDate=2026-06-15&endDate=2026-06-18"
echo -e "\n\nWeekly Breakdown API:"
curl -s -H "X-Api-Key: $API_KEY" "$BASE_URL/metrics/revenue/weekly?startDate=2026-06-15&endDate=2026-06-18"
echo ""

echo -e "\n=========================================================="
echo "🎉 DEMO TEST CYCLE COMPLETED SUCCESSFULLY 🎉"
echo "=========================================================="
