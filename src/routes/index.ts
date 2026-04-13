import { FastifyInstance } from "fastify";
import { attendanceAcceptSchema, loginSchema, issueQrSchema, manualCheckInSchema, mobileScanSchema, pastedSheetImportSchema, revokeQrSchema, scanValidationSchema, statusLookupSchema, syncSchema } from "../utils/validation";
import { loginUser } from "../modules/auth/auth-service";
import { syncRegistrantsFromSource } from "../modules/sync/sync-service";
import { GoogleSheetsRegistrationSource } from "../modules/sync/google-sheets-provider";
import { PastedSheetRegistrationSource } from "../modules/sync/pasted-sheet-source";
import { SampleRegistrationSource } from "../modules/sync/sample-registration-source";
import { issueQrForTicket, reissueQrToken, revokeQrToken } from "../modules/tickets/qr-service";
import { getTicketStatus, lookupRegistrants } from "../modules/registrants/registrant-service";
import { checkInByQr, manualCheckIn, validateQrScan } from "../modules/checkins/checkin-service";
import { deliverPendingQrEmails } from "../modules/email/qr-email-service";
import { UserRole } from "@prisma/client";
import { getAuthUser } from "../utils/auth-user";
import { AppError } from "../utils/errors";
import { acceptAttendance } from "../modules/attendance/attendance-service";

function getDefaultEventSlug(app: FastifyInstance, eventSlug?: string) {
  return eventSlug ?? app.config.DEFAULT_EVENT_SLUG;
}

function getPathParam<T extends string>(request: { params: unknown }, key: T) {
  return (request.params as Record<T, string>)[key];
}

