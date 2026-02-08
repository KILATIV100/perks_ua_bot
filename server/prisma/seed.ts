import { PrismaClient, LocationStatus, ProductType } from '@prisma/client';

const prisma = new PrismaClient();

interface LocationSeed {
  name: string;
  lat: number | null;
  long: number | null;
  address: string;
  status: LocationStatus;
  canPreorder: boolean;
}

const locations: LocationSeed[] = [
  {
    name: 'Mark Mall',
    lat: 50.51485367479439,
    long: 30.78219892858682,
    address: 'ТРЦ Mark Mall, Бровари',
    status: 'active',
    canPreorder: false,
  },
  {
    name: 'Парк "Приозерний"',
    lat: 50.50128659421246,
    long: 30.754029265863245,
    address: 'Парк Приозерний, Бровари',
    status: 'active',
    canPreorder: true,
  },
  {
    name: 'ЖК "Лісовий квартал"',
    lat: 50.51758555255138,
    long: 30.783235338021694,
    address: 'ЖК Лісовий квартал, Бровари',
    status: 'coming_soon',
    canPreorder: false,
  },
];

const products = [
  // ===== Кава (MENU) =====
  { name: 'Еспресо', description: null, volume: '110 мл', price: 40, category: 'Кава', type: 'MENU' as ProductType, imageUrl: null },
  { name: 'Допіо', description: null, volume: '180 мл', price: 60, category: 'Кава', type: 'MENU' as ProductType, imageUrl: null },
  { name: 'Американо', description: null, volume: '180 мл', price: 40, category: 'Кава', type: 'MENU' as ProductType, imageUrl: null },
  { name: 'Американо з молоком', description: null, volume: '180 мл', price: 50, category: 'Кава', type: 'MENU' as ProductType, imageUrl: null },
  { name: 'Макіато', description: 'Еспресо з молоком', volume: '180 мл', price: 50, category: 'Кава', type: 'MENU' as ProductType, imageUrl: null },
  { name: 'Капучіно', description: null, volume: '180 мл', price: 55, category: 'Кава', type: 'MENU' as ProductType, imageUrl: null },
  { name: 'Капучіно', description: null, volume: '250 мл', price: 65, category: 'Кава', type: 'MENU' as ProductType, imageUrl: null },
  { name: 'Капучіно', description: null, volume: '350 мл', price: 85, category: 'Кава', type: 'MENU' as ProductType, imageUrl: null },
  { name: 'Лате', description: null, volume: '350 мл', price: 75, category: 'Кава', type: 'MENU' as ProductType, imageUrl: null },
  { name: 'Лате', description: null, volume: '450 мл', price: 85, category: 'Кава', type: 'MENU' as ProductType, imageUrl: null },
  { name: 'Флет уайт', description: null, volume: '180 мл', price: 65, category: 'Кава', type: 'MENU' as ProductType, imageUrl: null },
  { name: 'Флет уайт', description: null, volume: '250 мл', price: 80, category: 'Кава', type: 'MENU' as ProductType, imageUrl: null },
  { name: 'Раф', description: null, volume: '250 мл', price: 100, category: 'Кава', type: 'MENU' as ProductType, imageUrl: null },
  { name: 'Раф', description: null, volume: '350 мл', price: 150, category: 'Кава', type: 'MENU' as ProductType, imageUrl: null },
  { name: 'Фільтр кава', description: null, volume: '250 мл', price: 55, category: 'Кава', type: 'MENU' as ProductType, imageUrl: null },
  { name: 'Фільтр кава', description: null, volume: '350 мл', price: 65, category: 'Кава', type: 'MENU' as ProductType, imageUrl: null },
  { name: 'Мокачіно', description: null, volume: '350 мл', price: 95, category: 'Кава', type: 'MENU' as ProductType, imageUrl: null },
  { name: 'Капуоранж', description: null, volume: '250 мл', price: 90, category: 'Кава', type: 'MENU' as ProductType, imageUrl: null },
  { name: 'Капуоранж', description: null, volume: '350 мл', price: 140, category: 'Кава', type: 'MENU' as ProductType, imageUrl: null },
  { name: 'Чорний оксамит', description: null, volume: '250 мл', price: 85, category: 'Кава', type: 'MENU' as ProductType, imageUrl: null },
  { name: 'Чорний оксамит', description: null, volume: '400 мл', price: 95, category: 'Кава', type: 'MENU' as ProductType, imageUrl: null },
  { name: 'Раф дубайський шоколад', description: null, volume: '250 мл', price: 150, category: 'Кава', type: 'MENU' as ProductType, imageUrl: null },
  { name: 'Раф дубайський шоколад', description: null, volume: '400 мл', price: 200, category: 'Кава', type: 'MENU' as ProductType, imageUrl: null },
  { name: 'Лате сирна груша', description: null, volume: '250 мл', price: 95, category: 'Кава', type: 'MENU' as ProductType, imageUrl: null },
  { name: 'Лате сирна груша', description: null, volume: '400 мл', price: 125, category: 'Кава', type: 'MENU' as ProductType, imageUrl: null },
  { name: 'Гарбузове лате', description: null, volume: '250 мл', price: 85, category: 'Кава', type: 'MENU' as ProductType, imageUrl: null },
  { name: 'Гарбузове лате', description: null, volume: '400 мл', price: 95, category: 'Кава', type: 'MENU' as ProductType, imageUrl: null },

  // ===== Холодні напої (MENU) =====
  { name: 'ICE-лате', description: null, volume: null, price: 95, category: 'Холодні напої', type: 'MENU' as ProductType, imageUrl: null },
  { name: 'ICE-какао', description: null, volume: null, price: 95, category: 'Холодні напої', type: 'MENU' as ProductType, imageUrl: null },
  { name: 'ICE-матча', description: null, volume: null, price: 110, category: 'Холодні напої', type: 'MENU' as ProductType, imageUrl: null },
  { name: 'ICE-раф', description: null, volume: null, price: 130, category: 'Холодні напої', type: 'MENU' as ProductType, imageUrl: null },
  { name: 'Джміль (Бамбл)', description: null, volume: null, price: 110, category: 'Холодні напої', type: 'MENU' as ProductType, imageUrl: null },
  { name: 'Еспресо-тонік', description: null, volume: null, price: 95, category: 'Холодні напої', type: 'MENU' as ProductType, imageUrl: null },
  { name: 'Матча тонік', description: null, volume: null, price: 110, category: 'Холодні напої', type: 'MENU' as ProductType, imageUrl: null },
  { name: 'Матча оранж', description: null, volume: null, price: 110, category: 'Холодні напої', type: 'MENU' as ProductType, imageUrl: null },
  { name: 'Лимонад класичний', description: null, volume: null, price: 95, category: 'Холодні напої', type: 'MENU' as ProductType, imageUrl: null },
  { name: 'Лимонад манго-маракуя', description: null, volume: null, price: 95, category: 'Холодні напої', type: 'MENU' as ProductType, imageUrl: null },
  { name: 'Лимонад полуниця-лічі', description: null, volume: null, price: 95, category: 'Холодні напої', type: 'MENU' as ProductType, imageUrl: null },
  { name: 'Апероль', description: 'Безалкогольний', volume: null, price: 95, category: 'Холодні напої', type: 'MENU' as ProductType, imageUrl: null },
  { name: 'Блакитна лагуна', description: 'Безалкогольний', volume: null, price: 95, category: 'Холодні напої', type: 'MENU' as ProductType, imageUrl: null },
  { name: 'Мохіто', description: 'Безалкогольний', volume: null, price: 110, category: 'Холодні напої', type: 'MENU' as ProductType, imageUrl: null },
  { name: 'Фрапе', description: null, volume: null, price: 140, category: 'Холодні напої', type: 'MENU' as ProductType, imageUrl: null },
  { name: 'Молочний коктейль', description: null, volume: null, price: 110, category: 'Холодні напої', type: 'MENU' as ProductType, imageUrl: null },
  { name: 'Глясе', description: null, volume: '250 мл', price: 95, category: 'Холодні напої', type: 'MENU' as ProductType, imageUrl: null },
  { name: 'Coca-Cola', description: null, volume: '0.5 л', price: 35, category: 'Холодні напої', type: 'MENU' as ProductType, imageUrl: null },
  { name: 'Fanta', description: null, volume: '0.5 л', price: 35, category: 'Холодні напої', type: 'MENU' as ProductType, imageUrl: null },
  { name: 'Sprite', description: null, volume: '0.5 л', price: 35, category: 'Холодні напої', type: 'MENU' as ProductType, imageUrl: null },
  { name: 'Енергетик Монстр', description: null, volume: null, price: 90, category: 'Холодні напої', type: 'MENU' as ProductType, imageUrl: null },
  { name: 'Енергетик Бьорн', description: null, volume: null, price: 60, category: 'Холодні напої', type: 'MENU' as ProductType, imageUrl: null },

  // ===== Не кава (MENU) =====
  { name: 'Какао', description: null, volume: '250 мл', price: 65, category: 'Не кава', type: 'MENU' as ProductType, imageUrl: null },
  { name: 'Какао', description: null, volume: '350 мл', price: 75, category: 'Не кава', type: 'MENU' as ProductType, imageUrl: null },
  { name: 'Матча', description: null, volume: '250 мл', price: 85, category: 'Не кава', type: 'MENU' as ProductType, imageUrl: null },
  { name: 'Чай натуральний', description: null, volume: '500 мл', price: 70, category: 'Не кава', type: 'MENU' as ProductType, imageUrl: null },
  { name: 'Чай листовий', description: null, volume: '500 мл', price: 40, category: 'Не кава', type: 'MENU' as ProductType, imageUrl: null },
  { name: 'Гарячий шоколад', description: null, volume: '350 мл', price: 110, category: 'Не кава', type: 'MENU' as ProductType, imageUrl: null },
  { name: 'Глінтвейн б/а', description: null, volume: '250 мл', price: 95, category: 'Не кава', type: 'MENU' as ProductType, imageUrl: null },
  { name: 'Глінтвейн б/а', description: null, volume: '400 мл', price: 125, category: 'Не кава', type: 'MENU' as ProductType, imageUrl: null },
  { name: 'Бебічіно', description: null, volume: '250 мл', price: 90, category: 'Не кава', type: 'MENU' as ProductType, imageUrl: null },
  { name: 'Бебічіно', description: null, volume: '350 мл', price: 130, category: 'Не кава', type: 'MENU' as ProductType, imageUrl: null },

  // ===== Солодощі та Їжа (MENU) =====
  { name: 'Хот-дог', description: null, volume: null, price: 70, category: 'Їжа', type: 'MENU' as ProductType, imageUrl: null },
  { name: 'Бургер', description: null, volume: null, price: 70, category: 'Їжа', type: 'MENU' as ProductType, imageUrl: null },
  { name: 'Сендвіч', description: null, volume: null, price: 65, category: 'Їжа', type: 'MENU' as ProductType, imageUrl: null },
  { name: 'Київський сирник', description: null, volume: null, price: 90, category: 'Їжа', type: 'MENU' as ProductType, imageUrl: null },
  { name: 'Трубочка зі згущеним молоком', description: null, volume: null, price: 55, category: 'Їжа', type: 'MENU' as ProductType, imageUrl: null },
  { name: 'Горішок зі згущеним молоком', description: null, volume: null, price: 30, category: 'Їжа', type: 'MENU' as ProductType, imageUrl: null },
  { name: 'Макарун', description: null, volume: null, price: 75, category: 'Їжа', type: 'MENU' as ProductType, imageUrl: null },
  { name: 'Картопля кремова', description: null, volume: null, price: 65, category: 'Їжа', type: 'MENU' as ProductType, imageUrl: null },
  { name: 'Круасан Ньюйоркер', description: null, volume: null, price: 55, category: 'Їжа', type: 'MENU' as ProductType, imageUrl: null },

  // ===== Кава на продаж (COFFEE_BEANS) =====
  { name: 'Zavari Ethiopia', description: null, volume: '200 г', price: 380, category: 'Кава на продаж', type: 'COFFEE_BEANS' as ProductType, imageUrl: null },
  { name: 'Zavari Italy blend', description: null, volume: '200 г', price: 340, category: 'Кава на продаж', type: 'COFFEE_BEANS' as ProductType, imageUrl: null },
  { name: 'Zavari Guatemala', description: null, volume: '200 г', price: 300, category: 'Кава на продаж', type: 'COFFEE_BEANS' as ProductType, imageUrl: null },
  { name: 'Zavari Santos', description: null, volume: '200 г', price: 340, category: 'Кава на продаж', type: 'COFFEE_BEANS' as ProductType, imageUrl: null },
  { name: 'Кава Ethiopia', description: 'Зерно, свіжий смак', volume: '250 г', price: 380, category: 'Кава на продаж', type: 'COFFEE_BEANS' as ProductType, imageUrl: null },

  // ===== Мерч (MERCH) =====
  { name: 'Худі "PerkUp Original"', description: 'Стильне худі з логотипом PerkUp', volume: null, price: 1200, category: 'Мерч', type: 'MERCH' as ProductType, imageUrl: null },
  { name: 'Термочашка "Coffee Lover"', description: 'Термочашка з фірмовим дизайном', volume: '350 мл', price: 450, category: 'Мерч', type: 'MERCH' as ProductType, imageUrl: null },
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

  // Seed products (always recreate to keep menu up-to-date)
  await prisma.orderItem.updateMany({ where: { productId: { not: undefined } }, data: { productId: null } });
  await prisma.product.deleteMany({});
  await prisma.product.createMany({ data: products });
  console.log(`☕ Created ${products.length} products`);

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
