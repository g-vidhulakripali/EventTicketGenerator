import { PrismaClient } from "@prisma/client";
import { FastifyBaseLogger } from "fastify";
import { AppEnv } from "../../config/env";
import { deliverPendingQrEmails } from "../email/qr-email-service";
import { syncRegistrantsFromSource } from "./sync-service";
import { GoogleSheetsRegistrationSource, RegistrationSource } from "./google-sheets-provider";

type SyncPollerOptions = {
  prisma: PrismaClient;
  config: Pick<AppEnv, "DEFAULT_EVENT_SLUG" | "GOOGLE_SHEETS_ENABLED" | "GOOGLE_SHEETS_POLL_INTERVAL_MS">;
  logger: Pick<FastifyBaseLogger, "info" | "warn" | "error">;
  source?: RegistrationSource;
};

export function startGoogleSheetsSyncPolling(options: SyncPollerOptions) {
  if (!options.config.GOOGLE_SHEETS_ENABLED) {
    console.log("[Worker] ℹ️ Google Sheets sync is disabled.");
    return () => {};
  }

  const source = options.source ?? new GoogleSheetsRegistrationSource();
  let isSyncInFlight = false;
  let isEmailInFlight = false;

  console.log("-----------------------------------------");
  console.log(`[Worker] 🚀 Bootstrapping Background Services...`);
  console.log(`[Worker] 📍 Target Event:  ${options.config.DEFAULT_EVENT_SLUG}`);
  console.log(`[Worker] 📩 Email System:   ENABLED`);
  console.log(`[Worker] ⏲️  Polling Rate:   Every 60s (Strict 5/min)`);
  console.log("-----------------------------------------");

  const runTick = async () => {
    // 1. SYNC PHASE (Parallel-ready)
    const syncPhase = async () => {
      if (isSyncInFlight) return;
      isSyncInFlight = true;
      try {
        console.log(`[Sync] 🔄 Polling Google Sheets...`);
        const result = await syncRegistrantsFromSource(
          options.prisma,
          source,
          options.config.DEFAULT_EVENT_SLUG,
        );
        if (result.processed > 0) {
          console.log(`[Sync] ✅ Success: ${result.processed} new items synced.`);
        }
      } catch (error: any) {
        console.error(`[Sync] ❌ Error: ${error.message}`);
      } finally {
        isSyncInFlight = false;
      }
    };

    // 2. EMAIL PHASE (Parallel-ready)
    const emailPhase = async () => {
      if (isEmailInFlight) return;
      isEmailInFlight = true;
      try {
        const emailResult = await deliverPendingQrEmails(options.prisma, {
          eventSlug: options.config.DEFAULT_EVENT_SLUG,
          limit: 5, // Strictly 5 per minute
        });

        if (emailResult.sent > 0 || emailResult.failed > 0) {
           console.log(`[Email] ✅ Results: Sent ${emailResult.sent} | Failed ${emailResult.failed}`);
        }
      } catch (error: any) {
        console.error(`[Email] ❌ Error: ${error.message}`);
      } finally {
        isEmailInFlight = false;
      }
    };

    // Run both in parallel so slow sync doesn't block fast emails (or vice versa)
    await Promise.allSettled([syncPhase(), emailPhase()]);
  };

  void runTick();
  // Strictly 60 seconds to satisfy the 5-emails-per-minute limit
  const intervalId = setInterval(() => {
    void runTick();
  }, 60000); 

  return () => {
    clearInterval(intervalId);
  };
}
