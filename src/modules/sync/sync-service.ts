import { AuditAction, AuditOutcome, PrismaClient, TicketStatus } from "@prisma/client";
import { createChecksum } from "../../utils/crypto";
import { getEventBySlug } from "../events/event-service";
import { writeAuditLog } from "../audit/audit-service";
import { ensureActiveQrForTicket } from "../tickets/qr-service";
import { RegistrationSource } from "./google-sheets-provider";

type SyncRow = Awaited<ReturnType<RegistrationSource["listRows"]>>[number];

function parseTimestamp(value?: string) {
  if (!value) {
    return undefined;
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function buildRegistrantPayload(row: SyncRow) {
  const rawDataJson = JSON.stringify(row);
  // Fingerprint is Timestamp + Email to handle row shifts in Google Sheets
  const fingerprint = `${row.timestamp || ''}:${row.email!.toLowerCase()}`.trim();
  
  return {
    fullName: row.fullName!,
    email: row.email!.toLowerCase(),
    phone: row.phone,
    guestCategory: row.guestCategory,
    tags: row.tags,
    responseTimestamp: parseTimestamp(row.timestamp),
    syncChecksum: createChecksum(rawDataJson),
    rawDataJson,
    fingerprint,
  };
}

export async function syncRegistrantsFromSource(
  prisma: PrismaClient,
  source: RegistrationSource,
  eventSlug: string,
) {
  const event = await getEventBySlug(prisma, eventSlug);
  const syncStateId = `google-sheets:${event.id}`;
  const rows = await source.listRows();

  console.log(`[Sync] 📊 Sheet Scan: Found ${rows.length} rows.`);

  // Integrity Check: Find rows missing from DB
  const existingRegistrants = await prisma.registrant.findMany({
    where: { eventId: event.id },
    select: { sheetRowRef: true }
  });
  const existingRowRefs = new Set(existingRegistrants.map(r => r.sheetRowRef));

  const rowsToProcess = rows.filter((row) => {
    const fingerprint = `${row.timestamp || ''}:${row.email!.toLowerCase()}`.trim();
    return !existingRowRefs.has(fingerprint);
  });

  if (rowsToProcess.length > 0) {
    console.log(`[Sync] 🔍 Discovery: Found ${rowsToProcess.length} rows to synchronize.`);
  }

  let processed = 0;
  let skipped = 0;

  for (const row of rowsToProcess) {
    if (!row.fullName || !row.email) {
      skipped += 1;
      continue;
    }

    const { fingerprint, ...dbPayload } = buildRegistrantPayload(row);
    const rowRef = fingerprint;

    const registrant = await prisma.registrant.upsert({
      where: {
        eventId_sheetRowRef: {
          eventId: event.id,
          sheetRowRef: rowRef,
        },
      },
      update: {
        ...dbPayload,
        sheetRowNumber: row.rowNumber, // Keep row number updated for logging
      },
      create: {
        eventId: event.id,
        sheetRowRef: rowRef,
        sheetRowNumber: row.rowNumber,
        ...dbPayload,
      },
    });

    const ticket = await prisma.ticket.upsert({
      where: { registrantId: registrant.id },
      update: {
        ticketType: row.ticketType || "standard",
      },
      create: {
        eventId: event.id,
        registrantId: registrant.id,
        ticketType: row.ticketType || "standard",
        ticketStatus: TicketStatus.ACTIVE,
      },
    });

    if (ticket.id) {
      await ensureActiveQrForTicket(prisma, ticket.id);
    }

    await writeAuditLog(prisma, {
      action: AuditAction.REGISTRANT_SYNCED,
      outcome: AuditOutcome.SUCCESS,
      eventId: event.id,
      registrantId: registrant.id,
      message: "Registrant synced from Google Sheets",
      metadata: { rowNumber: row.rowNumber },
    });

    processed += 1;
    if (processed % 20 === 0) {
      console.log(`[Sync] ⏳ Progress: Synchronized ${processed}/${rowsToProcess.length}...`);
    }
  }

  const lastRowNumber = rows.reduce(
    (currentMax, row) => Math.max(currentMax, row.rowNumber),
    0
  );
  
  await prisma.syncState.upsert({
    where: { id: syncStateId },
    update: {
      lastSheetRowNumber: lastRowNumber,
      lastSyncedAt: new Date(),
    },
    create: {
      id: syncStateId,
      lastSheetRowNumber: lastRowNumber,
      lastSyncedAt: new Date(),
    },
  });

  if (processed > 0) {
    console.log(`[Sync] ✅ Integrity Verified: ${processed} rows synchronized.`);
  }

  return { processed, skipped, lastRowNumber };
}
