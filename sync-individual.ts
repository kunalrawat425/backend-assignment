import 'dotenv/config';
import { ConfigService } from './src/config/config.service';
import { getLogger } from './src/logger/logger.service';
import { ConnectorFactory } from './src/connectors/connector.factory';
import { CursorService } from './src/cursor/cursor.service';
import { OutboxService } from './src/outbox/outbox.service';
import { RunReportService } from './src/reports/run-report.service';
import { ProducerJob } from './src/jobs/producer.job';
import { SourceType } from './src/types/enums';
import { disconnectPrisma } from './src/db/db.service';

async function main() {
  const sourceName = process.argv[2] as SourceType;
  if (!sourceName) {
    console.error('Please specify a source (stripe, hubspot, gcal)');
    process.exit(1);
  }

  // Load config
  ConfigService.load();
  const cfg = ConfigService.get();

  const cursors = new CursorService();
  const outbox = new OutboxService();
  const reports = new RunReportService();
  const job = new ProducerJob(cursors, outbox, reports);


  // Build connectors
  const connectors = ConnectorFactory.build(cfg);
  const matches = connectors.filter((c) => c.source === sourceName);

  if (matches.length === 0) {
    console.error(`Source ${sourceName} is not enabled or built.`);
    process.exit(1);
  }

  console.log(`\n=== Starting Individual Sync for Source: ${sourceName.toUpperCase()} ===`);

  for (const match of matches) {
    console.log(`\nRunning connector: ${sourceName}:${match.connector.entity}`);
    await job.runOne(sourceName, match.connector);
  }

  console.log(`\n=== Completed Sync for Source: ${sourceName.toUpperCase()} ===`);
  
  // Wait for Winston logger to flush to console before exiting
  await new Promise((resolve) => setTimeout(resolve, 1000));
}

main().then(() => disconnectPrisma()).catch((err) => {
  console.error('Fatal Error:', err);
  process.exit(1);
});
