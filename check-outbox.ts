import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function check() {
  const items = await prisma.ingestOutbox.findMany();
  console.log('Outbox items count:', items.length);
  items.forEach((item, idx) => {
    console.log(`[Item ${idx + 1}] ID: ${item.id}, Source: ${item.source}, Entity: ${item.entity}, ExternalId: ${item.externalId}, Status: ${item.status}, LastError: ${item.lastError}`);
  });
}

check().then(() => prisma.$disconnect());
