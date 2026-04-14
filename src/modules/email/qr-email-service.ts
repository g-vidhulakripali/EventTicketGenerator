import nodemailer from "nodemailer";
import path from "path";
import { PrismaClient, QrStatus, TicketStatus } from "@prisma/client";
import { env } from "../../config/env";
import { getEventBySlug } from "../events/event-service";

type QrEmailPayload = {
  email: string;
  fullName: string;
  eventName: string;
  qrPayload: string;
  qrImageDataUrl: string;
};

type QrEmailSender = (input: QrEmailPayload) => Promise<void>;

type PendingQrEmailResult = {
  attempted: number;
  sent: number;
  failed: number;
  failures: Array<{
    qrTokenId: string;
    email: string;
    message: string;
  }>;
};

let transporter: nodemailer.Transporter | undefined;

function getTransporter() {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: env.SMTP_SECURE,
      auth: env.SMTP_USER || env.SMTP_PASS
        ? {
          user: env.SMTP_USER,
          pass: env.SMTP_PASS,
        }
        : undefined,
    });
  }

  return transporter;
}

function getQrImageBuffer(qrImageDataUrl: string) {
  const match = qrImageDataUrl.match(/^data:image\/png;base64,(.+)$/);
  if (!match) {
    throw new Error("QR code image is not a PNG data URL");
  }

  return Buffer.from(match[1], "base64");
}

export async function sendTicketQrEmail(input: QrEmailPayload) {
  if (!env.EMAIL_ENABLED) {
    return;
  }

  const transport = getTransporter();
  const qrImageBuffer = getQrImageBuffer(input.qrImageDataUrl);

  const textParts = [];
  if (env.EMAIL_BANNER_URL) {
    textParts.push(`[Event Banner Image]`);
    textParts.push("");
  }
  textParts.push(`🎉 Registration Confirmed – You're On Board!`);
  textParts.push("");
  textParts.push(`Hi ${input.fullName},`);
  textParts.push("");
  textParts.push(`Thank you for registering for the ${input.eventName} 🚀`);
  textParts.push(`We're excited to have you join us for this experience of learning, networking, and innovation.`);
  textParts.push("");
  textParts.push(`📍 Venue: Hochschule Schmalkalden`);
  textParts.push(`🗓 Date: 15 April 2026`);
  textParts.push(`⏰ Conference: 10:00 AM – 12:00 PM`);
  textParts.push(`⏰ Workshop: 13:00 PM – 17:00 PM`);
  textParts.push("");
  textParts.push(`Your QR Code for entry is attached to this email.`);
  textParts.push(`QR Payload: ${input.qrPayload}`);

  const htmlParts = [];
  let bannerSrc = env.EMAIL_BANNER_URL;
  let bannerIsLocal = false;
  if (env.EMAIL_BANNER_URL && !env.EMAIL_BANNER_URL.startsWith("http")) {
    bannerSrc = "cid:event-banner";
    bannerIsLocal = true;
  }

  htmlParts.push(`
<div style="font-family: Arial, sans-serif; max-width: 650px; margin: 0 auto; background-color: #f5f7fb; padding: 20px;">
  
  <!-- Card Container -->
  <div style="background-color: #ffffff; border-radius: 8px; padding: 24px;">

    <!-- Banner -->
    ${env.EMAIL_BANNER_URL ? `
      <div style="margin-bottom: 24px; text-align: center;">
        <img src="${bannerSrc}" alt="${input.eventName} Banner" 
             style="width: 100%; max-width: 650px; border-radius: 6px;" />
      </div>
    ` : ""}

    <!-- Title -->
    <h2 style="color: #2563eb; font-size: 24px; margin-bottom: 20px;">
      🎉 Registration Confirmed – You're On Board!
    </h2>

    <!-- Greeting -->
    <p style="font-size: 16px;">Hi ${input.fullName},</p>

    <p style="font-size: 16px;">
      Thank you for registering for the 
      <strong>${input.eventName}</strong> 🚀
    </p>

    <p style="font-size: 16px; margin-bottom: 20px;">
      We’re excited to have you join us for this experience of learning, networking, and innovation.
    </p>

    <!-- Event Details Box -->
    <div style="
      background-color: #f1f5f9;
      padding: 16px;
      border-radius: 8px;
      margin-bottom: 24px;
      font-size: 14px;
    ">
      <p style="margin: 6px 0;">📍 <strong>Venue:</strong> Hochschule Schmalkalden</p>
      <p style="margin: 6px 0;">📅 <strong>Date:</strong> 15 April 2026</p>
      <p style="margin: 6px 0;">⏰ <strong>Conference:</strong> 10:00 AM – 12:00 PM</p>
      <p style="margin: 6px 0;">🛠️ <strong>Workshop:</strong> 13:00 PM – 17:00 PM</p>
    </div>

    <!-- QR Code Section -->
    <div style="text-align: center; margin-bottom: 24px;">
      <p style="font-size: 14px; margin-bottom: 10px;">
        Please present this QR code securely at entry.
      </p>
      <img src="cid:ticket-qr" alt="Event QR code" 
           style="width: 160px; height: 160px;" />
    </div>

    <!-- Footer -->

    <p style="font-size: 14px;">We look forward to seeing you!</p>

    <p style="margin-top: 20px;">
      Regards,<br/>
      <strong>HSM Developer Community</strong>
    </p>

  </div>
</div>
`);

  const attachments: nodemailer.SendMailOptions["attachments"] = [
    {
      filename: "event-entry-qr.png",
      content: qrImageBuffer,
      cid: "ticket-qr",
    },
  ];

  if (bannerIsLocal && env.EMAIL_BANNER_URL) {
    attachments.push({
      filename: path.basename(env.EMAIL_BANNER_URL),
      path: path.join(process.cwd(), env.EMAIL_BANNER_URL),
      cid: "event-banner",
    });
  }

  await transport.sendMail({
    from: env.EMAIL_FROM,
    to: input.email,
    replyTo: env.EMAIL_REPLY_TO || undefined,
    subject: `${input.eventName} entry QR code`,
    text: textParts.join("\n"),
    html: htmlParts.join(""),
    attachments,
  });
}

