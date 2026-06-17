import { PrismaClient } from '@prisma/client';

const regions = [
  'ap-south-2',
  'ap-southeast-3',
  'ap-southeast-4',
  'eu-central-2',
  'eu-south-1',
  'eu-south-2',
  'eu-north-1',
  'me-south-1',
  'me-central-1'
];

async function testRegion(region: string) {
  const url = `postgresql://postgres.nyavzumoljcrmmwcdcuj:San4930%404930@aws-0-${region}.pooler.supabase.com:5432/postgres`;
  const prisma = new PrismaClient({
    datasources: {
      db: { url }
    }
  });

  try {
    await prisma.$queryRaw`SELECT 1`;
    console.log(`SUCCESS connected to region: ${region}`);
    await prisma.$disconnect();
    return true;
  } catch (err: any) {
    console.log(`Region ${region} error:`, err.message.split('\n').filter((l: string) => l.trim()).slice(0, 3).join(' '));
    await prisma.$disconnect();
    return false;
  }
}

async function run() {
  for (const region of regions) {
    await testRegion(region);
  }
  console.log('Done.');
}

run();
