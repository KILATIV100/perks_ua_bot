import { PrismaClient } from '@prisma/client';
import { seedLocations, seedProducts } from '../src/data/seedData.js';

const prisma = new PrismaClient();

async function main(): Promise<void> {
  console.log('🌱 Seeding database...');

  // Seed locations
  await prisma.location.deleteMany({});
  console.log('🗑️ Cleared existing locations');

  for (const location of seedLocations) {
    await prisma.location.create({ data: location });
    console.log(`✅ Created location: ${location.name} (${location.status})`);
  }

  const locationCount = await prisma.location.count();
  console.log(`📍 Total locations: ${locationCount}`);

  // Seed products (always recreate to keep menu up-to-date)
  await prisma.orderItem.updateMany({ where: { productId: { not: undefined } }, data: { productId: null } });
  await prisma.product.deleteMany({});
  await prisma.product.createMany({ data: seedProducts });
  console.log(`☕ Created ${seedProducts.length} products`);

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
