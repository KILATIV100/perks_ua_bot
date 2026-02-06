import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const OWNER_TELEGRAM_ID = '7363233852';
const POINTS_TO_SET = 100;

async function main(): Promise<void> {
  console.log(`Setting ${POINTS_TO_SET} points for user ${OWNER_TELEGRAM_ID}...`);

  const user = await prisma.user.update({
    where: { telegramId: OWNER_TELEGRAM_ID },
    data: { points: POINTS_TO_SET },
    select: {
      telegramId: true,
      firstName: true,
      points: true,
    },
  });

  console.log(`✅ Done! User ${user.firstName || user.telegramId} now has ${user.points} points.`);
}

main()
  .catch((e: Error) => {
    console.error('❌ Error:', e.message);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