export function registerRoutes(app: FastifyInstance) {
  const adminOnly = { preHandler: [app.authorize([UserRole.ADMIN])] };
  const staffOnly = { preHandler: [app.authorize([UserRole.ADMIN, UserRole.SCANNER])] };

  app.get("/", async () => ({
    name: "qr-event-entry",
    status: "ok",
    docs: "/docs",
    health: "/health",
  }));

  app.get("/health", async () => ({ status: "ok" }));

  // ----------------------------------------------------------------
  // One-call trigger: sync Google Sheets + send all pending QR emails
  // No JWT needed — authenticated by TRIGGER_SECRET env var
  // POST /api/v1/trigger  { "secret": "your-trigger-secret" }
  // ----------------------------------------------------------------
  app.post("/api/v1/trigger", async (request, reply) => {
    const { secret } = request.body as { secret?: string };
    if (!secret || secret !== app.config.TRIGGER_SECRET) {
      return reply.status(401).send({ error: "Unauthorized" });
    }

    const eventSlug = app.config.DEFAULT_EVENT_SLUG;

    const syncResult = await syncRegistrantsFromSource(
      app.prisma,
      new GoogleSheetsRegistrationSource(),
      eventSlug,
    );

    const emailResult = await deliverPendingQrEmails(app.prisma, { eventSlug });

    return reply.send({
      sync: syncResult,
      emails: emailResult,
    });
  });

  // ----------------------------------------------------------------
  // Public mobile scan endpoint — no auth required
  // Mobile app: scan QR → POST /scan → receive { status, ticketId, name, email }
  // ----------------------------------------------------------------
  app.post("/api/v1/scan", {
    config: { rateLimit: { max: 30, timeWindow: "1 minute" } },
  }, async (request, reply) => {
    try {
      const body = mobileScanSchema.parse(request.body);

      const result = await validateQrScan(app.prisma, {
        qrPayload: body.qrPayload,
        eventSlug: body.eventSlug,
      });

      // Flatten registrant fields to the shape the mobile app expects
      if (result.status === "valid" && result.registrant) {
        return reply.send({
          status: result.status,
          ticketId: result.ticketId,
          name: result.registrant.fullName,
          email: result.registrant.email,
        });
      }

      return reply.send(result);
    } catch (error) {
      return reply.status(500).send({ error: "Internal server error" });
    }
  });

  app.post("/api/v1/auth/login", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (request, reply) => {
    const body = loginSchema.parse(request.body);
    const user = await loginUser(app.prisma, body.email.toLowerCase(), body.password, request.ip);
    const token = await reply.jwtSign(
      { role: user.role, email: user.email },
      { sign: { sub: user.id, expiresIn: app.config.JWT_EXPIRES_IN } },
    );

    return {
      token,
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        fullName: user.fullName,
      },
    };
  });

  app.post("/api/v1/sync/google-sheets", adminOnly, async (request) => {
    const body = syncSchema.parse(request.body ?? {});
    return syncRegistrantsFromSource(
      app.prisma,
      new GoogleSheetsRegistrationSource(),
      getDefaultEventSlug(app, body.eventSlug),
    );
  });

  app.post("/api/v1/dev/load-sample-registrants", adminOnly, async (request) => {
    if (app.config.NODE_ENV === "production") {
      throw new AppError(404, "Not found");
    }

    const body = syncSchema.parse(request.body ?? {});
    return syncRegistrantsFromSource(
      app.prisma,
      new SampleRegistrationSource(),
      getDefaultEventSlug(app, body.eventSlug),
    );
  });

  app.post("/api/v1/dev/import-sheet-rows", adminOnly, async (request) => {
    if (app.config.NODE_ENV === "production") {
      throw new AppError(404, "Not found");
    }

    const body = pastedSheetImportSchema.parse(request.body);
    return syncRegistrantsFromSource(
      app.prisma,
      new PastedSheetRegistrationSource(body.rowsText),
      getDefaultEventSlug(app, body.eventSlug),
    );
  });

  app.post("/api/v1/tickets/issue-qr", adminOnly, async (request) => {
    const body = issueQrSchema.parse(request.body);
    return issueQrForTicket(app.prisma, body.ticketId, getAuthUser(request).sub);
  });

  // Send QR emails to all registrants who haven't received one yet
  app.post("/api/v1/tickets/send-qr-emails", adminOnly, async (request) => {
    const body = syncSchema.parse(request.body ?? {});
    const eventSlug = getDefaultEventSlug(app, body.eventSlug);
    return deliverPendingQrEmails(app.prisma, { eventSlug });
  });

  app.get("/api/v1/tickets/:ticketId/status", staffOnly, async (request) => {
    const ticketId = getPathParam(request, "ticketId");
    return getTicketStatus(app.prisma, ticketId);
  });

  app.post("/api/v1/scans/validate", {
    ...staffOnly,
    config: { rateLimit: { max: 60, timeWindow: "1 minute" } },
  }, async (request) => {
    const body = scanValidationSchema.parse(request.body);
    const user = getAuthUser(request);
    return validateQrScan(app.prisma, {
      qrPayload: body.qrPayload,
      eventSlug: body.eventSlug,
      scannerUserId: user.sub,
      scannerDeviceId: body.scannerDeviceId,
      ipAddress: request.ip,
    });
  });

  app.post("/api/v1/checkins/scan", {
    ...staffOnly,
    config: { rateLimit: { max: 60, timeWindow: "1 minute" } },
  }, async (request) => {
    const body = scanValidationSchema.parse(request.body);
    const user = getAuthUser(request);
    return checkInByQr(app.prisma, {
      qrPayload: body.qrPayload,
      eventSlug: body.eventSlug,
      scannerUserId: user.sub,
      scannerDeviceId: body.scannerDeviceId,
      ipAddress: request.ip,
    });
  });

  app.post("/api/v1/attendance/accept", {
    ...staffOnly,
    config: { rateLimit: { max: 60, timeWindow: "1 minute" } },
  }, async (request, reply) => {
    const body = attendanceAcceptSchema.parse(request.body);
    const user = getAuthUser(request);

    const scanResult = await validateQrScan(app.prisma, {
      qrPayload: body.qrPayload,
      eventSlug: body.eventSlug,
      scannerUserId: user.sub,
      ipAddress: request.ip,
    });

    if (scanResult.status !== "valid" || !scanResult.ticketId || !scanResult.registrant) {
      return reply.status(400).send({
        status: "error",
        error: `Ticket status: ${scanResult.status}`,
      });
    }

    const sheet = await acceptAttendance({
      eventType: body.eventType,
      attendee: {
        name: scanResult.registrant.fullName,
        email: scanResult.registrant.email,
        ticketId: scanResult.ticketId,
      },
    });

    return {
      status: "accepted",
      attendee: {
        name: scanResult.registrant.fullName,
        email: scanResult.registrant.email,
        ticketId: scanResult.ticketId,
      },
      sheet,
    };
  });

  app.post("/api/v1/checkins/manual", staffOnly, async (request) => {
    const body = manualCheckInSchema.parse(request.body);
    const user = getAuthUser(request);
    return manualCheckIn(app.prisma, {
      eventSlug: body.eventSlug,
      ticketId: body.ticketId,
      registrantQuery: body.registrantQuery,
      scannerUserId: user.sub,
      scannerDeviceId: body.scannerDeviceId,
      notes: body.notes,
    });
  });

  app.post("/api/v1/tickets/revoke-qr", adminOnly, async (request) => {
    const body = revokeQrSchema.parse(request.body);
    await revokeQrToken(app.prisma, body.ticketId, body.reason, getAuthUser(request).sub);
    return { success: true };
  });

  app.post("/api/v1/tickets/reissue-qr", adminOnly, async (request) => {
    const body = revokeQrSchema.parse(request.body);
    return reissueQrToken(app.prisma, body.ticketId, body.reason, getAuthUser(request).sub);
  });

  app.get("/api/v1/registrants/lookup", staffOnly, async (request) => {
    const query = statusLookupSchema.parse(request.query);
    return lookupRegistrants(app.prisma, query.eventSlug, query.query);
  });

  app.get("/api/v1/audit", adminOnly, async (request) => {
    const { ticketId, eventId } = request.query as { ticketId?: string; eventId?: string };
    return app.prisma.auditLog.findMany({
      where: {
        ticketId,
        eventId,
      },
      orderBy: { createdAt: "desc" },
      take: 200,
    });
  });

  app.get("/api/v1/checkins/export", adminOnly, async (request) => {
    const { eventSlug } = request.query as { eventSlug: string };
    const event = await app.prisma.event.findUniqueOrThrow({ where: { slug: eventSlug } });
    const results = await app.prisma.ticket.findMany({
      where: { eventId: event.id },
      include: { registrant: true },
      orderBy: { checkedInAt: "desc" },
    });
    return results.map((ticket: typeof results[number]) => ({
      ticketId: ticket.id,
      fullName: ticket.registrant.fullName,
      email: ticket.registrant.email,
      checkedInAt: ticket.checkedInAt,
      ticketType: ticket.ticketType,
    }));
  });
}
