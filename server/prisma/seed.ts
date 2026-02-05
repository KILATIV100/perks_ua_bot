import { PrismaClient, LocationStatus } from '@prisma/client';

const prisma = new PrismaClient();

interface LocationSeed {
  name: string;
  lat: number | null;
  long: number | null;
  address: string;
  status: LocationStatus;
}

const locations: LocationSeed[] = [
  {
    name: 'Mark Mall',
    lat: 50.51485367479439,
    long: 30.78219892858682,
    address: 'ТРЦ Mark Mall, Бровари',
    status: 'active',
  },
  {
    name: 'Парк "Приозерний"',
    lat: 50.50128659421246,
    long: 30.754029265863245,
    address: 'Парк Приозерний, Бровари',
    status: 'active',
  },
  {
    name: 'ЖК "Лісовий квартал"',
    lat: 50.51758555255138,
    long: 30.783235338021694,
    address: 'ЖК Лісовий квартал, Бровари',
    status: 'coming_soon',
  },
];

async function main(): Promise<void> {
  console.log('🌱 Seeding database...');

  // Clear existing locations
  await prisma.location.deleteMany({});
  console.log('🗑️ Cleared existing locations');

  // Create new locations
  for (const location of locations) {
    await prisma.location.create({
      data: location,
    });
    console.log(`✅ Created location: ${location.name} (${location.status})`);
  }

  const count = await prisma.location.count();
  console.log(`🎉 Seeding completed! Total locations: ${count}`);
}

main()
  .catch((e: Error) => {
    console.error('❌ Seeding error:', e.message);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
