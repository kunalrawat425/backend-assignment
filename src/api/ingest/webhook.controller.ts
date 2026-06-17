import { Request, Response, Router } from 'express';
import Stripe from 'stripe';
import { v4 as uuidv4 } from 'uuid';
import { ConfigService } from '../../config/config.service';
import { OutboxService } from '../../outbox/outbox.service';
import { EntityType, SourceType } from '../../types/enums';
import { childLogger } from '../../logger/logger.service';

const log = childLogger({ component: 'webhook.controller' });

export function buildWebhookRouter(): Router {
  const r = Router();
  const cfg = ConfigService.get();
  const outbox = new OutboxService();

  // Stripe webhook — uses raw body for signature verification.
  // Mount with express.raw({ type: 'application/json' }) on this path.
  r.post('/webhooks/stripe', async (req: Request, res: Response) => {
    if (!cfg.STRIPE_ENABLED) {
      res.status(404).json({ error: 'stripe_disabled' });
      return;
    }
    if (!cfg.STRIPE_WEBHOOK_SECRET || !cfg.STRIPE_API_KEY) {
      res.status(503).json({ error: 'stripe_not_configured' });
      return;
    }
    const sig = req.header('stripe-signature');
    if (!sig) {
      res.status(400).json({ error: 'missing_signature' });
      return;
    }
    const stripe = new Stripe(cfg.STRIPE_API_KEY, {
      apiVersion: '2024-09-30.acacia' as Stripe.LatestApiVersion,
    });
    let event: Stripe.Event;
    try {
      // req.body MUST be the raw Buffer here (express.raw)
      event = stripe.webhooks.constructEvent(
        req.body as Buffer,
        sig,
        cfg.STRIPE_WEBHOOK_SECRET,
      );
    } catch (err) {
      log.warn({ err: (err as Error).message }, 'stripe_webhook_sig_failed');
      res.status(400).json({ error: 'invalid_signature' });
      return;
    }

    try {
      await routeStripeEvent(event, outbox);
      res.json({ received: true, type: event.type });
    } catch (err) {
      log.error({ type: event.type, err: (err as Error).message }, 'stripe_webhook_handler_failed');
      res.status(500).json({ error: 'handler_failed' });
    }
  });

  // HubSpot webhook stub — full impl Sprint 2
  r.post('/webhooks/hubspot', (_req: Request, res: Response) => {
    if (!cfg.HUBSPOT_ENABLED) {
      res.status(404).json({ error: 'hubspot_disabled' });
      return;
    }
    res.status(501).json({ error: 'not_implemented' });
  });

  return r;
}

async function routeStripeEvent(event: Stripe.Event, outbox: OutboxService): Promise<void> {
  const runId = uuidv4();
  switch (event.type) {
    case 'charge.succeeded':
    case 'charge.updated':
    case 'charge.failed':
    case 'charge.captured':
    case 'charge.pending': {
      const charge = event.data.object as Stripe.Charge;
      await outbox.enqueue([
        {
          source: SourceType.STRIPE,
          entity: EntityType.PAYMENTS,
          externalId: charge.id,
          rawPayload: charge,
          runId,
        },
      ]);
      log.info({ chargeId: charge.id, type: event.type, runId }, 'webhook_charge_enqueued');
      return;
    }
    case 'charge.refunded': {
      const charge = event.data.object as Stripe.Charge;
      // Enqueue parent charge plus each refund as separate payment rows
      await outbox.enqueue([
        {
          source: SourceType.STRIPE,
          entity: EntityType.PAYMENTS,
          externalId: charge.id,
          rawPayload: charge,
          runId,
        },
      ]);
      // Refund rows handled via separate `refund.created` events
      log.info({ chargeId: charge.id, runId }, 'webhook_charge_refunded_parent_enqueued');
      return;
    }
    case 'refund.created':
    case 'refund.updated': {
      const refund = event.data.object as Stripe.Refund;
      await outbox.enqueue([
        {
          source: SourceType.STRIPE,
          entity: EntityType.PAYMENTS,
          externalId: refund.id,
          rawPayload: { ...refund, __object: 'refund' },
          runId,
        },
      ]);
      log.info({ refundId: refund.id, runId }, 'webhook_refund_enqueued');
      return;
    }
    default:
      log.debug({ type: event.type }, 'webhook_event_ignored');
  }
}
