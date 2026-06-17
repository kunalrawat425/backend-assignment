import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { withDbRetry } from './src/db/retry-policy.service';
import { CursorService } from './src/cursor/cursor.service';
import { OutboxService } from './src/outbox/outbox.service';
import { OutboxProcessor } from './src/outbox/outbox.processor';
import { PaymentRepo } from './src/repos/payment.repo';
import { StripeNormalizer } from './src/normalizers/stripe.normalizer';
import { SourceType, EntityType, OutboxStatus } from './src/types/enums';
import { getPrisma, disconnectPrisma } from './src/db/db.service';

const prisma = new PrismaClient();

if (!(BigInt.prototype as any).toJSON) {
  (BigInt.prototype as any).toJSON = function (this: bigint) {
    return this.toString();
  };
}

class MockNetworkError extends Error {
  code = 'ECONNRESET';
  constructor() {
    super('Connection reset by peer');
    this.name = 'MockNetworkError';
  }
}

async function runBrutalScenarios() {
  console.log('======================================================');
  console.log('=== STARTING BRUTAL SYSTEM SCENARIOS TEST SUITE ===');
  console.log('======================================================');

  // --- SCENARIO 1: DB Retry Policy & backoff ---
  console.log('\n--- SCENARIO 1: DB RETRY POLICY & EXPONENTIAL BACKOFF ---');
  let calls = 0;
  try {
    const result = await withDbRetry(async () => {
      calls++;
      console.log(`[DB Call ${calls}] Attempting database query...`);
      if (calls < 3) {
        throw new MockNetworkError();
      }
      return 'SUCCESSFUL_QUERY';
    }, { baseMs: 100, attempts: 3, label: 'brutal-test-db-op' });
    console.log(`Result: ${result} (Succeeded after ${calls} attempts)`);
  } catch (err: any) {
    console.error('Failed after retries:', err.message);
  }


  // --- SCENARIO 2: Concurrent Advisory Locks ---
  console.log('\n--- SCENARIO 2: CONCURRENT DOUBLE-FIRING LOCKS ---');
  const cursorService = new CursorService();
  const source = SourceType.STRIPE;
  const entity = EntityType.PAYMENTS;

  console.log('Transaction 1: Acquiring advisory lock for stripe:payments...');
  const tx1Promise = getPrisma().$transaction(async (tx1) => {
    const lock1 = await cursorService.tryAcquireRunLock(tx1, source, entity);
    console.log(`Transaction 1: Lock Acquired? ${lock1}`);

    // Keep Transaction 1 active to hold the lock, and try to acquire it concurrently in Transaction 2
    console.log('Transaction 2: Attempting to acquire same lock concurrently...');
    const lock2 = await getPrisma().$transaction(async (tx2) => {
      return await cursorService.tryAcquireRunLock(tx2, source, entity);
    });
    console.log(`Transaction 2 (Concurrent): Lock Acquired? ${lock2} (Expected: false)`);

    // Sleep 1s to hold lock
    await new Promise((r) => setTimeout(r, 1000));
    console.log('Transaction 1: Releasing lock (tx complete).');
    return lock1;
  });

  await tx1Promise;


  // --- SCENARIO 3: Poison Messages & Dead Letter Queue (DLQ) ---
  console.log('\n--- SCENARIO 3: POISON MESSAGE & DLQ ROUTING ---');
  const outbox = new OutboxService();

  console.log('Inserting a valid Stripe charge and a poison Stripe charge (EUR currency)...');
  const runId = '9b8ff10d-2c35-46b2-a016-786bb4277568';
  
  // Clean tables first for clean metrics
  await prisma.ingestOutbox.deleteMany({ where: { runId } });
  
  // 1. Insert a poison record (unsupported currency EUR)
  const poisonPayload = {
    id: 'ch_poison_eur_001',
    amount: 2500,
    currency: 'eur',
    status: 'succeeded',
    created: Math.floor(Date.now() / 1000),
  };
  
  // Insert directly with attempts = 4 so that the first failure pushes it immediately to DLQ (attempts >= 5 limit)
  await prisma.ingestOutbox.create({
    data: {
      source: SourceType.STRIPE,
      entity: EntityType.PAYMENTS,
      externalId: 'ch_poison_eur_001',
      rawPayload: poisonPayload,
      runId,
      status: OutboxStatus.PENDING,
      attempts: 4, // 5th attempt will fail and route to DLQ
    }
  });
  console.log('Poison charge inserted into IngestOutbox (status: pending, attempts: 4).');

  // 2. Run the processor to drain
  const processor = new OutboxProcessor(outbox, new PaymentRepo(), new StripeNormalizer());
  console.log('Processing outbox...');
  await processor.drain();

  // 3. Verify that the poison record was routed to the DLQ and marked failed
  console.log('\nVerifying DLQ entries...');
  const dlqEntries = await prisma.dlqLog.findMany({
    where: { externalId: 'ch_poison_eur_001' }
  });
  console.log(`DLQ Logs matching "ch_poison_eur_001": ${dlqEntries.length}`);
  if (dlqEntries.length > 0) {
    console.log('DLQ Record:', JSON.stringify(dlqEntries[0], null, 2));
  }

  const outboxRow = await prisma.ingestOutbox.findFirst({
    where: { externalId: 'ch_poison_eur_001', runId }
  });
  console.log(`Outbox Row Status: ${outboxRow?.status}, Attempts: ${outboxRow?.attempts}, Last Error: "${outboxRow?.lastError}"`);

  console.log('\n======================================================');
  console.log('=== BRUTAL SCENARIO RUNS COMPLETED SUCCESSFULLY ===');
  console.log('======================================================');
}

runBrutalScenarios()
  .catch((err) => {
    console.error('Brutal scenarios execution failed:', err);
  })
  .finally(async () => {
    await prisma.$disconnect();
    await disconnectPrisma();
  });
