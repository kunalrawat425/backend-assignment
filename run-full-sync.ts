import 'dotenv/config';
import { ConfigService } from './src/config/config.service';
import { ConnectorFactory } from './src/connectors/connector.factory';
import { CursorService } from './src/cursor/cursor.service';
import { OutboxService } from './src/outbox/outbox.service';
import { RunReportService } from './src/reports/run-report.service';
import { ProducerJob } from './src/jobs/producer.job';
import { OutboxProcessor } from './src/outbox/outbox.processor';
import { PaymentRepo } from './src/repos/payment.repo';
import { StripeNormalizer } from './src/normalizers/stripe.normalizer';
import { SourceType } from './src/types/enums';
import { PrismaClient } from '@prisma/client';
import { disconnectPrisma } from './src/db/db.service';

const prisma = new PrismaClient();

async function run() {
  console.log('=== RUNNING FULL SYNC & OUTBOX DRAIN ===\n');

  ConfigService.load();
  const cfg = ConfigService.get();

  const cursors = new CursorService();
  const outbox = new OutboxService();
  const reports = new RunReportService();
  const job = new ProducerJob(cursors, outbox, reports);

  // 1. Reset cursors to force full fetch
  console.log('Resetting GCal and HubSpot cursors...');
  const connectors = ConnectorFactory.build(cfg);
  for (const match of connectors) {
    if (match.source === SourceType.GCAL || (match.source === SourceType.HUBSPOT && match.connector.entity === 'contacts')) {
      await cursors.reset(match.source, match.connector.entity);
    }
  }

  // 2. Fetch records
  console.log('\nRunning Ingestion (Producer)...');
  for (const match of connectors) {
    if (match.source === SourceType.GCAL || (match.source === SourceType.HUBSPOT && match.connector.entity === 'contacts')) {
      console.log(`> Fetching ${match.source}:${match.connector.entity}...`);
      await job.runOne(match.source, match.connector);
    }
  }

  // 3. Process Outbox
  console.log('\nProcessing Outbox (Consumer)...');
  const processor = new OutboxProcessor(outbox, new PaymentRepo(), new StripeNormalizer());
  const stats = await processor.drain();
  console.log(`Outbox consumed: ${stats.consumed}, failed: ${stats.failed}, DLQ: ${stats.dlq}`);

  // 4. Verify Database
  console.log('\n=== DB VERIFICATION ===');
  
  // Verify GCal Event
  const dbEvents = await prisma.event.findMany({
    where: { externalId: 'h0dt5om1tu4l19kg76hg1qleac' }
  });
  console.log(`Google Calendar Events with ID "h0dt5om1tu4l19kg76hg1qleac": ${dbEvents.length}`);
  if (dbEvents.length > 0) {
    console.log('Event details:', JSON.stringify(dbEvents[0], null, 2));
  }

  // Verify HubSpot Contact
  const dbContacts = await prisma.contact.findMany({
    where: { externalId: '503571432123' }
  });
  console.log(`HubSpot Contacts with ID "503571432123": ${dbContacts.length}`);
  if (dbContacts.length > 0) {
    console.log('Contact details:', JSON.stringify(dbContacts[0], null, 2));
  }
}

run().then(() => prisma.$disconnect().then(() => disconnectPrisma()));
