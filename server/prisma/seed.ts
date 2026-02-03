import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const locations = [
  {
    name: 'Mark Mall',
    latitude: 50.514794,
    longitude: 30.782308,
    address: 'ТРЦ Mark Mall',
  },
  {
    name: 'Парк "Приозерний"',
    latitude: 50.501265,
    longitude: 30.754011,
    address: 'Парк Приозерний',
  },
  {
    name: 'ЖК "Лісовий квартал"',
    latitude: null,
    longitude: null,
    address: 'ЖК Лісовий квартал (локація уточнюється)',
  },
];

async function main() {
  console.log('🌱 Seeding database...');

  for (const location of locations) {
    const existing = await prisma.location.findFirst({
      where: { name: location.name },
    });

    if (!existing) {
      await prisma.location.create({
        data: location,
      });
      console.log(`✅ Created location: ${location.name}`);
    } else {
      console.log(`⏭️ Location already exists: ${location.name}`);
    }
  }

  console.log('🎉 Seeding completed!');
}

main()
  .catch((e) => {
    console.error('❌ Seeding error:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
