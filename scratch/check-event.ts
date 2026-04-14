import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function main() {
  const event = await prisma.event.findFirst({ 
    where: { slug: { equals: 'aI-conference-2026', mode: 'insensitive' } } 
  });
  console.log('Event exists:', !!event);
  if (event) {
    console.log('Event details:', JSON.stringify(event, null, 2));
  }
}
main().finally(() => prisma.$disconnect());
