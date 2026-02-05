import { Bot, InlineKeyboard } from 'grammy';

// Environment variables
const BOT_TOKEN = process.env.BOT_TOKEN;

// WebApp URL - perkup.com.ua
const WEB_APP_URL = 'https://perkup.com.ua';

if (!BOT_TOKEN) {
  throw new Error('BOT_TOKEN environment variable is required');
}

const bot = new Bot(BOT_TOKEN);

// PerkUp locations in Brovary
const LOCATIONS = [
  { name: 'Mark Mall', lat: 50.51485367479439, lng: 30.78219892858682 },
  { name: 'Парк "Приозерний"', lat: 50.50128659421246, lng: 30.754029265863245 },
  { name: 'ЖК "Лісовий квартал"', lat: 50.51758555255138, lng: 30.783235338021694 },
];

// Notification radius in meters (500m)
const NOTIFICATION_RADIUS = 500;

// Random notification messages
const PROXIMITY_MESSAGES = [
  "Відчуваєш цей аромат? ☕️ Ти всього в 5 хвилинах від ідеального капучино. Заходь!",
  "Бро, ти сьогодні якийсь занадто тверезий... Може, час на подвійний еспресо? Ми поруч! 😉",
  "Твоя денна норма кави сама себе не вип'є. Завітай у PerkUp, ми за 500 метрів від тебе!",
  "Ого, яка зустріч! Ти якраз поблизу нашої точки. Заходь, крутнеш колесо — може, кава буде зі знижкою? 🎡",
  "Твої бали сумують без тебе... Заходь на Mark Mall, ми вже розігріли кавомашину!",
];

/**
 * Calculate distance between two coordinates using Haversine formula
 * @returns Distance in meters
 */
function calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000; // Earth's radius in meters
  const dLat = toRadians(lat2 - lat1);
  const dLon = toRadians(lon2 - lon1);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function toRadians(degrees: number): number {
  return degrees * (Math.PI / 180);
}

/**
 * Find nearest location and check if within notification radius
 */
function findNearestLocation(userLat: number, userLng: number): { name: string; distance: number } | null {
  let nearest: { name: string; distance: number } | null = null;

  for (const location of LOCATIONS) {
    const distance = calculateDistance(userLat, userLng, location.lat, location.lng);

    if (!nearest || distance < nearest.distance) {
      nearest = { name: location.name, distance };
    }
  }

  return nearest;
}

/**
 * Get random message from array
 */
function getRandomMessage(): string {
  return PROXIMITY_MESSAGES[Math.floor(Math.random() * PROXIMITY_MESSAGES.length)];
}

// Start command - greet user and show Mini App button
bot.command('start', async (ctx) => {
  const user = ctx.from;
  const firstName = user?.first_name || 'друже';

  const keyboard = new InlineKeyboard().webApp(
    '☕ Відкрити PerkUp',
    WEB_APP_URL
  );

  await ctx.reply(
    `Привіт, ${firstName}! 👋\n\n` +
      `Ласкаво просимо до *PerkUp* — твого помічника у світі кави! ☕\n\n` +
      `Тут ти можеш:\n` +
      `• Обрати найближчу кав'ярню\n` +
      `• Зробити замовлення онлайн\n` +
      `• Накопичувати бонуси\n` +
      `• Крутити Колесо Фортуни 🎡\n\n` +
      `📍 *Надішли свою геолокацію* і ми повідомимо, коли будеш поруч з нашими кав'ярнями!\n\n` +
      `Натисни кнопку нижче, щоб почати! 👇`,
    {
      parse_mode: 'Markdown',
      reply_markup: keyboard,
    }
  );
});

// Help command
bot.command('help', async (ctx) => {
  const keyboard = new InlineKeyboard().webApp(
    '☕ Відкрити PerkUp',
    WEB_APP_URL
  );

  await ctx.reply(
    `*Як користуватися PerkUp:*\n\n` +
      `1️⃣ Натисни кнопку "Відкрити PerkUp"\n` +
      `2️⃣ Обери локацію кав'ярні\n` +
      `3️⃣ Переглянь меню та зроби замовлення\n` +
      `4️⃣ Отримай сповіщення, коли замовлення готове\n\n` +
      `🎡 *Колесо Фортуни:*\n` +
      `• Підійди до кав'ярні (до 50м)\n` +
      `• Крутни колесо раз на день\n` +
      `• Отримай 5, 10 або 15 балів!\n\n` +
      `📍 Надішли геолокацію, щоб дізнатися відстань до найближчої точки.\n\n` +
      `Якщо є питання — пиши нам! 💬`,
    {
      parse_mode: 'Markdown',
      reply_markup: keyboard,
    }
  );
});

// Handle location messages
bot.on('message:location', async (ctx) => {
  const { latitude, longitude } = ctx.message.location;
  const user = ctx.from;
  const firstName = user?.first_name || 'друже';

  console.log(`[Location] User ${user?.id} (${firstName}): ${latitude}, ${longitude}`);

  const nearest = findNearestLocation(latitude, longitude);

  if (!nearest) {
    await ctx.reply('Не вдалося визначити найближчу локацію. Спробуй пізніше!');
    return;
  }

  const keyboard = new InlineKeyboard().webApp(
    '☕ Відкрити PerkUp',
    WEB_APP_URL
  );

  if (nearest.distance <= NOTIFICATION_RADIUS) {
    // User is nearby - send random notification
    const randomMessage = getRandomMessage();

    await ctx.reply(
      `📍 *${nearest.name}* — ${Math.round(nearest.distance)} метрів\n\n` +
        `${randomMessage}`,
      {
        parse_mode: 'Markdown',
        reply_markup: keyboard,
      }
    );
  } else if (nearest.distance <= 2000) {
    // User is within 2km
    await ctx.reply(
      `📍 Найближча кав'ярня: *${nearest.name}*\n` +
        `Відстань: ${Math.round(nearest.distance)} метрів\n\n` +
        `Підійди ближче, щоб крутнути Колесо Фортуни! 🎡`,
      {
        parse_mode: 'Markdown',
        reply_markup: keyboard,
      }
    );
  } else {
    // User is far away
    const distanceKm = (nearest.distance / 1000).toFixed(1);
    await ctx.reply(
      `📍 Найближча кав'ярня: *${nearest.name}*\n` +
        `Відстань: ${distanceKm} км\n\n` +
        `Поки що ти далековато, але ми чекаємо на тебе! ☕`,
      {
        parse_mode: 'Markdown',
        reply_markup: keyboard,
      }
    );
  }
});

// Handle any text message
bot.on('message:text', async (ctx) => {
  const keyboard = new InlineKeyboard().webApp(
    '☕ Відкрити PerkUp',
    WEB_APP_URL
  );

  await ctx.reply(
    `Щоб зробити замовлення, скористайся нашим додатком! 👇\n\n` +
      `📍 Або надішли свою геолокацію, щоб дізнатися відстань до найближчої кав'ярні.`,
    {
      reply_markup: keyboard,
    }
  );
});

// Error handling
bot.catch((err) => {
  console.error('Bot error:', err);
});

// Start bot
console.log('🤖 Starting PerkUp bot...');
bot.start({
  onStart: (botInfo) => {
    console.log(`✅ Bot @${botInfo.username} is running!`);
  },
});
