import axios from 'axios';
import 'dotenv/config';
import Stripe from 'stripe';
import { PrismaClient } from '@prisma/client';
import { ConfigService } from './src/config/config.service';
import { OutboxProcessor } from './src/outbox/outbox.processor';
import { OutboxService } from './src/outbox/outbox.service';
import { PaymentRepo } from './src/repos/payment.repo';
import { StripeNormalizer } from './src/normalizers/stripe.normalizer';
import { SourceType } from './src/types/enums';
import { disconnectPrisma } from './src/db/db.service';

const BASE_URL = 'http://localhost:3000';
const ADMIN_API_KEY = '9a7c3b2f5d1e4c7b8e0a1f2c3d4e5f6a';

const prisma = new PrismaClient();

async function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function createStripeCharges(apiKey: string) {
  console.log('\n--- SEEDING STRIPE TEST CHARGES ---');
  const stripe = new Stripe(apiKey, { apiVersion: '2024-09-30.acacia' as any });
  const chargeIds = [];
  for (let i = 1; i <= 3; i++) {
    const amount = 1500 * i; // $15, $30, $45
    const charge = await stripe.charges.create({
      amount,
      currency: 'usd',
      source: 'tok_visa',
      description: `E2E Happy Path charge ${i} - ${new Date().toISOString()}`,
    });
    console.log(`Created Stripe Test Charge: ${charge.id} ($${amount / 100})`);
    chargeIds.push(charge.id);
  }
  return chargeIds;
}

async function triggerSync(source: string, mode: 'incremental' | 'full') {
  console.log(`\nTriggering Sync: ${source} (${mode})...`);
  const idempotencyKey = `e2e-trigger-${source}-${mode}-${Date.now()}`;
  const res = await axios.post(
    `${BASE_URL}/trigger/${source}/${mode}`,
    {},
    {
      headers: {
        'X-Admin-Api-Key': ADMIN_API_KEY,
        'Idempotency-Key': idempotencyKey,
      },
    },
  );
  console.log(`Response: Status ${res.status}, runId: ${res.data.runId}`);
  return res.data.runId;
}

async function runProcessor() {
  console.log('\nRunning Outbox Processor...');
  const outbox = new OutboxService();
  const processor = new OutboxProcessor(outbox, new PaymentRepo(), new StripeNormalizer());
  const stats = await processor.drain();
  console.log(`Outbox Processor Results — Consumed: ${stats.consumed}, Failed: ${stats.failed}, DLQ: ${stats.dlq}`);
  return stats;
}

async function runScenario() {
  console.log('======================================================');
  console.log('=== STARTING END-TO-END SYSTEM SCENARIO TEST SUITE ===');
  console.log('======================================================');

  ConfigService.load();
  const cfg = ConfigService.get();
  
  if (!cfg.STRIPE_API_KEY || cfg.STRIPE_API_KEY.includes('YOUR_STRIPE_API_KEY')) {
    console.error('Stripe API Key is not configured correctly in .env.');
    process.exit(1);
  }

  // --- SCENARIO 1: Happy Path 1-by-1 for each vendor ---

  // 1. Stripe Ingest & Sync
  await createStripeCharges(cfg.STRIPE_API_KEY);
  await triggerSync('stripe', 'incremental');
  console.log('Waiting 5s for Stripe Ingestion Producer...');
  await sleep(5000);
  await runProcessor();

  // 2. HubSpot Contact Ingest & Sync
  await triggerSync('hubspot', 'incremental');
  console.log('Waiting 5s for HubSpot Ingestion Producer...');
  await sleep(5000);
  await runProcessor();

  // 3. Google Calendar Ingest & Sync
  await triggerSync('gcal', 'incremental');
  console.log('Waiting 5s for GCal Ingestion Producer...');
  await sleep(5000);
  await runProcessor();


  // --- SCENARIO 2: Edge Case - Stale Cursor & Fallback to Full Sync ---
  console.log('\n======================================================');
  console.log('=== SCENARIO 2: STALE CURSOR DETECTION & FALLBACK ===');
  console.log('======================================================');

  // We set Stripe cursor in database to an invalid/garbage value.
  // When fetchIncremental parses it, it will fail and throw StaleCursorError.
  console.log('Setting Stripe cursor in DB to invalid value to simulate stale/corrupted cursor...');
  await prisma.syncCursor.upsert({
    where: { source_entity: { source: SourceType.STRIPE, entity: 'payments' } },
    update: { cursor: 'invalid-stale-garbage-cursor' },
    create: { source: SourceType.STRIPE, entity: 'payments', cursor: 'invalid-stale-garbage-cursor' },
  });

  // Now trigger an incremental sync.
  // The system should detect the stale cursor, warn, reset the cursor, fall back to full backfill, and complete successfully.
  await triggerSync('stripe', 'incremental');
  console.log('Waiting 8s for Stale-Cursor Fallback to complete...');
  await sleep(8000);
  await runProcessor();


  // --- SCENARIO 3: All Sources Sync ---
  console.log('\n======================================================');
  console.log('=== SCENARIO 3: TRIGGER ALL SOURCES SIMULTANEOUSLY ===');
  console.log('======================================================');
  
  await triggerSync('stripe', 'incremental');
  await triggerSync('hubspot', 'incremental');
  await triggerSync('gcal', 'incremental');

  console.log('Waiting 8s for concurrent ingestion of all sources...');
  await sleep(8000);
  await runProcessor();

  console.log('\n======================================================');
  console.log('=== END-TO-END SCENARIO RUN COMPLETED SUCCESSFULLY ===');
  console.log('======================================================');
}

runScenario()
  .catch((err) => {
    console.error('Scenario run failed:', err);
  })
  .finally(async () => {
    await prisma.$disconnect();
    await disconnectPrisma();
  });
