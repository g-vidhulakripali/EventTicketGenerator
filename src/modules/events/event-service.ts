import { PrismaClient } from "@prisma/client";
import { AppError } from "../../utils/errors";

export async function getEventBySlug(prisma: PrismaClient, slug: string) {
  // Try exact match first
  let event = await prisma.event.findUnique({ where: { slug } });
  
  // Try case-insensitive fallback if not found
  if (!event) {
    event = await prisma.event.findFirst({
      where: {
        slug: {
          equals: slug,
          mode: 'insensitive'
        }
      }
    });
  }

  if (!event || !event.isActive) {
    throw new AppError(404, `Event not found or inactive: "${slug}"`);
  }

  return event;
}
