import { ProductType } from '@prisma/client';

export interface LocationSeed {
  slug: string;
  name: string;
  latitude: number | null;
  longitude: number | null;
  address: string;
  hasOrdering: boolean;
  isViewOnly: boolean;
  isActive: boolean;
}

export const seedLocations: LocationSeed[] = [
  {
    slug: 'mark-mall',
    name: 'Mark Mall',
    latitude: 50.51482724566517,
    longitude: 30.782198499061632,
    address: 'ТРЦ Mark Mall, Бровари',
    hasOrdering: false,
    isViewOnly: false,
    isActive: true,
  },
  {
    slug: 'park-pryozernyi',
    name: 'Парк "Приозерний"',
    latitude: 50.501291914923804,
    longitude: 30.754033777909726,
    address: 'Парк Приозерний, Бровари',
    hasOrdering: true,
    isViewOnly: false,
    isActive: true,
  },
  {
    slug: 'zhk-krona-park-2',
    name: 'ЖК "Krona Park 2" (незабаром відкриття)',
    latitude: 50.51726299985014,
    longitude: 30.779625658162075,
    address: 'ЖК Krona Park 2, Бровари',
    hasOrdering: false,
    isViewOnly: true,
    isActive: true,
  },
];

export const seedProducts = [
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

  // ===== Кава на продаж (BEANS) =====
  { name: 'Zavari Ethiopia', description: null, volume: '200 г', price: 380, category: 'Кава на продаж', type: 'BEANS' as ProductType, imageUrl: null },
  { name: 'Zavari Italy blend', description: null, volume: '200 г', price: 340, category: 'Кава на продаж', type: 'BEANS' as ProductType, imageUrl: null },
  { name: 'Zavari Guatemala', description: null, volume: '200 г', price: 300, category: 'Кава на продаж', type: 'BEANS' as ProductType, imageUrl: null },
  { name: 'Zavari Santos', description: null, volume: '200 г', price: 340, category: 'Кава на продаж', type: 'BEANS' as ProductType, imageUrl: null },
  { name: 'Кава Ethiopia', description: 'Зерно, свіжий смак', volume: '250 г', price: 380, category: 'Кава на продаж', type: 'BEANS' as ProductType, imageUrl: null },

  // ===== Мерч (MERCH) =====
  { name: 'Худі "PerkUp Original"', description: 'Стильне худі з логотипом PerkUp', volume: null, price: 1200, category: 'Мерч', type: 'MERCH' as ProductType, imageUrl: null },
  { name: 'Термочашка "Coffee Lover"', description: 'Термочашка з фірмовим дизайном', volume: '350 мл', price: 450, category: 'Мерч', type: 'MERCH' as ProductType, imageUrl: null },
];
