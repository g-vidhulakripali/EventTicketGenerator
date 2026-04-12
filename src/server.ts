import { buildApp } from "./app";
import { env } from "./config/env";
import { startGoogleSheetsSyncPolling } from "./modules/sync/sync-poller";
import { getDirectPrismaClient } from "./config/prisma";

async function start() {
  const app = buildApp();
  const directPrisma = getDirectPrismaClient();

  const stopGoogleSheetsSyncPolling = startGoogleSheetsSyncPolling({
    prisma: directPrisma,
    config: app.config,
    logger: app.log,
  });

  app.addHook("onClose", async () => {
    stopGoogleSheetsSyncPolling();
  });

  await app.listen({ port: env.PORT, host: "0.0.0.0" });
}

start().catch((error) => {
  console.error(error);
  process.exit(1);
});
