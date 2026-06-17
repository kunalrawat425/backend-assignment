import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function verify() {
  console.log('=== VERIFYING LANDED DATA IN SUPABASE ===\n');

  // Verify GCal Event
  const events = await prisma.event.findMany({
    orderBy: { ingestedAt: 'desc' },
    take: 5
  });
  console.log(`--- Google Calendar Events in Database (Count: ${await prisma.event.count()}) ---`);
  events.forEach((event, idx) => {
    console.log(`[Event ${idx + 1}] ID: ${event.id}, ExternalId: ${event.externalId}, Title: "${event.title}", IngestedAt: ${event.ingestedAt}`);
  });

  // Verify HubSpot Contact
  const contacts = await prisma.contact.findMany({
    orderBy: { ingestedAt: 'desc' },
    take: 5
  });
  console.log(`\n--- HubSpot Contacts in Database (Count: ${await prisma.contact.count()}) ---`);
  contacts.forEach((contact, idx) => {
    console.log(`[Contact ${idx + 1}] ID: ${contact.id}, ExternalId: ${contact.externalId}, Email: "${contact.email}", Name: "${contact.firstName} ${contact.lastName}", IngestedAt: ${contact.ingestedAt}`);
  });
}

verify().then(() => prisma.$disconnect()).catch((err) => {
  console.error(err);
  prisma.$disconnect();
});
