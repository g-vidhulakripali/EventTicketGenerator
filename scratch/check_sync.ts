import { PrismaClient } from "@prisma/client";
import "dotenv/config";

const prisma = new PrismaClient();

async function check() {
  const registrantCount = await prisma.registrant.count();
  const ticketCount = await prisma.ticket.count();
  const qrTokenCount = await prisma.qrToken.count();
  const lastSync = await prisma.syncState.findMany();
  const registrants = await prisma.registrant.findMany({ select: { fullName: true, sheetRowNumber: true } });
  const recentLogs = await prisma.auditLog.findMany({
    take: 5,
    orderBy: { createdAt: 'desc' },
  });

  console.log({
    registrantCount,
    ticketCount,
    qrTokenCount,
    lastSync: lastSync.map((s) => ({ id: s.id, lastRow: s.lastSheetRowNumber, time: s.lastSyncedAt })),
    registrants,
    recentLogs: recentLogs.map((l) => ({ action: l.action, outcome: l.outcome, time: l.createdAt, message: l.message })),
  });
}

check()
  .finally(async () => {
    await prisma.$disconnect();
  });
