import { PrismaClient } from '@prisma/client';
import { seedLocations, seedProducts, seedTracks } from '../src/data/seedData.js';

const prisma = new PrismaClient();

async function main(): Promise<void> {
  console.log('🌱 Seeding database...');

  // Clear dependent data first to avoid FK constraint issues
  await prisma.orderItem.deleteMany({});
  await prisma.order.deleteMany({});
  await prisma.product.deleteMany({});
  await prisma.location.deleteMany({});
  console.log('🗑️ Cleared existing order data, products, and locations');

  // Seed locations
  for (const location of seedLocations) {
    await prisma.location.create({ data: location });
    console.log(`✅ Created location: ${location.name} (${location.status})`);
  }

  const locationCount = await prisma.location.count();
  console.log(`📍 Total locations: ${locationCount}`);

  // Seed products (always recreate to keep menu up-to-date)
  await prisma.product.createMany({ data: seedProducts });
  console.log(`☕ Created ${seedProducts.length} products`);

  // Seed local playlist tracks (set MUSIC_BASE_URL env if needed)
  await prisma.track.createMany({
    data: seedTracks,
    skipDuplicates: true,
  });
  console.log('🎵 Seeded demo tracks for /api/radio/tracks');

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
