import { AuditAction, AuditOutcome, Prisma, PrismaClient } from "@prisma/client";

export type PrismaDbClient = PrismaClient | Prisma.TransactionClient;

export async function writeAuditLog(
  prisma: PrismaDbClient,
  input: {
    action: AuditAction;
    outcome: AuditOutcome;
    message: string;
    eventId?: string;
    ticketId?: string;
    registrantId?: string;
    userId?: string;
    ipAddress?: string;
    metadata?: Record<string, unknown>;
  },
) {
  try {
    await prisma.auditLog.create({
      data: {
        action: input.action,
        outcome: input.outcome,
        message: input.message,
        eventId: input.eventId,
        ticketId: input.ticketId,
        registrantId: input.registrantId,
        userId: input.userId,
        ipAddress: input.ipAddress,
        metadataJson: input.metadata ? JSON.stringify(input.metadata) : undefined,
      },
    });
  } catch (error) {
    // If audit logging fails, we log to console but don't rethrow.
    // This ensures that major transactions (like generating a ticket) are NOT
    // rolled back just because an audit log entry failed to save.
    console.error(`[AuditLog Failure] ${input.action}: ${input.message}`, error);
  }
}

