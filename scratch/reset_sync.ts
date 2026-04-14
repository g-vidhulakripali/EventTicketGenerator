import { PrismaClient } from "@prisma/client";
import "dotenv/config";

const prisma = new PrismaClient();

async function reset() {
  const result = await prisma.syncState.updateMany({
    data: {
      lastSheetRowNumber: 0,
    },
  });
  console.log("Reset complete:", result);
}

reset()
  .finally(async () => {
    await prisma.$disconnect();
  });
