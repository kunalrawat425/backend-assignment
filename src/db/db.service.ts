import { PrismaClient } from '@prisma/client';

let prisma: PrismaClient | null = null;

export function getPrisma(): PrismaClient {
  if (prisma) return prisma;
  prisma = new PrismaClient();
  return prisma;
}

export async function disconnectPrisma(): Promise<void> {
  if (prisma) {
    await prisma.$disconnect();
    prisma = null;
  }
}

export async function pingDb(): Promise<{ ok: boolean; latencyMs: number; error?: string }> {
  const t0 = Date.now();
  try {
    await getPrisma().$queryRaw`SELECT 1`;
    return { ok: true, latencyMs: Date.now() - t0 };
  } catch (e) {
    return { ok: false, latencyMs: Date.now() - t0, error: (e as Error).message };
  }
}
