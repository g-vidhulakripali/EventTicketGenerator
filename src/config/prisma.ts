import { PrismaClient } from "@prisma/client";
import { env } from "./env";

let prisma: PrismaClient | undefined;
let directPrisma: PrismaClient | undefined;

function getPortFromUrl(url: string) {
  try {
    const match = url.match(/:(\d+)\//);
    return match ? match[1] : "unknown";
  } catch {
    return "error";
  }
}

export function getPrismaClient() {
  if (!prisma) {
    const port = getPortFromUrl(env.DATABASE_URL);
    console.log(`[Prisma] Initializing Pooled Client (Port: ${port})`);
    prisma = new PrismaClient({
      datasourceUrl: env.DATABASE_URL,
    });
  }

  return prisma;
}

export function getDirectPrismaClient() {
  if (!directPrisma) {
    const port = getPortFromUrl(env.DIRECT_URL);
    console.log(`[Prisma] Initializing Direct Client (Port: ${port})`);
    directPrisma = new PrismaClient({
      datasourceUrl: env.DIRECT_URL,
    });
  }

  return directPrisma;
}

export async function resetPrismaClient() {
  if (prisma) {
    await prisma.$disconnect();
    prisma = undefined;
  }
  if (directPrisma) {
    await directPrisma.$disconnect();
    directPrisma = undefined;
  }
}

