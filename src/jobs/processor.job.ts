import 'dotenv/config';
import { ConfigService } from '../config/config.service';
import { childLogger } from '../logger/logger.service';
import { OutboxProcessor } from '../outbox/outbox.processor';
import { OutboxService } from '../outbox/outbox.service';
import { PaymentRepo } from '../repos/payment.repo';
import { StripeNormalizer } from '../normalizers/stripe.normalizer';
import { disconnectPrisma } from '../db/db.service';

const log = childLogger({ component: 'processor.job' });

async function main(): Promise<void> {
  ConfigService.load();
  const processor = new OutboxProcessor(
    new OutboxService(),
    new PaymentRepo(),
    new StripeNormalizer(),
  );
  const result = await processor.drain();
  log.info(result, 'processor_job_done');
  await disconnectPrisma();
}

if (require.main === module) {
  main().catch((err) => {
    log.error({ err: (err as Error).message, stack: (err as Error).stack }, 'fatal');
    process.exit(1);
  });
}
