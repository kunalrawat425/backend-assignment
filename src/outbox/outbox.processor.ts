import Stripe from 'stripe';
import { ConfigService } from '../config/config.service';
import { childLogger } from '../logger/logger.service';
import { OutboxRow, OutboxService } from './outbox.service';
import { PaymentRepo } from '../repos/payment.repo';
import { ContactRepo } from '../repos/contact.repo';
import { EventRepo } from '../repos/event.repo';
import { CurrencyRejectedError, StripeNormalizer } from '../normalizers/stripe.normalizer';
import { HubSpotContactNormalizer, HubSpotDealNormalizer } from '../normalizers/hubspot.normalizer';
import { GCalNormalizer } from '../normalizers/gcal.normalizer';
import { EntityType, PaymentStatus, SourceType } from '../types/enums';
import { UnifiedPayment, UnifiedContact, UnifiedEvent } from '../types/unified';
import { getPrisma, disconnectPrisma } from '../db/db.service';
import { withDbRetry } from '../db/retry-policy.service';

const log = childLogger({ component: 'outbox.processor' });

const MAX_OUTBOX_ATTEMPTS = 5;

export class OutboxProcessor {
  private readonly contactRepo = new ContactRepo();
  private readonly eventRepo = new EventRepo();
  private readonly hubspotContactNormalizer = new HubSpotContactNormalizer();
  private readonly hubspotDealNormalizer = new HubSpotDealNormalizer();
  private readonly gcalNormalizer = new GCalNormalizer();

  constructor(
    private readonly outbox: OutboxService,
    private readonly paymentRepo: PaymentRepo,
    private readonly stripeNormalizer: StripeNormalizer,
  ) {}

  async drain(): Promise<{ consumed: number; failed: number; dlq: number }> {
    const cfg = ConfigService.get();
    let totalConsumed = 0;
    let totalFailed = 0;
    let totalDlq = 0;
    let safety = 0;
    while (safety++ < 1000) {
      const rows = await this.outbox.claimBatch(cfg.OUTBOX_BATCH_SIZE);
      if (rows.length === 0) break;
      const result = await this.processBatch(rows);
      totalConsumed += result.consumed;
      totalFailed += result.failed;
      totalDlq += result.dlq;
      if (rows.length < cfg.OUTBOX_BATCH_SIZE) break;
    }
    log.info({ consumed: totalConsumed, failed: totalFailed, dlq: totalDlq }, 'drain_done');
    return { consumed: totalConsumed, failed: totalFailed, dlq: totalDlq };
  }

  private async processBatch(
    rows: OutboxRow[],
  ): Promise<{ consumed: number; failed: number; dlq: number }> {
    const consumedIds: bigint[] = [];
    let failed = 0;
    let dlq = 0;
    for (const row of rows) {
      try {
        if (row.entity === EntityType.PAYMENTS) {
          const unified = this.normalizePayment(row);
          if (unified) {
            await this.paymentRepo.upsert(unified);
          }
        } else if (row.entity === EntityType.CONTACTS) {
          const unified = this.normalizeContact(row);
          if (unified) {
            await this.contactRepo.upsert(unified);
          }
        } else if (row.entity === EntityType.EVENTS) {
          const unified = this.normalizeEvent(row);
          if (unified) {
            await this.eventRepo.upsert(unified);
          }
        }
        consumedIds.push(row.id);
      } catch (err) {
        const e = err as Error;
        if (row.attempts + 1 >= MAX_OUTBOX_ATTEMPTS) {
          await this.sendToDlq(row, e.message);
          await this.outbox.markPermanentlyFailed(row.id, e.message);
          dlq++;
        } else {
          await this.outbox.markFailed(row.id, e.message);
          failed++;
        }
        log.warn(
          {
            outboxId: row.id.toString(),
            source: row.source,
            externalId: row.externalId,
            attempts: row.attempts + 1,
            err: e.message,
          },
          'outbox_row_failed',
        );
      }
    }
    if (consumedIds.length > 0) {
      await this.outbox.markConsumed(consumedIds);
    }
    return { consumed: consumedIds.length, failed, dlq };
  }

  private normalizePayment(row: OutboxRow): UnifiedPayment | null {
    if (row.source === SourceType.STRIPE) {
      const raw = row.rawPayload as Stripe.Charge & { __object?: string };
      const unified =
        raw.__object === 'refund'
          ? this.stripeNormalizer.normalizeRefund(raw as unknown as Stripe.Refund)
          : this.stripeNormalizer.normalize(raw);
      if (unified.status === PaymentStatus.UNKNOWN) {
        log.warn(
          { source: row.source, externalId: row.externalId, rawStatus: unified.rawStatus },
          'unmapped_status_persisted_as_unknown',
        );
      }
      return unified;
    }
    if (row.source === SourceType.HUBSPOT) {
      return this.hubspotDealNormalizer.normalize(row.rawPayload as any);
    }
    throw new Error(`unsupported_source_for_payment_normalization: ${row.source}`);
  }

  private normalizeContact(row: OutboxRow): UnifiedContact | null {
    if (row.source === SourceType.HUBSPOT) {
      return this.hubspotContactNormalizer.normalize(row.rawPayload as any);
    }
    throw new Error(`unsupported_source_for_contact_normalization: ${row.source}`);
  }

  private normalizeEvent(row: OutboxRow): UnifiedEvent | null {
    if (row.source === SourceType.GCAL) {
      return this.gcalNormalizer.normalize(row.rawPayload as any);
    }
    throw new Error(`unsupported_source_for_event_normalization: ${row.source}`);
  }

  private async sendToDlq(row: OutboxRow, error: string): Promise<void> {
    await withDbRetry(() =>
      getPrisma().dlqLog.create({
        data: {
          source: row.source,
          entity: row.entity,
          externalId: row.externalId,
          payload: row.rawPayload as object,
          error: error.slice(0, 2000),
          retryCount: row.attempts + 1,
          runId: row.runId,
        },
      }),
    );
    if (error.includes('CurrencyRejected') || error.startsWith('unsupported_currency')) {
      // tracked specifically — surfaces in metrics/unmapped if user wants
      log.warn({ externalId: row.externalId }, 'currency_rejected_dlq');
    } else if (error.includes(CurrencyRejectedError.name)) {
      log.warn({ externalId: row.externalId }, 'currency_rejected_dlq');
    }
  }
}

// CLI entry — `pnpm job:process`
async function main(): Promise<void> {
  ConfigService.load();
  const processor = new OutboxProcessor(
    new OutboxService(),
    new PaymentRepo(),
    new StripeNormalizer(),
  );
  await processor.drain();
  await disconnectPrisma();
}

if (require.main === module) {
  main().catch((err) => {
    log.error({ err: err.message, stack: err.stack }, 'fatal');
    process.exit(1);
  });
}

