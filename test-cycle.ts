import Stripe from 'stripe';
import axios from 'axios';
import 'dotenv/config';
import { getPrisma, disconnectPrisma } from './src/db/db.service';
import { OutboxProcessor } from './src/outbox/outbox.processor';
import { OutboxService } from './src/outbox/outbox.service';
import { PaymentRepo } from './src/repos/payment.repo';
import { StripeNormalizer } from './src/normalizers/stripe.normalizer';

const BASE_URL = 'http://localhost:3000';
const ADMIN_API_KEY = '9a7c3b2f5d1e4c7b8e0a1f2c3d4e5f6a';
const API_KEY = 'f5d96a7ebcd7fbe4f691c28c894d0a1b';

async function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function createStripeCharges(amounts: number[], batchName: string) {
  const stripeApiKey = process.env.STRIPE_API_KEY;
  if (!stripeApiKey || stripeApiKey.includes('YOUR_STRIPE_API_KEY')) {
    throw new Error('STRIPE_API_KEY is not configured correctly in .env.');
  }
  const stripe = new Stripe(stripeApiKey, { apiVersion: '2024-09-30.acacia' as any });

  console.log(`\n--- [${batchName}] Creating ${amounts.length} Stripe Charges ---`);
  const chargeIds: string[] = [];
  for (const amount of amounts) {
    const charge = await stripe.charges.create({
      amount,
      currency: 'usd',
      source: 'tok_visa',
      description: `${batchName} charge - ${new Date().toISOString()}`,
    });
    console.log(`[Stripe] Created Charge: ${charge.id} ($${amount / 100})`);
    chargeIds.push(charge.id);
  }
  return chargeIds;
}

async function triggerSync(id: number) {
  console.log(`\n--- Triggering Sync Run #${id} (Incremental) via API ---`);
  const idempotencyKey = `test-cycle-trigger-${id}-${Date.now()}`;
  const res = await axios.post(
    `${BASE_URL}/trigger/stripe/incremental`,
    {},
    {
      headers: {
        'X-Admin-Api-Key': ADMIN_API_KEY,
        'Idempotency-Key': idempotencyKey,
      },
    },
  );
  console.log(`[API] Response: Status ${res.status}, runId: ${res.data.runId}`);
  return res.data.runId;
}

async function runProcessor() {
  console.log('\n--- Running Outbox Processor to ingest events ---');
  const outbox = new OutboxService();
  const processor = new OutboxProcessor(outbox, new PaymentRepo(), new StripeNormalizer());
  const stats = await processor.drain();
  console.log(`[Ingestion] Completed. Consumed: ${stats.consumed}, Failed: ${stats.failed}`);
}

async function verifyState(chargeIds: string[], expectedNewCount: number) {
  console.log('\n--- Verification ---');
  
  // 1. Check DB records
  let foundCount = 0;
  for (const id of chargeIds) {
    const p = await getPrisma().payment.findUnique({
      where: { source_externalId: { source: 'stripe', externalId: id } },
    });
    if (p) {
      console.log(`[DB] Verified Payment: ${p.externalId} | Status: ${p.status} | Amount: $${Number(p.amountCents) / 100}`);
      foundCount++;
    } else {
      console.log(`[DB] WARNING: Payment ${id} was not found.`);
    }
  }
  console.log(`[DB Verification] Ingested in this batch: ${foundCount}/${expectedNewCount}`);

  // 2. Check sync cursor in DB
  const cursorRow = await getPrisma().syncCursor.findUnique({
    where: { source_entity: { source: 'stripe', entity: 'payments' } },
  });
  console.log(`[DB Cursor] Current Stripe Sync Cursor: ${cursorRow?.cursor}`);

  // 3. Query summary metrics API
  const metricsRes = await axios.get(`${BASE_URL}/metrics/revenue/summary`, {
    headers: { 'X-Api-Key': API_KEY },
  });
  console.log(`[API Metrics] Total Collected Revenue: $${Number(metricsRes.data.totalRevenueCents) / 100}`);
  console.log(`[API Metrics] Total Payments Count: ${metricsRes.data.count}`);
}

async function run() {
  console.log('=== STARTING AUTOMATED CURSOR SYNC DEMO CYCLE ===');

  // ================= BATCH 1 =================
  console.log('\n================ BATCH 1: 2 CHARGES ================');
  const batch1Charges = await createStripeCharges([1000, 2000], 'BATCH 1'); // $10, $20
  await triggerSync(1);
  
  console.log('Waiting 6 seconds for background producer to poll Stripe and populate outbox...');
  await sleep(6000);
  
  await runProcessor();
  await verifyState(batch1Charges, 2);

  // ================= BATCH 2 =================
  console.log('\n================ BATCH 2: 3 CHARGES ================');
  const batch2Charges = await createStripeCharges([1500, 2500, 3500], 'BATCH 2'); // $15, $25, $35
  await triggerSync(2);

  console.log('Waiting 6 seconds for background producer to poll Stripe and populate outbox...');
  await sleep(6000);

  await runProcessor();
  await verifyState(batch2Charges, 3);

  console.log('\n=== CURSOR SYNC DEMO CYCLE COMPLETED SUCCESSFULLY ===');
}

run()
  .catch((err) => {
    console.error('Cycle failed:', err.response?.data || err.message);
  })
  .finally(async () => {
    await disconnectPrisma();
  });
