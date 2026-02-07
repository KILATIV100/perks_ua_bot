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

const products = [
  // Кава
  { name: 'Еспресо', description: 'Класичний еспресо', price: 55, category: 'Кава', imageUrl: null },
  { name: 'Американо', description: 'Еспресо з гарячою водою', price: 65, category: 'Кава', imageUrl: null },
  { name: 'Капучіно', description: 'Еспресо з молочною пінкою', price: 85, category: 'Кава', imageUrl: null },
  { name: 'Лате', description: 'Еспресо з великою кількістю молока', price: 90, category: 'Кава', imageUrl: null },
  { name: 'Флет Вайт', description: 'Подвійний еспресо з молоком', price: 95, category: 'Кава', imageUrl: null },
  { name: 'Раф', description: 'Еспресо з вершками та ванільним цукром', price: 100, category: 'Кава', imageUrl: null },
  // Чай
  { name: 'Чай чорний', description: 'Класичний чорний чай', price: 55, category: 'Чай', imageUrl: null },
  { name: 'Чай зелений', description: 'Зелений чай з жасмином', price: 55, category: 'Чай', imageUrl: null },
  { name: 'Чай фруктовий', description: 'Фруктова суміш', price: 65, category: 'Чай', imageUrl: null },
  // Холодні напої
  { name: 'Айс Лате', description: 'Лате з льодом', price: 95, category: 'Холодні напої', imageUrl: null },
  { name: 'Айс Американо', description: 'Американо з льодом', price: 75, category: 'Холодні напої', imageUrl: null },
  { name: 'Лимонад', description: 'Домашній лимонад', price: 80, category: 'Холодні напої', imageUrl: null },
  // Випічка
  { name: 'Круасан', description: 'Масляний круасан', price: 65, category: 'Випічка', imageUrl: null },
  { name: 'Круасан з шоколадом', description: 'З бельгійським шоколадом', price: 75, category: 'Випічка', imageUrl: null },
  { name: 'Чізкейк', description: 'Ніжний вершковий чізкейк', price: 95, category: 'Випічка', imageUrl: null },
];

async function main(): Promise<void> {
  console.log('🌱 Seeding database...');

  // Seed locations
  await prisma.location.deleteMany({});
  console.log('🗑️ Cleared existing locations');

  for (const location of locations) {
    await prisma.location.create({ data: location });
    console.log(`✅ Created location: ${location.name} (${location.status})`);
  }

  const locationCount = await prisma.location.count();
  console.log(`📍 Total locations: ${locationCount}`);

  // Seed products
  const existingProducts = await prisma.product.count();
  if (existingProducts === 0) {
    await prisma.product.createMany({ data: products });
    console.log(`☕ Created ${products.length} products`);
  } else {
    console.log(`☕ Products already exist (${existingProducts}), skipping`);
  }

  console.log('🎉 Seeding completed!');
}

main()
  .catch((e: Error) => {
    console.error('❌ Seeding error:', e.message);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
