import { PrismaClient } from '@prisma/client';
import crypto from 'crypto';
import dotenv from 'dotenv';

dotenv.config();

const prisma = new PrismaClient();

function idKey(source: string, id: string): string {
  return crypto.createHash('sha256').update(`${source}|${id}`).digest('hex');
}

const now = new Date();
const d = (days: number): Date => new Date(now.getTime() - days * 86400_000);

async function main(): Promise<void> {
  console.log('Seeding payments...');

  const payments = [
    // Stripe — various statuses
    { source: 'stripe', externalId: 'ch_seed_001', amountCents: 9900n, currency: 'USD', status: 'COLLECTED', rawStatus: 'succeeded', occurredAt: d(1) },
    { source: 'stripe', externalId: 'ch_seed_002', amountCents: 4900n, currency: 'USD', status: 'COLLECTED', rawStatus: 'paid', occurredAt: d(2) },
    { source: 'stripe', externalId: 'ch_seed_003', amountCents: 2000n, currency: 'USD', status: 'FAILED', rawStatus: 'failed', occurredAt: d(3) },
    { source: 'stripe', externalId: 'ch_seed_004', amountCents: 1500n, currency: 'USD', status: 'PENDING', rawStatus: 'processing', occurredAt: d(4) },
    { source: 'stripe', externalId: 're_seed_001', amountCents: 2500n, currency: 'USD', status: 'REFUNDED', rawStatus: 'succeeded', occurredAt: d(5) },
    { source: 'stripe', externalId: 'ch_seed_005', amountCents: 19900n, currency: 'USD', status: 'VOIDED', rawStatus: 'canceled', occurredAt: d(6) },
    // HubSpot deals
    { source: 'hubspot', externalId: 'deal_seed_001', amountCents: 50000n, currency: 'USD', status: 'COLLECTED', rawStatus: 'closedwon', occurredAt: d(2) },
    { source: 'hubspot', externalId: 'deal_seed_002', amountCents: 25000n, currency: 'USD', status: 'FAILED', rawStatus: 'closedlost', occurredAt: d(7) },
    { source: 'hubspot', externalId: 'deal_seed_003', amountCents: 12000n, currency: 'USD', status: 'PENDING', rawStatus: 'appointmentscheduled', occurredAt: d(1) },
  ];

  for (const p of payments) {
    await prisma.payment.upsert({
      where: { source_externalId: { source: p.source, externalId: p.externalId } },
      update: { amountCents: p.amountCents, status: p.status, rawStatus: p.rawStatus },
      create: {
        source: p.source,
        externalId: p.externalId,
        idempotencyKey: idKey(p.source, p.externalId),
        amountCents: p.amountCents,
        currency: p.currency,
        status: p.status,
        rawStatus: p.rawStatus,
        occurredAt: p.occurredAt,
        raw: {},
      },
    });
  }

  console.log(`Seeded ${payments.length} payments.`);

  const contacts = [
    { source: 'hubspot', externalId: 'ct_seed_001', firstName: 'Alice', lastName: 'Smith', email: 'alice@example.com', phone: null, occurredAt: d(10) },
    { source: 'hubspot', externalId: 'ct_seed_002', firstName: 'Bob', lastName: 'Jones', email: 'bob@example.com', phone: '+15551234567', occurredAt: d(8) },
  ];

  for (const c of contacts) {
    await prisma.contact.upsert({
      where: { source_externalId: { source: c.source, externalId: c.externalId } },
      update: { firstName: c.firstName, lastName: c.lastName },
      create: {
        source: c.source,
        externalId: c.externalId,
        idempotencyKey: idKey(c.source, c.externalId),
        firstName: c.firstName,
        lastName: c.lastName,
        email: c.email,
        phone: c.phone,
        occurredAt: c.occurredAt,
        raw: {},
      },
    });
  }

  console.log(`Seeded ${contacts.length} contacts.`);

  const events = [
    { source: 'gcal', externalId: 'ev_seed_001', title: 'Q2 planning', description: null, startAt: d(5), endAt: d(5), status: 'confirmed', occurredAt: d(5) },
    { source: 'gcal', externalId: 'ev_seed_002', title: 'Customer call', description: 'Demo call', startAt: d(2), endAt: d(2), status: 'confirmed', occurredAt: d(2) },
  ];

  for (const e of events) {
    await prisma.event.upsert({
      where: { source_externalId: { source: e.source, externalId: e.externalId } },
      update: { title: e.title },
      create: {
        source: e.source,
        externalId: e.externalId,
        idempotencyKey: idKey(e.source, e.externalId),
        title: e.title,
        description: e.description,
        startAt: e.startAt,
        endAt: e.endAt,
        status: e.status,
        occurredAt: e.occurredAt,
        raw: {},
      },
    });
  }

  console.log(`Seeded ${events.length} events.`);
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