export async function deliverQrTokenEmail(
  prisma: PrismaClient,
  qrTokenId: string,
  sender: QrEmailSender = sendTicketQrEmail,
) {
  if (!env.EMAIL_ENABLED) {
    return false;
  }

  const qrToken = await prisma.qrToken.findUnique({
    where: { id: qrTokenId },
    include: {
      ticket: {
        include: {
          event: true,
          registrant: true,
        },
      },
    },
  });

  if (
    !qrToken ||
    qrToken.emailedAt ||
    qrToken.status !== QrStatus.ACTIVE ||
    qrToken.ticket.ticketStatus !== TicketStatus.ACTIVE ||
    !qrToken.qrImageDataUrl
  ) {
    return false;
  }

  await sender({
    email: qrToken.ticket.registrant.email,
    fullName: qrToken.ticket.registrant.fullName,
    eventName: qrToken.ticket.event.name,
    qrPayload: qrToken.payload,
    qrImageDataUrl: qrToken.qrImageDataUrl,
  });

  const updated = await prisma.qrToken.updateMany({
    where: {
      id: qrToken.id,
      emailedAt: null,
    },
    data: {
      emailedAt: new Date(),
    },
  });

  return updated.count > 0;
}

export async function deliverPendingQrEmails(
  prisma: PrismaClient,
  input: {
    eventSlug: string;
    limit?: number;
  },
  sender: QrEmailSender = sendTicketQrEmail,
): Promise<PendingQrEmailResult> {
  if (!env.EMAIL_ENABLED) {
    return { attempted: 0, sent: 0, failed: 0, failures: [] };
  }

  const event = await getEventBySlug(prisma, input.eventSlug);
  const pendingTokens = await prisma.qrToken.findMany({
    where: {
      status: QrStatus.ACTIVE,
      emailedAt: null,
      qrImageDataUrl: { not: null },
      ticket: {
        eventId: event.id,
        ticketStatus: TicketStatus.ACTIVE,
      },
    },
    include: {
      ticket: {
        include: {
          registrant: true,
        },
      },
    },
    orderBy: { issuedAt: "asc" },
    take: input.limit ?? 50,
  });

  let sent = 0;
  let failed = 0;
  const failures: PendingQrEmailResult["failures"] = [];

  for (const qrToken of pendingTokens) {
    try {
      const delivered = await deliverQrTokenEmail(prisma, qrToken.id, sender);
      if (delivered) {
        sent += 1;
      }
    } catch (error) {
      failed += 1;
      failures.push({
        qrTokenId: qrToken.id,
        email: qrToken.ticket.registrant.email,
        message: error instanceof Error ? error.message : "Unknown email delivery error",
      });
    }
  }

  return {
    attempted: pendingTokens.length,
    sent,
    failed,
    failures,
  };
}
